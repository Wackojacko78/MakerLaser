//! Path planning helpers for the toolpath generator (`toolpath.rs`). Pure functions on points and
//! paths, so they are unit-tested without a project: see "Path planning" in docs/user-guide.md.
//!
//! * [`order_stops`] puts pieces of work (a filled object, a whole part) in an order that keeps the
//!   head's laser-off travel short: nearest first, then a few passes that move one to three stops
//!   at a time to a better place.
//! * [`remove_shared_lines`] makes sure two lines that lie on top of each other are cut once.
//!
//! Nothing here changes the shape of anything that is cut, except that a line that was already cut
//! is not cut again.

use std::collections::{HashMap, HashSet};

use makerlaser_common::{Path2D, Point2};

// ---------------------------------------------------------------------------------------
// Ordering stops
// ---------------------------------------------------------------------------------------

/// One piece of work the head does in a single go: it arrives at `start` and leaves from `end`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Stop {
    pub start: Point2,
    pub end: Point2,
}

/// More stops than this keep the nearest-first order: the improvement passes work in time that
/// grows with the square of the number of stops.
pub const MAX_IMPROVE_STOPS: usize = 300;
const MAX_IMPROVE_PASSES: usize = 6;

/// The laser-off distance of doing `order` from `from`: the head goes from where it is to the start
/// of each stop in turn, and leaves each from its end.
#[cfg(test)]
fn travel_length(stops: &[Stop], order: &[usize], from: Point2) -> f64 {
    let mut here = from;
    let mut total = 0.0;
    for &i in order {
        total += here.distance_to(&stops[i].start);
        here = stops[i].end;
    }
    total
}

/// Always go to the stop whose start is nearest to where the head is.
fn nearest_first(stops: &[Stop], from: Point2) -> Vec<usize> {
    let mut left: Vec<usize> = (0..stops.len()).collect();
    let mut order: Vec<usize> = Vec::with_capacity(stops.len());
    let mut here = from;
    while !left.is_empty() {
        let mut best = 0;
        let mut best_d = f64::INFINITY;
        for (k, &i) in left.iter().enumerate() {
            let d = here.distance_to(&stops[i].start);
            if d < best_d {
                best_d = d;
                best = k;
            }
        }
        let i = left.remove(best);
        order.push(i);
        here = stops[i].end;
    }
    order
}

/// Where the head is just before position `pos` of `seq`.
fn end_before(stops: &[Stop], seq: &[usize], pos: usize, from: Point2) -> Point2 {
    if pos == 0 {
        from
    } else {
        stops[seq[pos - 1]].end
    }
}

/// Tries taking the `block` stops that start at position `i` out of `order` and putting them
/// (in the same order) where they cost least. Returns the new order if that is shorter.
fn try_move(
    stops: &[Stop],
    order: &[usize],
    from: Point2,
    i: usize,
    block: usize,
) -> Option<Vec<usize>> {
    let n = order.len();
    let first = order[i];
    let last = order[i + block - 1];
    // What is saved by taking the block out.
    let before = end_before(stops, order, i, from);
    let mut removed = before.distance_to(&stops[first].start);
    if i + block < n {
        let after = stops[order[i + block]].start;
        removed += stops[last].end.distance_to(&after);
        removed -= before.distance_to(&after);
    }
    let mut rest: Vec<usize> = Vec::with_capacity(n - block);
    rest.extend_from_slice(&order[..i]);
    rest.extend_from_slice(&order[i + block..]);
    // What it costs to put it back at each other place.
    let mut best_pos = i;
    let mut best_gain = 1e-9;
    for pos in 0..=rest.len() {
        if pos == i {
            continue;
        }
        let p = end_before(stops, &rest, pos, from);
        let mut added = p.distance_to(&stops[first].start);
        if pos < rest.len() {
            let q = stops[rest[pos]].start;
            added += stops[last].end.distance_to(&q);
            added -= p.distance_to(&q);
        }
        let gain = removed - added;
        if gain > best_gain {
            best_gain = gain;
            best_pos = pos;
        }
    }
    if best_pos == i {
        return None;
    }
    let moved: Vec<usize> = order[i..i + block].to_vec();
    for (k, item) in moved.into_iter().enumerate() {
        rest.insert(best_pos + k, item);
    }
    Some(rest)
}

/// Repeats `try_move` for blocks of one, two and three stops until a whole pass changes nothing.
fn improve(stops: &[Stop], mut order: Vec<usize>, from: Point2) -> Vec<usize> {
    let n = order.len();
    for _ in 0..MAX_IMPROVE_PASSES {
        let mut improved = false;
        for block in 1..=3usize {
            if block > n {
                break;
            }
            let mut i = 0;
            while i + block <= order.len() {
                if let Some(better) = try_move(stops, &order, from, i, block) {
                    order = better;
                    improved = true;
                }
                i += 1;
            }
        }
        if !improved {
            break;
        }
    }
    order
}

/// The order to do `stops` in, starting with the head at `from`: every index appears once. The
/// order starts as nearest-first and is then improved, so it is never longer than nearest-first.
/// Points that are not numbers leave the order as it was given.
pub fn order_stops(stops: &[Stop], from: Point2) -> Vec<usize> {
    let finite = from.is_finite()
        && stops
            .iter()
            .all(|s| s.start.is_finite() && s.end.is_finite());
    if !finite {
        return (0..stops.len()).collect();
    }
    let order = nearest_first(stops, from);
    if stops.len() > 2 && stops.len() <= MAX_IMPROVE_STOPS {
        improve(stops, order, from)
    } else {
        order
    }
}

// ---------------------------------------------------------------------------------------
// Cutting shared lines once
// ---------------------------------------------------------------------------------------

/// Two points closer than this (mm) are the same point, and a line within this distance of a
/// point passes through it. It matches the 0.01 mm grid that Clipper2 snaps its results to.
const SHARED_TOLERANCE_MM: f64 = 0.01;
/// Cell size (mm) of the coarse grid used to find the points that lie on a line.
const COARSE_CELL_MM: f64 = 1.0;
/// A layer with more points than this is left alone: the search for points on long lines would
/// take too long.
pub const MAX_SHARED_POINTS: usize = 60_000;

/// The answer of [`remove_shared_lines`].
#[derive(Debug, Clone)]
pub struct SharedLines {
    /// The paths to cut, in the order given. A path with nothing shared is returned as it was
    /// (closed paths stay closed); one that shares lines comes back as the open runs that are
    /// still to be cut.
    pub paths: Vec<Path2D>,
    /// How much cutting was dropped, in mm.
    pub removed_mm: f64,
    /// True when the layer was too big and nothing was changed.
    pub skipped: bool,
}

type Grid = HashMap<(i64, i64), Vec<usize>>;

fn cell_of(p: Point2, size: f64) -> (i64, i64) {
    ((p.x / size).floor() as i64, (p.y / size).floor() as i64)
}

/// Gives every point an id, and the same id to points that are within the tolerance of each other.
struct PointIndex {
    tol: f64,
    cells: Grid,
    points: Vec<Point2>,
}

impl PointIndex {
    fn new(tol: f64) -> Self {
        PointIndex {
            tol,
            cells: HashMap::new(),
            points: Vec::new(),
        }
    }

    fn id(&mut self, p: Point2) -> usize {
        let (cx, cy) = cell_of(p, self.tol);
        for dx in -1..=1i64 {
            for dy in -1..=1i64 {
                if let Some(list) = self
                    .cells
                    .get(&(cx.saturating_add(dx), cy.saturating_add(dy)))
                {
                    for &k in list {
                        if self.points[k].distance_to(&p) <= self.tol {
                            return k;
                        }
                    }
                }
            }
        }
        let k = self.points.len();
        self.points.push(p);
        self.cells.entry((cx, cy)).or_default().push(k);
        k
    }
}

/// The distinct vertices of a path, as ids and as drawn. A point that repeats the one before it is
/// dropped, and so is a last point that repeats the first one of a closed path.
fn vertices(path: &Path2D, index: &mut PointIndex) -> (Vec<usize>, Vec<Point2>) {
    let mut ids: Vec<usize> = Vec::new();
    let mut coords: Vec<Point2> = Vec::new();
    for &p in &path.points {
        let k = index.id(p);
        if ids.last() == Some(&k) {
            continue;
        }
        ids.push(k);
        coords.push(p);
    }
    if path.closed && ids.len() > 1 && ids.first() == ids.last() {
        ids.pop();
        coords.pop();
    }
    (ids, coords)
}

/// The known points that lie strictly inside the segment a-b (within the tolerance of its line and
/// not within it of either end), nearest `a` first, with how far along the segment they are.
fn points_on_segment(
    a: Point2,
    b: Point2,
    index: &PointIndex,
    coarse: &Grid,
    all: &[usize],
) -> Vec<(f64, usize)> {
    let tol = SHARED_TOLERANCE_MM;
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let length = (dx * dx + dy * dy).sqrt();
    if length <= 2.0 * tol {
        return Vec::new();
    }
    let low = Point2::new(a.x.min(b.x) - tol, a.y.min(b.y) - tol);
    let high = Point2::new(a.x.max(b.x) + tol, a.y.max(b.y) + tol);
    let (cx0, cy0) = cell_of(low, COARSE_CELL_MM);
    let (cx1, cy1) = cell_of(high, COARSE_CELL_MM);
    let across = cx1.saturating_sub(cx0).saturating_add(1);
    let down = cy1.saturating_sub(cy0).saturating_add(1);
    let cells = across.saturating_mul(down);
    let mut candidates: Vec<usize> = Vec::new();
    if cells <= 400 {
        for cx in cx0..=cx1 {
            for cy in cy0..=cy1 {
                if let Some(list) = coarse.get(&(cx, cy)) {
                    candidates.extend_from_slice(list);
                }
            }
        }
    } else {
        candidates.extend_from_slice(all);
    }
    let mut found: Vec<(f64, usize)> = Vec::new();
    for k in candidates {
        let p = index.points[k];
        let along = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length;
        if along <= tol || along >= length - tol {
            continue;
        }
        let off = ((p.x - a.x) * dy - (p.y - a.y) * dx).abs() / length;
        if off <= tol {
            found.push((along, k));
        }
    }
    found.sort_by(|x, y| x.0.total_cmp(&y.0));
    found
}

/// A straight piece of a path between two vertices (a segment is split where another vertex lies
/// on it, so two lines that only partly overlap still match piece for piece).
struct Piece {
    from: Point2,
    to: Point2,
    from_id: usize,
    to_id: usize,
}

/// Goes through `paths` in order and drops every piece of a line that an earlier path has already
/// cut (in either direction), so a line shared by two parts is cut once, by the one that comes
/// first. Because the order is not changed, holes still come before the outlines round them.
///
/// Lines count as the same when their ends are within 0.01 mm of each other, and a line that
/// passes through the end of another is split there, so a short edge against the middle of a long
/// one is found too.
pub fn remove_shared_lines(paths: &[Path2D]) -> SharedLines {
    let total: usize = paths.iter().map(|p| p.points.len()).sum();
    if total > MAX_SHARED_POINTS {
        return SharedLines {
            paths: paths.to_vec(),
            removed_mm: 0.0,
            skipped: true,
        };
    }
    let mut index = PointIndex::new(SHARED_TOLERANCE_MM);
    let per_path: Vec<(Vec<usize>, Vec<Point2>)> =
        paths.iter().map(|p| vertices(p, &mut index)).collect();
    let mut coarse: Grid = HashMap::new();
    let mut all: Vec<usize> = Vec::new();
    let mut seen: HashSet<usize> = HashSet::new();
    for (ids, _) in &per_path {
        for &k in ids {
            if seen.insert(k) {
                all.push(k);
                coarse
                    .entry(cell_of(index.points[k], COARSE_CELL_MM))
                    .or_default()
                    .push(k);
            }
        }
    }
    let mut done: HashSet<(usize, usize)> = HashSet::new();
    let mut out: Vec<Path2D> = Vec::new();
    let mut removed_mm = 0.0;
    for (path, (ids, coords)) in paths.iter().zip(&per_path) {
        let n = ids.len();
        if n < 2 {
            out.push(path.clone());
            continue;
        }
        let count = if path.closed { n } else { n - 1 };
        let mut pieces: Vec<Piece> = Vec::new();
        for s in 0..count {
            let (a_id, b_id) = (ids[s], ids[(s + 1) % n]);
            let (a, b) = (coords[s], coords[(s + 1) % n]);
            let length = a.distance_to(&b);
            if a_id == b_id || length <= 1e-12 {
                continue;
            }
            let (ux, uy) = ((b.x - a.x) / length, (b.y - a.y) / length);
            let mut cur_xy = a;
            let mut cur_id = a_id;
            for (t, k) in points_on_segment(a, b, &index, &coarse, &all) {
                if k == cur_id || k == b_id {
                    continue;
                }
                let xy = Point2::new(a.x + ux * t, a.y + uy * t);
                pieces.push(Piece {
                    from: cur_xy,
                    to: xy,
                    from_id: cur_id,
                    to_id: k,
                });
                cur_xy = xy;
                cur_id = k;
            }
            pieces.push(Piece {
                from: cur_xy,
                to: b,
                from_id: cur_id,
                to_id: b_id,
            });
        }
        // A piece is kept only the first time its two ends are seen, whichever way round.
        let mut keep: Vec<bool> = Vec::with_capacity(pieces.len());
        for piece in &pieces {
            let key = (
                piece.from_id.min(piece.to_id),
                piece.from_id.max(piece.to_id),
            );
            keep.push(done.insert(key));
        }
        if keep.iter().all(|&k| k) {
            out.push(path.clone());
            continue;
        }
        for (piece, &kept) in pieces.iter().zip(&keep) {
            if !kept {
                removed_mm += piece.from.distance_to(&piece.to);
            }
        }
        if path.closed {
            // Start just after a dropped piece, so that no run has to wrap round the start.
            if let Some(f) = keep.iter().position(|&k| !k) {
                pieces.rotate_left(f);
                keep.rotate_left(f);
            }
        }
        let mut run: Vec<Point2> = Vec::new();
        for (piece, &kept) in pieces.iter().zip(&keep) {
            if kept {
                if run.is_empty() {
                    run.push(piece.from);
                }
                run.push(piece.to);
            } else {
                if run.len() >= 2 {
                    out.push(Path2D::new(run.clone(), false));
                }
                run.clear();
            }
        }
        if run.len() >= 2 {
            out.push(Path2D::new(run, false));
        }
    }
    SharedLines {
        paths: out,
        removed_mm,
        skipped: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(x: f64, y: f64) -> Point2 {
        Point2::new(x, y)
    }

    fn stop_at(x: f64, y: f64) -> Stop {
        Stop {
            start: p(x, y),
            end: p(x, y),
        }
    }

    fn square(x: f64, y: f64, s: f64) -> Path2D {
        Path2D::new(
            vec![p(x, y), p(x + s, y), p(x + s, y + s), p(x, y + s)],
            true,
        )
    }

    fn line(a: (f64, f64), b: (f64, f64)) -> Path2D {
        Path2D::new(vec![p(a.0, a.1), p(b.0, b.1)], false)
    }

    fn total_length(paths: &[Path2D]) -> f64 {
        paths.iter().map(|q| q.length()).sum()
    }

    fn near(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    fn is_a_permutation(order: &[usize], n: usize) -> bool {
        let mut sorted = order.to_vec();
        sorted.sort_unstable();
        sorted == (0..n).collect::<Vec<usize>>()
    }

    // ---- order_stops -----------------------------------------------------------------

    #[test]
    fn stops_on_a_line_are_visited_nearest_first() {
        let stops = [
            stop_at(10.0, 0.0),
            stop_at(50.0, 0.0),
            stop_at(20.0, 0.0),
            stop_at(30.0, 0.0),
        ];
        assert_eq!(order_stops(&stops, p(0.0, 0.0)), vec![0, 2, 3, 1]);
    }

    #[test]
    fn a_stop_is_entered_at_its_start_and_left_from_its_end() {
        let stops = [
            Stop {
                start: p(100.0, 0.0),
                end: p(100.0, 100.0),
            },
            Stop {
                start: p(100.0, 110.0),
                end: p(0.0, 0.0),
            },
        ];
        let order = order_stops(&stops, p(0.0, 0.0));
        assert_eq!(order, vec![0, 1]);
        assert!(near(travel_length(&stops, &order, p(0.0, 0.0)), 110.0));
        // The other way round is much longer: out to the second stop and all the way back.
        assert!(travel_length(&stops, &[1, 0], p(0.0, 0.0)) > 248.0);
    }

    #[test]
    fn a_move_that_makes_the_tour_shorter_is_made() {
        let points = [
            (55.0, 60.0),
            (54.0, 3.0),
            (5.0, 5.0),
            (23.0, 53.0),
            (10.0, 47.0),
            (51.0, 42.0),
        ];
        let stops: Vec<Stop> = points.iter().map(|&(x, y)| stop_at(x, y)).collect();
        let from = p(0.0, 0.0);
        let nearest = nearest_first(&stops, from);
        let better = order_stops(&stops, from);
        assert_eq!(nearest, vec![2, 4, 3, 5, 0, 1]);
        assert_eq!(better, vec![2, 4, 3, 0, 5, 1]);
        assert!(near(travel_length(&stops, &nearest, from), 169.216539));
        assert!(near(travel_length(&stops, &better, from), 153.996443));
    }

    #[test]
    fn every_stop_is_visited_once_and_the_tour_is_never_longer_than_nearest_first() {
        for n in [3usize, 4, 7, 20, 60] {
            // Spread-out points from a simple formula, so the test needs no random numbers.
            let stops: Vec<Stop> = (0..n)
                .map(|i| {
                    let f = i as f64;
                    stop_at(
                        (f * 97.0) % 290.0 + 5.0,
                        (f * 61.0 + f * f * 13.0) % 290.0 + 5.0,
                    )
                })
                .collect();
            let from = p(0.0, 300.0);
            let order = order_stops(&stops, from);
            assert!(is_a_permutation(&order, n), "{n}: {order:?}");
            let nearest = nearest_first(&stops, from);
            assert!(
                travel_length(&stops, &order, from) <= travel_length(&stops, &nearest, from) + 1e-9,
                "{n}"
            );
        }
    }

    #[test]
    fn numbers_that_are_not_numbers_leave_the_order_alone() {
        let stops = [
            stop_at(10.0, 0.0),
            stop_at(f64::NAN, 0.0),
            stop_at(5.0, 0.0),
        ];
        assert_eq!(order_stops(&stops, p(0.0, 0.0)), vec![0, 1, 2]);
        let fine = [stop_at(10.0, 0.0), stop_at(5.0, 0.0)];
        assert_eq!(order_stops(&fine, p(f64::INFINITY, 0.0)), vec![0, 1]);
    }

    #[test]
    fn nothing_and_one_stop_are_fine() {
        assert!(order_stops(&[], p(0.0, 0.0)).is_empty());
        assert_eq!(order_stops(&[stop_at(5.0, 5.0)], p(0.0, 0.0)), vec![0]);
    }

    #[test]
    fn too_many_stops_keep_the_nearest_first_order() {
        let stops: Vec<Stop> = (0..MAX_IMPROVE_STOPS + 1)
            .map(|i| stop_at(((i * 7) % 301) as f64, 0.0))
            .collect();
        let from = p(0.0, 0.0);
        assert_eq!(order_stops(&stops, from), nearest_first(&stops, from));
    }

    // ---- remove_shared_lines -------------------------------------------------------------

    #[test]
    fn two_squares_that_share_an_edge_cut_it_once() {
        let a = square(0.0, 0.0, 10.0);
        let b = square(10.0, 0.0, 10.0);
        let r = remove_shared_lines(&[a.clone(), b]);
        assert!(!r.skipped);
        assert!(near(r.removed_mm, 10.0), "{}", r.removed_mm);
        assert_eq!(r.paths.len(), 2);
        // The first square is cut whole; the second is cut from where it meets the first.
        assert_eq!(r.paths[0], a);
        assert!(!r.paths[1].closed);
        assert_eq!(
            r.paths[1].points,
            vec![p(10.0, 0.0), p(20.0, 0.0), p(20.0, 10.0), p(10.0, 10.0)]
        );
        assert!(near(total_length(&r.paths), 70.0));
    }

    #[test]
    fn a_grid_of_touching_squares_loses_the_edges_it_shares() {
        let mut squares: Vec<Path2D> = Vec::new();
        for row in 0..5 {
            for col in 0..5 {
                squares.push(square(col as f64 * 40.0, row as f64 * 40.0, 40.0));
            }
        }
        let r = remove_shared_lines(&squares);
        // 25 squares of 160 mm, and 6 x 5 + 5 x 6 = 60 distinct edges of 40 mm.
        assert!(near(total_length(&squares), 4000.0));
        assert!(
            near(total_length(&r.paths), 2400.0),
            "{}",
            total_length(&r.paths)
        );
        assert!(near(r.removed_mm, 1600.0), "{}", r.removed_mm);
    }

    #[test]
    fn a_square_drawn_twice_is_cut_once_whichever_way_round() {
        let a = square(5.0, 5.0, 10.0);
        let mut again = a.clone();
        again.points.reverse();
        for second in [a.clone(), again] {
            let r = remove_shared_lines(&[a.clone(), second]);
            assert_eq!(r.paths.len(), 1);
            assert_eq!(r.paths[0], a);
            assert!(near(r.removed_mm, 40.0), "{}", r.removed_mm);
        }
    }

    #[test]
    fn a_short_edge_against_the_middle_of_a_long_one_is_found() {
        // A 20 mm square with two 10 mm squares along its right-hand edge.
        let shapes = [
            square(0.0, 0.0, 20.0),
            square(20.0, 0.0, 10.0),
            square(20.0, 10.0, 10.0),
        ];
        let r = remove_shared_lines(&shapes);
        assert!(near(total_length(&shapes), 160.0));
        assert!(
            near(total_length(&r.paths), 130.0),
            "{}",
            total_length(&r.paths)
        );
        assert!(near(r.removed_mm, 30.0), "{}", r.removed_mm);
        // A partial overlap: the 10 mm square sits against only the middle 10 mm of the long edge.
        let shapes = [square(0.0, 0.0, 20.0), square(20.0, 5.0, 10.0)];
        let r = remove_shared_lines(&shapes);
        assert!(near(r.removed_mm, 10.0), "{}", r.removed_mm);
        assert!(near(total_length(&r.paths), 110.0));
    }

    #[test]
    fn shapes_that_only_touch_at_a_point_or_not_at_all_are_left_as_they_are() {
        for shapes in [
            vec![square(0.0, 0.0, 10.0), square(10.0, 10.0, 10.0)],
            vec![square(0.0, 0.0, 10.0), square(30.0, 0.0, 10.0)],
            vec![square(0.0, 0.0, 30.0), square(10.0, 10.0, 10.0)],
        ] {
            let r = remove_shared_lines(&shapes);
            assert_eq!(r.paths, shapes);
            assert_eq!(r.removed_mm, 0.0);
            assert!(!r.skipped);
        }
    }

    #[test]
    fn a_line_along_an_edge_is_dropped_and_one_that_runs_past_it_is_trimmed() {
        let sq = square(0.0, 0.0, 20.0);
        let r = remove_shared_lines(&[sq.clone(), line((0.0, 0.0), (20.0, 0.0))]);
        assert_eq!(r.paths, vec![sq.clone()]);
        assert!(near(r.removed_mm, 20.0));
        let r = remove_shared_lines(&[sq.clone(), line((-5.0, 0.0), (25.0, 0.0))]);
        assert_eq!(r.paths.len(), 3);
        assert!(
            near(total_length(&r.paths), 90.0),
            "{}",
            total_length(&r.paths)
        );
        assert!(near(r.removed_mm, 20.0));
    }

    #[test]
    fn a_diagonal_shared_by_two_triangles_is_cut_once() {
        let upper = Path2D::new(vec![p(0.0, 0.0), p(10.0, 0.0), p(10.0, 10.0)], true);
        let lower = Path2D::new(vec![p(0.0, 0.0), p(10.0, 10.0), p(0.0, 10.0)], true);
        let r = remove_shared_lines(&[upper, lower]);
        assert!(near(r.removed_mm, 200.0_f64.sqrt()), "{}", r.removed_mm);
    }

    #[test]
    fn ends_a_few_thousandths_of_a_millimetre_apart_still_count_as_shared() {
        let r = remove_shared_lines(&[square(0.0, 0.0, 10.0), square(10.004, 0.003, 10.0)]);
        assert!(near(r.removed_mm, 10.0), "{}", r.removed_mm);
    }

    #[test]
    fn a_closed_path_that_repeats_its_first_point_is_the_same_loop() {
        let plain = square(0.0, 0.0, 10.0);
        let mut again = plain.clone();
        again.points.push(plain.points[0]);
        let r = remove_shared_lines(&[plain.clone(), again]);
        assert_eq!(r.paths, vec![plain]);
        assert!(near(r.removed_mm, 40.0), "{}", r.removed_mm);
    }

    #[test]
    fn what_is_not_shared_is_returned_exactly_as_it_was() {
        // Curves: no flat edges are shared, so nothing is touched (not even re-ordered).
        let circle = |cx: f64, cy: f64, r: f64| {
            let pts: Vec<Point2> = (0..48)
                .map(|k| {
                    let a = std::f64::consts::TAU * k as f64 / 48.0;
                    p(cx + r * a.cos(), cy + r * a.sin())
                })
                .collect();
            Path2D::new(pts, true)
        };
        let shapes = [
            circle(0.0, 0.0, 10.0),
            circle(30.0, 0.0, 10.0),
            circle(0.0, 0.0, 5.0),
        ];
        let r = remove_shared_lines(&shapes);
        assert_eq!(r.paths, shapes.to_vec());
        assert_eq!(r.removed_mm, 0.0);
    }

    #[test]
    fn a_layer_with_too_many_points_is_left_alone_and_says_so() {
        let big = Path2D::new(
            (0..MAX_SHARED_POINTS + 1)
                .map(|i| p(i as f64, (i % 2) as f64))
                .collect(),
            false,
        );
        let r = remove_shared_lines(&[big.clone(), big.clone()]);
        assert!(r.skipped);
        assert_eq!(r.paths, vec![big.clone(), big]);
        assert_eq!(r.removed_mm, 0.0);
    }

    #[test]
    fn nothing_to_do_is_fine() {
        let r = remove_shared_lines(&[]);
        assert!(r.paths.is_empty() && !r.skipped && r.removed_mm == 0.0);
        let one = Path2D::new(vec![p(1.0, 1.0)], false);
        let r = remove_shared_lines(std::slice::from_ref(&one));
        assert_eq!(r.paths, vec![one]);
    }
}
