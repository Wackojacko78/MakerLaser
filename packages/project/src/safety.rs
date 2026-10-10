//! Pre-flight safety checks. Machine-connection state is checked where the connection
//! lives (`apps/rust-core`); everything that can be decided from the job alone is here.

use makerlaser_common::{MachineProfile, ProjectFile};
use serde::{Deserialize, Serialize};

use crate::toolpath::{MoveKind, Toolpath};

/// Slack for float error and the 0.01 mm grid of the offsetting library.
pub const BOUNDS_TOLERANCE_MM: f64 = 0.01;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SafetyReport {
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

impl SafetyReport {
    pub fn is_safe_to_run(&self) -> bool {
        self.errors.is_empty()
    }

    pub fn merge(&mut self, other: SafetyReport) {
        self.errors.extend(other.errors);
        self.warnings.extend(other.warnings);
    }
}

/// Checks the toolpath against the machine: every point (travel included) must be finite
/// and inside the bed; speeds and powers must be within the machine's limits.
pub fn check_toolpath(toolpath: &Toolpath, machine: &MachineProfile) -> SafetyReport {
    let mut report = SafetyReport::default();

    if toolpath.segments.is_empty() {
        report
            .warnings
            .push("The toolpath is empty: nothing would be run.".to_string());
        return report;
    }

    let non_finite = toolpath
        .segments
        .iter()
        .filter(|s| {
            !(s.from.is_finite()
                && s.to.is_finite()
                && s.feed_mm_min.is_finite()
                && s.power_percent.is_finite())
        })
        .count();
    if non_finite > 0 {
        report.errors.push(format!(
            "{non_finite} toolpath move(s) contain invalid (NaN or infinite) values; the job cannot be run."
        ));
        return report;
    }

    if let Some(b) = toolpath.bounds() {
        if !b.fits_within(&machine.bed_bounds(), BOUNDS_TOLERANCE_MM) {
            report.errors.push(format!(
                "The job reaches outside the machine's {:.0} x {:.0} mm bed (it spans X {:.1} to {:.1}, Y {:.1} to {:.1} mm). Move or resize the artwork.",
                machine.bed_width_mm, machine.bed_height_mm, b.min.x, b.max.x, b.min.y, b.max.y
            ));
        }
    }

    let too_fast = toolpath
        .segments
        .iter()
        .filter(|s| {
            s.kind != MoveKind::Travel && s.feed_mm_min > machine.max_feed_rate_mm_min + 1e-9
        })
        .count();
    if too_fast > 0 {
        report.errors.push(format!(
            "{too_fast} move(s) exceed the machine's maximum feed rate of {:.0} mm/min.",
            machine.max_feed_rate_mm_min
        ));
    }
    let over_power = toolpath
        .segments
        .iter()
        .filter(|s| {
            s.kind != MoveKind::Travel && (s.power_percent <= 0.0 || s.power_percent > 100.0)
        })
        .count();
    if over_power > 0 {
        report.errors.push(format!(
            "{over_power} move(s) have a laser power outside 0-100%."
        ));
    }
    report
}

/// Machine profile and enabled-layer validation.
pub fn check_project(project: &ProjectFile) -> SafetyReport {
    let mut report = SafetyReport {
        errors: project.validation_errors(),
        warnings: Vec::new(),
    };
    if project.layers.iter().all(|l| !l.enabled) {
        report
            .warnings
            .push("All layers are disabled: nothing would be run.".to_string());
    }
    if project.settings.start_from.is_relative() {
        report.warnings.push(format!(
            "Start From is {} (job origin: {}). The job runs relative to the laser head, and MakerLaser cannot check that it stays on the bed from where the head is: use Frame first. Saved G-code files do not include this placement.",
            project.settings.start_from.label(),
            project.settings.job_origin.label()
        ));
    }
    let overscan_mm = project
        .layers
        .iter()
        .filter(|l| {
            l.enabled
                && matches!(
                    l.kind,
                    makerlaser_common::LayerKind::Fill | makerlaser_common::LayerKind::Image
                )
        })
        .map(|l| l.overscan_mm)
        .fold(0.0_f64, f64::max);
    if overscan_mm > 0.0 && project.settings.start_from.is_relative() {
        report.warnings.push(format!(
            "Overscan adds up to {overscan_mm:.1} mm of laser-off travel beyond each end of every scan line. Start From is relative to the laser head, so MakerLaser cannot keep that inside the bed: leave at least that much clear space around the artwork, and use Frame first."
        ));
    }
    report
}

pub fn check_all(project: &ProjectFile, toolpath: &Toolpath) -> SafetyReport {
    let mut report = check_project(project);
    report.merge(check_toolpath(toolpath, &project.machine));
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::toolpath::ToolpathSegment;
    use makerlaser_common::{Layer, LayerKind, Point2};

    fn path(points: &[(f64, f64)]) -> Toolpath {
        let segments = points
            .windows(2)
            .map(|w| ToolpathSegment {
                from: Point2::new(w[0].0, w[0].1),
                to: Point2::new(w[1].0, w[1].1),
                kind: MoveKind::Cut,
                feed_mm_min: 300.0,
                power_percent: 80.0,
                air_assist: false,
                overscan: false,
            })
            .collect();
        Toolpath { segments }
    }

    #[test]
    fn placing_the_job_relative_to_the_head_is_warned_about_but_not_blocked() {
        let mut p = ProjectFile::new("T", MachineProfile::tts55_pro());
        assert!(!check_project(&p)
            .warnings
            .iter()
            .any(|w| w.contains("Start From")));
        p.settings = serde_json::from_str(
            r#"{"units":"mm","grid_spacing_mm":10.0,"show_grid":true,"show_origin":true,"start_from":"current_position","job_origin":"center"}"#,
        )
        .unwrap();
        let r = check_project(&p);
        assert!(r.is_safe_to_run());
        assert!(r
            .warnings
            .iter()
            .any(|w| w.contains("Start From is Current position") && w.contains("centre")));
    }

    #[test]
    fn overscan_with_a_relative_start_is_warned_about_but_not_blocked() {
        let mut p = ProjectFile::new("T", MachineProfile::tts55_pro());
        p.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Fill)
            .unwrap()
            .overscan_mm = 3.0;
        assert!(!check_project(&p)
            .warnings
            .iter()
            .any(|w| w.contains("Overscan")));
        p.settings = serde_json::from_str(
            r#"{"units":"mm","grid_spacing_mm":10.0,"show_grid":true,"show_origin":true,"start_from":"current_position","job_origin":"center"}"#,
        )
        .unwrap();
        let r = check_project(&p);
        assert!(r.is_safe_to_run());
        assert!(r.warnings.iter().any(|w| w.contains("Overscan adds up to 3.0 mm")));
    }

    #[test]
    fn a_job_inside_the_bed_is_safe() {
        let r = check_toolpath(
            &path(&[(1.0, 1.0), (299.0, 299.0)]),
            &MachineProfile::tts55_pro(),
        );
        assert!(r.is_safe_to_run(), "{r:?}");
    }

    #[test]
    fn a_job_outside_the_bed_is_refused_on_every_side() {
        let m = MachineProfile::tts55_pro();
        for pts in [
            [(-5.0, 10.0), (50.0, 50.0)],
            [(10.0, -5.0), (50.0, 50.0)],
            [(10.0, 10.0), (305.0, 50.0)],
            [(10.0, 10.0), (50.0, 301.0)],
        ] {
            assert!(!check_toolpath(&path(&pts), &m).is_safe_to_run(), "{pts:?}");
        }
    }

    #[test]
    fn float_noise_at_the_edge_is_tolerated() {
        let r = check_toolpath(
            &path(&[(0.0, 0.0), (300.004, 300.0)]),
            &MachineProfile::tts55_pro(),
        );
        assert!(r.is_safe_to_run());
    }

    #[test]
    fn non_finite_values_are_refused() {
        let r = check_toolpath(
            &path(&[(0.0, 0.0), (f64::NAN, 1.0)]),
            &MachineProfile::tts55_pro(),
        );
        assert!(!r.is_safe_to_run());
        let r = check_toolpath(
            &path(&[(0.0, 0.0), (f64::INFINITY, 1.0)]),
            &MachineProfile::tts55_pro(),
        );
        assert!(!r.is_safe_to_run());
    }

    #[test]
    fn an_empty_toolpath_warns_but_is_not_an_error() {
        let r = check_toolpath(&Toolpath::default(), &MachineProfile::tts55_pro());
        assert!(r.is_safe_to_run());
        assert_eq!(r.warnings.len(), 1);
    }

    #[test]
    fn over_speed_moves_are_refused() {
        let mut tp = path(&[(1.0, 1.0), (50.0, 50.0)]);
        tp.segments[0].feed_mm_min = 50_000.0;
        assert!(!check_toolpath(&tp, &MachineProfile::tts55_pro()).is_safe_to_run());
    }

    #[test]
    fn invalid_layers_are_refused_but_only_when_enabled() {
        let mut p = ProjectFile::new("T", MachineProfile::tts55_pro());
        let mut bad = Layer::new("bad", LayerKind::Cut, 9);
        bad.power_percent = 250.0;
        p.layers.push(bad);
        assert!(!check_project(&p).is_safe_to_run());
        p.layers.last_mut().unwrap().enabled = false;
        assert!(check_project(&p).is_safe_to_run());
    }
}
