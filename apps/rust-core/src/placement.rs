//! Placing a job relative to the laser head (Start From: Current position or User origin).
//!
//! The G-code the user previews is always in bed (absolute) coordinates. For the relative modes
//! the program is run through this module just before it is sent: a few extra lines tell GRBL
//! "the head is at the job's anchor point" (`G92`), so the unchanged program lands around the
//! head instead of at its place on the bed. Every program also starts by clearing any `G92`
//! offset left behind by an earlier run (`G92.1`), so a stale offset can never shift a job.
//!
//! Everything here is plain text and numbers, so it is unit-tested without a machine.

/// Clears any `G92` offset (GRBL 1.1 and FluidNC both support it).
const CLEAR_OFFSET: &str = "G92.1";

/// Where a relative job is anchored.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    /// Machine coordinates of the job's anchor point (the job origin) in the previewed program.
    pub anchor: (f64, f64),
    /// Machine position (`MPos`) of the User origin. `Some` sends the head there first;
    /// `None` anchors the job where the head already is (Current position).
    pub user_origin: Option<(f64, f64)>,
}

/// Formats a coordinate like the G-code generator: up to 3 decimals, no trailing zeros.
fn num(v: f64) -> String {
    let s = format!("{v:.3}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-0" {
        "0".to_string()
    } else {
        s.to_string()
    }
}

fn check_finite(values: &[f64], what: &str) -> Result<(), String> {
    if values.iter().all(|v| v.is_finite()) {
        Ok(())
    } else {
        Err(format!("The {what} is not a valid position."))
    }
}

fn validate(p: &Placement) -> Result<(), String> {
    check_finite(&[p.anchor.0, p.anchor.1], "job anchor")?;
    if let Some((ux, uy)) = p.user_origin {
        check_finite(&[ux, uy], "user origin")?;
    }
    Ok(())
}

fn is_comment_or_blank(line: &str) -> bool {
    let t = line.trim();
    t.is_empty() || t.starts_with(';')
}

/// The lines that put the head's position in order before the job body.
fn prelude(p: &Placement) -> Vec<String> {
    let mut lines = vec![CLEAR_OFFSET.to_string()];
    if let Some((ux, uy)) = p.user_origin {
        // Rapid to the User origin in machine coordinates, then wait until the head is there.
        lines.push(format!("G53 G0 X{} Y{}", num(ux), num(uy)));
        lines.push("G4 P0".to_string());
    }
    lines.push(format!("G92 X{} Y{}", num(p.anchor.0), num(p.anchor.1)));
    lines
}

/// Index of the last header line (`M5`, the laser-off line the generator always writes first).
fn find_header_end(lines: &[String]) -> Option<usize> {
    lines.iter().position(|l| l.trim() == "M5")
}

/// Prepares the previewed program to be sent.
///
/// * `None` (absolute): the program is unchanged except for a `G92.1` line after the header.
/// * `Some` (relative): the head position is declared after the header, the footer's return to
///   the work origin becomes a return to where the job started, and the offset is cleared again
///   before the program ends.
pub fn place_program(
    lines: &[String],
    placement: Option<&Placement>,
) -> Result<Vec<String>, String> {
    let Some(header_end) = find_header_end(lines) else {
        return match placement {
            Some(_) => Err(
                "This G-code has no standard header, so it cannot be placed relative to the head."
                    .to_string(),
            ),
            None => Ok(lines.to_vec()),
        };
    };
    if let Some(p) = placement {
        validate(p)?;
    }

    let mut out: Vec<String> = Vec::with_capacity(lines.len() + 6);
    out.extend_from_slice(&lines[..=header_end]);
    let body = &lines[header_end + 1..];
    match placement {
        None => {
            out.push(CLEAR_OFFSET.to_string());
            out.extend_from_slice(body);
        }
        Some(p) => {
            out.extend(prelude(p));
            let end = body
                .iter()
                .rposition(|l| l.trim() == "M2")
                .unwrap_or(body.len());
            let (main, tail) = body.split_at(end);
            let mut main = main.to_vec();
            // "Return to the work origin" at the end becomes "return to where the job started".
            let last = main.iter().rposition(|l| !is_comment_or_blank(l));
            if let Some(last) = last {
                if main[last].trim() == "G0 X0 Y0" {
                    main[last] = format!("G0 X{} Y{}", num(p.anchor.0), num(p.anchor.1));
                }
            }
            out.extend(main);
            out.push(CLEAR_OFFSET.to_string());
            out.extend_from_slice(tail);
        }
    }
    Ok(out)
}

/// A complete program that traces the rectangle `min`..`max` (machine coordinates of the
/// previewed job) around the head with the laser off, then returns to where it started.
pub fn frame_program(
    min: (f64, f64),
    max: (f64, f64),
    feed_mm_min: f64,
    p: &Placement,
) -> Result<Vec<String>, String> {
    validate(p)?;
    check_finite(
        &[min.0, min.1, max.0, max.1, feed_mm_min],
        "frame rectangle",
    )?;
    if feed_mm_min <= 0.0 || min.0 > max.0 || min.1 > max.1 {
        return Err("Invalid frame rectangle.".to_string());
    }
    let feed = format!("F{feed_mm_min:.0}");
    let mut lines = vec!["G21".to_string(), "G90".to_string(), "M5".to_string()];
    lines.extend(prelude(p));
    for (x, y) in [
        (min.0, min.1),
        (max.0, min.1),
        (max.0, max.1),
        (min.0, max.1),
        (min.0, min.1),
    ] {
        lines.push(format!("G1 X{} Y{} {feed}", num(x), num(y)));
    }
    lines.push(format!("G0 X{} Y{}", num(p.anchor.0), num(p.anchor.1)));
    lines.push(CLEAR_OFFSET.to_string());
    Ok(lines)
}

/// The most power the framing laser may use, in percent of the machine's maximum. Framing is meant
/// to show where the job goes, not to mark the material.
pub const FRAME_LASER_MAX_PERCENT: f64 = 5.0;

/// The S value for framing with the laser on at `percent` of the machine's maximum S value.
/// Never rounds down to 0 (which would switch the laser off), and refuses anything above
/// `FRAME_LASER_MAX_PERCENT` whatever the screen asked for.
pub fn frame_laser_s(percent: f64, max_spindle_value: u32) -> Result<u32, String> {
    if !percent.is_finite() || percent <= 0.0 || percent > FRAME_LASER_MAX_PERCENT {
        return Err(format!(
            "The framing laser power must be above 0% and at most {FRAME_LASER_MAX_PERCENT:.0}%."
        ));
    }
    if max_spindle_value == 0 {
        return Err(
            "The machine's maximum S value is zero, so the laser power cannot be set.".to_string(),
        );
    }
    let s = (percent / 100.0 * f64::from(max_spindle_value)).round() as u32;
    Ok(s.clamp(1, max_spindle_value))
}

/// A complete program that traces the rectangle `min`..`max` (machine coordinates of the
/// previewed job) with the laser **on** at S value `laser_s`, so the outline can be seen on the
/// material.
///
/// * The head goes to the first corner with the laser off. The laser is switched on (`M4`, dynamic
///   power) only for the four sides.
/// * `M5` comes straight after the trace and before any rapid move, so the laser is never on
///   during a `G0`, and the program always ends with it off.
/// * `placement` is as for `frame_program`: `Some` traces the outline around the head and comes
///   back; `None` traces it on the bed (absolute coordinates) and stays at the first corner.
pub fn laser_frame_program(
    min: (f64, f64),
    max: (f64, f64),
    feed_mm_min: f64,
    placement: Option<&Placement>,
    laser_s: u32,
) -> Result<Vec<String>, String> {
    if let Some(p) = placement {
        validate(p)?;
    }
    check_finite(
        &[min.0, min.1, max.0, max.1, feed_mm_min],
        "frame rectangle",
    )?;
    if feed_mm_min <= 0.0 || min.0 > max.0 || min.1 > max.1 {
        return Err("Invalid frame rectangle.".to_string());
    }
    if laser_s == 0 {
        return Err("The framing laser power must be above zero.".to_string());
    }
    let feed = format!("F{feed_mm_min:.0}");
    let mut lines = vec!["G21".to_string(), "G90".to_string(), "M5".to_string()];
    match placement {
        Some(p) => lines.extend(prelude(p)),
        None => lines.push(CLEAR_OFFSET.to_string()),
    }
    let corners = [
        (min.0, min.1),
        (max.0, min.1),
        (max.0, max.1),
        (min.0, max.1),
        (min.0, min.1),
    ];
    for (i, &(x, y)) in corners.iter().enumerate() {
        lines.push(format!("G1 X{} Y{} {feed}", num(x), num(y)));
        if i == 0 {
            // At the first corner with the laser off. From here the trace is lit.
            lines.push(format!("M4 S{laser_s}"));
        }
    }
    lines.push("M5".to_string());
    if let Some(p) = placement {
        lines.push(format!("G0 X{} Y{}", num(p.anchor.0), num(p.anchor.1)));
        lines.push(CLEAR_OFFSET.to_string());
    }
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    /// What the G-code generator writes for a tiny job (header, one cut, return, end).
    fn program() -> Vec<String> {
        lines(&[
            "; MakerLaser job: T",
            "; Machine: M",
            "; Start with the laser head at the work origin (X0 Y0).",
            "G21",
            "G90",
            "G94",
            "G54",
            "M5",
            "G0 X10 Y290",
            "M4 S800",
            "G1 X20 Y290 F300",
            "M5",
            "G0 X0 Y0",
            "M2",
        ])
    }

    fn current() -> Placement {
        Placement {
            anchor: (10.0, 290.0),
            user_origin: None,
        }
    }

    fn user() -> Placement {
        Placement {
            anchor: (10.0, 290.0),
            user_origin: Some((120.5, 80.0)),
        }
    }

    #[test]
    fn an_absolute_program_only_gains_a_clear_offset_line_after_the_header() {
        let out = place_program(&program(), None).unwrap();
        let mut expected = program();
        expected.insert(8, "G92.1".to_string());
        assert_eq!(out, expected);
    }

    #[test]
    fn current_position_declares_the_head_to_be_at_the_anchor() {
        let out = place_program(&program(), Some(&current())).unwrap();
        assert_eq!(
            out[..11].to_vec(),
            lines(&[
                "; MakerLaser job: T",
                "; Machine: M",
                "; Start with the laser head at the work origin (X0 Y0).",
                "G21",
                "G90",
                "G94",
                "G54",
                "M5",
                "G92.1",
                "G92 X10 Y290",
                "G0 X10 Y290",
            ])
        );
    }

    #[test]
    fn user_origin_moves_to_the_stored_position_first() {
        let out = place_program(&program(), Some(&user())).unwrap();
        assert_eq!(
            out[8..13].to_vec(),
            lines(&[
                "G92.1",
                "G53 G0 X120.5 Y80",
                "G4 P0",
                "G92 X10 Y290",
                "G0 X10 Y290",
            ])
        );
    }

    #[test]
    fn the_footer_return_goes_back_to_the_start_point_and_the_offset_is_cleared() {
        let out = place_program(&program(), Some(&current())).unwrap();
        let tail: Vec<String> = out[out.len() - 4..].to_vec();
        assert_eq!(tail, lines(&["M5", "G0 X10 Y290", "G92.1", "M2"]));
        assert!(!out.iter().any(|l| l == "G0 X0 Y0"));
    }

    #[test]
    fn a_return_to_the_origin_in_the_middle_of_the_job_is_left_alone() {
        let mut p = program();
        p.insert(9, "G0 X0 Y0".to_string());
        let out = place_program(&p, Some(&current())).unwrap();
        assert_eq!(out.iter().filter(|l| *l == "G0 X0 Y0").count(), 1);
        assert_eq!(out[out.len() - 3], "G0 X10 Y290");
    }

    #[test]
    fn a_program_without_a_footer_return_just_clears_the_offset_before_the_end() {
        let p = lines(&[
            "G21",
            "G90",
            "G94",
            "G54",
            "M5",
            "G1 X5 Y5 F300",
            "M5",
            "M2",
        ]);
        let out = place_program(&p, Some(&current())).unwrap();
        assert_eq!(out[out.len() - 3..].to_vec(), lines(&["M5", "G92.1", "M2"]));
    }

    #[test]
    fn a_program_without_a_standard_header_is_run_unchanged_if_absolute_and_refused_if_relative() {
        let p = lines(&["G21", "G1 X1 Y1 F100"]);
        assert_eq!(place_program(&p, None).unwrap(), p);
        assert!(place_program(&p, Some(&current())).is_err());
    }

    #[test]
    fn invalid_positions_are_refused() {
        let nan = Placement {
            anchor: (f64::NAN, 0.0),
            user_origin: None,
        };
        assert!(place_program(&program(), Some(&nan)).is_err());
        let inf = Placement {
            anchor: (0.0, 0.0),
            user_origin: Some((f64::INFINITY, 0.0)),
        };
        assert!(place_program(&program(), Some(&inf)).is_err());
        assert!(frame_program((0.0, 0.0), (10.0, 10.0), 3000.0, &nan).is_err());
    }

    #[test]
    fn the_frame_traces_the_rectangle_around_the_anchor_and_comes_back() {
        let out = frame_program((10.0, 260.0), (40.0, 290.0), 3000.0, &current()).unwrap();
        assert_eq!(
            out,
            lines(&[
                "G21",
                "G90",
                "M5",
                "G92.1",
                "G92 X10 Y290",
                "G1 X10 Y260 F3000",
                "G1 X40 Y260 F3000",
                "G1 X40 Y290 F3000",
                "G1 X10 Y290 F3000",
                "G1 X10 Y260 F3000",
                "G0 X10 Y290",
                "G92.1",
            ])
        );
    }

    #[test]
    fn a_user_origin_frame_goes_to_the_stored_position_first() {
        let out = frame_program((10.0, 260.0), (40.0, 290.0), 3000.0, &user()).unwrap();
        assert_eq!(
            out[3..7].to_vec(),
            lines(&["G92.1", "G53 G0 X120.5 Y80", "G4 P0", "G92 X10 Y290"])
        );
    }

    #[test]
    fn a_bad_frame_rectangle_is_refused() {
        assert!(frame_program((10.0, 10.0), (5.0, 20.0), 3000.0, &current()).is_err());
        assert!(frame_program((0.0, 0.0), (5.0, 5.0), 0.0, &current()).is_err());
        assert!(frame_program((0.0, 0.0), (f64::NAN, 5.0), 3000.0, &current()).is_err());
    }

    // ---- framing with the laser on -------------------------------------------------------

    /// Reads a program the way the machine would. Returns the rapid moves made while the laser was
    /// on, and whether the laser is still on at the end.
    fn laser_trace(program: &[String]) -> (Vec<String>, bool) {
        let mut laser_on = false;
        let mut bad = Vec::new();
        for line in program {
            let l = line.trim();
            if l.starts_with("M3") || l.starts_with("M4") {
                laser_on = true;
            } else if l.starts_with("M5") {
                laser_on = false;
            } else if (l.starts_with("G0") || l.starts_with("G53 G0")) && laser_on {
                bad.push(l.to_string());
            }
        }
        (bad, laser_on)
    }

    #[test]
    fn the_framing_s_value_follows_the_machine_range_and_never_rounds_to_zero() {
        assert_eq!(frame_laser_s(1.0, 1000), Ok(10));
        assert_eq!(frame_laser_s(0.1, 1000), Ok(1));
        assert_eq!(frame_laser_s(0.04, 1000), Ok(1));
        assert_eq!(frame_laser_s(5.0, 1000), Ok(50));
        assert_eq!(frame_laser_s(1.0, 255), Ok(3));
    }

    #[test]
    fn a_framing_power_above_the_limit_or_not_a_power_is_refused() {
        for bad in [0.0, -1.0, 5.01, 100.0, f64::NAN, f64::INFINITY] {
            assert!(frame_laser_s(bad, 1000).is_err(), "{bad}");
        }
        assert!(frame_laser_s(1.0, 0).is_err());
    }

    #[test]
    fn the_laser_frame_around_the_head_lights_only_the_trace() {
        let out = laser_frame_program((10.0, 260.0), (40.0, 290.0), 3000.0, Some(&current()), 10)
            .unwrap();
        assert_eq!(
            out,
            lines(&[
                "G21",
                "G90",
                "M5",
                "G92.1",
                "G92 X10 Y290",
                "G1 X10 Y260 F3000",
                "M4 S10",
                "G1 X40 Y260 F3000",
                "G1 X40 Y290 F3000",
                "G1 X10 Y290 F3000",
                "G1 X10 Y260 F3000",
                "M5",
                "G0 X10 Y290",
                "G92.1",
            ])
        );
    }

    #[test]
    fn the_laser_frame_on_the_bed_stays_at_the_first_corner() {
        let out = laser_frame_program((10.0, 260.0), (40.0, 290.0), 3000.0, None, 10).unwrap();
        assert_eq!(
            out,
            lines(&[
                "G21",
                "G90",
                "M5",
                "G92.1",
                "G1 X10 Y260 F3000",
                "M4 S10",
                "G1 X40 Y260 F3000",
                "G1 X40 Y290 F3000",
                "G1 X10 Y290 F3000",
                "G1 X10 Y260 F3000",
                "M5",
            ])
        );
    }

    #[test]
    fn a_user_origin_laser_frame_goes_there_before_the_laser_comes_on() {
        let out =
            laser_frame_program((10.0, 260.0), (40.0, 290.0), 3000.0, Some(&user()), 10).unwrap();
        let go_there = out.iter().position(|l| l.starts_with("G53 G0")).unwrap();
        let laser_on = out.iter().position(|l| l == "M4 S10").unwrap();
        assert!(go_there < laser_on, "{out:?}");
        assert_eq!(out.iter().filter(|l| l.starts_with("M4")).count(), 1);
    }

    #[test]
    fn the_laser_is_never_on_during_a_rapid_move_and_is_off_at_the_end() {
        for placement in [None, Some(current()), Some(user())] {
            let out =
                laser_frame_program((10.0, 260.0), (40.0, 290.0), 3000.0, placement.as_ref(), 10)
                    .unwrap();
            let (rapids_with_laser_on, on_at_the_end) = laser_trace(&out);
            assert!(rapids_with_laser_on.is_empty(), "{rapids_with_laser_on:?}");
            assert!(!on_at_the_end, "{out:?}");
        }
    }

    #[test]
    fn a_bad_laser_frame_is_refused() {
        assert!(laser_frame_program((10.0, 10.0), (5.0, 20.0), 3000.0, None, 10).is_err());
        assert!(laser_frame_program((0.0, 0.0), (5.0, 5.0), 0.0, None, 10).is_err());
        assert!(laser_frame_program((0.0, 0.0), (f64::NAN, 5.0), 3000.0, None, 10).is_err());
        assert!(laser_frame_program((0.0, 0.0), (5.0, 5.0), 3000.0, None, 0).is_err());
        let nan = Placement {
            anchor: (f64::NAN, 0.0),
            user_origin: None,
        };
        assert!(laser_frame_program((0.0, 0.0), (5.0, 5.0), 3000.0, Some(&nan), 10).is_err());
    }

    #[test]
    fn numbers_are_formatted_like_the_gcode_generator() {
        assert_eq!(num(10.0), "10");
        assert_eq!(num(10.5), "10.5");
        assert_eq!(num(-0.0001), "0");
        assert_eq!(num(123.4567), "123.457");
        assert_eq!(num(0.0), "0");
    }
}
