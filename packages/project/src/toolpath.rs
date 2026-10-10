//! Toolpath generation: `Operations -> Toolpaths`. Converts planned operations into an
//! ordered list of straight machine moves in **workspace coordinates** (conversion to
//! machine coordinates happens once, in the G-code stage).
//!
//! * **Cut ordering** is nesting-aware: paths are grouped by containment depth and the
//!   deepest group (holes, islands) is cut first. Travel optimisation (nearest neighbour,
//!   with closed paths started at their nearest vertex) only reorders paths *within* a
//!   depth group, so it can never move an outer boundary ahead of the holes inside it.
//! * **Passes** repeat the *whole operation*, not each path, so material stays supported
//!   until the final pass.
//! * **Kerf compensation** grows outer boundaries and shrinks holes by half the kerf.
//! * **Fill** uses an even-odd scanline fill with serpentine (alternating) direction.
//! * **Raster** resamples the image through the object's full affine transform, applies the
//!   adjustments and dithering, and emits scan-line runs (bidirectional if requested).

use std::collections::{BTreeMap, HashMap};

use makerlaser_common::{
    BoundingBox, CutOrderStrategy, DitherAlgorithm as CommonDither, FillPattern, ImageData,
    LaserOperation, Layer, ObjectKind, Path2D, Point2, ProjectFile, RasterOperation, ScanDirection,
    Transform2D, WorkspaceObject,
};
use makerlaser_geometry::{kerf_compensate, KerfSide};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{ProjectError, Result};

const MAX_RASTER_PIXELS: u64 = 60_000_000;
const MAX_SEGMENTS: usize = 4_000_000;
const MAX_FILL_LINES: usize = 400_000;
const RAPID_FEED_MM_MIN: f64 = 6000.0;
/// Overscan: runs on one scan line closer together than this are joined by a laser-off move at
/// the layer's feed rate instead of a stop.
const OVERSCAN_JOIN_MM: f64 = 10.0;
/// Overscan moves shorter than this are dropped.
const OVERSCAN_MIN_MM: f64 = 0.01;
/// Ramped power (Score layers): a ramp is built from this many equal steps, each burned at one power.
const RAMP_STEPS: usize = 8;
/// An open line ramps from this fraction of the layer's power up to the full power (and back down at
/// its other end), so the very ends of the line are still visible. Closed shapes ramp from nothing,
/// because the end of the ramp overlaps the start (see `ramp_pieces`).
const RAMP_OPEN_FLOOR: f64 = 0.2;
/// A ramp shorter than this is not worth making: the path is burned at full power.
const RAMP_MIN_MM: f64 = 0.01;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MoveKind {
    Travel,
    Cut,
    Score,
    Fill,
    Engrave,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ToolpathSegment {
    pub from: Point2,
    pub to: Point2,
    pub kind: MoveKind,
    pub feed_mm_min: f64,
    pub power_percent: f64,
    pub air_assist: bool,
    /// A laser-off move that belongs to an overscan run-up, run-out or join. The kind is
    /// Travel, but G-code sends it as M4 S0 + G1 at feed_mm_min (never M5 + G0), so GRBL's
    /// planner is not emptied between scan lines.
    #[serde(default)]
    pub overscan: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct ToolpathStats {
    pub travel_mm: f64,
    pub cut_mm: f64,
    pub engrave_mm: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Toolpath {
    pub segments: Vec<ToolpathSegment>,
}

impl Toolpath {
    pub fn stats(&self) -> ToolpathStats {
        let mut s = ToolpathStats::default();
        for seg in &self.segments {
            let len = seg.from.distance_to(&seg.to);
            match seg.kind {
                MoveKind::Travel => s.travel_mm += len,
                MoveKind::Cut | MoveKind::Score => s.cut_mm += len,
                MoveKind::Fill | MoveKind::Engrave => s.engrave_mm += len,
            }
        }
        s
    }

    /// Bounding box of every point the laser head visits (travel included). Overscan moves
    /// are left out: they are clamped to the bed when they are made, and including them would
    /// move the job's edges (and so Start From / Job Origin) by the overscan distance.
    pub fn bounds(&self) -> Option<BoundingBox> {
        BoundingBox::from_points(
            self.segments
                .iter()
                .filter(|s| !s.overscan)
                .flat_map(|s| [&s.from, &s.to]),
        )
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolpathResult {
    pub toolpath: Toolpath,
    pub stats: ToolpathStats,
    pub warnings: Vec<String>,
}

struct Builder {
    toolpath: Toolpath,
    cursor: Point2,
    rapid: f64,
}

impl Builder {
    fn travel_to(&mut self, target: Point2) {
        if self.cursor.distance_to(&target) > 1e-6 {
            self.toolpath.segments.push(ToolpathSegment {
                from: self.cursor,
                to: target,
                kind: MoveKind::Travel,
                feed_mm_min: self.rapid,
                power_percent: 0.0,
                air_assist: false,
                overscan: false,
            });
        }
        self.cursor = target;
    }

    fn draw(&mut self, from: Point2, to: Point2, kind: MoveKind, layer: &Layer) {
        self.travel_to(from);
        self.toolpath.segments.push(ToolpathSegment {
            from,
            to,
            kind,
            feed_mm_min: layer.speed_mm_min,
            power_percent: layer.power_percent,
            air_assist: layer.air_assist,
            overscan: false,
        });
        self.cursor = to;
    }

    /// A laser-off move to "to" at the layer's feed rate: an overscan run-up, run-out or join.
    /// G-code sends it as M4 S0 + G1, never M5 + G0, so GRBL's planner is not emptied and the
    /// head keeps its speed.
    fn dark(&mut self, to: Point2, layer: &Layer) {
        let from = self.cursor;
        if from.distance_to(&to) > 1e-9 {
            self.toolpath.segments.push(ToolpathSegment {
                from,
                to,
                kind: MoveKind::Travel,
                feed_mm_min: layer.speed_mm_min,
                power_percent: 0.0,
                air_assist: layer.air_assist,
                overscan: true,
            });
        }
        self.cursor = to;
    }

    /// Moves to the start of the next run-up. Short hops stay at the layer's feed rate so the
    /// head does not stop between scan lines; longer ones are ordinary rapid travel.
    fn link_to(&mut self, target: Point2, layer: &Layer) {
        let distance = self.cursor.distance_to(&target);
        if distance <= 1e-6 {
            self.cursor = target;
        } else if distance <= OVERSCAN_JOIN_MM {
            self.dark(target, layer);
        } else {
            self.travel_to(target);
        }
    }

    /// Burns scan lines with overscan. Each line is a list of runs in travel order. Runs on a
    /// line that are close together are burned as one chain (the gaps are crossed with the laser
    /// off, without stopping); each chain gets a laser-off run-up before it and run-out after it.
    fn scan_lines(
        &mut self,
        lines: &[Vec<(Point2, Point2)>],
        kind: MoveKind,
        layer: &Layer,
        bed: &BoundingBox,
    ) {
        let mut first = true;
        for line in lines {
            let mut start = 0;
            while start < line.len() {
                let mut end = start + 1;
                while end < line.len()
                    && line[end - 1].1.distance_to(&line[end].0) <= OVERSCAN_JOIN_MM
                {
                    end += 1;
                }
                self.scan_chain(&line[start..end], kind, layer, bed, first);
                first = false;
                start = end;
            }
        }
    }

    fn scan_chain(
        &mut self,
        chain: &[(Point2, Point2)],
        kind: MoveKind,
        layer: &Layer,
        bed: &BoundingBox,
        first: bool,
    ) {
        let (Some(&(head, along)), Some(&(_, tail))) = (chain.first(), chain.last()) else {
            return;
        };
        let length = head.distance_to(&along);
        let (run_up, run_out) = if length > 1e-9 {
            let (dx, dy) = ((along.x - head.x) / length, (along.y - head.y) / length);
            (
                extend_within_bed(head, -dx, -dy, layer.overscan_mm, bed),
                extend_within_bed(tail, dx, dy, layer.overscan_mm, bed),
            )
        } else {
            (head, tail)
        };
        // The first line of an operation is approached by a normal rapid move.
        if first {
            self.travel_to(run_up);
        } else {
            self.link_to(run_up, layer);
        }
        self.dark(head, layer);
        for (i, &(a, z)) in chain.iter().enumerate() {
            if i > 0 {
                self.dark(a, layer);
            }
            self.draw(a, z, kind, layer);
        }
        self.dark(run_out, layer);
    }

    /// A burning move at an explicit power. The steps of a ramp use this; otherwise it is `draw`.
    fn draw_powered(
        &mut self,
        from: Point2,
        to: Point2,
        kind: MoveKind,
        layer: &Layer,
        power_percent: f64,
    ) {
        self.travel_to(from);
        self.toolpath.segments.push(ToolpathSegment {
            from,
            to,
            kind,
            feed_mm_min: layer.speed_mm_min,
            power_percent,
            air_assist: layer.air_assist,
            overscan: false,
        });
        self.cursor = to;
    }

    /// Draws a path with ramped power at its ends (Score layers; see `ramp_pieces`).
    fn ramped_path(&mut self, path: &Path2D, kind: MoveKind, layer: &Layer) {
        for (from, to, fraction) in ramp_pieces(path, layer.ramp_mm) {
            self.draw_powered(from, to, kind, layer, layer.power_percent * fraction);
        }
    }

    fn path(&mut self, path: &Path2D, kind: MoveKind, layer: &Layer) {
        if path.points.len() < 2 {
            return;
        }
        for w in path.points.windows(2) {
            self.draw(w[0], w[1], kind, layer);
        }
        if path.closed {
            let last = path.points[path.points.len() - 1];
            let first = path.points[0];
            if last.distance_to(&first) > 1e-9 {
                self.draw(last, first, kind, layer);
            }
        }
    }
}

/// One piece of a ramped path: where it runs, and the fraction (above 0, up to 1) of the layer's
/// power it burns at.
type RampPiece = (Point2, Point2, f64);

/// The point at distance `s` along a polyline whose running lengths are `cum` (`cum[i]` is the
/// distance from the start to `points[i]`).
fn point_along(points: &[Point2], cum: &[f64], s: f64) -> Point2 {
    let total = cum[cum.len() - 1];
    let s = s.clamp(0.0, total);
    let mut i = 0;
    while i + 2 < points.len() && cum[i + 1] < s {
        i += 1;
    }
    let (a, b) = (points[i], points[i + 1]);
    let span = cum[i + 1] - cum[i];
    if span <= 1e-12 {
        return a;
    }
    let t = ((s - cum[i]) / span).clamp(0.0, 1.0);
    Point2::new(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
}

/// Adds the straight pieces that cover the stretch of the polyline from distance `s0` to `s1`, all
/// at one power. Every corner inside the stretch ends a piece, so a piece never turns a corner.
fn stretch(
    points: &[Point2],
    cum: &[f64],
    s0: f64,
    s1: f64,
    fraction: f64,
    out: &mut Vec<RampPiece>,
) {
    if s1 - s0 <= 1e-9 {
        return;
    }
    let mut here = point_along(points, cum, s0);
    for (i, &corner) in points.iter().enumerate().skip(1) {
        if cum[i] > s0 + 1e-9 && cum[i] < s1 - 1e-9 && here.distance_to(&corner) > 1e-9 {
            out.push((here, corner, fraction));
            here = corner;
        }
    }
    let end = point_along(points, cum, s1);
    if here.distance_to(&end) > 1e-9 {
        out.push((here, end, fraction));
    }
}

/// Splits a path into pieces whose power rises over the first `ramp_mm` and falls over the last
/// `ramp_mm`, in `RAMP_STEPS` equal steps each. The ramp is never longer than half the path.
///
/// * An **open** line starts at `RAMP_OPEN_FLOOR` of the power, rises to the full power and falls
///   back to that floor at the other end, so both ends are still marked.
/// * A **closed** shape starts from nothing, runs once round at full power and then carries on over
///   its first `ramp_mm` again while the power falls. The rise and the fall add up to exactly the
///   full power at every point of that stretch, so there is no weak spot where the loop closes and
///   no dark dot where the head starts and stops. It costs `ramp_mm` of extra travel.
///
/// The pieces follow one another without a gap, so the head never lifts. A path with fewer than two
/// distinct points, or no length, gives nothing; a ramp too short to make gives plain full power.
fn ramp_pieces(path: &Path2D, ramp_mm: f64) -> Vec<RampPiece> {
    let mut points: Vec<Point2> = Vec::with_capacity(path.points.len() + 1);
    for &p in &path.points {
        let keep = match points.last() {
            Some(q) => q.distance_to(&p) > 1e-9,
            None => true,
        };
        if keep {
            points.push(p);
        }
    }
    if path.closed {
        // A closed path may repeat its first point at the end. The closing edge is added exactly once.
        if points.len() > 1 && points[0].distance_to(&points[points.len() - 1]) <= 1e-9 {
            points.pop();
        }
        if let Some(&first) = points.first() {
            points.push(first);
        }
    }
    if points.len() < 2 {
        return Vec::new();
    }
    let mut cum = vec![0.0];
    for w in points.windows(2) {
        cum.push(cum[cum.len() - 1] + w[0].distance_to(&w[1]));
    }
    let total = cum[cum.len() - 1];
    if total <= 1e-9 {
        return Vec::new();
    }

    let mut out = Vec::new();
    // A ramp that is not a number counts as no ramp, rather than as half the path.
    let wanted = if ramp_mm.is_finite() { ramp_mm } else { 0.0 };
    let ramp = wanted.min(total / 2.0);
    if ramp < RAMP_MIN_MM {
        stretch(&points, &cum, 0.0, total, 1.0, &mut out);
        return out;
    }
    // Where step `i` of a ramp starts, measured from the start of the ramp.
    let step = |i: usize| ramp * i as f64 / RAMP_STEPS as f64;
    // The middle of step `i` as a fraction of the way up the ramp.
    let mid = |i: usize| (i as f64 + 0.5) / RAMP_STEPS as f64;

    if path.closed {
        for i in 0..RAMP_STEPS {
            stretch(&points, &cum, step(i), step(i + 1), mid(i), &mut out);
        }
        stretch(&points, &cum, ramp, total, 1.0, &mut out);
        // Round again over the start, with the power falling by what the rise gained.
        for i in 0..RAMP_STEPS {
            stretch(&points, &cum, step(i), step(i + 1), 1.0 - mid(i), &mut out);
        }
    } else {
        let span = 1.0 - RAMP_OPEN_FLOOR;
        for i in 0..RAMP_STEPS {
            let power = RAMP_OPEN_FLOOR + span * mid(i);
            stretch(&points, &cum, step(i), step(i + 1), power, &mut out);
        }
        stretch(&points, &cum, ramp, total - ramp, 1.0, &mut out);
        // Where step `i` of the way down starts, ending exactly at the end of the path.
        let tail = |i: usize| {
            if i == RAMP_STEPS {
                total
            } else {
                total - ramp + step(i)
            }
        };
        for i in 0..RAMP_STEPS {
            let power = RAMP_OPEN_FLOOR + span * (1.0 - mid(i));
            stretch(&points, &cum, tail(i), tail(i + 1), power, &mut out);
        }
    }
    out
}

/// The point reached by moving from "p" along the unit direction (dx, dy) by up to "max_mm",
/// stopping at the bed edge. Returns "p" itself when there is less than OVERSCAN_MIN_MM of room.
fn extend_within_bed(p: Point2, dx: f64, dy: f64, max_mm: f64, bed: &BoundingBox) -> Point2 {
    let mut reach = max_mm;
    if dx > 1e-12 {
        reach = reach.min((bed.max.x - p.x) / dx);
    } else if dx < -1e-12 {
        reach = reach.min((bed.min.x - p.x) / dx);
    }
    if dy > 1e-12 {
        reach = reach.min((bed.max.y - p.y) / dy);
    } else if dy < -1e-12 {
        reach = reach.min((bed.min.y - p.y) / dy);
    }
    if reach < OVERSCAN_MIN_MM {
        p
    } else {
        Point2::new(p.x + dx * reach, p.y + dy * reach)
    }
}

/// Splits raster runs (already in scan order) into scan lines: consecutive runs that share a row
/// (horizontal scan) or a column (vertical scan).
fn group_scan_lines(runs: &[(Point2, Point2)], horizontal: bool) -> Vec<Vec<(Point2, Point2)>> {
    let mut lines: Vec<Vec<(Point2, Point2)>> = Vec::new();
    let mut line_pos = f64::NAN;
    for &(a, z) in runs {
        let pos = if horizontal { a.y } else { a.x };
        let same_line = !lines.is_empty() && (pos - line_pos).abs() < 1e-9;
        if same_line {
            if let Some(line) = lines.last_mut() {
                line.push((a, z));
            }
        } else {
            lines.push(vec![(a, z)]);
            line_pos = pos;
        }
    }
    lines
}

fn world_paths(obj: &WorkspaceObject) -> Vec<Path2D> {
    match &obj.kind {
        ObjectKind::Vector(v) => v
            .paths
            .iter()
            .map(|p| p.transformed(&obj.transform))
            .filter(|p| p.points.len() >= 2 && p.points.iter().all(|q| q.is_finite()))
            .collect(),
        ObjectKind::Image(_) => Vec::new(),
    }
}

/// Generates the toolpath for planned operations. `image_bytes` maps an image
/// **asset id** to its encoded (PNG/JPG/BMP) bytes.
pub fn generate_toolpath(
    project: &ProjectFile,
    operations: &[LaserOperation],
    image_bytes: &HashMap<Uuid, Vec<u8>>,
) -> Result<ToolpathResult> {
    let objects: HashMap<Uuid, &WorkspaceObject> =
        project.objects.iter().map(|o| (o.id, o)).collect();
    let home = project.machine.machine_to_workspace(Point2::ZERO);
    let bed = project.machine.bed_bounds();
    let mut b = Builder {
        toolpath: Toolpath::default(),
        cursor: home,
        rapid: RAPID_FEED_MM_MIN.min(project.machine.max_feed_rate_mm_min),
    };
    let mut warnings: Vec<String> = Vec::new();

    for op in operations {
        let layer = project
            .find_layer(op.layer_id())
            .ok_or_else(|| ProjectError::LayerNotFound(op.layer_id().to_string()))?;
        let passes = layer.passes.max(1);

        match op {
            LaserOperation::Cut {
                object_ids, params, ..
            } => {
                let paths = collect_paths(&objects, object_ids);
                let mut final_paths: Vec<Path2D> = Vec::new();
                for (path, depth) in order_paths(paths, params.cut_order, b.cursor) {
                    if params.kerf_mm > 0.0 && path.closed {
                        let side = if depth % 2 == 1 {
                            KerfSide::Inward
                        } else {
                            KerfSide::Outward
                        };
                        let compensated = kerf_compensate(&path, params.kerf_mm, side)?;
                        if compensated.is_empty() {
                            warnings.push(
                                "A feature smaller than the kerf vanished after kerf compensation and will not be cut."
                                    .to_string(),
                            );
                        }
                        final_paths.extend(compensated);
                    } else {
                        final_paths.push(path);
                    }
                }
                for _ in 0..passes {
                    for p in &final_paths {
                        b.path(p, MoveKind::Cut, layer);
                    }
                }
            }
            LaserOperation::Score {
                object_ids, params, ..
            } => {
                let paths = collect_paths(&objects, object_ids);
                let ordered: Vec<Path2D> = order_paths(paths, params.cut_order, b.cursor)
                    .into_iter()
                    .map(|(p, _)| p)
                    .collect();
                for _ in 0..passes {
                    for p in &ordered {
                        if layer.ramp_mm > 0.0 {
                            b.ramped_path(p, MoveKind::Score, layer);
                        } else {
                            b.path(p, MoveKind::Score, layer);
                        }
                    }
                }
            }
            LaserOperation::Fill {
                object_ids, params, ..
            } => {
                for id in object_ids {
                    let Some(obj) = objects.get(id) else { continue };
                    let closed: Vec<Path2D> = world_paths(obj)
                        .into_iter()
                        .filter(|p| p.closed && p.points.len() >= 3)
                        .collect();
                    if closed.is_empty() {
                        warnings.push(format!("'{}' has no closed shapes to fill.", obj.name));
                        continue;
                    }
                    let mut angles = vec![params.angle_deg];
                    if params.pattern == FillPattern::CrossHatch {
                        angles.push(params.angle_deg + 90.0);
                    }
                    let spacing = params.line_spacing_mm.max(0.01);
                    let mut rows: Vec<Vec<(Point2, Point2)>> = Vec::new();
                    for angle in angles {
                        match scanline_fill(&closed, angle, spacing) {
                            Some(r) => rows.extend(r),
                            None => warnings.push(format!(
                                "Fill of '{}' needs too many lines; increase the line spacing.",
                                obj.name
                            )),
                        }
                    }
                    for _ in 0..passes {
                        if layer.overscan_mm > 0.0 {
                            b.scan_lines(&rows, MoveKind::Fill, layer, &bed);
                        } else {
                            for row in &rows {
                                for (a, z) in row {
                                    b.draw(*a, *z, MoveKind::Fill, layer);
                                }
                            }
                        }
                        // The outline pass: after the fill, the edge of every closed shape is traced
                        // once (holes first), so the edge is crisp whatever the fill lines did.
                        if layer.fill_outline {
                            let ordered = order_paths(
                                closed.clone(),
                                CutOrderStrategy::InsideFirst,
                                b.cursor,
                            );
                            for (outline, _) in ordered {
                                b.path(&outline, MoveKind::Fill, layer);
                            }
                        }
                    }
                }
            }
            LaserOperation::Raster {
                object_ids, params, ..
            } => {
                for id in object_ids {
                    let Some(obj) = objects.get(id) else { continue };
                    let ObjectKind::Image(image) = &obj.kind else {
                        continue;
                    };
                    let Some(bytes) = image_bytes.get(&image.asset_id) else {
                        warnings.push(format!(
                            "Image data for '{}' is missing; it was skipped.",
                            obj.name
                        ));
                        continue;
                    };
                    match raster_runs(obj, image, bytes, params) {
                        Ok(runs) => {
                            let lines = if layer.overscan_mm > 0.0 {
                                let horizontal = params.direction == ScanDirection::Horizontal;
                                group_scan_lines(&runs, horizontal)
                            } else {
                                Vec::new()
                            };
                            for _ in 0..passes {
                                if layer.overscan_mm > 0.0 {
                                    b.scan_lines(&lines, MoveKind::Engrave, layer, &bed);
                                } else {
                                    for (a, z) in &runs {
                                        b.draw(*a, *z, MoveKind::Engrave, layer);
                                    }
                                }
                            }
                        }
                        Err(e) => warnings.push(format!("Could not engrave '{}': {e}", obj.name)),
                    }
                }
            }
        }

        if b.toolpath.segments.len() > MAX_SEGMENTS {
            return Err(ProjectError::TooLarge(format!(
                "The job needs more than {MAX_SEGMENTS} moves. Lower the raster DPI, raise the fill spacing or split the job."
            )));
        }
    }

    let stats = b.toolpath.stats();
    Ok(ToolpathResult {
        toolpath: b.toolpath,
        stats,
        warnings,
    })
}

fn collect_paths(objects: &HashMap<Uuid, &WorkspaceObject>, ids: &[Uuid]) -> Vec<Path2D> {
    let mut paths = Vec::new();
    for id in ids {
        if let Some(obj) = objects.get(id) {
            paths.extend(world_paths(obj));
        }
    }
    paths
}

// ---------------------------------------------------------------------------------------
// Nesting and ordering
// ---------------------------------------------------------------------------------------

fn point_in_polygon(p: Point2, polygon: &Path2D) -> bool {
    let pts = &polygon.points;
    let n = pts.len();
    if n < 3 {
        return false;
    }
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (pi, pj) = (pts[i], pts[j]);
        if (pi.y > p.y) != (pj.y > p.y) && p.x < (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y) + pi.x
        {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Containment depth of every path: 0 = outer boundary, 1 = a hole in it, 2 = an island in
/// that hole, and so on. A path is "inside" another when its bounding box fits within the
/// other's and its first vertex lies inside the other polygon.
fn nesting_depths(paths: &[Path2D]) -> Vec<u32> {
    let boxes: Vec<Option<BoundingBox>> = paths.iter().map(|p| p.bounding_box()).collect();
    (0..paths.len())
        .map(|i| {
            let Some(bi) = boxes[i] else { return 0 };
            let probe = paths[i].points[0];
            (0..paths.len())
                .filter(|&j| {
                    j != i
                        && paths[j].closed
                        && paths[j].points.len() >= 3
                        && boxes[j].map_or(false, |bj| bj.contains_box(&bi))
                        && point_in_polygon(probe, &paths[j])
                })
                .count() as u32
        })
        .collect()
}

fn nearest_neighbor(items: Vec<(Path2D, u32)>, start: Point2) -> Vec<(Path2D, u32)> {
    let mut remaining = items;
    let mut out = Vec::with_capacity(remaining.len());
    let mut cursor = start;

    while !remaining.is_empty() {
        let mut best = 0usize;
        let mut best_dist = f64::INFINITY;
        let mut best_vertex = 0usize;
        let mut best_reverse = false;
        for (i, (path, _)) in remaining.iter().enumerate() {
            if path.points.is_empty() {
                continue;
            }
            if path.closed {
                for (vi, p) in path.points.iter().enumerate() {
                    let d = cursor.distance_to(p);
                    if d < best_dist {
                        (best_dist, best, best_vertex, best_reverse) = (d, i, vi, false);
                    }
                }
            } else {
                let d_start = cursor.distance_to(&path.points[0]);
                let d_end = cursor.distance_to(&path.points[path.points.len() - 1]);
                if d_start < best_dist {
                    (best_dist, best, best_vertex, best_reverse) = (d_start, i, 0, false);
                }
                if d_end < best_dist {
                    (best_dist, best, best_vertex, best_reverse) = (d_end, i, 0, true);
                }
            }
        }
        let (mut path, depth) = remaining.swap_remove(best);
        if path.points.is_empty() {
            out.push((path, depth));
            continue;
        }
        if path.closed {
            path.points.rotate_left(best_vertex);
        } else if best_reverse {
            path.points.reverse();
        }
        cursor = if path.closed {
            path.points[0]
        } else {
            path.points[path.points.len() - 1]
        };
        out.push((path, depth));
    }
    out
}

/// Orders paths for cutting, returning each path with its nesting depth.
fn order_paths(
    paths: Vec<Path2D>,
    strategy: CutOrderStrategy,
    start: Point2,
) -> Vec<(Path2D, u32)> {
    let depths = nesting_depths(&paths);
    let items: Vec<(Path2D, u32)> = paths.into_iter().zip(depths).collect();
    match strategy {
        CutOrderStrategy::AsDrawn => items,
        CutOrderStrategy::InsideFirst | CutOrderStrategy::OutsideLast => {
            let mut groups: BTreeMap<u32, Vec<(Path2D, u32)>> = BTreeMap::new();
            for item in items {
                groups.entry(item.1).or_default().push(item);
            }
            let mut out = Vec::new();
            let mut cursor = start;
            // BTreeMap iterates ascending; reverse so the deepest group is cut first.
            for (_, group) in groups.into_iter().rev() {
                let ordered = nearest_neighbor(group, cursor);
                if let Some((last, _)) = ordered.last() {
                    let end = if last.closed {
                        last.points.first()
                    } else {
                        last.points.last()
                    };
                    if let Some(end) = end {
                        cursor = *end;
                    }
                }
                out.extend(ordered);
            }
            out
        }
    }
}

// ---------------------------------------------------------------------------------------
// Vector fill
// ---------------------------------------------------------------------------------------

/// Even-odd scanline fill. Returns one row of segments per scan line; odd rows are reversed
/// so consecutive lines are traversed in alternating directions (serpentine). `None` when
/// the shape would need more than `MAX_FILL_LINES` lines or has no extent.
fn scanline_fill(
    paths: &[Path2D],
    angle_deg: f64,
    spacing: f64,
) -> Option<Vec<Vec<(Point2, Point2)>>> {
    let to_rotated = Transform2D::rotate_deg(-angle_deg);
    let from_rotated = Transform2D::rotate_deg(angle_deg);
    let rotated: Vec<Path2D> = paths.iter().map(|p| p.transformed(&to_rotated)).collect();
    let bbox = rotated
        .iter()
        .filter_map(|p| p.bounding_box())
        .reduce(|a, b| a.union(&b))?;
    if ((bbox.height() / spacing).ceil() as usize) + 1 > MAX_FILL_LINES {
        return None;
    }

    let mut rows = Vec::new();
    let mut y = bbox.min.y + spacing / 2.0;
    let mut index = 0usize;
    while y <= bbox.max.y {
        let mut xs: Vec<f64> = Vec::new();
        for path in &rotated {
            let pts = &path.points;
            let n = pts.len();
            if n < 2 {
                continue;
            }
            for i in 0..n {
                let (a, b) = (pts[i], pts[(i + 1) % n]);
                if (a.y <= y && b.y > y) || (b.y <= y && a.y > y) {
                    let t = (y - a.y) / (b.y - a.y);
                    xs.push(a.x + t * (b.x - a.x));
                }
            }
        }
        xs.sort_by(|a, b| a.total_cmp(b));
        let mut row: Vec<(Point2, Point2)> = Vec::new();
        let mut i = 0;
        while i + 1 < xs.len() {
            row.push((
                from_rotated.apply(Point2::new(xs[i], y)),
                from_rotated.apply(Point2::new(xs[i + 1], y)),
            ));
            i += 2;
        }
        if index % 2 == 1 {
            row.reverse();
            for seg in row.iter_mut() {
                std::mem::swap(&mut seg.0, &mut seg.1);
            }
        }
        if !row.is_empty() {
            rows.push(row);
        }
        y += spacing;
        index += 1;
    }
    Some(rows)
}

// ---------------------------------------------------------------------------------------
// Raster engraving
// ---------------------------------------------------------------------------------------

fn to_raster_dither(d: CommonDither) -> makerlaser_raster::DitherAlgorithm {
    match d {
        CommonDither::None => makerlaser_raster::DitherAlgorithm::None,
        CommonDither::FloydSteinberg => makerlaser_raster::DitherAlgorithm::FloydSteinberg,
        CommonDither::Jarvis => makerlaser_raster::DitherAlgorithm::Jarvis,
        CommonDither::Stucki => makerlaser_raster::DitherAlgorithm::Stucki,
        CommonDither::Atkinson => makerlaser_raster::DitherAlgorithm::Atkinson,
    }
}

/// Runs of pixels to burn, as `(start, end)` workspace points in scan order.
fn raster_runs(
    obj: &WorkspaceObject,
    image: &ImageData,
    bytes: &[u8],
    params: &RasterOperation,
) -> Result<Vec<(Point2, Point2)>> {
    let err = |m: &str| ProjectError::Raster(m.to_string());
    let bbox = obj
        .world_bounding_box()
        .ok_or_else(|| err("the image has no extent"))?;
    let (w_mm, h_mm) = (bbox.width(), bbox.height());
    if !(w_mm > 0.0 && h_mm > 0.0) {
        return Err(err("the image has no area"));
    }
    let dpi = params.dpi.max(1) as f64;
    let cols64 = ((w_mm / 25.4 * dpi).round() as u64).max(1);
    let rows64 = ((h_mm / 25.4 * dpi).round() as u64).max(1);
    if cols64 * rows64 > MAX_RASTER_PIXELS {
        return Err(ProjectError::Raster(format!(
            "{cols64} x {rows64} pixels is too large; lower the DPI or the image size"
        )));
    }
    let (cols, rows) = (cols64 as u32, rows64 as u32);

    let inverse = obj
        .transform
        .inverse()
        .ok_or_else(|| err("the image transform is degenerate"))?;
    let source = makerlaser_raster::load_grayscale(bytes)
        .map_err(|e| ProjectError::Raster(format!("cannot decode the image: {e}")))?;
    let (nat_w, nat_h) = image.natural_size_mm();
    let scale_x = obj.transform.a.hypot(obj.transform.b);
    let scale_y = obj.transform.c.hypot(obj.transform.d);

    // Pre-shrink large sources to roughly the output resolution; sampling a 4000 px photo
    // down to 300 px with bilinear alone would alias badly.
    let per_out_x = (source.width() as f64 / (nat_w * scale_x)) / (dpi / 25.4);
    let per_out_y = (source.height() as f64 / (nat_h * scale_y)) / (dpi / 25.4);
    let source = if per_out_x > 1.5 || per_out_y > 1.5 {
        let nw = (source.width() as f64 / per_out_x.max(1.0))
            .round()
            .max(1.0) as u32;
        let nh = (source.height() as f64 / per_out_y.max(1.0))
            .round()
            .max(1.0) as u32;
        makerlaser_raster::resize_grayscale(&source, nw, nh)
    } else {
        source
    };
    let (sw, sh) = (source.width() as f64, source.height() as f64);
    let (dx, dy) = (w_mm / cols as f64, h_mm / rows as f64);

    let resampled = makerlaser_raster::resample(&source, cols, rows, |c, r| {
        let world = Point2::new(
            bbox.min.x + (c as f64 + 0.5) * dx,
            bbox.min.y + (r as f64 + 0.5) * dy,
        );
        let local = inverse.apply(world);
        (local.x / nat_w * sw, local.y / nat_h * sh)
    });
    let adjusted = makerlaser_raster::Adjustments {
        brightness: params.brightness,
        contrast: params.contrast,
        gamma: params.gamma,
        invert: params.invert,
    }
    .apply(&resampled.image);
    let adjusted = makerlaser_raster::sharpen(&adjusted, params.sharpen);
    let dithered =
        makerlaser_raster::dither(&adjusted, to_raster_dither(params.dither), params.threshold);

    let horizontal = params.direction == ScanDirection::Horizontal;
    let (n_primary, n_secondary) = if horizontal {
        (rows, cols)
    } else {
        (cols, rows)
    };
    let mut out: Vec<(Point2, Point2)> = Vec::new();

    for p in 0..n_primary {
        let reverse = params.bidirectional && p % 2 == 1;
        let mut runs: Vec<(u32, u32)> = Vec::new();
        let mut current: Option<(u32, u32)> = None;
        for s in 0..n_secondary {
            let (c, r) = if horizontal { (s, p) } else { (p, s) };
            let idx = r as usize * cols as usize + c as usize;
            let burn = dithered.get_pixel(c, r).0[0] == 0 && resampled.inside[idx];
            current = match (burn, current) {
                (true, Some((first, _))) => Some((first, s)),
                (true, None) => Some((s, s)),
                (false, Some(run)) => {
                    runs.push(run);
                    None
                }
                (false, None) => None,
            };
        }
        if let Some(run) = current {
            runs.push(run);
        }
        if reverse {
            runs.reverse();
        }
        for (first, last) in runs {
            let (a, z) = if horizontal {
                let y = bbox.min.y + (p as f64 + 0.5) * dy;
                (
                    Point2::new(bbox.min.x + first as f64 * dx, y),
                    Point2::new(bbox.min.x + (last as f64 + 1.0) * dx, y),
                )
            } else {
                let x = bbox.min.x + (p as f64 + 0.5) * dx;
                (
                    Point2::new(x, bbox.min.y + first as f64 * dy),
                    Point2::new(x, bbox.min.y + (last as f64 + 1.0) * dy),
                )
            };
            out.push(if reverse { (z, a) } else { (a, z) });
        }
        if out.len() > MAX_SEGMENTS {
            return Err(ProjectError::TooLarge(
                "The raster needs too many moves; lower the DPI.".to_string(),
            ));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cam::plan_operations;
    use makerlaser_common::{ImageFormat, LayerKind, MachineProfile};

    fn square(x: f64, y: f64, s: f64) -> Path2D {
        Path2D::new(
            vec![
                Point2::new(x, y),
                Point2::new(x + s, y),
                Point2::new(x + s, y + s),
                Point2::new(x, y + s),
            ],
            true,
        )
    }

    fn project_with(kind: LayerKind, paths: Vec<Path2D>) -> ProjectFile {
        let mut p = ProjectFile::new("T", MachineProfile::tts55_pro());
        let layer = p.layers.iter().find(|l| l.kind == kind).unwrap().id;
        let mut o = WorkspaceObject::new_vector("o", paths, 0);
        o.layer_id = Some(layer);
        p.objects.push(o);
        p
    }

    fn generate(p: &ProjectFile) -> ToolpathResult {
        let plan = plan_operations(p);
        generate_toolpath(p, &plan.operations, &HashMap::new()).unwrap()
    }

    fn cut_segments(r: &ToolpathResult) -> Vec<&ToolpathSegment> {
        r.toolpath
            .segments
            .iter()
            .filter(|s| s.kind == MoveKind::Cut)
            .collect()
    }

    // ---- nesting ---------------------------------------------------------------------

    #[test]
    fn containment_depth_of_nested_squares() {
        let depths = nesting_depths(&[
            square(0.0, 0.0, 100.0),
            square(10.0, 10.0, 50.0),
            square(20.0, 20.0, 10.0),
            square(200.0, 0.0, 5.0),
        ]);
        assert_eq!(depths, vec![0, 1, 2, 0]);
    }

    #[test]
    fn inside_first_cuts_the_hole_before_the_outer_boundary() {
        // The outer path starts nearest the origin: a naive nearest-neighbour pass would
        // cut it first. Nesting priority must win.
        let p = project_with(
            LayerKind::Cut,
            vec![square(0.0, 0.0, 100.0), square(40.0, 40.0, 10.0)],
        );
        let r = generate(&p);
        let first_cut = cut_segments(&r)[0];
        let inside_hole = |q: Point2| q.x >= 40.0 && q.x <= 50.0 && q.y >= 40.0 && q.y <= 50.0;
        assert!(
            inside_hole(first_cut.from) && inside_hole(first_cut.to),
            "{first_cut:?}"
        );
    }

    #[test]
    fn equal_depth_paths_are_still_travel_optimised() {
        // The head starts at the machine origin, which is workspace (0, 300) for a
        // bottom-left-origin machine. The square near that corner must be cut first even
        // though it is listed second.
        let p = project_with(
            LayerKind::Cut,
            vec![square(250.0, 10.0, 5.0), square(2.0, 280.0, 5.0)],
        );
        let r = generate(&p);
        let first = cut_segments(&r)[0];
        assert!(first.from.x < 10.0 && first.from.y > 270.0, "{first:?}");
    }

    #[test]
    fn as_drawn_keeps_the_original_order() {
        let order = order_paths(
            vec![square(250.0, 250.0, 5.0), square(2.0, 2.0, 5.0)],
            CutOrderStrategy::AsDrawn,
            Point2::ZERO,
        );
        assert_eq!(order[0].0.points[0], Point2::new(250.0, 250.0));
    }

    #[test]
    fn closed_paths_start_at_their_nearest_vertex() {
        let out = nearest_neighbor(vec![(square(0.0, 0.0, 10.0), 0)], Point2::new(11.0, 11.0));
        assert_eq!(out[0].0.points[0], Point2::new(10.0, 10.0));
        assert_eq!(out[0].0.points.len(), 4);
    }

    #[test]
    fn open_paths_are_reversed_when_their_far_end_is_nearer() {
        let open = Path2D::new(vec![Point2::new(0.0, 0.0), Point2::new(100.0, 0.0)], false);
        let out = nearest_neighbor(vec![(open, 0)], Point2::new(99.0, 1.0));
        assert_eq!(out[0].0.points[0], Point2::new(100.0, 0.0));
    }

    // ---- cutting ---------------------------------------------------------------------

    #[test]
    fn a_square_is_cut_as_four_segments_after_one_travel() {
        let p = project_with(LayerKind::Cut, vec![square(10.0, 10.0, 20.0)]);
        let r = generate(&p);
        assert_eq!(cut_segments(&r).len(), 4);
        assert_eq!(r.toolpath.segments[0].kind, MoveKind::Travel);
        assert!((r.stats.cut_mm - 80.0).abs() < 1e-6);
    }

    #[test]
    fn passes_repeat_the_whole_operation_not_each_path() {
        let mut p = project_with(
            LayerKind::Cut,
            vec![square(10.0, 10.0, 10.0), square(50.0, 10.0, 10.0)],
        );
        p.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Cut)
            .unwrap()
            .passes = 2;
        let r = generate(&p);
        let cuts = cut_segments(&r);
        assert_eq!(cuts.len(), 16);
        // First pass visits both squares before the second pass starts: segment 4 (the
        // first of the second square) must lie in the other square.
        let in_square = |s: &ToolpathSegment, x0: f64| s.from.x >= x0 && s.from.x <= x0 + 10.0;
        assert!(in_square(cuts[0], 10.0) != in_square(cuts[4], 10.0));
    }

    #[test]
    fn kerf_grows_the_outer_boundary_and_shrinks_the_hole() {
        let mut p = project_with(
            LayerKind::Cut,
            vec![square(0.0, 0.0, 100.0), square(40.0, 40.0, 20.0)],
        );
        p.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Cut)
            .unwrap()
            .kerf_mm = 1.0;
        let r = generate(&p);
        let segs = cut_segments(&r);
        let xs: Vec<f64> = segs.iter().flat_map(|s| [s.from.x, s.to.x]).collect();
        let (min, max) = xs
            .iter()
            .fold((f64::MAX, f64::MIN), |(a, b), v| (a.min(*v), b.max(*v)));
        // Outer boundary grew by 0.5 mm each side; the hole shrank by 0.5 mm each side.
        assert!(min < -0.4 && max > 100.4, "min {min} max {max}");
        let hole_xs: Vec<f64> = xs
            .iter()
            .copied()
            .filter(|x| *x > 30.0 && *x < 70.0)
            .collect();
        let (hmin, hmax) = hole_xs
            .iter()
            .fold((f64::MAX, f64::MIN), |(a, b), v| (a.min(*v), b.max(*v)));
        assert!(hmin > 40.4 && hmax < 59.6, "hole x range {hmin}..{hmax}");
    }

    #[test]
    fn a_hole_smaller_than_the_kerf_produces_a_warning_not_a_failure() {
        let mut p = project_with(
            LayerKind::Cut,
            vec![square(0.0, 0.0, 100.0), square(50.0, 50.0, 0.2)],
        );
        p.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Cut)
            .unwrap()
            .kerf_mm = 1.0;
        let r = generate(&p);
        assert!(r.warnings.iter().any(|w| w.contains("kerf")));
    }

    #[test]
    fn score_layers_emit_score_moves_in_the_layer_s_power() {
        let p = project_with(LayerKind::Score, vec![square(10.0, 10.0, 10.0)]);
        let r = generate(&p);
        let scores: Vec<_> = r
            .toolpath
            .segments
            .iter()
            .filter(|s| s.kind == MoveKind::Score)
            .collect();
        assert_eq!(scores.len(), 4);
        assert_eq!(scores[0].power_percent, 15.0);
    }

    // ---- fill ------------------------------------------------------------------------

    #[test]
    fn fill_lines_stay_inside_the_shape_and_alternate_direction() {
        let rows = scanline_fill(&[square(0.0, 0.0, 10.0)], 0.0, 1.0).unwrap();
        assert_eq!(rows.len(), 10);
        for row in &rows {
            for (a, z) in row {
                assert!(a.x >= -1e-9 && a.x <= 10.0 + 1e-9 && z.x >= -1e-9 && z.x <= 10.0 + 1e-9);
            }
        }
        assert!(rows[0][0].0.x < rows[0][0].1.x, "row 0 runs left to right");
        assert!(rows[1][0].0.x > rows[1][0].1.x, "row 1 runs right to left");
    }

    #[test]
    fn fill_respects_holes_by_the_even_odd_rule() {
        let rows =
            scanline_fill(&[square(0.0, 0.0, 10.0), square(4.0, 4.0, 2.0)], 0.0, 1.0).unwrap();
        // The scan line at y = 5.5 crosses the hole: two segments, not one.
        let crossing = rows.iter().find(|r| (r[0].0.y - 5.5).abs() < 1e-9).unwrap();
        assert_eq!(crossing.len(), 2);
    }

    #[test]
    fn rotated_fill_keeps_every_point_inside_the_shape() {
        let shape = square(0.0, 0.0, 10.0);
        for (a, z) in scanline_fill(std::slice::from_ref(&shape), 45.0, 1.0)
            .unwrap()
            .into_iter()
            .flatten()
        {
            for q in [a, z] {
                assert!(q.x >= -1e-6 && q.x <= 10.0 + 1e-6 && q.y >= -1e-6 && q.y <= 10.0 + 1e-6);
            }
        }
    }

    #[test]
    fn absurdly_dense_fills_are_refused() {
        assert!(scanline_fill(&[square(0.0, 0.0, 300.0)], 0.0, 0.0001).is_none());
    }

    #[test]
    fn a_fill_layer_produces_fill_moves_and_cross_hatch_doubles_them() {
        let mut p = project_with(LayerKind::Fill, vec![square(10.0, 10.0, 10.0)]);
        p.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Fill)
            .unwrap()
            .line_spacing_mm = 1.0;
        let single = generate(&p)
            .toolpath
            .segments
            .iter()
            .filter(|s| s.kind == MoveKind::Fill)
            .count();
        p.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Fill)
            .unwrap()
            .cross_hatch = true;
        let double = generate(&p)
            .toolpath
            .segments
            .iter()
            .filter(|s| s.kind == MoveKind::Fill)
            .count();
        assert_eq!(single, 10);
        assert_eq!(double, 20);
    }

    // ---- raster ----------------------------------------------------------------------

    /// 4 x 2 px image at 254 dpi (0.4 x 0.2 mm), engraved at 254 dpi: one output pixel per
    /// source pixel, 0.1 mm each.
    fn raster_project(
        rows: [[u8; 4]; 2],
        bidirectional: bool,
    ) -> (ProjectFile, HashMap<Uuid, Vec<u8>>) {
        let mut p = ProjectFile::new("T", MachineProfile::tts55_pro());
        let asset = Uuid::new_v4();
        let img = ImageData {
            asset_id: asset,
            format: ImageFormat::Png,
            source_path: None,
            width_px: 4,
            height_px: 2,
            dpi: 254.0,
        };
        let mut o = WorkspaceObject::new_image("img", img, 0);
        let layer = p
            .layers
            .iter()
            .find(|l| l.kind == LayerKind::Image)
            .unwrap();
        o.layer_id = Some(layer.id);
        p.objects.push(o);
        let layer = p
            .layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Image)
            .unwrap();
        layer.raster.dpi = 254;
        layer.raster.dither = makerlaser_common::DitherAlgorithm::None;
        layer.raster.bidirectional = bidirectional;

        let gray =
            image::GrayImage::from_fn(4, 2, |x, y| image::Luma([rows[y as usize][x as usize]]));
        let mut bytes = HashMap::new();
        bytes.insert(asset, makerlaser_raster::encode_png(&gray).unwrap());
        (p, bytes)
    }

    /// Where each burned run of an image ends (x, to a tenth of a mm), with the dither off.
    fn burn_ends(rows: [[u8; 4]; 2], threshold: u8, sharpen: f64) -> Vec<f64> {
        let (mut p, bytes) = raster_project(rows, false);
        let layer = p
            .layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Image)
            .unwrap();
        layer.raster.threshold = threshold;
        layer.raster.sharpen = sharpen;
        engrave(&p, &bytes)
            .iter()
            .map(|s| (s.to.x * 10.0).round() / 10.0)
            .collect()
    }

    fn engrave(p: &ProjectFile, bytes: &HashMap<Uuid, Vec<u8>>) -> Vec<ToolpathSegment> {
        let plan = plan_operations(p);
        generate_toolpath(p, &plan.operations, bytes)
            .unwrap()
            .toolpath
            .segments
            .into_iter()
            .filter(|s| s.kind == MoveKind::Engrave)
            .collect()
    }

    #[test]
    fn raster_runs_cover_exactly_the_black_pixels() {
        // Row 0: black black white black; row 1: all white.
        let (p, bytes) = raster_project([[0, 0, 255, 0], [255; 4]], false);
        let segs = engrave(&p, &bytes);
        assert_eq!(segs.len(), 2, "{segs:?}");
        let near = |a: f64, b: f64| (a - b).abs() < 1e-6;
        assert!(
            near(segs[0].from.x, 0.0) && near(segs[0].to.x, 0.2),
            "{:?}",
            segs[0]
        );
        assert!(
            near(segs[1].from.x, 0.3) && near(segs[1].to.x, 0.4),
            "{:?}",
            segs[1]
        );
        assert!(near(segs[0].from.y, 0.05), "row centre y");
    }

    #[test]
    fn bidirectional_scanning_reverses_every_second_row() {
        let (p, bytes) = raster_project([[0, 0, 0, 0], [0, 0, 0, 0]], true);
        let segs = engrave(&p, &bytes);
        assert_eq!(segs.len(), 2);
        assert!(segs[0].from.x < segs[0].to.x, "row 0 left to right");
        assert!(segs[1].from.x > segs[1].to.x, "row 1 right to left");
        let (p, bytes) = raster_project([[0, 0, 0, 0], [0, 0, 0, 0]], false);
        let segs = engrave(&p, &bytes);
        assert!(
            segs[1].from.x < segs[1].to.x,
            "unidirectional keeps one direction"
        );
    }

    #[test]
    fn a_rotated_image_is_engraved_through_its_transform() {
        // Mirror the image horizontally via a negative X scale: the burn must appear on
        // the opposite side of the object's bounding box.
        let (mut p, bytes) = raster_project([[0, 255, 255, 255], [255; 4]], false);
        let mut t = Transform2D::scale(-1.0, 1.0);
        t.e = 0.4;
        p.objects[0].transform = t;
        let segs = engrave(&p, &bytes);
        assert_eq!(segs.len(), 1);
        assert!(
            segs[0].from.x.min(segs[0].to.x) > 0.29,
            "burn moved to the right edge: {:?}",
            segs[0]
        );
    }

    #[test]
    fn the_threshold_decides_which_grey_pixels_burn() {
        // Row 0 is 0, 60, 130, 255. With no dither a pixel burns when it is darker than the threshold.
        let rows = [[0, 60, 130, 255], [255; 4]];
        assert_eq!(burn_ends(rows, 128, 0.0), vec![0.2]);
        assert_eq!(burn_ends(rows, 50, 0.0), vec![0.1]);
        assert_eq!(burn_ends(rows, 200, 0.0), vec![0.3]);
        assert!(burn_ends(rows, 0, 0.0).is_empty());
    }

    #[test]
    fn sharpening_is_applied_before_the_threshold() {
        // The 125 pixel is lighter than the threshold (120) but darker than what is around it, so
        // sharpening pushes it below the threshold and it burns.
        let rows = [[100, 125, 200, 200]; 2];
        assert_eq!(burn_ends(rows, 120, 0.0), vec![0.1, 0.1]);
        assert_eq!(burn_ends(rows, 120, 100.0), vec![0.2, 0.2]);
    }

    #[test]
    fn missing_image_data_is_a_warning_not_a_crash() {
        let (p, _) = raster_project([[0; 4], [0; 4]], false);
        let plan = plan_operations(&p);
        let r = generate_toolpath(&p, &plan.operations, &HashMap::new()).unwrap();
        assert!(r.toolpath.segments.is_empty());
        assert!(r.warnings.iter().any(|w| w.contains("missing")));
    }

    #[test]
    fn engraving_precedes_cutting_in_the_toolpath() {
        let (mut p, bytes) = raster_project([[0; 4], [0; 4]], false);
        let cut = p
            .layers
            .iter()
            .find(|l| l.kind == LayerKind::Cut)
            .unwrap()
            .id;
        let mut o = WorkspaceObject::new_vector("sq", vec![square(10.0, 10.0, 5.0)], 1);
        o.layer_id = Some(cut);
        p.objects.push(o);
        let plan = plan_operations(&p);
        let r = generate_toolpath(&p, &plan.operations, &bytes).unwrap();
        let first_engrave = r
            .toolpath
            .segments
            .iter()
            .position(|s| s.kind == MoveKind::Engrave)
            .unwrap();
        let first_cut = r
            .toolpath
            .segments
            .iter()
            .position(|s| s.kind == MoveKind::Cut)
            .unwrap();
        assert!(first_engrave < first_cut);
    }

    // ---- general ---------------------------------------------------------------------

    // ---- overscan --------------------------------------------------------------------

    fn fill_project(paths: Vec<Path2D>, spacing: f64, overscan_mm: f64) -> ProjectFile {
        let mut p = project_with(LayerKind::Fill, paths);
        let layer = p
            .layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Fill)
            .unwrap();
        layer.line_spacing_mm = spacing;
        layer.overscan_mm = overscan_mm;
        p
    }

    fn burns(r: &ToolpathResult) -> Vec<(Point2, Point2)> {
        r.toolpath
            .segments
            .iter()
            .filter(|s| s.kind == MoveKind::Fill)
            .map(|s| (s.from, s.to))
            .collect()
    }

    fn dark_moves(r: &ToolpathResult) -> Vec<&ToolpathSegment> {
        r.toolpath.segments.iter().filter(|s| s.overscan).collect()
    }

    fn rapid_moves(r: &ToolpathResult) -> usize {
        r.toolpath
            .segments
            .iter()
            .filter(|s| s.kind == MoveKind::Travel && !s.overscan)
            .count()
    }

    #[test]
    fn overscan_is_off_unless_a_fill_or_image_layer_asks_for_it() {
        let plain = generate(&fill_project(vec![square(50.0, 50.0, 10.0)], 1.0, 0.0));
        assert!(dark_moves(&plain).is_empty());
        // Cut layers have no overscan, even if the value is set.
        let mut cut = project_with(LayerKind::Cut, vec![square(50.0, 50.0, 10.0)]);
        cut.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Cut)
            .unwrap()
            .overscan_mm = 5.0;
        assert!(dark_moves(&generate(&cut)).is_empty());
    }

    #[test]
    fn overscan_adds_laser_off_run_up_and_run_out_without_changing_the_burn() {
        let plain = generate(&fill_project(vec![square(50.0, 50.0, 10.0)], 1.0, 0.0));
        let with = generate(&fill_project(vec![square(50.0, 50.0, 10.0)], 1.0, 3.0));
        assert_eq!(burns(&with), burns(&plain));
        let segs = &with.toolpath.segments;
        let first_burn = segs.iter().position(|s| s.kind == MoveKind::Fill).unwrap();
        let near = |a: f64, b: f64| (a - b).abs() < 1e-6;
        // Run-up: 3 mm before the first burn, on the same scan line, laser off.
        let run_up = &segs[first_burn - 1];
        assert!(run_up.overscan && run_up.kind == MoveKind::Travel && run_up.power_percent == 0.0);
        assert!(
            near(run_up.from.x, 47.0) && near(run_up.to.x, 50.0) && near(run_up.to.y, 50.5),
            "{run_up:?}"
        );
        // Run-out: 3 mm past the end of the burn.
        let run_out = &segs[first_burn + 1];
        assert!(run_out.overscan);
        assert!(
            near(run_out.from.x, 60.0) && near(run_out.to.x, 63.0),
            "{run_out:?}"
        );
        // Dark moves run at the layer's feed rate, not the rapid rate.
        assert!(dark_moves(&with).iter().all(|s| s.feed_mm_min == 3000.0));
    }

    #[test]
    fn fill_lines_are_joined_at_feed_rate_instead_of_stopping_between_them() {
        let r = generate(&fill_project(vec![square(50.0, 50.0, 10.0)], 1.0, 3.0));
        // The only rapid move is the approach to the first run-up.
        assert_eq!(rapid_moves(&r), 1);
        // Ten lines: ten run-ups, ten run-outs and nine joins between lines.
        assert_eq!(dark_moves(&r).len(), 29);
    }

    #[test]
    fn overscan_never_leaves_the_bed() {
        // The shape touches the right edge of the 300 mm bed, so no run-out is possible there.
        let r = generate(&fill_project(vec![square(290.0, 100.0, 10.0)], 1.0, 5.0));
        for s in &r.toolpath.segments {
            for q in [s.from, s.to] {
                assert!(
                    q.x >= -1e-6 && q.x <= 300.0 + 1e-6 && q.y >= -1e-6 && q.y <= 300.0 + 1e-6,
                    "{s:?}"
                );
            }
        }
        // The left-hand side has room, so those run-ups and run-outs are kept.
        assert!(dark_moves(&r).iter().any(|s| s.from.x.min(s.to.x) < 288.0));
    }

    #[test]
    fn distant_runs_on_one_line_each_get_their_own_run_up_and_run_out() {
        let shapes = || vec![square(50.0, 100.0, 10.0), square(150.0, 100.0, 10.0)];
        let plain = generate(&fill_project(shapes(), 5.0, 0.0));
        let with = generate(&fill_project(shapes(), 5.0, 2.0));
        assert_eq!(burns(&with), burns(&plain));
        // Nothing crosses the 90 mm gap at feed rate: the gap is a rapid move.
        assert!(dark_moves(&with)
            .iter()
            .all(|s| s.from.distance_to(&s.to) <= 5.0 + 1e-6));
        assert!(rapid_moves(&with) >= 3, "{}", rapid_moves(&with));
    }

    #[test]
    fn raster_lines_get_run_ups_and_run_outs_and_the_burn_is_unchanged() {
        // Row 0: black black white black. Placed away from the bed edge so nothing is clamped.
        let (mut p, bytes) = raster_project([[0, 0, 255, 0], [255; 4]], false);
        p.objects[0].transform = Transform2D::translate(100.0, 100.0);
        let plain = engrave(&p, &bytes);
        p.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Image)
            .unwrap()
            .overscan_mm = 1.0;
        assert_eq!(engrave(&p, &bytes), plain);
        let plan = plan_operations(&p);
        let tp = generate_toolpath(&p, &plan.operations, &bytes)
            .unwrap()
            .toolpath;
        let dark: Vec<&ToolpathSegment> = tp.segments.iter().filter(|s| s.overscan).collect();
        // Run-up, the 0.1 mm gap between the two runs (crossed, not stopped), and run-out.
        assert_eq!(dark.len(), 3, "{dark:?}");
        let near = |a: f64, b: f64| (a - b).abs() < 1e-6;
        assert!(near(dark[0].from.x, 99.0) && near(dark[0].to.x, 100.0));
        assert!(near(dark[1].from.x, 100.2) && near(dark[1].to.x, 100.3));
        assert!(near(dark[2].from.x, 100.4) && near(dark[2].to.x, 101.4));
    }

    // ---- fill outline pass ---------------------------------------------------------------

    fn outline_project(paths: Vec<Path2D>, outline: bool) -> ProjectFile {
        let mut p = project_with(LayerKind::Fill, paths);
        let layer = p
            .layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Fill)
            .unwrap();
        layer.line_spacing_mm = 1.0;
        layer.fill_outline = outline;
        p
    }

    fn fill_moves(r: &ToolpathResult) -> Vec<&ToolpathSegment> {
        r.toolpath
            .segments
            .iter()
            .filter(|s| s.kind == MoveKind::Fill)
            .collect()
    }

    fn on_the_edge(q: Point2, lo: f64, hi: f64) -> bool {
        let near = |a: f64, b: f64| (a - b).abs() < 1e-9;
        let inside = |v: f64| v >= lo - 1e-9 && v <= hi + 1e-9;
        inside(q.x)
            && inside(q.y)
            && (near(q.x, lo) || near(q.x, hi) || near(q.y, lo) || near(q.y, hi))
    }

    #[test]
    fn the_outline_pass_is_off_unless_a_fill_layer_asks_for_it() {
        let plain = generate(&outline_project(vec![square(50.0, 50.0, 10.0)], false));
        assert_eq!(fill_moves(&plain).len(), 10);
        assert!(!Layer::new("Fill", LayerKind::Fill, 0).fill_outline);
    }

    #[test]
    fn an_outline_traces_the_edge_of_the_shape_once_after_the_fill() {
        let plain = generate(&outline_project(vec![square(50.0, 50.0, 10.0)], false));
        let with = generate(&outline_project(vec![square(50.0, 50.0, 10.0)], true));
        let (before, after) = (fill_moves(&plain), fill_moves(&with));
        assert_eq!(after.len(), before.len() + 4);
        // The fill lines are exactly what they were, and come first.
        for (a, b) in before.iter().zip(&after) {
            assert_eq!((a.from, a.to), (b.from, b.to));
        }
        let outline = &after[before.len()..];
        let mut length = 0.0;
        for s in outline {
            assert!(
                on_the_edge(s.from, 50.0, 60.0) && on_the_edge(s.to, 50.0, 60.0),
                "{s:?}"
            );
            length += s.from.distance_to(&s.to);
        }
        assert!((length - 40.0).abs() < 1e-9, "{length}");
        // Every corner is visited.
        for corner in [(50.0, 50.0), (60.0, 50.0), (60.0, 60.0), (50.0, 60.0)] {
            assert!(outline.iter().any(|s| {
                (s.from.x - corner.0).abs() < 1e-9 && (s.from.y - corner.1).abs() < 1e-9
            }));
        }
    }

    #[test]
    fn the_outline_burns_at_the_layers_speed_and_power() {
        let p = outline_project(vec![square(50.0, 50.0, 10.0)], true);
        let layer = p.layers.iter().find(|l| l.kind == LayerKind::Fill).unwrap();
        let (speed, power) = (layer.speed_mm_min, layer.power_percent);
        let with = generate(&p);
        let moves = fill_moves(&with);
        for s in &moves[moves.len() - 4..] {
            assert_eq!((s.feed_mm_min, s.power_percent), (speed, power));
            assert!(!s.overscan);
        }
    }

    #[test]
    fn holes_are_outlined_too_and_before_the_shape_that_contains_them() {
        let shapes = || vec![square(50.0, 50.0, 20.0), square(56.0, 56.0, 6.0)];
        let plain = generate(&outline_project(shapes(), false));
        let with = generate(&outline_project(shapes(), true));
        let (before, after) = (fill_moves(&plain), fill_moves(&with));
        assert_eq!(after.len(), before.len() + 8);
        let first = after[before.len()];
        let in_hole = |q: Point2| q.x >= 56.0 && q.x <= 62.0 && q.y >= 56.0 && q.y <= 62.0;
        assert!(in_hole(first.from) && in_hole(first.to), "{first:?}");
    }

    #[test]
    fn the_outline_is_part_of_every_pass() {
        let one = outline_project(vec![square(50.0, 50.0, 10.0)], true);
        let mut two = one.clone();
        two.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Fill)
            .unwrap()
            .passes = 2;
        assert_eq!(fill_moves(&generate(&one)).len(), 14);
        let r = generate(&two);
        let moves = fill_moves(&r);
        assert_eq!(moves.len(), 28);
        // Fill, outline, fill, outline: the 11th to 14th moves are the first outline.
        for s in &moves[10..14] {
            assert!(
                on_the_edge(s.from, 50.0, 60.0) && on_the_edge(s.to, 50.0, 60.0),
                "{s:?}"
            );
        }
    }

    #[test]
    fn with_overscan_the_outline_is_still_a_plain_burning_move() {
        let mut p = outline_project(vec![square(50.0, 50.0, 10.0)], true);
        p.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Fill)
            .unwrap()
            .overscan_mm = 3.0;
        let r = generate(&p);
        let segs = &r.toolpath.segments;
        let last_four: Vec<usize> = segs
            .iter()
            .enumerate()
            .filter(|(_, s)| s.kind == MoveKind::Fill)
            .map(|(i, _)| i)
            .rev()
            .take(4)
            .collect();
        let outline_start = *last_four.last().unwrap();
        assert!(segs[outline_start..].iter().all(|s| !s.overscan));
        assert!(segs[outline_start..]
            .iter()
            .filter(|s| s.kind == MoveKind::Fill)
            .all(|s| on_the_edge(s.from, 50.0, 60.0) && on_the_edge(s.to, 50.0, 60.0)));
    }

    // ---- ramped power --------------------------------------------------------------------

    fn line(x0: f64, x1: f64) -> Path2D {
        Path2D::new(vec![Point2::new(x0, 0.0), Point2::new(x1, 0.0)], false)
    }

    fn length_of(pieces: &[RampPiece]) -> f64 {
        pieces.iter().map(|p| p.0.distance_to(&p.1)).sum()
    }

    fn follows_without_a_gap(pieces: &[RampPiece]) -> bool {
        pieces
            .windows(2)
            .all(|w| w[0].1.distance_to(&w[1].0) < 1e-9)
    }

    #[test]
    fn an_open_line_ramps_up_runs_at_full_power_and_ramps_down() {
        let pieces = ramp_pieces(&line(0.0, 100.0), 5.0);
        assert_eq!(pieces.len(), 8 + 1 + 8);
        assert!(follows_without_a_gap(&pieces));
        assert!((length_of(&pieces) - 100.0).abs() < 1e-9);
        assert_eq!(pieces[0].0, Point2::new(0.0, 0.0));
        assert_eq!(pieces[16].1, Point2::new(100.0, 0.0));
        // The middle is the full power, the ends are the floor and above.
        assert_eq!(pieces[8].2, 1.0);
        assert!((pieces[0].2 - 0.25).abs() < 1e-12);
        assert!((pieces[16].2 - 0.25).abs() < 1e-12);
        for w in pieces[..9].windows(2) {
            assert!(w[0].2 < w[1].2, "{w:?}");
        }
        for w in pieces[8..].windows(2) {
            assert!(w[0].2 > w[1].2, "{w:?}");
        }
        // Each step is a ramp-length eighth long.
        for p in &pieces[..8] {
            assert!((p.0.distance_to(&p.1) - 0.625).abs() < 1e-9);
        }
    }

    #[test]
    fn a_short_line_ramps_over_half_its_length_each_way() {
        let pieces = ramp_pieces(&line(0.0, 4.0), 5.0);
        assert_eq!(pieces.len(), 16);
        assert!(follows_without_a_gap(&pieces));
        assert!((length_of(&pieces) - 4.0).abs() < 1e-9);
        // It never reaches the full power: there is no flat middle.
        assert!(pieces.iter().all(|p| p.2 < 1.0));
        assert!((pieces[7].0.x - 1.75).abs() < 1e-9 && (pieces[7].1.x - 2.0).abs() < 1e-9);
    }

    #[test]
    fn a_closed_shape_runs_round_once_and_then_over_its_start_with_the_power_falling() {
        let square = Path2D::new(
            vec![
                Point2::new(0.0, 0.0),
                Point2::new(40.0, 0.0),
                Point2::new(40.0, 40.0),
                Point2::new(0.0, 40.0),
            ],
            true,
        );
        let pieces = ramp_pieces(&square, 5.0);
        // Eight steps up, the rest of the first edge and three more edges, eight steps down.
        assert_eq!(pieces.len(), 8 + 4 + 8);
        assert!(follows_without_a_gap(&pieces));
        assert!((length_of(&pieces) - 165.0).abs() < 1e-9);
        assert_eq!(pieces[0].0, Point2::new(0.0, 0.0));
        assert_eq!(pieces[19].1, Point2::new(5.0, 0.0));
        for middle in &pieces[8..12] {
            assert_eq!(middle.2, 1.0);
        }
        // The second ramp runs over the same ground as the first, and the two add up to full power.
        for k in 0..8 {
            let (up, down) = (pieces[k], pieces[12 + k]);
            assert_eq!((up.0, up.1), (down.0, down.1));
            assert!((up.2 + down.2 - 1.0).abs() < 1e-12, "{up:?} {down:?}");
            assert!(up.2 > 0.0 && down.2 > 0.0);
        }
    }

    #[test]
    fn a_closed_path_that_repeats_its_first_point_is_the_same_loop() {
        let corners = vec![
            Point2::new(0.0, 0.0),
            Point2::new(10.0, 0.0),
            Point2::new(10.0, 10.0),
            Point2::new(0.0, 10.0),
        ];
        let mut again = corners.clone();
        again.push(corners[0]);
        let a = ramp_pieces(&Path2D::new(corners, true), 2.0);
        let b = ramp_pieces(&Path2D::new(again, true), 2.0);
        assert_eq!(a.len(), b.len());
        assert!((length_of(&a) - 42.0).abs() < 1e-9 && (length_of(&b) - 42.0).abs() < 1e-9);
    }

    #[test]
    fn a_piece_never_turns_a_corner() {
        // The ramp (15 mm) runs round the first corner of a 10 mm square.
        let square = Path2D::new(
            vec![
                Point2::new(0.0, 0.0),
                Point2::new(10.0, 0.0),
                Point2::new(10.0, 10.0),
                Point2::new(0.0, 10.0),
            ],
            true,
        );
        let pieces = ramp_pieces(&square, 15.0);
        assert!(follows_without_a_gap(&pieces));
        assert!((length_of(&pieces) - 55.0).abs() < 1e-9);
        for p in &pieces {
            let (dx, dy) = ((p.1.x - p.0.x).abs(), (p.1.y - p.0.y).abs());
            assert!(dx < 1e-9 || dy < 1e-9, "{p:?} turns a corner");
        }
        // The corner at (10, 0) is the end of a piece, with the power stepping up across it.
        assert!(pieces.iter().any(|p| p.1 == Point2::new(10.0, 0.0)));
    }

    #[test]
    fn a_ramp_of_zero_or_too_small_or_not_a_number_gives_plain_full_power() {
        let square = Path2D::new(
            vec![
                Point2::new(0.0, 0.0),
                Point2::new(10.0, 0.0),
                Point2::new(10.0, 10.0),
                Point2::new(0.0, 10.0),
            ],
            true,
        );
        for ramp in [0.0, 0.001, -3.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let pieces = ramp_pieces(&square, ramp);
            assert_eq!(pieces.len(), 4, "{ramp}");
            assert!(pieces.iter().all(|p| p.2 == 1.0));
            assert!((length_of(&pieces) - 40.0).abs() < 1e-9);
        }
        assert_eq!(ramp_pieces(&line(0.0, 50.0), 0.0).len(), 1);
    }

    #[test]
    fn nothing_to_draw_gives_no_pieces() {
        assert!(ramp_pieces(&Path2D::new(vec![], false), 5.0).is_empty());
        assert!(ramp_pieces(&Path2D::new(vec![Point2::new(1.0, 1.0)], false), 5.0).is_empty());
        let same = vec![Point2::new(1.0, 1.0), Point2::new(1.0, 1.0)];
        assert!(ramp_pieces(&Path2D::new(same.clone(), false), 5.0).is_empty());
        assert!(ramp_pieces(&Path2D::new(same, true), 5.0).is_empty());
    }

    #[test]
    fn every_ramp_step_has_a_power_above_zero_and_not_above_full() {
        let curve: Vec<Point2> = (0..=40)
            .map(|i| {
                let a = i as f64 * 0.1;
                Point2::new(30.0 * a.cos(), 30.0 * a.sin())
            })
            .collect();
        for path in [
            line(0.0, 80.0),
            Path2D::new(curve.clone(), false),
            Path2D::new(curve, true),
        ] {
            for ramp in [0.5, 3.0, 9.0, 200.0] {
                let pieces = ramp_pieces(&path, ramp);
                assert!(!pieces.is_empty());
                assert!(follows_without_a_gap(&pieces));
                for p in &pieces {
                    assert!(p.2 > 0.0 && p.2 <= 1.0, "{p:?}");
                }
            }
        }
    }

    fn score_project(paths: Vec<Path2D>, ramp_mm: f64) -> ProjectFile {
        let mut p = project_with(LayerKind::Score, paths);
        p.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Score)
            .unwrap()
            .ramp_mm = ramp_mm;
        p
    }

    fn score_moves(r: &ToolpathResult) -> Vec<&ToolpathSegment> {
        r.toolpath
            .segments
            .iter()
            .filter(|s| s.kind == MoveKind::Score)
            .collect()
    }

    #[test]
    fn a_score_layer_is_not_ramped_unless_it_asks() {
        let r = generate(&score_project(vec![square(50.0, 50.0, 40.0)], 0.0));
        let moves = score_moves(&r);
        assert_eq!(moves.len(), 4);
        assert!(moves.iter().all(|s| s.power_percent == 15.0));
    }

    #[test]
    fn a_ramped_score_line_steps_its_power_and_never_goes_above_the_layers() {
        let r = generate(&score_project(vec![line(50.0, 150.0)], 5.0));
        let moves = score_moves(&r);
        assert_eq!(moves.len(), 17);
        assert!((moves[0].power_percent - 3.75).abs() < 1e-9);
        assert_eq!(moves[8].power_percent, 15.0);
        for s in &moves {
            assert!(s.power_percent > 0.0 && s.power_percent <= 15.0, "{s:?}");
            assert_eq!(s.feed_mm_min, 1000.0);
        }
        // Nothing is left unburned between the steps.
        for w in moves.windows(2) {
            assert!(w[0].to.distance_to(&w[1].from) < 1e-9);
        }
    }

    #[test]
    fn a_ramped_score_loop_reaches_full_power_and_overlaps_its_start() {
        let r = generate(&score_project(vec![square(50.0, 50.0, 40.0)], 5.0));
        let moves = score_moves(&r);
        assert_eq!(moves.len(), 20);
        assert_eq!(moves.iter().filter(|s| s.power_percent == 15.0).count(), 4);
        let total: f64 = moves.iter().map(|s| s.from.distance_to(&s.to)).sum();
        assert!((total - 165.0).abs() < 1e-9, "{total}");
    }

    #[test]
    fn passes_repeat_the_whole_ramped_path() {
        let mut p = score_project(vec![line(50.0, 150.0)], 5.0);
        p.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Score)
            .unwrap()
            .passes = 2;
        let r = generate(&p);
        assert_eq!(score_moves(&r).len(), 34);
    }

    #[test]
    fn cut_layers_are_never_ramped_so_a_cut_always_goes_all_the_way_through() {
        let mut p = project_with(
            LayerKind::Cut,
            vec![square(50.0, 50.0, 40.0), line(10.0, 60.0)],
        );
        p.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Cut)
            .unwrap()
            .ramp_mm = 5.0;
        let r = generate(&p);
        let cuts = cut_segments(&r);
        assert_eq!(cuts.len(), 5);
        assert!(cuts.iter().all(|s| s.power_percent == 80.0));
    }

    #[test]
    fn fill_layers_ignore_a_ramp() {
        let mut p = outline_project(vec![square(50.0, 50.0, 10.0)], false);
        p.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Fill)
            .unwrap()
            .ramp_mm = 5.0;
        let r = generate(&p);
        assert!(fill_moves(&r).iter().all(|s| s.power_percent == 40.0));
    }

    #[test]
    fn travel_starts_from_the_machine_origin_in_workspace_terms() {
        let p = project_with(LayerKind::Cut, vec![square(10.0, 10.0, 10.0)]);
        let r = generate(&p);
        // BottomLeft origin on a 300 mm bed is workspace (0, 300).
        assert_eq!(r.toolpath.segments[0].from, Point2::new(0.0, 300.0));
    }
}
