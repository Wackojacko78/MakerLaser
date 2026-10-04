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
}

#[tauri::command(async)]
pub fn generate_gcode(state: State<'_, AppState>) -> Result<GenerateResponse, String> {
    let project = lock(&state.project)?.clone();
    let job = {
        let assets = lock(&state.assets)?;
        build_job(&project, &assets, &GcodeOptions::default()).map_err(|e| e.to_string())?
    };

    let lines: Vec<String> = job.gcode.lines().map(String::from).collect();
    let estimate = makerlaser_machine::estimate_runtime(&lines, 6000.0);

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
