//! DXF import for 2D profiles as exported by Fusion 360 and most CAD tools: `LINE`,
//! `CIRCLE`, `ARC`, `ELLIPSE`, `LWPOLYLINE` (with bulge arcs), legacy `POLYLINE`/`VERTEX`
//! and `SPLINE` (NURBS evaluated with De Boor's algorithm).
//!
//! * Drawing units come from the `$INSUNITS` header variable and are converted to
//!   millimetres. A missing/zero value assumes millimetres and produces a warning.
//! * DXF is Y-up; the workspace is Y-down, so Y is mirrored on import.
//! * Separate segments whose end points meet are joined into closed loops, because CAD
//!   exports describe profiles as loose LINE/ARC entities and kerf compensation and
//!   cut ordering both need closed paths.
//!
//! `INSERT` (a reference to a block) is expanded: the block's contents are placed at the insertion
//! point with its scale and rotation, including arrays (`MINSERT`) and blocks inside blocks.
//!
//! Everything else (`TEXT`, `HATCH`, `DIMENSION`, ...) is reported as a warning.

use std::collections::{BTreeSet, HashMap};
use std::f64::consts::PI;

use makerlaser_common::{Path2D, Point2};

use crate::bezier::{arc_points, arc_steps};
use crate::error::{GeometryError, Result};
use crate::join::join_open_paths;

const FLATTEN_TOLERANCE_MM: f64 = 0.02;
const JOIN_TOLERANCE_MM: f64 = 0.01;

#[derive(Debug, Clone, Default)]
pub struct DxfImportResult {
    pub paths: Vec<Path2D>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct Pair {
    code: i32,
    value: String,
}

fn tokenize(content: &str) -> Vec<Pair> {
    let mut lines = content.trim_start_matches('\u{feff}').lines();
    let mut pairs = Vec::new();
    while let (Some(code), Some(value)) = (lines.next(), lines.next()) {
        if let Ok(code) = code.trim().parse::<i32>() {
            pairs.push(Pair {
                code,
                value: value.trim().to_string(),
            });
        }
    }
    pairs
}

fn header_int(pairs: &[Pair], variable: &str) -> Option<i32> {
    for i in 0..pairs.len().saturating_sub(1) {
        if pairs[i].code == 9 && pairs[i].value == variable {
            return pairs[i + 1].value.parse().ok();
        }
    }
    None
}

/// Millimetres per drawing unit, plus an optional warning.
fn unit_scale(pairs: &[Pair]) -> (f64, Option<String>) {
    match header_int(pairs, "$INSUNITS") {
        Some(1) => (25.4, None),
        Some(2) => (304.8, None),
        Some(4) => (1.0, None),
        Some(5) => (10.0, None),
        Some(6) => (1000.0, None),
        Some(9) => (0.0254, None),
        Some(10) => (914.4, None),
        Some(14) => (100.0, None),
        Some(0) | None => (
            1.0,
            Some("DXF does not declare its units; millimetres were assumed. Check the imported size.".to_string()),
        ),
        Some(other) => (
            1.0,
            Some(format!(
                "DXF unit code {other} is not supported; millimetres were assumed. Check the imported size."
            )),
        ),
    }
}

fn entities_range(pairs: &[Pair]) -> Option<(usize, usize)> {
    for i in 0..pairs.len().saturating_sub(1) {
        if pairs[i].code == 0
            && pairs[i].value == "SECTION"
            && pairs[i + 1].code == 2
            && pairs[i + 1].value == "ENTITIES"
        {
            let start = i + 2;
            let mut end = start;
            while end < pairs.len() && !(pairs[end].code == 0 && pairs[end].value == "ENDSEC") {
                end += 1;
            }
            return Some((start, end));
        }
    }
    None
}

fn first_f64(ent: &[Pair], code: i32) -> Option<f64> {
    ent.iter()
        .find(|p| p.code == code)
        .and_then(|p| p.value.parse().ok())
}

fn all_f64(ent: &[Pair], code: i32) -> Vec<f64> {
    ent.iter()
        .filter(|p| p.code == code)
        .filter_map(|p| p.value.parse().ok())
        .collect()
}

fn first_int(ent: &[Pair], code: i32) -> Option<i64> {
    ent.iter()
        .find(|p| p.code == code)
        .and_then(|p| p.value.parse().ok())
}

/// Limits on `INSERT`: how many block copies one import places, how deeply blocks may nest, and how
/// many paths the copies may add up to. Without them, a block that inserts the previous block ten
/// times, nine levels down, would ask for billions of copies.
const MAX_INSERT_DEPTH: usize = 16;
const MAX_INSERT_COPIES: usize = 50_000;
const MAX_INSERT_PATHS: usize = 1_000_000;
/// How much finer a block's curves are flattened to make up for a large scale (see `expand_insert`).
const MAX_TOLERANCE_REFINEMENT: f64 = 1000.0;

/// A block from the BLOCKS section: its base point and the entities it is made of.
struct Block {
    base: (f64, f64),
    entities: Vec<Vec<Pair>>,
}

/// The block definitions, by name in capitals (DXF block names are not case sensitive).
type Blocks = HashMap<String, Block>;

/// What an import has used up so far, shared by every `INSERT` it expands.
#[derive(Default)]
struct InsertState {
    /// The blocks being expanded right now, outermost first. A block that contains itself would
    /// appear twice.
    stack: Vec<String>,
    /// Block copies placed so far.
    copies: usize,
}

/// The pairs of the named section, as a range: from just after its name to its `ENDSEC`.
fn section_range(pairs: &[Pair], name: &str) -> Option<(usize, usize)> {
    for i in 0..pairs.len().saturating_sub(1) {
        if pairs[i].code == 0
            && pairs[i].value == "SECTION"
            && pairs[i + 1].code == 2
            && pairs[i + 1].value.eq_ignore_ascii_case(name)
        {
            let start = i + 2;
            let mut end = start;
            while end < pairs.len() && !(pairs[end].code == 0 && pairs[end].value == "ENDSEC") {
                end += 1;
            }
            return Some((start, end));
        }
    }
    None
}

/// Splits a run of pairs into entities: each begins at a group code 0.
fn split_entities(slice: &[Pair]) -> Vec<&[Pair]> {
    let mut entities = Vec::new();
    let mut s = 0;
    for i in 1..=slice.len() {
        if i == slice.len() || slice[i].code == 0 {
            if i > s && slice[s].code == 0 {
                entities.push(&slice[s..i]);
            }
            s = i;
        }
    }
    entities
}

/// Reads the block definitions out of the BLOCKS section (there may be none).
fn read_blocks(pairs: &[Pair]) -> Blocks {
    let mut blocks = Blocks::new();
    let Some((start, end)) = section_range(pairs, "BLOCKS") else {
        return blocks;
    };
    let mut open: Option<(String, Block)> = None;
    for ent in split_entities(&pairs[start..end]) {
        match ent[0].value.to_ascii_uppercase().as_str() {
            "BLOCK" => {
                if let Some((name, block)) = open.take() {
                    blocks.entry(name).or_insert(block);
                }
                let name = ent
                    .iter()
                    .find(|p| p.code == 2)
                    .map(|p| p.value.to_ascii_uppercase())
                    .unwrap_or_default();
                let base = (
                    first_f64(ent, 10).unwrap_or(0.0),
                    first_f64(ent, 20).unwrap_or(0.0),
                );
                open = Some((
                    name,
                    Block {
                        base,
                        entities: Vec::new(),
                    },
                ));
            }
            "ENDBLK" => {
                if let Some((name, block)) = open.take() {
                    blocks.entry(name).or_insert(block);
                }
            }
            _ => {
                if let Some((_, block)) = open.as_mut() {
                    block.entities.push(ent.to_vec());
                }
            }
        }
    }
    // A block that was never closed is still used.
    if let Some((name, block)) = open.take() {
        blocks.entry(name).or_insert(block);
    }
    blocks
}

/// Places copies of a block (an `INSERT` entity): the block's own entities are turned into paths
/// once, then each copy is moved by the base point, scaled, turned and put at the insertion point.
/// A column and row count (a `MINSERT` array) places a grid of copies, which turns with the insert.
fn expand_insert(
    ent: &[Pair],
    tol: f64,
    blocks: &Blocks,
    state: &mut InsertState,
    paths: &mut Vec<Path2D>,
    warnings: &mut BTreeSet<String>,
) {
    let name = ent
        .iter()
        .find(|p| p.code == 2)
        .map(|p| p.value.as_str())
        .unwrap_or("");
    let key = name.to_ascii_uppercase();
    let Some(block) = blocks.get(&key) else {
        warnings.insert(format!(
            "An INSERT refers to the block '{name}', which is not in the file; it was skipped."
        ));
        return;
    };
    if state.stack.contains(&key) {
        warnings.insert(format!(
            "The block '{name}' contains itself; the inner copy was skipped."
        ));
        return;
    }

    let (sx, sy) = (
        first_f64(ent, 41).unwrap_or(1.0),
        first_f64(ent, 42).unwrap_or(1.0),
    );
    let (ix, iy) = (
        first_f64(ent, 10).unwrap_or(0.0),
        first_f64(ent, 20).unwrap_or(0.0),
    );
    let angle = first_f64(ent, 50).unwrap_or(0.0).to_radians();
    let usable = [sx, sy, ix, iy, angle].iter().all(|v| v.is_finite());
    if !usable || sx.abs() < 1e-12 || sy.abs() < 1e-12 {
        warnings.insert(format!(
            "An INSERT of the block '{name}' has a zero scale or an unusable position; it was skipped."
        ));
        return;
    }
    // A negative extrusion axis flips the insert's own X direction, which is not applied here.
    if first_f64(ent, 230).is_some_and(|z| z < 0.0) {
        warnings.insert(format!(
            "The INSERT of the block '{name}' has a flipped (negative extrusion) axis, which is not applied: check which way the copy faces."
        ));
    }
    let columns = first_int(ent, 70).unwrap_or(1).clamp(1, 1_000_000) as usize;
    let rows = first_int(ent, 71).unwrap_or(1).clamp(1, 1_000_000) as usize;
    let spacing = |code: i32| {
        first_f64(ent, code)
            .filter(|v| v.is_finite())
            .unwrap_or(0.0)
    };
    let (dx, dy) = (spacing(44), spacing(45));

    let copies = columns.saturating_mul(rows);
    if state.stack.len() >= MAX_INSERT_DEPTH
        || state.copies.saturating_add(copies) > MAX_INSERT_COPIES
    {
        warnings.insert(
            "Too many block copies (or blocks nested too deeply): the rest were skipped."
                .to_string(),
        );
        return;
    }
    state.copies += copies;

    // The block's curves are flattened in the block's own units and then scaled with it, so the
    // tolerance is divided by the scale. Otherwise a block drawn small and scaled up by 100 would
    // come out as coarse polygons.
    let entities: Vec<&[Pair]> = block.entities.iter().map(|e| e.as_slice()).collect();
    let mut inner: Vec<Path2D> = Vec::new();
    let block_tol = (tol / sx.abs().max(sy.abs())).max(tol / MAX_TOLERANCE_REFINEMENT);
    state.stack.push(key);
    convert_entities(&entities, block_tol, blocks, state, &mut inner, warnings);
    state.stack.pop();

    if paths
        .len()
        .saturating_add(inner.len().saturating_mul(copies))
        > MAX_INSERT_PATHS
    {
        warnings.insert(
            "Too many block copies (or blocks nested too deeply): the rest were skipped."
                .to_string(),
        );
        return;
    }

    let (sin, cos) = angle.sin_cos();
    for row in 0..rows {
        for column in 0..columns {
            // The rows and columns of an array turn with the insert.
            let (ox, oy) = (column as f64 * dx, row as f64 * dy);
            let (px, py) = (ix + ox * cos - oy * sin, iy + ox * sin + oy * cos);
            for path in &inner {
                let points = path
                    .points
                    .iter()
                    .map(|q| {
                        let (x, y) = ((q.x - block.base.0) * sx, (q.y - block.base.1) * sy);
                        Point2::new(px + x * cos - y * sin, py + x * sin + y * cos)
                    })
                    .collect();
                paths.push(Path2D::new(points, path.closed));
            }
        }
    }
}

pub fn parse_dxf(content: &str) -> Result<DxfImportResult> {
    let pairs = tokenize(content);
    if pairs.is_empty() {
        return Err(GeometryError::DxfParse(
            "the file does not look like an ASCII DXF".into(),
        ));
    }
    let (scale, unit_warning) = unit_scale(&pairs);
    let (start, end) = entities_range(&pairs)
        .ok_or_else(|| GeometryError::DxfParse("no ENTITIES section found".into()))?;

    // Work in drawing units; tolerance converted accordingly.
    let tol = FLATTEN_TOLERANCE_MM / scale;
    let slice = &pairs[start..end];

    // Split the section into entities: each begins at a group code 0.
    let mut entities: Vec<&[Pair]> = Vec::new();
    let mut s = 0;
    for i in 1..=slice.len() {
        if i == slice.len() || slice[i].code == 0 {
            if i > s && slice[s].code == 0 {
                entities.push(&slice[s..i]);
            }
            s = i;
        }
    }

    let mut paths: Vec<Path2D> = Vec::new();
    let mut warnings: BTreeSet<String> = BTreeSet::new();
    let blocks = read_blocks(&pairs);
    let mut state = InsertState::default();
    convert_entities(
        &entities,
        tol,
        &blocks,
        &mut state,
        &mut paths,
        &mut warnings,
    );
    finish_import(paths, warnings, scale, unit_warning)
}

/// Turns entities into paths, in drawing units and the DXF's own Y-up orientation. An `INSERT` calls
/// this again for the entities of its block.
fn convert_entities(
    entities: &[&[Pair]],
    tol: f64,
    blocks: &Blocks,
    state: &mut InsertState,
    paths: &mut Vec<Path2D>,
    warnings: &mut BTreeSet<String>,
) {
    let mut k = 0;
    while k < entities.len() {
        let ent = entities[k];
        let kind = ent[0].value.to_ascii_uppercase();
        k += 1;
        match kind.as_str() {
            "LINE" => {
                if let (Some(x1), Some(y1), Some(x2), Some(y2)) = (
                    first_f64(ent, 10),
                    first_f64(ent, 20),
                    first_f64(ent, 11),
                    first_f64(ent, 21),
                ) {
                    paths.push(Path2D::new(
                        vec![Point2::new(x1, y1), Point2::new(x2, y2)],
                        false,
                    ));
                }
            }
            "CIRCLE" => {
                if let (Some(cx), Some(cy), Some(r)) =
                    (first_f64(ent, 10), first_f64(ent, 20), first_f64(ent, 40))
                {
                    if r > 0.0 {
                        let mut pts = Vec::new();
                        arc_points(cx, cy, r, r, 0.0, 0.0, 2.0 * PI, tol, &mut pts);
                        paths.push(Path2D::new(pts, true));
                    }
                }
            }
            "ARC" => {
                if let (Some(cx), Some(cy), Some(r), Some(a0), Some(a1)) = (
                    first_f64(ent, 10),
                    first_f64(ent, 20),
                    first_f64(ent, 40),
                    first_f64(ent, 50),
                    first_f64(ent, 51),
                ) {
                    if r > 0.0 {
                        // DXF arcs always run counter-clockwise from the start angle.
                        let mut sweep = (a1 - a0).rem_euclid(360.0);
                        if sweep < 1e-9 {
                            sweep = 360.0;
                        }
                        let mut pts = Vec::new();
                        arc_points(
                            cx,
                            cy,
                            r,
                            r,
                            0.0,
                            a0.to_radians(),
                            sweep.to_radians(),
                            tol,
                            &mut pts,
                        );
                        paths.push(Path2D::new(pts, false));
                    }
                }
            }
            "ELLIPSE" => {
                if let Some(p) = parse_ellipse(ent, tol) {
                    paths.push(p);
                }
            }
            "LWPOLYLINE" => {
                if let Some(p) = parse_lwpolyline(ent, tol) {
                    paths.push(p);
                }
            }
            "POLYLINE" => {
                // Vertices follow as separate VERTEX entities, terminated by SEQEND.
                let mut vertices: Vec<&[Pair]> = Vec::new();
                while k < entities.len() {
                    let next = entities[k][0].value.to_ascii_uppercase();
                    k += 1;
                    if next == "VERTEX" {
                        vertices.push(entities[k - 1]);
                    } else if next == "SEQEND" {
                        break;
                    }
                }
                if let Some(p) = parse_legacy_polyline(ent, &vertices, tol) {
                    paths.push(p);
                }
            }
            "SPLINE" => match parse_spline(ent) {
                Some((p, approximated)) => {
                    if approximated {
                        warnings.insert(
                            "A SPLINE had no usable control data and was approximated by straight segments through its fit points.".to_string(),
                        );
                    }
                    paths.push(p);
                }
                None => {
                    warnings.insert("A SPLINE could not be read and was skipped.".to_string());
                }
            },
            "POINT" | "VERTEX" | "SEQEND" | "" => {}
            "INSERT" => expand_insert(ent, tol, blocks, state, paths, warnings),
            other => {
                warnings.insert(format!("Unsupported DXF entity skipped: {other}"));
            }
        }
    }
}

/// Y-up -> Y-down mirror and unit conversion, then join loose segments.
fn finish_import(
    paths: Vec<Path2D>,
    warnings: BTreeSet<String>,
    scale: f64,
    unit_warning: Option<String>,
) -> Result<DxfImportResult> {
    let mut converted: Vec<Path2D> = paths
        .into_iter()
        .map(|mut p| {
            for q in &mut p.points {
                *q = Point2::new(q.x * scale, -q.y * scale);
            }
            p.dedup(1e-9);
            p
        })
        .filter(|p| p.points.len() >= if p.closed { 3 } else { 2 })
        .filter(|p| p.points.iter().all(|q| q.is_finite()))
        .collect();
    converted = join_open_paths(converted, JOIN_TOLERANCE_MM);

    let mut out_warnings: Vec<String> = warnings.into_iter().collect();
    if let Some(w) = unit_warning {
        out_warnings.insert(0, w);
    }
    Ok(DxfImportResult {
        paths: converted,
        warnings: out_warnings,
    })
}

fn parse_ellipse(ent: &[Pair], tol: f64) -> Option<Path2D> {
    let (cx, cy) = (first_f64(ent, 10)?, first_f64(ent, 20)?);
    let (mx, my) = (first_f64(ent, 11)?, first_f64(ent, 21)?);
    let ratio = first_f64(ent, 40)?;
    let t0 = first_f64(ent, 41).unwrap_or(0.0);
    let t1 = first_f64(ent, 42).unwrap_or(2.0 * PI);
    let major = mx.hypot(my);
    if major <= 0.0 || ratio <= 0.0 {
        return None;
    }
    let (nx, ny) = (-my * ratio, mx * ratio); // minor axis: major rotated +90 degrees
    let mut sweep = t1 - t0;
    if sweep <= 1e-12 {
        sweep += 2.0 * PI;
    }
    let n = arc_steps(major, sweep, tol);
    let pts: Vec<Point2> = (0..=n)
        .map(|i| {
            let t = t0 + sweep * (i as f64 / n as f64);
            let (s, c) = t.sin_cos();
            Point2::new(cx + mx * c + nx * s, cy + my * c + ny * s)
        })
        .collect();
    Some(Path2D::new(pts, (sweep - 2.0 * PI).abs() < 1e-9))
}

/// Appends the points of the bulge arc from `p0` to `p1` (excluding `p0`, ending exactly
/// on `p1`). `bulge = tan(included_angle / 4)`; positive means counter-clockwise.
fn bulge_points(p0: Point2, p1: Point2, bulge: f64, tol: f64, out: &mut Vec<Point2>) {
    let chord = p0.distance_to(&p1);
    if bulge.abs() < 1e-9 || chord < 1e-12 {
        out.push(p1);
        return;
    }
    let theta = 4.0 * bulge.atan(); // signed included angle
    let half_tan = (theta / 2.0).tan();
    if half_tan.abs() < 1e-12 {
        out.push(p1);
        return;
    }
    let (dx, dy) = ((p1.x - p0.x) / chord, (p1.y - p0.y) / chord);
    let offset = (chord / 2.0) / half_tan; // signed distance along the left normal
    let cx = (p0.x + p1.x) / 2.0 - dy * offset;
    let cy = (p0.y + p1.y) / 2.0 + dx * offset;
    let r = (p0.x - cx).hypot(p0.y - cy);
    let start = (p0.y - cy).atan2(p0.x - cx);
    let mut pts = Vec::new();
    arc_points(cx, cy, r, r, 0.0, start, theta, tol, &mut pts);
    let n = pts.len();
    for (i, p) in pts.into_iter().enumerate().skip(1) {
        out.push(if i + 1 == n { p1 } else { p });
    }
}

fn build_polyline(vertices: &[(Point2, f64)], closed: bool, tol: f64) -> Option<Path2D> {
    if vertices.len() < 2 {
        return None;
    }
    let mut pts = vec![vertices[0].0];
    for w in vertices.windows(2) {
        bulge_points(w[0].0, w[1].0, w[0].1, tol, &mut pts);
    }
    if closed {
        let last = vertices[vertices.len() - 1];
        bulge_points(last.0, vertices[0].0, last.1, tol, &mut pts);
    }
    Some(Path2D::new(pts, closed))
}

fn parse_lwpolyline(ent: &[Pair], tol: f64) -> Option<Path2D> {
    let closed = first_int(ent, 70).unwrap_or(0) & 1 == 1;
    // Walk the group codes in order: 10 starts a vertex, 20 completes it, 42 is the
    // bulge of the vertex currently being read.
    let mut vertices: Vec<(Point2, f64)> = Vec::new();
    let mut pending_x: Option<f64> = None;
    for p in ent {
        match p.code {
            10 => pending_x = p.value.parse().ok(),
            20 => {
                if let (Some(x), Ok(y)) = (pending_x.take(), p.value.parse::<f64>()) {
                    vertices.push((Point2::new(x, y), 0.0));
                }
            }
            42 => {
                if let (Some(last), Ok(b)) = (vertices.last_mut(), p.value.parse::<f64>()) {
                    last.1 = b;
                }
            }
            _ => {}
        }
    }
    build_polyline(&vertices, closed, tol)
}

fn parse_legacy_polyline(header: &[Pair], vertex_entities: &[&[Pair]], tol: f64) -> Option<Path2D> {
    let flags = first_int(header, 70).unwrap_or(0);
    if flags & (16 | 64) != 0 {
        return None; // 3D polygon mesh / polyface mesh
    }
    let vertices: Vec<(Point2, f64)> = vertex_entities
        .iter()
        .filter_map(|v| {
            Some((
                Point2::new(first_f64(v, 10)?, first_f64(v, 20)?),
                first_f64(v, 42).unwrap_or(0.0),
            ))
        })
        .collect();
    build_polyline(&vertices, flags & 1 == 1, tol)
}

/// Evaluates a (rational) B-spline at `t` with De Boor's algorithm.
fn nurbs_point(degree: usize, knots: &[f64], cps: &[Point2], weights: &[f64], t: f64) -> Point2 {
    let n = cps.len() - 1;
    let mut k = degree;
    while k < n && t >= knots[k + 1] {
        k += 1;
    }
    let mut d: Vec<[f64; 3]> = (0..=degree)
        .map(|j| {
            let idx = k - degree + j;
            [
                cps[idx].x * weights[idx],
                cps[idx].y * weights[idx],
                weights[idx],
            ]
        })
        .collect();
    for r in 1..=degree {
        for j in (r..=degree).rev() {
            let i = k - degree + j;
            let denom = knots[i + degree - r + 1] - knots[i];
            let alpha = if denom.abs() < 1e-12 {
                0.0
            } else {
                (t - knots[i]) / denom
            };
            let prev = d[j - 1];
            for (c, slot) in d[j].iter_mut().enumerate() {
                *slot = (1.0 - alpha) * prev[c] + alpha * *slot;
            }
        }
    }
    let h = d[degree];
    if h[2].abs() < 1e-12 {
        return cps[k];
    }
    Point2::new(h[0] / h[2], h[1] / h[2])
}

/// Returns the path and whether it had to be approximated from fit points.
fn parse_spline(ent: &[Pair]) -> Option<(Path2D, bool)> {
    let flags = first_int(ent, 70).unwrap_or(0);
    let closed = flags & 1 == 1;
    let degree = first_int(ent, 71).unwrap_or(3).max(1) as usize;
    let knots = all_f64(ent, 40);
    let (xs, ys) = (all_f64(ent, 10), all_f64(ent, 20));
    let cps: Vec<Point2> = xs
        .iter()
        .zip(ys.iter())
        .map(|(x, y)| Point2::new(*x, *y))
        .collect();
    let mut weights = all_f64(ent, 41);
    if weights.len() != cps.len() {
        weights = vec![1.0; cps.len()];
    }

    if cps.len() > degree && knots.len() == cps.len() + degree + 1 {
        let (t0, t1) = (knots[degree], knots[cps.len()]);
        if t1 > t0 {
            let samples = (cps.len() * 16).clamp(32, 4096);
            let pts: Vec<Point2> = (0..=samples)
                .map(|i| {
                    let t = t0 + (t1 - t0) * (i as f64 / samples as f64);
                    nurbs_point(degree, &knots, &cps, &weights, t)
                })
                .collect();
            return Some((Path2D::new(pts, closed), false));
        }
    }

    let (fx, fy) = (all_f64(ent, 11), all_f64(ent, 21));
    let fit: Vec<Point2> = fx
        .iter()
        .zip(fy.iter())
        .map(|(x, y)| Point2::new(*x, *y))
        .collect();
    if fit.len() >= 2 {
        return Some((Path2D::new(fit, closed), true));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dxf(header: &[(i32, &str)], entities: &[(i32, &str)]) -> String {
        let mut s = String::new();
        let mut add = |pairs: &[(i32, &str)]| {
            for (c, v) in pairs {
                s.push_str(&format!("{c}\n{v}\n"));
            }
        };
        if !header.is_empty() {
            add(&[(0, "SECTION"), (2, "HEADER")]);
            add(header);
            add(&[(0, "ENDSEC")]);
        }
        add(&[(0, "SECTION"), (2, "ENTITIES")]);
        add(entities);
        add(&[(0, "ENDSEC"), (0, "EOF")]);
        s
    }

    const MM: &[(i32, &str)] = &[(9, "$INSUNITS"), (70, "4")];

    fn line(x1: &str, y1: &str, x2: &str, y2: &str) -> Vec<(i32, String)> {
        vec![
            (0, "LINE".into()),
            (10, x1.into()),
            (20, y1.into()),
            (11, x2.into()),
            (21, y2.into()),
        ]
    }

    fn entities(items: Vec<Vec<(i32, String)>>) -> Vec<(i32, String)> {
        items.into_iter().flatten().collect()
    }

    fn doc(header: &[(i32, &str)], ents: Vec<Vec<(i32, String)>>) -> String {
        let owned = entities(ents);
        let refs: Vec<(i32, &str)> = owned.iter().map(|(c, v)| (*c, v.as_str())).collect();
        dxf(header, &refs)
    }

    #[test]
    fn inches_are_converted_to_millimetres() {
        let d = doc(
            &[(9, "$INSUNITS"), (70, "1")],
            vec![line("0", "0", "1", "0")],
        );
        let r = parse_dxf(&d).unwrap();
        assert!((r.paths[0].bounding_box().unwrap().width() - 25.4).abs() < 1e-9);
        assert!(r.warnings.is_empty());
    }

    #[test]
    fn missing_units_assume_millimetres_and_warn() {
        let d = doc(&[], vec![line("0", "0", "10", "0")]);
        let r = parse_dxf(&d).unwrap();
        assert!((r.paths[0].bounding_box().unwrap().width() - 10.0).abs() < 1e-9);
        assert!(r.warnings.iter().any(|w| w.contains("millimetres")));
    }

    #[test]
    fn y_axis_is_mirrored_into_the_y_down_workspace() {
        let d = doc(MM, vec![line("0", "0", "0", "10")]);
        let b = parse_dxf(&d).unwrap().paths[0].bounding_box().unwrap();
        assert!((b.min.y + 10.0).abs() < 1e-9 && b.max.y.abs() < 1e-9);
    }

    #[test]
    fn loose_lines_are_joined_into_a_closed_square() {
        let d = doc(
            MM,
            vec![
                line("0", "0", "10", "0"),
                line("10", "0", "10", "10"),
                line("10", "10", "0", "10"),
                line("0", "10", "0", "0"),
            ],
        );
        let r = parse_dxf(&d).unwrap();
        assert_eq!(r.paths.len(), 1);
        assert!(r.paths[0].closed);
        assert_eq!(r.paths[0].points.len(), 4);
    }

    #[test]
    fn circle_and_arc() {
        let circle = vec![
            (0, "CIRCLE".into()),
            (10, "0".into()),
            (20, "0".into()),
            (40, "5".into()),
        ];
        let arc = vec![
            (0, "ARC".into()),
            (10, "100".into()),
            (20, "0".into()),
            (40, "10".into()),
            (50, "0".into()),
            (51, "90".into()),
        ];
        let r = parse_dxf(&doc(MM, vec![circle, arc])).unwrap();
        assert_eq!(r.paths.len(), 2);
        let closed = r.paths.iter().find(|p| p.closed).unwrap();
        assert!((closed.bounding_box().unwrap().width() - 10.0).abs() < 0.05);
        let open = r.paths.iter().find(|p| !p.closed).unwrap();
        // Quarter arc of radius 10: 10 mm wide and tall.
        let b = open.bounding_box().unwrap();
        assert!((b.width() - 10.0).abs() < 0.05 && (b.height() - 10.0).abs() < 0.05);
    }

    #[test]
    fn arc_wrapping_through_zero_degrees_sweeps_counter_clockwise() {
        let arc = vec![
            (0, "ARC".into()),
            (10, "0".into()),
            (20, "0".into()),
            (40, "10".into()),
            (50, "270".into()),
            (51, "90".into()),
        ];
        let b = parse_dxf(&doc(MM, vec![arc])).unwrap().paths[0]
            .bounding_box()
            .unwrap();
        // Right half circle: x from 0 to 10, y spanning -10..10 (workspace flipped).
        assert!((b.width() - 10.0).abs() < 0.05 && (b.height() - 20.0).abs() < 0.05);
    }

    #[test]
    fn closed_lwpolyline_square() {
        let mut e = vec![
            (0, "LWPOLYLINE".to_string()),
            (90, "4".into()),
            (70, "1".into()),
        ];
        for (x, y) in [("0", "0"), ("10", "0"), ("10", "10"), ("0", "10")] {
            e.push((10, x.into()));
            e.push((20, y.into()));
        }
        let r = parse_dxf(&doc(MM, vec![e])).unwrap();
        assert_eq!(r.paths.len(), 1);
        assert!(r.paths[0].closed && r.paths[0].points.len() == 4);
    }

    #[test]
    fn bulge_arc_curves_to_the_right_of_travel() {
        // Quarter-circle bulge (tan(pi/8)) from (0,0) to (10,0), counter-clockwise: the
        // arc dips below the chord in DXF space, i.e. to +Y after the Y mirror.
        let bulge = format!("{}", (PI / 8.0).tan());
        let e = vec![
            (0, "LWPOLYLINE".to_string()),
            (90, "2".into()),
            (70, "0".into()),
            (10, "0".into()),
            (20, "0".into()),
            (42, bulge),
            (10, "10".into()),
            (20, "0".into()),
        ];
        let p = &parse_dxf(&doc(MM, vec![e])).unwrap().paths[0];
        assert!(p.points.len() > 3);
        let b = p.bounding_box().unwrap();
        // Sagitta of a 90 degree arc over a 10 mm chord: r(1 - cos 45deg), r = 10/sqrt2.
        let sagitta = (10.0 / 2f64.sqrt()) * (1.0 - (PI / 4.0).cos());
        assert!(
            (b.max.y - sagitta).abs() < 0.05,
            "max y {} expected {}",
            b.max.y,
            sagitta
        );
        assert!(b.min.y.abs() < 1e-9);
        assert_eq!(*p.points.last().unwrap(), Point2::new(10.0, 0.0));
    }

    #[test]
    fn legacy_polyline_with_vertices() {
        let mut e = vec![(0, "POLYLINE".to_string()), (70, "0".into())];
        for (x, y) in [("0", "0"), ("5", "0"), ("5", "5")] {
            e.extend([(0, "VERTEX".to_string()), (10, x.into()), (20, y.into())]);
        }
        e.push((0, "SEQEND".to_string()));
        let r = parse_dxf(&doc(MM, vec![e])).unwrap();
        assert_eq!(r.paths.len(), 1);
        assert_eq!(r.paths[0].points.len(), 3);
    }

    #[test]
    fn clamped_cubic_spline_matches_the_bezier_end_points() {
        let mut e = vec![
            (0, "SPLINE".to_string()),
            (70, "8".into()),
            (71, "3".into()),
            (72, "8".into()),
            (73, "4".into()),
        ];
        for k in ["0", "0", "0", "0", "1", "1", "1", "1"] {
            e.push((40, k.into()));
        }
        for (x, y) in [("0", "0"), ("0", "10"), ("10", "10"), ("10", "0")] {
            e.push((10, x.into()));
            e.push((20, y.into()));
        }
        let r = parse_dxf(&doc(MM, vec![e])).unwrap();
        let p = &r.paths[0];
        assert!(p.points.len() >= 32);
        assert!(p.points[0].distance_to(&Point2::new(0.0, 0.0)) < 1e-9);
        assert!(
            p.points
                .last()
                .unwrap()
                .distance_to(&Point2::new(10.0, 0.0))
                < 1e-9
        );
        // The curve peaks at y = 7.5 (DXF) -> -7.5 after the mirror.
        let b = p.bounding_box().unwrap();
        assert!((b.min.y + 7.5).abs() < 0.01);
    }

    #[test]
    fn spline_without_control_data_falls_back_to_fit_points_with_a_warning() {
        let e = vec![
            (0, "SPLINE".to_string()),
            (74, "3".into()),
            (11, "0".into()),
            (21, "0".into()),
            (11, "5".into()),
            (21, "5".into()),
            (11, "10".into()),
            (21, "0".into()),
        ];
        let r = parse_dxf(&doc(MM, vec![e])).unwrap();
        assert_eq!(r.paths[0].points.len(), 3);
        assert!(r.warnings.iter().any(|w| w.contains("fit points")));
    }

    #[test]
    fn full_ellipse_is_closed_with_the_expected_extent() {
        let e = vec![
            (0, "ELLIPSE".to_string()),
            (10, "0".into()),
            (20, "0".into()),
            (11, "10".into()),
            (21, "0".into()),
            (40, "0.5".into()),
            (41, "0".into()),
            (42, format!("{}", 2.0 * PI)),
        ];
        let p = &parse_dxf(&doc(MM, vec![e])).unwrap().paths[0];
        assert!(p.closed);
        let b = p.bounding_box().unwrap();
        assert!((b.width() - 20.0).abs() < 0.05 && (b.height() - 10.0).abs() < 0.05);
    }

    #[test]
    fn unsupported_entities_warn_once() {
        let text = |s: &str| vec![(0, "MTEXT".to_string()), (1, s.into())];
        let r = parse_dxf(&doc(
            MM,
            vec![text("a"), text("b"), line("0", "0", "1", "1")],
        ))
        .unwrap();
        assert_eq!(r.paths.len(), 1);
        assert_eq!(r.warnings.iter().filter(|w| w.contains("MTEXT")).count(), 1);
    }

    // ---- INSERT (blocks) -------------------------------------------------------------------

    fn pair(code: i32, value: &str) -> (i32, String) {
        (code, value.to_string())
    }

    /// A BLOCK ... ENDBLK definition with the given base point and contents.
    fn block(
        name: &str,
        base: (&str, &str),
        contents: Vec<Vec<(i32, String)>>,
    ) -> Vec<(i32, String)> {
        let mut out = vec![
            pair(0, "BLOCK"),
            pair(2, name),
            pair(70, "0"),
            pair(10, base.0),
            pair(20, base.1),
            pair(30, "0"),
            pair(3, name),
        ];
        out.extend(contents.into_iter().flatten());
        out.push(pair(0, "ENDBLK"));
        out
    }

    fn insert(name: &str, x: &str, y: &str) -> Vec<(i32, String)> {
        vec![pair(0, "INSERT"), pair(2, name), pair(10, x), pair(20, y)]
    }

    /// An INSERT with a scale (x, y) and a rotation in degrees.
    fn insert_scaled(
        name: &str,
        at: (&str, &str),
        scale: (&str, &str),
        angle: &str,
    ) -> Vec<(i32, String)> {
        let mut v = insert(name, at.0, at.1);
        v.extend([pair(41, scale.0), pair(42, scale.1), pair(50, angle)]);
        v
    }

    /// A closed 10 x 10 square from (x, y), as a closed LWPOLYLINE.
    fn square(x: f64, y: f64) -> Vec<(i32, String)> {
        let corners = [(x, y), (x + 10.0, y), (x + 10.0, y + 10.0), (x, y + 10.0)];
        let mut v = vec![pair(0, "LWPOLYLINE"), pair(70, "1")];
        for (cx, cy) in corners {
            v.push(pair(10, &cx.to_string()));
            v.push(pair(20, &cy.to_string()));
        }
        v
    }

    fn circle(radius: &str) -> Vec<(i32, String)> {
        vec![
            pair(0, "CIRCLE"),
            pair(10, "0"),
            pair(20, "0"),
            pair(40, radius),
        ]
    }

    /// A DXF with a BLOCKS section and an ENTITIES section, in the given $INSUNITS.
    fn doc_with_blocks_in(
        units: &str,
        blocks: Vec<Vec<(i32, String)>>,
        ents: Vec<Vec<(i32, String)>>,
    ) -> String {
        let mut s = String::new();
        let mut add = |pairs: &[(i32, String)]| {
            for (c, v) in pairs {
                s.push_str(&format!("{c}\n{v}\n"));
            }
        };
        add(&[
            pair(0, "SECTION"),
            pair(2, "HEADER"),
            pair(9, "$INSUNITS"),
            pair(70, units),
            pair(0, "ENDSEC"),
            pair(0, "SECTION"),
            pair(2, "BLOCKS"),
        ]);
        for b in &blocks {
            add(b.as_slice());
        }
        add(&[pair(0, "ENDSEC"), pair(0, "SECTION"), pair(2, "ENTITIES")]);
        for e in &ents {
            add(e.as_slice());
        }
        add(&[pair(0, "ENDSEC"), pair(0, "EOF")]);
        s
    }

    fn doc_with_blocks(blocks: Vec<Vec<(i32, String)>>, ents: Vec<Vec<(i32, String)>>) -> String {
        doc_with_blocks_in("4", blocks, ents)
    }

    /// The smallest box around all the paths: (min x, min y, max x, max y).
    fn extent(paths: &[Path2D]) -> (f64, f64, f64, f64) {
        let mut e = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for p in paths {
            for q in &p.points {
                e = (e.0.min(q.x), e.1.min(q.y), e.2.max(q.x), e.3.max(q.y));
            }
        }
        e
    }

    fn near(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn insert_places_a_copy_of_the_block_at_the_insertion_point() {
        let d = doc_with_blocks(
            vec![block("SQ", ("0", "0"), vec![square(0.0, 0.0)])],
            vec![insert("SQ", "100", "50")],
        );
        let r = parse_dxf(&d).unwrap();
        assert_eq!(r.paths.len(), 1);
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
        assert!(r.paths[0].closed);
        // Y is mirrored on import: DXF y 50..60 becomes -60..-50.
        let (x0, y0, x1, y1) = extent(&r.paths);
        assert!(near(x0, 100.0) && near(x1, 110.0) && near(y0, -60.0) && near(y1, -50.0));
    }

    #[test]
    fn the_base_point_of_the_block_lands_on_the_insertion_point() {
        // The square is drawn at 5..15 with its base point at (5, 5), so it is placed from 100.
        let d = doc_with_blocks(
            vec![block("SQ", ("5", "5"), vec![square(5.0, 5.0)])],
            vec![insert("SQ", "100", "50")],
        );
        let (x0, _, x1, _) = extent(&parse_dxf(&d).unwrap().paths);
        assert!(near(x0, 100.0) && near(x1, 110.0), "{x0} {x1}");
    }

    #[test]
    fn block_names_are_not_case_sensitive() {
        let d = doc_with_blocks(
            vec![block("Bolt", ("0", "0"), vec![square(0.0, 0.0)])],
            vec![insert("BOLT", "0", "0"), insert("bolt", "50", "0")],
        );
        let r = parse_dxf(&d).unwrap();
        assert_eq!(r.paths.len(), 2);
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
    }

    #[test]
    fn scale_and_rotation_are_applied_in_that_order() {
        // A line 10 long, scaled by 2 (20 long) and turned 90 degrees anticlockwise (DXF is Y-up):
        // it points straight up, so after the mirror it runs from y = 0 to y = -20.
        let d = doc_with_blocks(
            vec![block("BAR", ("0", "0"), vec![line("0", "0", "10", "0")])],
            vec![insert_scaled("BAR", ("0", "0"), ("2", "2"), "90")],
        );
        let (x0, y0, x1, y1) = extent(&parse_dxf(&d).unwrap().paths);
        assert!(near(x0, 0.0) && near(x1, 0.0), "{x0} {x1}");
        assert!(near(y0, -20.0) && near(y1, 0.0), "{y0} {y1}");
    }

    #[test]
    fn a_negative_scale_mirrors_the_block() {
        let d = doc_with_blocks(
            vec![block("BAR", ("0", "0"), vec![line("0", "0", "10", "0")])],
            vec![insert_scaled("BAR", ("0", "0"), ("-1", "1"), "0")],
        );
        let (x0, _, x1, _) = extent(&parse_dxf(&d).unwrap().paths);
        assert!(near(x0, -10.0) && near(x1, 0.0), "{x0} {x1}");
    }

    #[test]
    fn an_uneven_scale_stretches_a_circle_into_an_ellipse() {
        let d = doc_with_blocks(
            vec![block("DISC", ("0", "0"), vec![circle("5")])],
            vec![insert_scaled("DISC", ("0", "0"), ("2", "1"), "0")],
        );
        let r = parse_dxf(&d).unwrap();
        assert_eq!(r.paths.len(), 1);
        assert!(r.paths[0].closed);
        let b = r.paths[0].bounding_box().unwrap();
        assert!((b.width() - 20.0).abs() < 0.2, "{}", b.width());
        assert!((b.height() - 10.0).abs() < 0.2, "{}", b.height());
    }

    #[test]
    fn a_scaled_up_circle_is_as_smooth_as_one_drawn_at_full_size() {
        let direct = parse_dxf(&doc(MM, vec![circle("100")])).unwrap();
        let scaled = parse_dxf(&doc_with_blocks(
            vec![block("DISC", ("0", "0"), vec![circle("1")])],
            vec![insert_scaled("DISC", ("0", "0"), ("100", "100"), "0")],
        ))
        .unwrap();
        let (a, b) = (direct.paths[0].points.len(), scaled.paths[0].points.len());
        assert!(a > 50, "{a}");
        assert!(
            b * 10 >= a * 9,
            "scaled {b} points against {a} drawn directly"
        );
    }

    #[test]
    fn blocks_inside_blocks_are_placed_through_every_level() {
        let d = doc_with_blocks(
            vec![
                block("INNER", ("0", "0"), vec![line("0", "0", "5", "0")]),
                block("OUTER", ("0", "0"), vec![insert("INNER", "10", "0")]),
            ],
            vec![insert("OUTER", "100", "0")],
        );
        let r = parse_dxf(&d).unwrap();
        assert_eq!(r.paths.len(), 1);
        let (x0, _, x1, _) = extent(&r.paths);
        assert!(near(x0, 110.0) && near(x1, 115.0), "{x0} {x1}");
    }

    #[test]
    fn a_nested_block_is_scaled_and_turned_with_the_block_around_it() {
        // INNER puts a 5 long line at x = 10. OUTER is inserted at 100, doubled and turned 90 degrees:
        // the line ends up 10 long and runs up from (100, 20).
        let d = doc_with_blocks(
            vec![
                block("INNER", ("0", "0"), vec![line("0", "0", "5", "0")]),
                block("OUTER", ("0", "0"), vec![insert("INNER", "10", "0")]),
            ],
            vec![insert_scaled("OUTER", ("100", "0"), ("2", "2"), "90")],
        );
        let (x0, y0, x1, y1) = extent(&parse_dxf(&d).unwrap().paths);
        assert!(near(x0, 100.0) && near(x1, 100.0), "{x0} {x1}");
        // DXF y 20..30 becomes -30..-20.
        assert!(near(y0, -30.0) && near(y1, -20.0), "{y0} {y1}");
    }

    #[test]
    fn an_array_places_a_grid_of_copies() {
        let mut array = insert("SQ", "0", "0");
        array.extend([pair(70, "3"), pair(71, "2"), pair(44, "20"), pair(45, "15")]);
        let d = doc_with_blocks(
            vec![block("SQ", ("0", "0"), vec![square(0.0, 0.0)])],
            vec![array],
        );
        let r = parse_dxf(&d).unwrap();
        assert_eq!(r.paths.len(), 6);
        let (x0, y0, x1, y1) = extent(&r.paths);
        // Three columns 20 apart and two rows 15 apart, each square 10 across.
        assert!(near(x0, 0.0) && near(x1, 50.0), "{x0} {x1}");
        assert!(near(y0, -25.0) && near(y1, 0.0), "{y0} {y1}");
    }

    #[test]
    fn an_array_turns_with_the_insert() {
        let mut array = insert_scaled("SQ", ("0", "0"), ("1", "1"), "90");
        array.extend([pair(70, "3"), pair(71, "2"), pair(44, "20"), pair(45, "15")]);
        let d = doc_with_blocks(
            vec![block("SQ", ("0", "0"), vec![square(0.0, 0.0)])],
            vec![array],
        );
        let r = parse_dxf(&d).unwrap();
        assert_eq!(r.paths.len(), 6);
        let (x0, y0, x1, y1) = extent(&r.paths);
        // Columns now run up and rows run left: 25 across and 50 up.
        assert!((x0 + 25.0).abs() < 1e-6 && x1.abs() < 1e-6, "{x0} {x1}");
        assert!((y0 + 50.0).abs() < 1e-6 && y1.abs() < 1e-6, "{y0} {y1}");
    }

    #[test]
    fn units_still_apply_to_what_blocks_place() {
        // Inches: a 1 inch line inserted 1 inch along runs from 25.4 to 50.8 mm.
        let d = doc_with_blocks_in(
            "1",
            vec![block("BAR", ("0", "0"), vec![line("0", "0", "1", "0")])],
            vec![insert("BAR", "1", "0")],
        );
        let (x0, _, x1, _) = extent(&parse_dxf(&d).unwrap().paths);
        assert!(
            (x0 - 25.4).abs() < 1e-9 && (x1 - 50.8).abs() < 1e-9,
            "{x0} {x1}"
        );
    }

    #[test]
    fn an_insert_of_a_block_that_is_not_there_warns_and_draws_nothing_extra() {
        let d = doc_with_blocks(
            vec![],
            vec![insert("NOPE", "0", "0"), line("0", "0", "1", "0")],
        );
        let r = parse_dxf(&d).unwrap();
        assert_eq!(r.paths.len(), 1);
        assert!(
            r.warnings.iter().any(|w| w.contains("NOPE")),
            "{:?}",
            r.warnings
        );
        // A file with no BLOCKS section at all behaves the same.
        let r = parse_dxf(&doc(MM, vec![insert("NOPE", "0", "0")])).unwrap();
        assert!(r.paths.is_empty());
        assert!(
            r.warnings.iter().any(|w| w.contains("NOPE")),
            "{:?}",
            r.warnings
        );
    }

    #[test]
    fn a_block_that_contains_itself_is_not_followed_forever() {
        let d = doc_with_blocks(
            vec![block(
                "LOOP",
                ("0", "0"),
                vec![line("0", "0", "10", "0"), insert("LOOP", "20", "0")],
            )],
            vec![insert("LOOP", "0", "0")],
        );
        let r = parse_dxf(&d).unwrap();
        assert_eq!(r.paths.len(), 1);
        assert!(
            r.warnings.iter().any(|w| w.contains("contains itself")),
            "{:?}",
            r.warnings
        );
    }

    #[test]
    fn two_blocks_that_insert_each_other_stop() {
        let d = doc_with_blocks(
            vec![
                block(
                    "A",
                    ("0", "0"),
                    vec![square(0.0, 0.0), insert("B", "20", "0")],
                ),
                block("B", ("0", "0"), vec![insert("A", "20", "0")]),
            ],
            vec![insert("A", "0", "0")],
        );
        let r = parse_dxf(&d).unwrap();
        assert!(
            !r.paths.is_empty() && r.paths.len() < 10,
            "{}",
            r.paths.len()
        );
        assert!(
            r.warnings.iter().any(|w| w.contains("contains itself")),
            "{:?}",
            r.warnings
        );
    }

    #[test]
    fn a_flipped_extrusion_axis_is_placed_as_usual_but_warned_about() {
        let mut flipped = insert("SQ", "0", "0");
        flipped.extend([pair(210, "0"), pair(220, "0"), pair(230, "-1")]);
        let d = doc_with_blocks(
            vec![block("SQ", ("0", "0"), vec![square(0.0, 0.0)])],
            vec![flipped, insert_scaled("SQ", ("50", "0"), ("1", "1"), "0")],
        );
        let r = parse_dxf(&d).unwrap();
        assert_eq!(r.paths.len(), 2);
        assert_eq!(
            r.warnings
                .iter()
                .filter(|w| w.contains("extrusion"))
                .count(),
            1
        );
    }

    #[test]
    fn a_zero_scale_is_skipped_with_a_warning() {
        let d = doc_with_blocks(
            vec![block("SQ", ("0", "0"), vec![square(0.0, 0.0)])],
            vec![insert_scaled("SQ", ("0", "0"), ("0", "1"), "0")],
        );
        let r = parse_dxf(&d).unwrap();
        assert!(r.paths.is_empty());
        assert!(
            r.warnings.iter().any(|w| w.contains("zero scale")),
            "{:?}",
            r.warnings
        );
    }

    #[test]
    fn nested_blocks_that_multiply_are_capped_rather_than_filling_the_computer() {
        // Each block inserts the one below it ten times: eight levels would be a hundred million
        // copies.
        let mut blocks = vec![block("B0", ("0", "0"), vec![square(0.0, 0.0)])];
        for level in 1..=8 {
            let below = format!("B{}", level - 1);
            let inserts = (0..10)
                .map(|i| insert(&below, &(i * 11).to_string(), "0"))
                .collect();
            blocks.push(block(&format!("B{level}"), ("0", "0"), inserts));
        }
        let d = doc_with_blocks(blocks, vec![insert("B8", "0", "0")]);
        let r = parse_dxf(&d).unwrap();
        assert!(r.paths.len() <= MAX_INSERT_PATHS, "{}", r.paths.len());
        assert!(
            r.warnings.iter().any(|w| w.contains("Too many")),
            "{:?}",
            r.warnings
        );
    }

    #[test]
    fn a_huge_array_is_refused_instead_of_allocated() {
        let mut array = insert("SQ", "0", "0");
        array.extend([
            pair(70, "100000"),
            pair(71, "100000"),
            pair(44, "11"),
            pair(45, "11"),
        ]);
        let d = doc_with_blocks(
            vec![block("SQ", ("0", "0"), vec![square(0.0, 0.0)])],
            vec![array],
        );
        let r = parse_dxf(&d).unwrap();
        assert!(r.paths.is_empty());
        assert!(
            r.warnings.iter().any(|w| w.contains("Too many")),
            "{:?}",
            r.warnings
        );
    }

    #[test]
    fn missing_entities_section_is_an_error() {
        let d = "0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n";
        assert!(parse_dxf(d).is_err());
    }

    #[test]
    fn crlf_line_endings_are_accepted() {
        let d = doc(MM, vec![line("0", "0", "10", "0")]).replace('\n', "\r\n");
        assert_eq!(parse_dxf(&d).unwrap().paths.len(), 1);
    }
}
