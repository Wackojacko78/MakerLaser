//! Cut tabs: small stretches of a cut line that are left uncut, so a part stays attached to the sheet
//! until it is broken free by hand. Pure functions on paths, unit-tested without a project: see "Tabs"
//! in docs/user-guide.md.
//!
//! [`add_tabs`] takes the closed outlines of a Cut layer and turns each one that should have tabs into
//! several open runs, one between every two tabs. What is cut is exactly what was cut before, less the
//! tabs. The rules:
//!
//! * Only outlines get tabs: a path that is not inside another one, or an island inside a hole (an even
//!   nesting depth). A hole's cut-out is waste, and open lines are not parts.
//! * About one tab for every `spacing` mm of outline, at least two (so a part is not held by one point)
//!   and spread evenly. A tab is never longer than the room allows: all the tabs on an outline together
//!   are at most a quarter of it. An outline too small for even one tab is left whole and counted.
//! * A tab is moved along the outline, a little, to keep it off a sharp corner, where it would hold the
//!   part badly and leave a ragged edge.

use makerlaser_common::{Path2D, Point2};

/// All the tabs on one outline together may use at most this fraction of its length.
pub const MAX_TAB_FRACTION: f64 = 0.25;
/// An outline that has room gets at least this many tabs.
pub const MIN_TABS: usize = 2;
/// No outline gets more tabs than this, whatever the settings say.
pub const MAX_TABS_PER_OUTLINE: usize = 500;
/// A bend at least this sharp (degrees) is a corner that a tab keeps away from.
const SHARP_TURN_DEG: f64 = 30.0;
/// How far (mm, at least) a tab is moved at a time when it is moved off a corner.
const MIN_STEP_MM: f64 = 0.25;
/// The most steps tried when moving a tab off a corner.
const MAX_NUDGE_STEPS: usize = 2000;
const EPS: f64 = 1e-9;

/// The answer of [`add_tabs`].
#[derive(Debug, Clone)]
pub struct Tabbed {
    /// The paths to cut, in the order given. An outline with tabs is replaced, in its place, by the open
    /// runs between its tabs; every other path comes back exactly as it was.
    pub paths: Vec<Path2D>,
    /// How many tabs were left, in all.
    pub tabs: usize,
    /// How many outlines got tabs.
    pub outlines: usize,
    /// How many outlines were too small for a tab of this width and were left whole.
    pub too_small: usize,
}

/// A closed outline with the running length at each corner, so a point can be found by distance along it.
struct Outline {
    pts: Vec<Point2>,
    /// `cum[i]` is the distance from the start to `pts[i]`; the last entry is the whole length.
    cum: Vec<f64>,
}

impl Outline {
    fn new(pts: Vec<Point2>) -> Self {
        let m = pts.len();
        let mut cum = Vec::with_capacity(m + 1);
        cum.push(0.0);
        for (i, a) in pts.iter().enumerate() {
            let last = cum[cum.len() - 1];
            cum.push(last + a.distance_to(&pts[(i + 1) % m]));
        }
        Outline { pts, cum }
    }

    fn length(&self) -> f64 {
        self.cum[self.cum.len() - 1]
    }

    /// The point `s` mm along the outline from its start (the closing edge included).
    fn point_at(&self, s: f64) -> Point2 {
        let s = s.clamp(0.0, self.length());
        let m = self.pts.len();
        let mut i = 0;
        while i + 1 < m && self.cum[i + 1] < s {
            i += 1;
        }
        let (a, b) = (self.pts[i], self.pts[(i + 1) % m]);
        let span = self.cum[i + 1] - self.cum[i];
        if span <= 1e-12 {
            return a;
        }
        let t = ((s - self.cum[i]) / span).clamp(0.0, 1.0);
        Point2::new(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
    }

    /// The open line that follows the outline from `s0` to `s1` mm along it (`0 <= s0 < s1 <= length`).
    fn stretch(&self, s0: f64, s1: f64) -> Vec<Point2> {
        let mut out = vec![self.point_at(s0)];
        for (i, &corner) in self.pts.iter().enumerate().skip(1) {
            if self.cum[i] > s0 + 1e-9 && self.cum[i] < s1 - 1e-9 {
                out.push(corner);
            }
        }
        let end = self.point_at(s1);
        let apart = out.last().is_some_and(|q| q.distance_to(&end) > EPS);
        if apart {
            out.push(end);
        }
        out
    }
}

/// The points of a closed path without repeats: a point that repeats the one before it is dropped, and
/// so is a last point that repeats the first.
fn clean(points: &[Point2]) -> Vec<Point2> {
    let mut out: Vec<Point2> = Vec::with_capacity(points.len());
    for &p in points {
        let keep = match out.last() {
            Some(q) => q.distance_to(&p) > EPS,
            None => true,
        };
        if keep {
            out.push(p);
        }
    }
    while out.len() > 1 && out[0].distance_to(&out[out.len() - 1]) <= EPS {
        out.pop();
    }
    out
}

/// How far the path turns at `b` when it goes a, b, c: 0 is straight on, 180 is back the way it came.
fn turn_deg(a: Point2, b: Point2, c: Point2) -> f64 {
    let (ux, uy) = (b.x - a.x, b.y - a.y);
    let (vx, vy) = (c.x - b.x, c.y - b.y);
    (ux * vy - uy * vx)
        .abs()
        .atan2(ux * vx + uy * vy)
        .to_degrees()
}

enum Plan {
    /// Nothing to do for this path (not enough points, no length, or settings that are not usable).
    Skip,
    /// Too small for a tab of this width.
    TooSmall,
    /// Where the tabs go: each as the distances along the outline where it starts and ends.
    Tabs(Outline, Vec<(f64, f64)>),
}

fn plan(points: &[Point2], width: f64, spacing: f64) -> Plan {
    let pts = clean(points);
    let m = pts.len();
    if m < 3 || !(width > 0.0 && width.is_finite() && spacing > 0.0 && spacing.is_finite()) {
        return Plan::Skip;
    }
    let outline = Outline::new(pts);
    let length = outline.length();
    if length <= EPS {
        return Plan::Skip;
    }
    let cap = (length * MAX_TAB_FRACTION / width + 1e-9).floor();
    if cap < 1.0 {
        return Plan::TooSmall;
    }
    let wanted = ((length / spacing).round() as usize).max(MIN_TABS);
    let n = wanted.min(cap as usize).min(MAX_TABS_PER_OUTLINE);
    // The corners, as distances along the outline (the first corner is at the start and at the end).
    let mut sharp: Vec<f64> = Vec::new();
    for (i, &b) in outline.pts.iter().enumerate() {
        let (a, c) = (outline.pts[(i + m - 1) % m], outline.pts[(i + 1) % m]);
        if turn_deg(a, b, c) >= SHARP_TURN_DEG {
            sharp.push(outline.cum[i]);
            if i == 0 {
                sharp.push(length);
            }
        }
    }
    let pitch = length / n as f64;
    // A tab may move this far along, which keeps it clear of the next one by at least its own width.
    let room = ((pitch - 2.0 * width) / 2.0).max(0.0);
    let step = (width / 4.0).max(MIN_STEP_MM);
    let margin = width / 2.0;
    let clear = |c: f64| {
        sharp
            .iter()
            .all(|&v| !(c - width / 2.0 - margin <= v && v <= c + width / 2.0 + margin))
    };
    let mut gaps: Vec<(f64, f64)> = Vec::with_capacity(n);
    for k in 0..n {
        let c0 = (k as f64 + 0.5) * pitch;
        let mut c = c0;
        if !clear(c0) {
            let mut j = 1usize;
            'search: while j <= MAX_NUDGE_STEPS && j as f64 * step <= room + 1e-12 {
                for candidate in [c0 + j as f64 * step, c0 - j as f64 * step] {
                    if clear(candidate) {
                        c = candidate;
                        break 'search;
                    }
                }
                j += 1;
            }
        }
        gaps.push((c - width / 2.0, c + width / 2.0));
    }
    Plan::Tabs(outline, gaps)
}

/// The open runs of an outline between its tabs. The first run goes from the end of the last tab round the
/// start of the outline to the start of the first tab, so there is one run for every tab.
fn runs_between(outline: &Outline, gaps: &[(f64, f64)]) -> Vec<Path2D> {
    let length = outline.length();
    let (Some(&first), Some(&last)) = (gaps.first(), gaps.last()) else {
        return Vec::new();
    };
    let mut wrap = if length - last.1 > EPS {
        outline.stretch(last.1, length)
    } else {
        vec![outline.point_at(length)]
    };
    let head = if first.0 > EPS {
        outline.stretch(0.0, first.0)
    } else {
        vec![outline.point_at(0.0)]
    };
    for p in head {
        let apart = wrap.last().is_some_and(|q| q.distance_to(&p) > EPS);
        if apart {
            wrap.push(p);
        }
    }
    let mut out = vec![Path2D::new(wrap, false)];
    for pair in gaps.windows(2) {
        out.push(Path2D::new(outline.stretch(pair[0].1, pair[1].0), false));
    }
    out
}

/// Leaves tabs of `width_mm` in the outlines among `paths`. `depths[i]` is how deeply `paths[i]` is nested
/// (0 for an outline, 1 for a hole in it, 2 for an island in that hole); a path with no depth given is
/// treated as a hole. With a width or spacing that is not a usable number nothing changes.
pub fn add_tabs(paths: &[Path2D], depths: &[u32], width_mm: f64, spacing_mm: f64) -> Tabbed {
    let mut out: Vec<Path2D> = Vec::with_capacity(paths.len());
    let (mut tabs, mut outlines, mut too_small) = (0, 0, 0);
    for (i, path) in paths.iter().enumerate() {
        let depth = depths.get(i).copied().unwrap_or(1);
        if !path.closed || depth % 2 != 0 || !path.points.iter().all(|p| p.is_finite()) {
            out.push(path.clone());
            continue;
        }
        match plan(&path.points, width_mm, spacing_mm) {
            Plan::Skip => out.push(path.clone()),
            Plan::TooSmall => {
                too_small += 1;
                out.push(path.clone());
            }
            Plan::Tabs(outline, gaps) => {
                tabs += gaps.len();
                outlines += 1;
                out.extend(runs_between(&outline, &gaps));
            }
        }
    }
    Tabbed {
        paths: out,
        tabs,
        outlines,
        too_small,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(x: f64, y: f64) -> Point2 {
        Point2::new(x, y)
    }

    fn square(x: f64, y: f64, s: f64) -> Path2D {
        Path2D::new(
            vec![p(x, y), p(x + s, y), p(x + s, y + s), p(x, y + s)],
            true,
        )
    }

    fn circle(r: f64, n: usize) -> Path2D {
        let pts: Vec<Point2> = (0..n)
            .map(|k| {
                let a = std::f64::consts::TAU * k as f64 / n as f64;
                p(r * a.cos(), r * a.sin())
            })
            .collect();
        Path2D::new(pts, true)
    }

    fn near(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-5
    }

    fn length_of(paths: &[Path2D]) -> f64 {
        paths.iter().map(|q| q.length()).sum()
    }

    /// True when `run` is these points (to a hundredth of a micrometre or so).
    fn is_run(run: &Path2D, expected: &[(f64, f64)]) -> bool {
        !run.closed
            && run.points.len() == expected.len()
            && run
                .points
                .iter()
                .zip(expected)
                .all(|(q, e)| near(q.x, e.0) && near(q.y, e.1))
    }

    fn corner_distance(q: Point2, corners: &[Point2]) -> f64 {
        corners
            .iter()
            .map(|c| c.distance_to(&q))
            .fold(f64::INFINITY, f64::min)
    }

    #[test]
    fn a_40_mm_square_gets_three_tabs_with_the_middle_one_moved_off_a_corner() {
        let r = add_tabs(&[square(0.0, 0.0, 40.0)], &[0], 2.0, 50.0);
        assert_eq!((r.tabs, r.outlines, r.too_small), (3, 1, 0));
        assert_eq!(r.paths.len(), 3);
        // Three evenly spaced tabs would put the middle one right on the corner at 80 mm. It is moved to
        // start 1.5 mm after it.
        assert!(is_run(
            &r.paths[0],
            &[(0.0, 25.666667), (0.0, 0.0), (25.666667, 0.0)]
        ));
        assert!(is_run(
            &r.paths[1],
            &[(27.666667, 0.0), (40.0, 0.0), (40.0, 40.0), (38.5, 40.0)]
        ));
        assert!(is_run(
            &r.paths[2],
            &[(36.5, 40.0), (0.0, 40.0), (0.0, 27.666667)]
        ));
        assert!(near(length_of(&r.paths), 160.0 - 3.0 * 2.0));
    }

    #[test]
    fn no_tab_sits_on_a_corner() {
        let corners = [p(0.0, 0.0), p(40.0, 0.0), p(40.0, 40.0), p(0.0, 40.0)];
        let r = add_tabs(&[square(0.0, 0.0, 40.0)], &[0], 2.0, 50.0);
        for run in &r.paths {
            for end in [run.points[0], run.points[run.points.len() - 1]] {
                assert!(corner_distance(end, &corners) >= 1.0 - 1e-6, "{end:?}");
            }
        }
    }

    #[test]
    fn a_small_part_gets_two_tabs_and_the_cut_is_the_outline_less_the_tabs() {
        let r = add_tabs(&[square(10.0, 10.0, 20.0)], &[0], 2.0, 50.0);
        assert_eq!((r.tabs, r.outlines), (2, 1));
        assert!(is_run(
            &r.paths[0],
            &[(10.0, 26.5), (10.0, 10.0), (30.0, 10.0), (30.0, 11.5)]
        ));
        assert!(is_run(
            &r.paths[1],
            &[(30.0, 13.5), (30.0, 30.0), (10.0, 30.0), (10.0, 28.5)]
        ));
        assert!(near(length_of(&r.paths), 80.0 - 2.0 * 2.0));
    }

    #[test]
    fn a_long_strip_gets_a_tab_about_every_spacing() {
        let strip = Path2D::new(
            vec![p(0.0, 0.0), p(100.0, 0.0), p(100.0, 10.0), p(0.0, 10.0)],
            true,
        );
        let r = add_tabs(&[strip], &[0], 1.0, 40.0);
        // The outline is 220 mm: 220 / 40 rounds to 6 tabs, each 1 mm.
        assert_eq!(r.tabs, 6);
        assert_eq!(r.paths.len(), 6);
        assert!(is_run(
            &r.paths[0],
            &[(7.833333, 10.0), (0.0, 10.0), (0.0, 0.0), (17.833333, 0.0)]
        ));
        assert!(is_run(&r.paths[1], &[(18.833333, 0.0), (54.5, 0.0)]));
        assert!(is_run(&r.paths[2], &[(55.5, 0.0), (91.166667, 0.0)]));
        assert!(is_run(
            &r.paths[3],
            &[
                (92.166667, 0.0),
                (100.0, 0.0),
                (100.0, 10.0),
                (82.166667, 10.0)
            ]
        ));
        assert!(is_run(&r.paths[4], &[(81.166667, 10.0), (45.5, 10.0)]));
        assert!(is_run(&r.paths[5], &[(44.5, 10.0), (8.833333, 10.0)]));
        assert!(near(length_of(&r.paths), 220.0 - 6.0));
    }

    #[test]
    fn the_tabs_on_a_circle_are_evenly_spaced() {
        let r = add_tabs(&[circle(20.0, 256)], &[0], 2.0, 50.0);
        assert_eq!(r.tabs, 3);
        assert_eq!(r.paths.len(), 3);
        let l = std::f64::consts::TAU * 20.0;
        // 256 straight chords are a touch shorter than the true circle.
        let chords = circle(20.0, 256).length();
        assert!((chords - l).abs() < 0.01);
        assert!(near(length_of(&r.paths), chords - 6.0));
        // Each run starts just past a tab: tabs are centred at 60, 180 and 300 degrees, and half a tab is
        // 1 mm of a 20 mm radius, which is 2.865 degrees.
        let angle = |q: Point2| q.y.atan2(q.x).to_degrees().rem_euclid(360.0);
        let starts: Vec<f64> = r.paths.iter().map(|run| angle(run.points[0])).collect();
        for (got, want) in starts.iter().zip([302.865, 62.865, 182.865]) {
            assert!((got - want).abs() < 0.1, "{starts:?}");
        }
    }

    #[test]
    fn holes_open_lines_and_what_has_no_depth_are_left_alone() {
        let line = Path2D::new(vec![p(0.0, 0.0), p(5.0, 5.0)], false);
        let paths = vec![
            square(0.0, 0.0, 100.0),
            square(20.0, 20.0, 30.0),
            square(30.0, 30.0, 10.0),
            line.clone(),
        ];
        let r = add_tabs(&paths, &[0, 1, 2, 0], 2.0, 50.0);
        // The outline (8 tabs) and the island in the hole (3 tabs) are tabbed; the hole and the line are not.
        assert_eq!((r.outlines, r.too_small), (2, 0));
        assert!(r.paths.contains(&paths[1]));
        assert!(r.paths.contains(&line));
        assert!(!r.paths.contains(&paths[0]));
        assert!(!r.paths.contains(&paths[2]));
        // A path with no depth given counts as a hole.
        let r = add_tabs(&paths, &[], 2.0, 50.0);
        assert_eq!(r.paths, paths);
        assert_eq!(r.tabs, 0);
    }

    #[test]
    fn settings_that_are_not_usable_change_nothing() {
        let paths = vec![square(0.0, 0.0, 40.0)];
        for (w, s) in [
            (0.0, 50.0),
            (-1.0, 50.0),
            (f64::NAN, 50.0),
            (f64::INFINITY, 50.0),
            (2.0, 0.0),
            (2.0, -5.0),
            (2.0, f64::NAN),
            (2.0, f64::INFINITY),
        ] {
            let r = add_tabs(&paths, &[0], w, s);
            assert_eq!(r.paths, paths, "{w} {s}");
            assert_eq!((r.tabs, r.outlines, r.too_small), (0, 0, 0), "{w} {s}");
        }
    }

    #[test]
    fn an_outline_too_small_for_a_tab_is_left_whole_and_counted() {
        let tiny = vec![square(0.0, 0.0, 1.0)];
        let r = add_tabs(&tiny, &[0], 2.0, 50.0);
        assert_eq!(r.paths, tiny);
        assert_eq!((r.tabs, r.outlines, r.too_small), (0, 0, 1));
        // A 3 mm square (12 mm round, a quarter of it is 3 mm) has room for one tab only.
        let r = add_tabs(&[square(0.0, 0.0, 3.0)], &[0], 2.0, 50.0);
        assert_eq!((r.tabs, r.outlines, r.too_small), (1, 1, 0));
        assert_eq!(r.paths.len(), 1);
        assert!(near(length_of(&r.paths), 12.0 - 2.0));
    }

    #[test]
    fn tabs_never_take_more_than_a_quarter_of_an_outline() {
        // 8 tabs would be wanted (a tab every 20 mm of a 160 mm outline), and they fit: 24 mm of 160.
        let r = add_tabs(&[square(0.0, 0.0, 40.0)], &[0], 3.0, 20.0);
        assert_eq!(r.tabs, 8);
        // Ask for far more tabs than fit and the room decides: 10 mm of a 40 mm outline is 3 tabs of 3 mm.
        let r = add_tabs(&[square(0.0, 0.0, 10.0)], &[0], 3.0, 5.0);
        assert_eq!(r.tabs, 3);
        assert!(near(length_of(&r.paths), 40.0 - 9.0));
    }

    #[test]
    fn no_outline_gets_more_than_the_largest_number_of_tabs() {
        let r = add_tabs(&[square(0.0, 0.0, 100.0)], &[0], 0.001, 0.000_001);
        assert_eq!(r.tabs, MAX_TABS_PER_OUTLINE);
        assert_eq!(r.paths.len(), MAX_TABS_PER_OUTLINE);
    }

    #[test]
    fn a_closed_path_that_repeats_its_first_point_is_the_same_loop() {
        let plain = square(0.0, 0.0, 40.0);
        let mut again = plain.clone();
        again.points.push(plain.points[0]);
        let a = add_tabs(&[plain], &[0], 2.0, 50.0);
        let b = add_tabs(&[again], &[0], 2.0, 50.0);
        assert_eq!(a.paths, b.paths);
        assert_eq!(a.tabs, b.tabs);
    }

    #[test]
    fn every_run_follows_the_outline_and_joins_up_with_nothing_left_over() {
        // For irregular outlines: the cut length is the outline less the tabs, and there is one run per tab.
        let shapes: Vec<Path2D> = vec![
            Path2D::new(vec![p(0.0, 0.0), p(60.0, 0.0), p(30.0, 52.0)], true),
            Path2D::new(
                vec![
                    p(0.0, 0.0),
                    p(60.0, 0.0),
                    p(60.0, 20.0),
                    p(20.0, 20.0),
                    p(20.0, 60.0),
                    p(0.0, 60.0),
                ],
                true,
            ),
            circle(3.0, 32),
        ];
        for shape in shapes {
            for (w, s) in [(0.5, 100.0), (1.0, 50.0), (2.0, 50.0), (3.0, 20.0)] {
                let r = add_tabs(std::slice::from_ref(&shape), &[0], w, s);
                if r.outlines == 0 {
                    continue;
                }
                assert_eq!(r.paths.len(), r.tabs, "{w} {s}");
                assert!(
                    near(length_of(&r.paths), shape.length() - r.tabs as f64 * w),
                    "{w} {s}: {} against {}",
                    length_of(&r.paths),
                    shape.length() - r.tabs as f64 * w
                );
                assert!(r
                    .paths
                    .iter()
                    .all(|run| !run.closed && run.points.len() >= 2));
            }
        }
    }

    #[test]
    fn nothing_to_do_is_fine() {
        let r = add_tabs(&[], &[], 2.0, 50.0);
        assert!(r.paths.is_empty());
        assert_eq!((r.tabs, r.outlines, r.too_small), (0, 0, 0));
    }
}
