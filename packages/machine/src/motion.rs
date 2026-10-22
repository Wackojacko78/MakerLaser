//! A closer estimate of how long a G-code program takes to run.
//!
//! [`estimate_runtime`] divides every move by its feed rate, as if the head were at full speed the
//! moment a move began. A real machine speeds up and slows down, and a GRBL controller slows for every
//! corner, so a job made of many short moves (fast fills, text, small shapes) takes longer than that.
//! [`estimate_motion`] works the job out the way GRBL's planner does:
//!
//! * every move has a top speed (its feed rate, or the rapid speed for `G0`) and an acceleration;
//! * where two moves meet, the head may only go as fast as GRBL's junction deviation allows for that
//!   corner (straight on is free, turning straight back stops the head, a square corner is slow);
//! * the planner looks ahead over a short run of moves (GRBL 1.1 keeps 15), so it slows down in time
//!   for a corner it can see, and carries on at its entry speed through a chain of tiny moves;
//! * each move is then a trapezoid of speed: speed up, cruise, slow down (or a triangle when the move
//!   is too short to reach its top speed).
//!
//! With no acceleration given the answer is exactly the one [`estimate_runtime`] gives. Nothing here
//! talks to a machine: the numbers are the ones the controller reports with `$$` (`$110` and `$111`,
//! `$120` and `$121`, `$11`), or typed in by hand.

use std::collections::VecDeque;

use crate::controller::strip_comments;
use crate::simulator::{estimate_runtime, tokenize, RuntimeEstimate};

/// How many moves GRBL 1.1 plans ahead.
pub const GRBL_PLANNER_BLOCKS: usize = 15;
/// The rapid speed the estimate assumes when the machine's own is not known, in mm/min.
pub const DEFAULT_RAPID_MM_MIN: f64 = 6000.0;
/// GRBL's default `$11`, in mm.
pub const DEFAULT_JUNCTION_DEVIATION_MM: f64 = 0.01;

/// Two moves whose directions are this close to straight on (or straight back) count as that.
const STRAIGHT_ON: f64 = 0.999_999;
/// "No limit" for the speed round a corner that is not a corner, squared.
const NO_LIMIT_SQ: f64 = 1.0e30;
/// A move shorter than this (mm) does nothing.
const MIN_MOVE_MM: f64 = 1e-9;

/// What the machine can do, for the estimate.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MotionProfile {
    /// The fastest the head moves, in mm/min (GRBL `$110` and `$111`). Rapid moves go this fast, and no
    /// move goes faster.
    pub rapid_mm_min: f64,
    /// How fast the head speeds up and slows down, in mm/s² (GRBL `$120` and `$121`). `None`: not
    /// known, and the estimate ignores acceleration.
    pub acceleration_mm_s2: Option<f64>,
    /// GRBL's junction deviation (`$11`), in mm.
    pub junction_deviation_mm: f64,
}

impl Default for MotionProfile {
    fn default() -> Self {
        MotionProfile {
            rapid_mm_min: DEFAULT_RAPID_MM_MIN,
            acceleration_mm_s2: None,
            junction_deviation_mm: DEFAULT_JUNCTION_DEVIATION_MM,
        }
    }
}

impl MotionProfile {
    fn usable_rapid(&self) -> f64 {
        if self.rapid_mm_min.is_finite() && self.rapid_mm_min >= 1.0 {
            self.rapid_mm_min
        } else {
            DEFAULT_RAPID_MM_MIN
        }
    }

    fn usable_acceleration(&self) -> Option<f64> {
        self.acceleration_mm_s2
            .filter(|a| a.is_finite() && *a > 0.0)
    }

    fn usable_junction_deviation(&self) -> f64 {
        if self.junction_deviation_mm.is_finite() && self.junction_deviation_mm > 0.0 {
            self.junction_deviation_mm
        } else {
            DEFAULT_JUNCTION_DEVIATION_MM
        }
    }

    /// True when the estimate uses acceleration (it needs a usable one).
    pub fn is_modelled(&self) -> bool {
        self.usable_acceleration().is_some()
    }
}

/// How long one move takes, going from `entry` to `exit` speed (mm/s) over `length` mm, never faster
/// than `nominal`, with a constant `accel`. A trapezoid of speed, or a triangle when the move is too
/// short to reach `nominal`.
fn block_seconds(length: f64, entry: f64, exit: f64, nominal: f64, accel: f64) -> f64 {
    let (entry, exit) = (entry.min(nominal), exit.min(nominal));
    let ramp_up = (nominal * nominal - entry * entry) / (2.0 * accel);
    let ramp_down = (nominal * nominal - exit * exit) / (2.0 * accel);
    if ramp_up + ramp_down <= length {
        (nominal - entry) / accel
            + (nominal - exit) / accel
            + (length - ramp_up - ramp_down) / nominal
    } else {
        let peak = ((2.0 * accel * length + entry * entry + exit * exit) / 2.0)
            .sqrt()
            .max(entry)
            .max(exit);
        (peak - entry) / accel + (peak - exit) / accel
    }
}

/// The direction and top speed of the move before.
#[derive(Debug, Clone, Copy)]
struct Heading {
    ux: f64,
    uy: f64,
    nominal: f64,
}

/// The fastest (squared) the head may go through the corner between `previous` and a move heading
/// `(ux, uy)`: GRBL's junction deviation rule.
fn junction_limit_sq(previous: Heading, ux: f64, uy: f64, accel: f64, deviation: f64) -> f64 {
    let cos_theta = -(previous.ux * ux + previous.uy * uy);
    if cos_theta > STRAIGHT_ON {
        return 0.0; // turning straight back: the head must stop
    }
    if cos_theta < -STRAIGHT_ON {
        return NO_LIMIT_SQ; // carrying straight on
    }
    let (jx, jy) = (ux - previous.ux, uy - previous.uy);
    let length = jx.hypot(jy);
    let junction_accel = accel / (jx / length).abs().max((jy / length).abs());
    let sin_half = (0.5 * (1.0 - cos_theta)).sqrt();
    (junction_accel * deviation * sin_half / (1.0 - sin_half)).max(0.0)
}

/// One move waiting in the planner.
#[derive(Debug, Clone, Copy)]
struct Block {
    length: f64,
    accel: f64,
    nominal: f64,
    /// The most (squared) the head may carry into this move, from the corner before it.
    max_entry_sq: f64,
    /// The entry speed (squared) the plan has settled on so far.
    entry_sq: f64,
    /// True when the laser is on and the move is not a rapid.
    work: bool,
}

/// GRBL's planner, reduced to what the time needs: a window of moves, planned back from a stop at the
/// end of the window and then forward from the speed the head already has.
struct Planner {
    window: usize,
    queue: VecDeque<Block>,
    done: RuntimeEstimate,
}

impl Planner {
    fn new(window: usize) -> Self {
        Planner {
            window: window.max(1),
            queue: VecDeque::new(),
            done: RuntimeEstimate::default(),
        }
    }

    /// Settles the entry speed of every move in the window except the first, whose speed is already
    /// fixed by the move before it.
    fn replan(&mut self) {
        let n = self.queue.len();
        let mut exit_sq = 0.0;
        for j in (1..n).rev() {
            let b = &mut self.queue[j];
            b.entry_sq = b.max_entry_sq.min(exit_sq + 2.0 * b.accel * b.length);
            exit_sq = b.entry_sq;
        }
        for j in 0..n.saturating_sub(1) {
            let reach = self.queue[j].entry_sq + 2.0 * self.queue[j].accel * self.queue[j].length;
            let next = &mut self.queue[j + 1];
            if reach < next.entry_sq {
                next.entry_sq = reach;
            }
        }
    }

    /// Runs the first move: it leaves at the speed the second one enters at (or stops, if it is the last).
    fn release_one(&mut self) {
        let Some(block) = self.queue.pop_front() else {
            return;
        };
        let exit_sq = self.queue.front().map_or(0.0, |next| next.entry_sq);
        let seconds = block_seconds(
            block.length,
            block.entry_sq.sqrt(),
            exit_sq.sqrt(),
            block.nominal,
            block.accel,
        );
        if block.work {
            self.done.cut_seconds += seconds;
        } else {
            self.done.travel_seconds += seconds;
        }
    }

    fn push(&mut self, mut block: Block) {
        block.entry_sq = 0.0;
        self.queue.push_back(block);
        self.replan();
        while self.queue.len() > self.window {
            self.release_one();
        }
    }

    fn finish(mut self) -> RuntimeEstimate {
        while !self.queue.is_empty() {
            self.release_one();
        }
        self.done
    }
}

/// Estimates the run time of a G-code program on a machine with the given speeds. The split between
/// laser-off travel and laser-on work is the same as in [`estimate_runtime`]. Without a usable
/// acceleration this is exactly [`estimate_runtime`] at the profile's rapid speed.
pub fn estimate_motion(lines: &[String], profile: &MotionProfile) -> RuntimeEstimate {
    estimate_with_window(lines, profile, GRBL_PLANNER_BLOCKS)
}

fn estimate_with_window(
    lines: &[String],
    profile: &MotionProfile,
    window: usize,
) -> RuntimeEstimate {
    let rapid_mm_min = profile.usable_rapid();
    let Some(accel) = profile.usable_acceleration() else {
        return estimate_runtime(lines, rapid_mm_min);
    };
    let deviation = profile.usable_junction_deviation();
    let rapid = rapid_mm_min / 60.0;
    let mut planner = Planner::new(window);
    let (mut x, mut y) = (0.0_f64, 0.0_f64);
    let mut feed = rapid_mm_min;
    let mut laser_on = false;
    let mut previous: Option<Heading> = None;
    for raw in lines {
        let line = strip_comments(raw);
        if line.is_empty() {
            continue;
        }
        let (mut nx, mut ny) = (x, y);
        let (mut is_rapid, mut is_move) = (false, false);
        for (letter, value) in tokenize(&line) {
            match letter {
                'G' => match value as i32 {
                    0 => {
                        is_rapid = true;
                        is_move = true;
                    }
                    1 => is_move = true,
                    _ => {}
                },
                'M' => match value as i32 {
                    3 | 4 => laser_on = true,
                    5 => laser_on = false,
                    _ => {}
                },
                'S' if value <= 0.0 => laser_on = false,
                'X' => nx = value,
                'Y' => ny = value,
                'F' => feed = value.max(1.0),
                _ => {}
            }
        }
        if !is_move {
            continue;
        }
        let (dx, dy) = (nx - x, ny - y);
        let length = dx.hypot(dy);
        x = nx;
        y = ny;
        if length < MIN_MOVE_MM {
            continue;
        }
        let (ux, uy) = (dx / length, dy / length);
        // A move along a diagonal may go faster and accelerate faster along its line than one axis can.
        let along = ux.abs().max(uy.abs());
        let rate_limit = rapid / along;
        let nominal = if is_rapid {
            rate_limit
        } else {
            (feed / 60.0).min(rate_limit)
        };
        let max_entry_sq = match previous {
            None => 0.0,
            Some(p) => junction_limit_sq(p, ux, uy, accel, deviation)
                .min(nominal * nominal)
                .min(p.nominal * p.nominal),
        };
        planner.push(Block {
            length,
            accel: accel / along,
            nominal,
            max_entry_sq,
            entry_sq: 0.0,
            work: laser_on && !is_rapid,
        });
        previous = Some(Heading { ux, uy, nominal });
    }
    planner.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn profile(rapid: f64, accel: f64) -> MotionProfile {
        MotionProfile {
            rapid_mm_min: rapid,
            acceleration_mm_s2: Some(accel),
            junction_deviation_mm: 0.01,
        }
    }

    fn near(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn without_an_acceleration_it_is_the_simple_estimate() {
        let program = lines(&[
            "G21",
            "G90",
            "G0 X10 Y0",
            "M4 S800",
            "G1 X10 Y10 F300",
            "M5",
        ]);
        let simple = estimate_runtime(&program, 3000.0);
        for acceleration in [
            None,
            Some(0.0),
            Some(-5.0),
            Some(f64::NAN),
            Some(f64::INFINITY),
        ] {
            let p = MotionProfile {
                rapid_mm_min: 3000.0,
                acceleration_mm_s2: acceleration,
                junction_deviation_mm: 0.01,
            };
            assert_eq!(estimate_motion(&program, &p), simple, "{acceleration:?}");
            assert!(!p.is_modelled());
        }
        assert!(profile(3000.0, 1000.0).is_modelled());
        assert!(!MotionProfile::default().is_modelled());
    }

    #[test]
    fn a_rapid_speed_that_is_not_a_speed_falls_back_to_the_default() {
        let program = lines(&["G0 X100"]);
        let expected = estimate_runtime(&program, DEFAULT_RAPID_MM_MIN);
        for rapid in [0.0, -1.0, 0.5, f64::NAN, f64::INFINITY] {
            let p = MotionProfile {
                rapid_mm_min: rapid,
                acceleration_mm_s2: None,
                junction_deviation_mm: 0.01,
            };
            assert_eq!(estimate_motion(&program, &p), expected, "{rapid}");
        }
    }

    #[test]
    fn a_move_from_rest_to_rest_speeds_up_cruises_and_slows_down() {
        // 100 mm at 100 mm/s with 1000 mm/s2: 5 mm to get up to speed, 5 mm to stop, 90 mm at speed.
        let e = estimate_motion(
            &lines(&["M4 S800", "G1 X100 F6000", "M5"]),
            &profile(30_000.0, 1000.0),
        );
        assert!(near(e.cut_seconds, 1.1), "{e:?}");
        assert_eq!(e.travel_seconds, 0.0);
    }

    #[test]
    fn a_short_move_never_reaches_its_top_speed() {
        let e = estimate_motion(
            &lines(&["M4 S800", "G1 X1 F6000", "M5"]),
            &profile(30_000.0, 1000.0),
        );
        assert!(near(e.cut_seconds, 0.063_245_553_203_367_58), "{e:?}");
    }

    #[test]
    fn two_moves_in_a_line_take_as_long_as_one() {
        let e = estimate_motion(
            &lines(&["M4 S800", "G1 X50 F6000", "G1 X100", "M5"]),
            &profile(30_000.0, 1000.0),
        );
        assert!(near(e.cut_seconds, 1.1), "{e:?}");
    }

    #[test]
    fn turning_straight_back_stops_the_head() {
        let e = estimate_motion(
            &lines(&["M4 S800", "G1 X50 F6000", "G1 X0", "M5"]),
            &profile(30_000.0, 1000.0),
        );
        assert!(near(e.cut_seconds, 1.2), "{e:?}");
    }

    #[test]
    fn a_square_corner_slows_the_head_but_does_not_stop_it() {
        let e = estimate_motion(
            &lines(&["M4 S800", "G1 X50 F6000", "G1 Y50", "M5"]),
            &profile(30_000.0, 1000.0),
        );
        assert!(near(e.cut_seconds, 1.188_655_166_930_848_5), "{e:?}");
        assert!(e.cut_seconds > 1.1 && e.cut_seconds < 1.2);
    }

    #[test]
    fn the_junction_speed_follows_the_corner() {
        let heading = Heading {
            ux: 1.0,
            uy: 0.0,
            nominal: 100.0,
        };
        let turn = |degrees: f64, accel: f64| {
            let t = degrees.to_radians();
            junction_limit_sq(heading, t.cos(), t.sin(), accel, 0.01)
        };
        assert!(near(turn(90.0, 1000.0), 34.142_135_623_730_96));
        assert!(near(turn(5.625, 2500.0), 20_754.745_578_659_7));
        assert_eq!(turn(180.0, 1000.0), 0.0);
        assert_eq!(turn(0.0, 1000.0), NO_LIMIT_SQ);
        // A gentler bend is always faster than a sharper one.
        assert!(turn(10.0, 1000.0) > turn(30.0, 1000.0) && turn(30.0, 1000.0) > turn(90.0, 1000.0));
    }

    #[test]
    fn a_rapid_goes_at_the_rapid_speed_whatever_the_feed() {
        // 300 mm at 500 mm/s with 2500 mm/s2: 50 mm to get up to speed, 50 mm to stop, 200 mm at speed.
        let p = profile(30_000.0, 2500.0);
        let e = estimate_motion(&lines(&["G0 X300"]), &p);
        assert!(near(e.travel_seconds, 0.8), "{e:?}");
        assert_eq!(e.cut_seconds, 0.0);
        let e = estimate_motion(&lines(&["G1 X10 F300", "G0 X310"]), &p);
        assert!(e.travel_seconds > 1.0, "{e:?}");
    }

    #[test]
    fn along_a_diagonal_the_head_may_go_faster_and_speeds_up_faster() {
        let e = estimate_motion(&lines(&["G0 X100 Y100"]), &profile(30_000.0, 2500.0));
        assert!(near(e.travel_seconds, 0.4), "{e:?}");
    }

    #[test]
    fn the_time_is_split_into_laser_off_travel_and_laser_on_work() {
        let e = estimate_motion(
            &lines(&[
                "G0 X10 Y0",
                "M4 S800",
                "G1 X10 Y10 F300",
                "M4 S0",
                "G1 X20 Y10",
                "M5",
            ]),
            &profile(30_000.0, 1000.0),
        );
        // The burn is a steady 10 mm at 5 mm/s: the head does not have to slow for the corners.
        assert!(near(e.cut_seconds, 2.0), "{e:?}");
        assert!(near(e.travel_seconds, 2.197_624_960_961_894_7), "{e:?}");
    }

    #[test]
    fn comments_blank_lines_and_zero_length_moves_change_nothing() {
        let plain = estimate_motion(
            &lines(&["M4 S800", "G1 X10 F600", "M5"]),
            &profile(30_000.0, 1000.0),
        );
        let noisy = estimate_motion(
            &lines(&[
                "M4 S800",
                "",
                "G1 X0 F600",
                "; a comment",
                "G1 X10 F600 (and another)",
                "G1 X10",
                "M5",
            ]),
            &profile(30_000.0, 1000.0),
        );
        assert_eq!(plain, noisy);
    }

    #[test]
    fn a_planner_that_sees_only_a_few_moves_cannot_carry_full_speed_through_tiny_ones() {
        // 2000 moves of 1 mm at 300 mm/s (18000 mm/min), 2500 mm/s2.
        let mut program = vec!["M4 S800".to_string()];
        program.extend((1..=2000).map(|i| format!("G1 X{i} F18000")));
        let p = profile(30_000.0, 2500.0);
        let grbl = estimate_motion(&program, &p).cut_seconds;
        let sees_everything = estimate_with_window(&program, &p, 100_000).cut_seconds;
        let no_acceleration = estimate_runtime(&program, 6000.0).cut_seconds;
        assert!(near(grbl, 7.353_545_499_936_862), "{grbl}");
        assert!(
            near(sees_everything, 6.786_666_666_666_437),
            "{sees_everything}"
        );
        assert!(
            near(no_acceleration, 6.666_666_666_666_438),
            "{no_acceleration}"
        );
        assert!(grbl > sees_everything && sees_everything > no_acceleration);
    }

    #[test]
    fn a_curve_made_of_many_small_bends_is_faster_than_a_zigzag_but_slower_than_a_straight_line() {
        let p = profile(30_000.0, 2500.0);
        let mut circle = vec!["M4 S800".to_string()];
        circle.extend((1..=64).map(|k| {
            let a = std::f64::consts::TAU * k as f64 / 64.0;
            let feed = if k == 1 { " F3000" } else { "" };
            format!(
                "G1 X{:.6} Y{:.6}{feed}",
                10.0 + 10.0 * a.cos(),
                10.0 * a.sin()
            )
        }));
        let curve = estimate_motion(&circle, &p).cut_seconds;
        let line = estimate_motion(&lines(&["M4 S800", "G1 X62.831853 F3000"]), &p).cut_seconds;
        let mut zigzag = vec!["M4 S800".to_string()];
        zigzag.extend((1..=64).map(|k| {
            let feed = if k == 1 { " F3000" } else { "" };
            format!(
                "G1 X{:.1} Y{:.1}{feed}",
                (k % 2) as f64 * 2.0,
                (k / 2) as f64 * 2.0
            )
        }));
        let zig = estimate_motion(&zigzag, &p).cut_seconds;
        assert!(near(curve, 1.669_938_659_614_204), "{curve}");
        assert!(curve > line && curve < zig, "{line} {curve} {zig}");
    }

    #[test]
    fn nothing_to_run_takes_no_time() {
        let p = profile(30_000.0, 2500.0);
        assert_eq!(estimate_motion(&[], &p), RuntimeEstimate::default());
        assert_eq!(
            estimate_motion(&lines(&["G21", "G90", "M5", "M2"]), &p),
            RuntimeEstimate::default()
        );
    }
}
