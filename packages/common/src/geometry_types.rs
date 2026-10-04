//! Fundamental 2D geometry primitives shared by every MakerLaser crate.
//!
//! # Coordinate convention
//!
//! * Units are **millimetres**.
//! * The *workspace* is **Y-down with its origin at the top-left corner of the bed**,
//!   exactly as it is drawn on screen and as SVG defines it.
//! * Conversion to machine coordinates happens in exactly one place:
//!   [`crate::machine::MachineProfile::workspace_to_machine`]. Nothing else may flip axes.

use serde::{Deserialize, Serialize};

/// A point in workspace coordinates (millimetres).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point2 {
    pub x: f64,
    pub y: f64,
}

impl Point2 {
    pub const ZERO: Point2 = Point2 { x: 0.0, y: 0.0 };

    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn distance_to(&self, other: &Point2) -> f64 {
        ((self.x - other.x).powi(2) + (self.y - other.y).powi(2)).sqrt()
    }

    pub fn lerp(&self, other: &Point2, t: f64) -> Point2 {
        Point2 {
            x: self.x + (other.x - self.x) * t,
            y: self.y + (other.y - self.y) * t,
        }
    }

    pub fn is_finite(&self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
}

/// An axis-aligned bounding box.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BoundingBox {
    pub min: Point2,
    pub max: Point2,
}

impl BoundingBox {
    pub fn from_points<'a, I: IntoIterator<Item = &'a Point2>>(points: I) -> Option<Self> {
        let mut iter = points.into_iter();
        let first = iter.next()?;
        let mut bbox = BoundingBox {
            min: *first,
            max: *first,
        };
        for p in iter {
            bbox.expand(p);
        }
        Some(bbox)
    }

    pub fn expand(&mut self, p: &Point2) {
        self.min.x = self.min.x.min(p.x);
        self.min.y = self.min.y.min(p.y);
        self.max.x = self.max.x.max(p.x);
        self.max.y = self.max.y.max(p.y);
    }

    pub fn union(&self, other: &BoundingBox) -> BoundingBox {
        BoundingBox {
            min: Point2::new(self.min.x.min(other.min.x), self.min.y.min(other.min.y)),
            max: Point2::new(self.max.x.max(other.max.x), self.max.y.max(other.max.y)),
        }
    }

    pub fn width(&self) -> f64 {
        self.max.x - self.min.x
    }

    pub fn height(&self) -> f64 {
        self.max.y - self.min.y
    }

    /// True when `other` lies entirely inside (or on the edge of) this box.
    pub fn contains_box(&self, other: &BoundingBox) -> bool {
        other.min.x >= self.min.x
            && other.min.y >= self.min.y
            && other.max.x <= self.max.x
            && other.max.y <= self.max.y
    }

    /// True when this box fits inside `bed`, allowing `tolerance_mm` of float slack.
    pub fn fits_within(&self, bed: &BoundingBox, tolerance_mm: f64) -> bool {
        self.min.x >= bed.min.x - tolerance_mm
            && self.min.y >= bed.min.y - tolerance_mm
            && self.max.x <= bed.max.x + tolerance_mm
            && self.max.y <= bed.max.y + tolerance_mm
    }
}

/// A 2D affine transform `[a b c d e f]` applied as:
///
/// ```text
/// x' = a*x + c*y + e
/// y' = b*x + d*y + f
/// ```
///
/// This is SVG's `matrix()` convention. In the Y-down workspace a positive rotation
/// angle turns the artwork **clockwise** on screen.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Transform2D {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Default for Transform2D {
    fn default() -> Self {
        Self::IDENTITY
    }
}

impl Transform2D {
    pub const IDENTITY: Transform2D = Transform2D {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: 0.0,
        f: 0.0,
    };

    pub fn translate(tx: f64, ty: f64) -> Self {
        Transform2D {
            e: tx,
            f: ty,
            ..Self::IDENTITY
        }
    }

    pub fn scale(sx: f64, sy: f64) -> Self {
        Transform2D {
            a: sx,
            d: sy,
            ..Self::IDENTITY
        }
    }

    /// Rotation by `degrees` about the origin (clockwise on screen in the Y-down workspace).
    pub fn rotate_deg(degrees: f64) -> Self {
        let r = degrees.to_radians();
        Transform2D {
            a: r.cos(),
            b: r.sin(),
            c: -r.sin(),
            d: r.cos(),
            e: 0.0,
            f: 0.0,
        }
    }

    /// Composition: a point is transformed by `self` first, then by `other`.
    pub fn then(&self, other: &Transform2D) -> Transform2D {
        Transform2D {
            a: other.a * self.a + other.c * self.b,
            b: other.b * self.a + other.d * self.b,
            c: other.a * self.c + other.c * self.d,
            d: other.b * self.c + other.d * self.d,
            e: other.a * self.e + other.c * self.f + other.e,
            f: other.b * self.e + other.d * self.f + other.f,
        }
    }

    pub fn apply(&self, p: Point2) -> Point2 {
        Point2 {
            x: self.a * p.x + self.c * p.y + self.e,
            y: self.b * p.x + self.d * p.y + self.f,
        }
    }

    pub fn inverse(&self) -> Option<Transform2D> {
        let det = self.a * self.d - self.b * self.c;
        if det.abs() < 1e-12 || !det.is_finite() {
            return None;
        }
        let inv = 1.0 / det;
        let a = self.d * inv;
        let b = -self.b * inv;
        let c = -self.c * inv;
        let d = self.a * inv;
        let e = -(a * self.e + c * self.f);
        let f = -(b * self.e + d * self.f);
        Some(Transform2D { a, b, c, d, e, f })
    }

    pub fn is_finite(&self) -> bool {
        [self.a, self.b, self.c, self.d, self.e, self.f]
            .iter()
            .all(|v| v.is_finite())
    }
}

/// A polyline produced by flattening vector geometry at import time. Downstream stages
/// (CAM, toolpath, G-code) therefore only ever see straight segments.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Path2D {
    pub points: Vec<Point2>,
    /// When true the last point is implicitly connected back to the first.
    pub closed: bool,
}

impl Path2D {
    pub fn new(points: Vec<Point2>, closed: bool) -> Self {
        Self { points, closed }
    }

    pub fn is_empty(&self) -> bool {
        self.points.len() < 2
    }

    pub fn bounding_box(&self) -> Option<BoundingBox> {
        BoundingBox::from_points(&self.points)
    }

    pub fn length(&self) -> f64 {
        if self.points.len() < 2 {
            return 0.0;
        }
        let mut total: f64 = self
            .points
            .windows(2)
            .map(|w| w[0].distance_to(&w[1]))
            .sum();
        if self.closed {
            total += self.points[self.points.len() - 1].distance_to(&self.points[0]);
        }
        total
    }

    /// Signed shoelace area (sign depends on winding and on the axis orientation).
    pub fn signed_area(&self) -> f64 {
        let n = self.points.len();
        if n < 3 {
            return 0.0;
        }
        let mut sum = 0.0;
        for i in 0..n {
            let p0 = self.points[i];
            let p1 = self.points[(i + 1) % n];
            sum += p0.x * p1.y - p1.x * p0.y;
        }
        sum * 0.5
    }

    pub fn area(&self) -> f64 {
        self.signed_area().abs()
    }

    pub fn transformed(&self, t: &Transform2D) -> Path2D {
        Path2D {
            points: self.points.iter().map(|p| t.apply(*p)).collect(),
            closed: self.closed,
        }
    }

    /// Removes consecutive (and, for closed paths, wrap-around) duplicate points.
    pub fn dedup(&mut self, tolerance: f64) {
        let mut out: Vec<Point2> = Vec::with_capacity(self.points.len());
        for p in self.points.drain(..) {
            match out.last() {
                Some(last) if last.distance_to(&p) <= tolerance => {}
                _ => out.push(p),
            }
        }
        if self.closed && out.len() > 1 && out[0].distance_to(&out[out.len() - 1]) <= tolerance {
            out.pop();
        }
        self.points = out;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn then_applies_self_first() {
        let t = Transform2D::translate(10.0, 0.0).then(&Transform2D::scale(2.0, 2.0));
        let p = t.apply(Point2::new(1.0, 1.0));
        assert!((p.x - 22.0).abs() < 1e-9 && (p.y - 2.0).abs() < 1e-9);
    }

    #[test]
    fn rotation_is_clockwise_on_screen_in_y_down_space() {
        // +X unit vector rotated by +90 deg must end up pointing down the screen (+Y).
        let p = Transform2D::rotate_deg(90.0).apply(Point2::new(1.0, 0.0));
        assert!(p.x.abs() < 1e-9 && (p.y - 1.0).abs() < 1e-9);
    }

    #[test]
    fn inverse_round_trips() {
        let t = Transform2D::translate(5.0, -3.0)
            .then(&Transform2D::rotate_deg(37.0))
            .then(&Transform2D::scale(2.0, 0.5));
        let inv = t.inverse().expect("invertible");
        let p = Point2::new(3.25, 2.5);
        let q = inv.apply(t.apply(p));
        assert!((q.x - p.x).abs() < 1e-9 && (q.y - p.y).abs() < 1e-9);
    }

    #[test]
    fn singular_transform_has_no_inverse() {
        assert!(Transform2D::scale(0.0, 1.0).inverse().is_none());
    }

    #[test]
    fn fits_within_uses_tolerance() {
        let bed = BoundingBox {
            min: Point2::ZERO,
            max: Point2::new(300.0, 300.0),
        };
        let edge = BoundingBox {
            min: Point2::new(-0.004, 0.0),
            max: Point2::new(300.004, 10.0),
        };
        assert!(edge.fits_within(&bed, 0.01));
        assert!(!edge.fits_within(&bed, 0.0));
    }

    #[test]
    fn dedup_removes_closing_duplicate() {
        let mut p = Path2D::new(
            vec![
                Point2::new(0.0, 0.0),
                Point2::new(1.0, 0.0),
                Point2::new(1.0, 1.0),
                Point2::new(0.0, 0.0),
            ],
            true,
        );
        p.dedup(1e-9);
        assert_eq!(p.points.len(), 3);
    }

    #[test]
    fn square_area() {
        let sq = Path2D::new(
            vec![
                Point2::new(0.0, 0.0),
                Point2::new(4.0, 0.0),
                Point2::new(4.0, 4.0),
                Point2::new(0.0, 4.0),
            ],
            true,
        );
        assert!((sq.area() - 16.0).abs() < 1e-9);
    }
}
