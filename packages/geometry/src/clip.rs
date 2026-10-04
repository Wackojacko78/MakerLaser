//! The ONLY module that touches the `clipper2` crate. Everything else in MakerLaser goes
//! through these functions, so an API change in a future `clipper2` release is a
//! one-file fix.
//!
//! Note: the crate's default point scaler works at 0.01 unit precision, i.e. results are
//! snapped to a 0.01 mm grid, which is well below laser kerf and positioning accuracy.

pub use clipper2::JoinType;
use clipper2::{EndType, FillRule, Paths};
use makerlaser_common::{Path2D, Point2};

use crate::error::{GeometryError, Result};

fn to_paths(paths: &[Path2D]) -> Paths {
    let raw: Vec<Vec<(f64, f64)>> = paths
        .iter()
        .filter(|p| p.points.len() >= 3)
        .map(|p| p.points.iter().map(|q| (q.x, q.y)).collect())
        .collect();
    raw.into()
}

fn from_paths(paths: Paths) -> Vec<Path2D> {
    let raw: Vec<Vec<(f64, f64)>> = paths.into();
    raw.into_iter()
        .filter(|pts| pts.len() >= 3)
        .map(|pts| {
            Path2D::new(
                pts.into_iter().map(|(x, y)| Point2::new(x, y)).collect(),
                true,
            )
        })
        .collect()
}

fn op_error<E: std::fmt::Debug>(e: E) -> GeometryError {
    GeometryError::BooleanOpFailed(format!("{e:?}"))
}

/// Union of two sets of closed paths.
pub fn union(a: &[Path2D], b: &[Path2D]) -> Result<Vec<Path2D>> {
    let out = to_paths(a)
        .to_clipper_subject()
        .add_clip(to_paths(b))
        .union(FillRule::default())
        .map_err(op_error)?;
    Ok(from_paths(out))
}

/// `a` minus `b`.
pub fn difference(a: &[Path2D], b: &[Path2D]) -> Result<Vec<Path2D>> {
    let out = to_paths(a)
        .to_clipper_subject()
        .add_clip(to_paths(b))
        .difference(FillRule::default())
        .map_err(op_error)?;
    Ok(from_paths(out))
}

/// Overlap of `a` and `b`.
pub fn intersect(a: &[Path2D], b: &[Path2D]) -> Result<Vec<Path2D>> {
    let out = to_paths(a)
        .to_clipper_subject()
        .add_clip(to_paths(b))
        .intersect(FillRule::default())
        .map_err(op_error)?;
    Ok(from_paths(out))
}

/// Regions covered by exactly one of `a` or `b`.
pub fn xor(a: &[Path2D], b: &[Path2D]) -> Result<Vec<Path2D>> {
    let out = to_paths(a)
        .to_clipper_subject()
        .add_clip(to_paths(b))
        .xor(FillRule::default())
        .map_err(op_error)?;
    Ok(from_paths(out))
}

/// Raw offset of a set of closed paths by `delta_mm` using Clipper2's own orientation
/// handling. Callers that need a guaranteed grow/shrink direction should use
/// [`crate::offset::offset_path`], which verifies the result.
pub fn inflate(paths: &[Path2D], delta_mm: f64, join: JoinType) -> Vec<Path2D> {
    // The kerf pipeline always offsets one path at a time. A single path is converted with
    // `Vec<(f64, f64)> -> Paths`, the exact form shown in the clipper2 documentation.
    let input: Paths = match paths {
        [only] if only.points.len() >= 3 => {
            let single: Vec<(f64, f64)> = only.points.iter().map(|q| (q.x, q.y)).collect();
            single.into()
        }
        _ => to_paths(paths),
    };
    from_paths(input.inflate(delta_mm, join, EndType::Polygon, 2.0))
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn union_merges_overlapping_squares() {
        let r = union(&[square(0.0, 0.0, 10.0)], &[square(5.0, 5.0, 10.0)]).unwrap();
        assert_eq!(r.len(), 1);
        let b = r[0].bounding_box().unwrap();
        assert!((b.min.x).abs() < 0.02 && (b.max.x - 15.0).abs() < 0.02);
    }

    #[test]
    fn difference_removes_overlap() {
        let r = difference(&[square(0.0, 0.0, 10.0)], &[square(5.0, 0.0, 10.0)]).unwrap();
        assert_eq!(r.len(), 1);
        assert!((r[0].bounding_box().unwrap().max.x - 5.0).abs() < 0.02);
    }

    #[test]
    fn intersect_of_disjoint_squares_is_empty() {
        let r = intersect(&[square(0.0, 0.0, 5.0)], &[square(100.0, 100.0, 5.0)]).unwrap();
        assert!(r.is_empty());
    }

    #[test]
    fn xor_of_identical_squares_is_empty() {
        let r = xor(&[square(0.0, 0.0, 10.0)], &[square(0.0, 0.0, 10.0)]).unwrap();
        assert!(r.is_empty());
    }

    #[test]
    fn inflate_changes_area() {
        let s = [square(0.0, 0.0, 10.0)];
        let grown: f64 = inflate(&s, 1.0, JoinType::Miter)
            .iter()
            .map(|p| p.area())
            .sum();
        let shrunk: f64 = inflate(&s, -1.0, JoinType::Miter)
            .iter()
            .map(|p| p.area())
            .sum();
        assert!(
            grown > 100.0 && shrunk < 100.0,
            "grown={grown} shrunk={shrunk}"
        );
    }
}
