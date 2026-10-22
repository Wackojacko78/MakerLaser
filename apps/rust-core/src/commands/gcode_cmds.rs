//! The one place the `Workspace -> Operations -> Toolpaths -> G-code` pipeline is run for
//! the UI. The frontend never builds G-code; it asks for a job and renders what comes back.

use std::path::PathBuf;

use makerlaser_project::{build_job, GcodeOptions, MoveKind, SafetyReport, ToolpathStats};
use serde::Serialize;
use tauri::State;

use crate::state::{fingerprint, lock, AppState, GeneratedJob};

/// Preview moves sent to the UI are capped; larger jobs are decimated for display only.
const MAX_PREVIEW_SEGMENTS: usize = 150_000;
/// Only this many G-code lines are sent for the text view.
const MAX_GCODE_PREVIEW_LINES: usize = 3_000;

fn kind_code(kind: MoveKind) -> f32 {
    match kind {
        MoveKind::Travel => 0.0,
        MoveKind::Cut => 1.0,
        MoveKind::Score => 2.0,
        MoveKind::Fill => 3.0,
        MoveKind::Engrave => 4.0,
    }
}

fn round2(v: f64) -> f32 {
    ((v * 100.0).round() / 100.0) as f32
}

#[derive(Debug, Serialize)]
pub struct GenerateResponse {
    /// First lines of the program, for the G-code tab.
    pub gcode_preview: String,
    pub line_count: usize,
    /// `[x0, y0, x1, y1, kind]` per move in workspace mm; kind: 0 travel, 1 cut, 2 score,
    /// 3 fill, 4 engrave.
    pub segments: Vec<[f32; 5]>,
    pub preview_simplified: bool,
    pub stats: ToolpathStats,
    pub safety: SafetyReport,
    pub warnings: Vec<String>,
    pub estimated_seconds: f64,
    /// How much of `estimated_seconds` is the laser off (rapid moves, overscan run-ups).
    pub estimated_travel_seconds: f64,
    /// True when the estimate uses the machine's acceleration; false when it ignores it because the
    /// machine profile has none (older projects), which makes a job of many short moves look quicker
    /// than it is.
    pub estimate_modelled: bool,
}

/// What the machine can do, for the time estimate: the machine profile's own speeds, or the defaults
/// the estimate has always used for any it does not know.
fn motion_profile(
    machine: &makerlaser_common::MachineProfile,
) -> makerlaser_machine::MotionProfile {
    makerlaser_machine::MotionProfile {
        rapid_mm_min: machine
            .rapid_feed_mm_min
            .unwrap_or(makerlaser_machine::DEFAULT_RAPID_MM_MIN),
        acceleration_mm_s2: machine.acceleration_mm_s2,
        junction_deviation_mm: machine
            .junction_deviation_mm
            .unwrap_or(makerlaser_machine::DEFAULT_JUNCTION_DEVIATION_MM),
    }
}

#[tauri::command(async)]
pub fn generate_gcode(state: State<'_, AppState>) -> Result<GenerateResponse, String> {
    let project = lock(&state.project)?.clone();
    let job = {
        let assets = lock(&state.assets)?;
        build_job(&project, &assets, &GcodeOptions::default()).map_err(|e| e.to_string())?
    };

    let lines: Vec<String> = job.gcode.lines().map(String::from).collect();
    let motion = motion_profile(&project.machine);
    let estimate = makerlaser_machine::estimate_motion(&lines, &motion);

    let all = &job.toolpath.toolpath.segments;
    let stride = if all.len() > MAX_PREVIEW_SEGMENTS {
        all.len().div_ceil(MAX_PREVIEW_SEGMENTS)
    } else {
        1
    };
    let segments: Vec<[f32; 5]> = all
        .iter()
        .enumerate()
        .filter(|(i, _)| i % stride == 0)
        .map(|(_, s)| {
            [
                round2(s.from.x),
                round2(s.from.y),
                round2(s.to.x),
                round2(s.to.y),
                kind_code(s.kind),
            ]
        })
        .collect();

    let gcode_preview = lines
        .iter()
        .take(MAX_GCODE_PREVIEW_LINES)
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");

    *lock(&state.generated)? = Some(GeneratedJob {
        lines: lines.clone(),
        safety: job.safety.clone(),
        fingerprint: fingerprint(&project),
    });

    Ok(GenerateResponse {
        gcode_preview,
        line_count: lines.len(),
        segments,
        preview_simplified: stride > 1,
        stats: job.toolpath.stats,
        safety: job.safety,
        warnings: job.warnings,
        estimated_seconds: estimate.total_seconds(),
        estimated_travel_seconds: estimate.travel_seconds,
        estimate_modelled: motion.is_modelled(),
    })
}

/// Writes the last generated program to a `.gcode` file.
#[tauri::command(async)]
pub fn save_gcode(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let generated = lock(&state.generated)?;
    let job = generated
        .as_ref()
        .ok_or_else(|| "Generate the toolpath first.".to_string())?;
    let mut path = PathBuf::from(path);
    if path.extension().is_none() {
        path.set_extension("gcode");
    }
    let mut text = job.lines.join("\n");
    text.push('\n');
    std::fs::write(&path, text).map_err(|e| format!("Cannot write '{}': {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use makerlaser_common::MachineProfile;

    #[test]
    fn the_estimate_uses_the_machines_own_speeds_and_the_old_defaults_for_the_rest() {
        let mut m = MachineProfile::generic_grbl();
        let none = motion_profile(&m);
        assert_eq!(none.rapid_mm_min, 6000.0);
        assert_eq!(none.acceleration_mm_s2, None);
        assert_eq!(none.junction_deviation_mm, 0.01);
        assert!(!none.is_modelled());
        m.rapid_feed_mm_min = Some(30_000.0);
        m.acceleration_mm_s2 = Some(2_500.0);
        m.junction_deviation_mm = Some(0.02);
        let set = motion_profile(&m);
        assert_eq!(
            (
                set.rapid_mm_min,
                set.acceleration_mm_s2,
                set.junction_deviation_mm
            ),
            (30_000.0, Some(2_500.0), 0.02)
        );
        assert!(set.is_modelled());
        // The TTS-55 Pro preset knows its speeds.
        assert!(motion_profile(&MachineProfile::tts55_pro()).is_modelled());
    }
}
