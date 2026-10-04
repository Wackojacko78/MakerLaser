//! GRBL 1.1 G-code generation: `Toolpaths -> G-code`.
//!
//! * Workspace points are converted to machine coordinates here (and only here) via
//!   `MachineProfile::workspace_to_machine`.
//! * Coordinates are absolute (`G90`) in the active work coordinate system (`G54`): the
//!   laser head must be at the work origin when the job starts.
//! * Laser on uses `M4` (dynamic power), which scales power with speed during
//!   acceleration so corners do not burn. `M5` is always emitted before any travel move, so
//!   safety never depends on GRBL's laser-mode setting (`$32`).
//! * Air assist uses `M8`/`M9` when the machine profile says it is supported.

use makerlaser_common::{MachineProfile, Point2};

use crate::toolpath::{MoveKind, Toolpath};

#[derive(Debug, Clone)]
pub struct GcodeOptions {
    /// Finish with a rapid move back to the work origin.
    pub return_to_origin: bool,
    pub include_comments: bool,
}

impl Default for GcodeOptions {
    fn default() -> Self {
        GcodeOptions {
            return_to_origin: true,
            include_comments: true,
        }
    }
}

/// Formats a coordinate with up to 3 decimals and no trailing zeros.
fn fmt(v: f64) -> String {
    let s = format!("{v:.3}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-0" {
        "0".to_string()
    } else {
        s.to_string()
    }
}

fn sanitize_comment(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control() && *c != ';' && *c != '(' && *c != ')')
        .collect()
}

pub fn generate_gcode(
    toolpath: &Toolpath,
    machine: &MachineProfile,
    project_name: &str,
    options: &GcodeOptions,
) -> String {
    let mut out = String::new();
    if options.include_comments {
        out.push_str(&format!(
            "; MakerLaser job: {}\n",
            sanitize_comment(project_name)
        ));
        out.push_str(&format!("; Machine: {}\n", sanitize_comment(&machine.name)));
        out.push_str("; Start with the laser head at the work origin (X0 Y0).\n");
    }
    out.push_str("G21\nG90\nG94\nG54\nM5\n");

    let max_s = machine.max_spindle_value as f64;
    let mut laser_on = false;
    let mut current_s: Option<u32> = None;
    let mut current_feed: Option<i64> = None;
    let mut air_on = false;
    // The head is assumed to start at the machine/work origin.
    let mut position = Point2::ZERO;

    for seg in &toolpath.segments {
        let from = machine.workspace_to_machine(seg.from);
        let to = machine.workspace_to_machine(seg.to);

        // A discontinuity must never become a laser-on diagonal across the work.
        if position.distance_to(&from) > 1e-6 {
            if laser_on {
                out.push_str("M5\n");
                laser_on = false;
            }
            out.push_str(&format!("G0 X{} Y{}\n", fmt(from.x), fmt(from.y)));
        }

        match seg.kind {
            MoveKind::Travel => {
                if laser_on {
                    out.push_str("M5\n");
                    laser_on = false;
                }
                out.push_str(&format!("G0 X{} Y{}\n", fmt(to.x), fmt(to.y)));
            }
            MoveKind::Cut | MoveKind::Score | MoveKind::Fill | MoveKind::Engrave => {
                if machine.air_assist_supported && seg.air_assist != air_on {
                    out.push_str(if seg.air_assist { "M8\n" } else { "M9\n" });
                    air_on = seg.air_assist;
                }
                let mut s = (seg.power_percent / 100.0 * max_s)
                    .round()
                    .clamp(0.0, max_s) as u32;
                if s == 0 && seg.power_percent > 0.0 {
                    s = 1;
                }
                if !laser_on || current_s != Some(s) {
                    out.push_str(&format!("M4 S{s}\n"));
                    laser_on = true;
                    current_s = Some(s);
                }
                let feed = (seg.feed_mm_min.round() as i64).max(1);
                if current_feed != Some(feed) {
                    out.push_str(&format!("G1 X{} Y{} F{feed}\n", fmt(to.x), fmt(to.y)));
                    current_feed = Some(feed);
                } else {
                    out.push_str(&format!("G1 X{} Y{}\n", fmt(to.x), fmt(to.y)));
                }
            }
        }
        position = to;
    }

    if laser_on {
        out.push_str("M5\n");
    }
    if air_on {
        out.push_str("M9\n");
    }
    if options.return_to_origin {
        out.push_str("G0 X0 Y0\n");
    }
    out.push_str("M2\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::toolpath::ToolpathSegment;

    fn seg(
        from: (f64, f64),
        to: (f64, f64),
        kind: MoveKind,
        feed: f64,
        power: f64,
        air: bool,
    ) -> ToolpathSegment {
        ToolpathSegment {
            from: Point2::new(from.0, from.1),
            to: Point2::new(to.0, to.1),
            kind,
            feed_mm_min: feed,
            power_percent: power,
            air_assist: air,
        }
    }

    fn gen(segments: Vec<ToolpathSegment>) -> String {
        generate_gcode(
            &Toolpath { segments },
            &MachineProfile::tts55_pro(),
            "Test",
            &GcodeOptions::default(),
        )
    }

    fn body(g: &str) -> Vec<&str> {
        g.lines().filter(|l| !l.starts_with(';')).collect()
    }

    #[test]
    fn header_and_footer() {
        let g = gen(vec![]);
        let lines = body(&g);
        assert_eq!(&lines[..5], ["G21", "G90", "G94", "G54", "M5"]);
        assert_eq!(*lines.last().unwrap(), "M2");
        assert!(lines.contains(&"G0 X0 Y0"));
    }

    #[test]
    fn workspace_y_is_converted_to_machine_y() {
        // Top-left of the screen (workspace 10,10) is far up the machine's Y axis.
        let g = gen(vec![
            seg(
                (0.0, 300.0),
                (10.0, 10.0),
                MoveKind::Travel,
                6000.0,
                0.0,
                false,
            ),
            seg(
                (10.0, 10.0),
                (20.0, 10.0),
                MoveKind::Cut,
                300.0,
                80.0,
                false,
            ),
        ]);
        let lines = body(&g);
        assert!(lines.contains(&"G0 X10 Y290"), "{lines:?}");
        assert!(lines.contains(&"G1 X20 Y290 F300"), "{lines:?}");
    }

    #[test]
    fn power_is_scaled_to_the_machine_s_range() {
        let g = gen(vec![seg(
            (0.0, 300.0),
            (10.0, 300.0),
            MoveKind::Cut,
            300.0,
            80.0,
            false,
        )]);
        assert!(g.contains("M4 S800\n"));
        let mut m = MachineProfile::tts55_pro();
        m.max_spindle_value = 255;
        let g = generate_gcode(
            &Toolpath {
                segments: vec![seg(
                    (0.0, 300.0),
                    (10.0, 300.0),
                    MoveKind::Cut,
                    300.0,
                    100.0,
                    false,
                )],
            },
            &m,
            "t",
            &GcodeOptions::default(),
        );
        assert!(g.contains("M4 S255\n"));
    }

    #[test]
    fn the_laser_is_always_off_before_a_travel_move() {
        let g = gen(vec![
            seg(
                (0.0, 300.0),
                (10.0, 300.0),
                MoveKind::Cut,
                300.0,
                80.0,
                false,
            ),
            seg(
                (10.0, 300.0),
                (50.0, 250.0),
                MoveKind::Travel,
                6000.0,
                0.0,
                false,
            ),
            seg(
                (50.0, 250.0),
                (60.0, 250.0),
                MoveKind::Cut,
                300.0,
                80.0,
                false,
            ),
        ]);
        let lines = body(&g);
        let rapid = lines.iter().position(|l| l.starts_with("G0 X50")).unwrap();
        assert_eq!(lines[rapid - 1], "M5");
        // ...and switched back on, with the power restated, before the next cut.
        assert!(lines[rapid + 1].starts_with("M4 S800"));
    }

    #[test]
    fn a_gap_in_the_toolpath_never_becomes_a_laser_on_diagonal() {
        let g = gen(vec![
            seg(
                (0.0, 300.0),
                (10.0, 300.0),
                MoveKind::Cut,
                300.0,
                80.0,
                false,
            ),
            seg(
                (100.0, 100.0),
                (110.0, 100.0),
                MoveKind::Cut,
                300.0,
                80.0,
                false,
            ),
        ]);
        let lines = body(&g);
        let corrective = lines.iter().position(|l| l.starts_with("G0 X100")).unwrap();
        assert_eq!(lines[corrective - 1], "M5");
    }

    #[test]
    fn feed_and_power_are_only_restated_when_they_change() {
        let g = gen(vec![
            seg(
                (0.0, 300.0),
                (10.0, 300.0),
                MoveKind::Cut,
                300.0,
                80.0,
                false,
            ),
            seg(
                (10.0, 300.0),
                (10.0, 290.0),
                MoveKind::Cut,
                300.0,
                80.0,
                false,
            ),
            seg(
                (10.0, 290.0),
                (0.0, 290.0),
                MoveKind::Cut,
                600.0,
                80.0,
                false,
            ),
        ]);
        assert_eq!(g.matches("M4").count(), 1);
        assert_eq!(g.matches(" F300").count(), 1);
        assert_eq!(g.matches(" F600").count(), 1);
    }

    #[test]
    fn air_assist_is_switched_on_and_finally_off() {
        let g = gen(vec![seg(
            (0.0, 300.0),
            (10.0, 300.0),
            MoveKind::Cut,
            300.0,
            80.0,
            true,
        )]);
        let lines = body(&g);
        assert!(lines.contains(&"M8") && lines.contains(&"M9"));
        assert!(
            lines.iter().position(|l| *l == "M8").unwrap()
                < lines.iter().position(|l| l.starts_with("G1")).unwrap()
        );
    }

    #[test]
    fn air_assist_is_never_emitted_for_machines_without_it() {
        let mut m = MachineProfile::tts55_pro();
        m.air_assist_supported = false;
        let g = generate_gcode(
            &Toolpath {
                segments: vec![seg(
                    (0.0, 300.0),
                    (10.0, 300.0),
                    MoveKind::Cut,
                    300.0,
                    80.0,
                    true,
                )],
            },
            &m,
            "t",
            &GcodeOptions::default(),
        );
        assert!(!g.contains("M8") && !g.contains("M9"));
    }

    #[test]
    fn tiny_power_never_rounds_down_to_laser_off_and_tiny_feed_is_at_least_one() {
        let g = gen(vec![seg(
            (0.0, 300.0),
            (10.0, 300.0),
            MoveKind::Cut,
            0.2,
            0.01,
            false,
        )]);
        assert!(g.contains("M4 S1\n") && g.contains(" F1\n"));
    }

    #[test]
    fn project_names_cannot_inject_gcode_through_comments() {
        let g = generate_gcode(
            &Toolpath::default(),
            &MachineProfile::tts55_pro(),
            "evil\nM3 S1000 ; (x)",
            &GcodeOptions::default(),
        );
        assert!(!g.lines().any(|l| l.starts_with("M3")));
        assert_eq!(g.lines().next().unwrap().matches(';').count(), 1);
    }

    #[test]
    fn number_formatting() {
        assert_eq!(fmt(10.0), "10");
        assert_eq!(fmt(10.5), "10.5");
        assert_eq!(fmt(-0.0001), "0");
        assert_eq!(fmt(123.4567), "123.457");
        assert_eq!(fmt(0.0), "0");
    }

    #[test]
    fn output_never_contains_non_finite_numbers() {
        let g = gen(vec![seg(
            (0.0, 300.0),
            (10.0, 300.0),
            MoveKind::Cut,
            300.0,
            80.0,
            false,
        )]);
        assert!(!g.contains("NaN") && !g.contains("inf"));
    }
}
