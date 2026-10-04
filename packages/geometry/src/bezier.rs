//! Flattening of Beziers and elliptical arcs into polylines. Every importer goes through
//! here so the rest of the pipeline only ever sees straight segments.

use makerlaser_common::Point2;

const MAX_DEPTH: u32 = 16;

/// Appends the flattened cubic (including both end points) to `out`.
pub fn flatten_cubic_bezier(
    p0: Point2,
    p1: Point2,
    p2: Point2,
    p3: Point2,
    tolerance: f64,
    out: &mut Vec<Point2>,
) {
    out.push(p0);
    subdivide_cubic(p0, p1, p2, p3, tolerance, 0, out);
    out.push(p3);
}

fn subdivide_cubic(
    p0: Point2,
    p1: Point2,
    p2: Point2,
    p3: Point2,
    tolerance: f64,
    depth: u32,
    out: &mut Vec<Point2>,
) {
    let flat = point_line_distance(p1, p0, p3) <= tolerance
        && point_line_distance(p2, p0, p3) <= tolerance;
    if depth >= MAX_DEPTH || flat {
        return;
    }
    let p01 = p0.lerp(&p1, 0.5);
    let p12 = p1.lerp(&p2, 0.5);
    let p23 = p2.lerp(&p3, 0.5);
    let p012 = p01.lerp(&p12, 0.5);
    let p123 = p12.lerp(&p23, 0.5);
    let mid = p012.lerp(&p123, 0.5);
    subdivide_cubic(p0, p01, p012, mid, tolerance, depth + 1, out);
    out.push(mid);
    subdivide_cubic(mid, p123, p23, p3, tolerance, depth + 1, out);
}

fn point_line_distance(p: Point2, a: Point2, b: Point2) -> f64 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len = (dx * dx + dy * dy).sqrt();
    if len < 1e-12 {
        return p.distance_to(&a);
    }
    ((p.x - a.x) * dy - (p.y - a.y) * dx).abs() / len
}

/// Quadratic Bezier via exact degree elevation to a cubic.
pub fn flatten_quadratic_bezier(
    p0: Point2,
    p1: Point2,
    p2: Point2,
    tolerance: f64,
    out: &mut Vec<Point2>,
) {
    let c1 = Point2::new(
        p0.x + 2.0 / 3.0 * (p1.x - p0.x),
        p0.y + 2.0 / 3.0 * (p1.y - p0.y),
    );
    let c2 = Point2::new(
        p2.x + 2.0 / 3.0 * (p1.x - p2.x),
        p2.y + 2.0 / 3.0 * (p1.y - p2.y),
    );
    flatten_cubic_bezier(p0, c1, c2, p2, tolerance, out);
}

/// Number of segments needed so the chord error stays below `tolerance`.
pub fn arc_steps(radius: f64, sweep_rad: f64, tolerance: f64) -> u32 {
    let sweep = sweep_rad.abs();
    if radius <= tolerance || radius <= 0.0 {
        return 8;
    }
    let max_step = 2.0 * (1.0 - tolerance / radius).clamp(-1.0, 1.0).acos();
    let max_step = if max_step < 1e-6 { 0.05 } else { max_step };
    ((sweep / max_step).ceil() as u32).clamp(2, 2048)
}

/// Points along an ellipse arc, **including both end points**.
///
/// `P(t) = centre + R(rot) * (rx cos t, ry sin t)`, for `t` from `start` to
/// `start + sweep` (radians; the sign of `sweep` gives the direction).
#[allow(clippy::too_many_arguments)]
pub fn arc_points(
    cx: f64,
    cy: f64,
    rx: f64,
    ry: f64,
    rot_rad: f64,
    start: f64,
    sweep: f64,
    tolerance: f64,
    out: &mut Vec<Point2>,
) {
    let n = arc_steps(rx.max(ry), sweep, tolerance);
    let (sin_r, cos_r) = rot_rad.sin_cos();
    for i in 0..=n {
        let t = start + sweep * (i as f64 / n as f64);
        let (sin_t, cos_t) = t.sin_cos();
        let x = rx * cos_t;
        let y = ry * sin_t;
        out.push(Point2::new(
            cx + x * cos_r - y * sin_r,
            cy + x * sin_r + y * cos_r,
        ));
    }
}

/// SVG endpoint-parameterised elliptical arc (the `A` path command), SVG 1.1 section F.6.
/// Appends the points *after* `start`, ending exactly on `end`.
#[allow(clippy::too_many_arguments)]
pub fn flatten_svg_arc(
    start: Point2,
    end: Point2,
    rx: f64,
    ry: f64,
    x_axis_rotation_deg: f64,
    large_arc: bool,
    sweep: bool,
    tolerance: f64,
    out: &mut Vec<Point2>,
) {
    if start.distance_to(&end) < 1e-12 {
        return;
    }
    let mut rx = rx.abs();
    let mut ry = ry.abs();
    if rx < 1e-12 || ry < 1e-12 {
        out.push(end);
        return;
    }
    let phi = x_axis_rotation_deg.to_radians();
    let (sin_phi, cos_phi) = phi.sin_cos();

    let dx2 = (start.x - end.x) / 2.0;
    let dy2 = (start.y - end.y) / 2.0;
    let x1p = cos_phi * dx2 + sin_phi * dy2;
    let y1p = -sin_phi * dx2 + cos_phi * dy2;

    let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if lambda > 1.0 {
        let s = lambda.sqrt();
        rx *= s;
        ry *= s;
    }

    let sign = if large_arc == sweep { -1.0 } else { 1.0 };
    let num = (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p).max(0.0);
    let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let co = if den.abs() < 1e-12 {
        0.0
    } else {
        sign * (num / den).sqrt()
    };
    let cxp = co * (rx * y1p) / ry;
    let cyp = -co * (ry * x1p) / rx;

    let cx = cos_phi * cxp - sin_phi * cyp + (start.x + end.x) / 2.0;
    let cy = sin_phi * cxp + cos_phi * cyp + (start.y + end.y) / 2.0;

    let ux = (x1p - cxp) / rx;
    let uy = (y1p - cyp) / ry;
    let vx = (-x1p - cxp) / rx;
    let vy = (-y1p - cyp) / ry;

    let theta1 = angle_between(1.0, 0.0, ux, uy);
    let mut delta = angle_between(ux, uy, vx, vy);
    if !sweep && delta > 0.0 {
        delta -= 2.0 * std::f64::consts::PI;
    } else if sweep && delta < 0.0 {
        delta += 2.0 * std::f64::consts::PI;
    }

    let mut pts = Vec::new();
    arc_points(cx, cy, rx, ry, phi, theta1, delta, tolerance, &mut pts);
    // Skip the start point (already in the path) and land exactly on `end`.
    let count = pts.len();
    for (i, p) in pts.into_iter().enumerate().skip(1) {
        out.push(if i + 1 == count { end } else { p });
    }
}

fn angle_between(ux: f64, uy: f64, vx: f64, vy: f64) -> f64 {
    let dot = ux * vx + uy * vy;
    let len = ((ux * ux + uy * uy) * (vx * vx + vy * vy)).sqrt();
    if len < 1e-18 {
        return 0.0;
    }
    let mut a = (dot / len).clamp(-1.0, 1.0).acos();
    if ux * vy - uy * vx < 0.0 {
        a = -a;
    }
    a
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cubic_keeps_endpoints_and_subdivides_curves() {
        let mut out = Vec::new();
        flatten_cubic_bezier(
            Point2::new(0.0, 0.0),
            Point2::new(0.0, 10.0),
            Point2::new(10.0, 10.0),
            Point2::new(10.0, 0.0),
            0.01,
            &mut out,
        );
        assert_eq!(out[0], Point2::new(0.0, 0.0));
        assert_eq!(*out.last().unwrap(), Point2::new(10.0, 0.0));
        assert!(out.len() > 4);
    }

    #[test]
    fn straight_cubic_is_not_subdivided() {
        let mut out = Vec::new();
        flatten_cubic_bezier(
            Point2::new(0.0, 0.0),
            Point2::new(3.0, 0.0),
            Point2::new(6.0, 0.0),
            Point2::new(10.0, 0.0),
            0.01,
            &mut out,
        );
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn quarter_circle_arc_stays_on_the_circle_and_ends_exactly() {
        let mut out = Vec::new();
        let end = Point2::new(0.0, 10.0);
        flatten_svg_arc(
            Point2::new(10.0, 0.0),
            end,
            10.0,
            10.0,
            0.0,
            false,
            true,
            0.02,
            &mut out,
        );
        assert_eq!(*out.last().unwrap(), end);
        for p in &out {
            assert!(((p.x * p.x + p.y * p.y).sqrt() - 10.0).abs() < 0.03);
        }
    }

    #[test]
    fn arc_points_cover_a_full_circle() {
        let mut out = Vec::new();
        arc_points(
            0.0,
            0.0,
            5.0,
            5.0,
            0.0,
            0.0,
            2.0 * std::f64::consts::PI,
            0.01,
            &mut out,
        );
        assert!(out.len() > 16);
        assert!(out[0].distance_to(out.last().unwrap()) < 1e-9);
    }

    #[test]
    fn chord_error_is_within_tolerance() {
        let (r, tol) = (50.0, 0.02);
        let n = arc_steps(r, 2.0 * std::f64::consts::PI, tol) as f64;
        let sagitta = r * (1.0 - (std::f64::consts::PI / n).cos());
        assert!(sagitta <= tol + 1e-9, "sagitta {sagitta}");
    }
}
