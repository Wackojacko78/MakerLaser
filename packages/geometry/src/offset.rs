//! Path offsetting and **kerf compensation**.
//!
//! A laser removes a strip of material about `kerf` wide centred on the beam path.
//! To get a part (or a hole) of the drawn size the beam path must be offset by half the
//! kerf: *outward* around parts you keep, *inward* around holes.

use makerlaser_common::Path2D;

use crate::clip::inflate;
pub use crate::clip::JoinType;
use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KerfSide {
    /// Grow the enclosed area (outer boundaries).
    Outward,
    /// Shrink the enclosed area (holes).
    Inward,
    /// Cut exactly on the drawn line.
    None,
}

fn total_area(paths: &[Path2D]) -> f64 {
    paths.iter().map(|p| p.area()).sum()
}

/// Offsets one closed path. Positive `delta_mm` grows the enclosed area, negative shrinks
/// it, **independent of winding direction**: the result is checked and the offset is
/// re-run with the opposite sign if it went the wrong way. May return several paths
/// (a shrinking shape can split) or none (a shrinking feature can vanish).
pub fn offset_path(path: &Path2D, delta_mm: f64, join: JoinType) -> Result<Vec<Path2D>> {
    if delta_mm == 0.0 || !delta_mm.is_finite() || !path.closed || path.points.len() < 3 {
        return Ok(vec![path.clone()]);
    }
    let original = path.area();
    let single = std::slice::from_ref(path);
    let mut result = inflate(single, delta_mm, join);
    let area = total_area(&result);
    let wrong_way = (delta_mm > 0.0 && area + 1e-6 < original)
        || (delta_mm < 0.0 && !result.is_empty() && area > original + 1e-6);
    if wrong_way {
        result = inflate(single, -delta_mm, join);
    }
    Ok(result)
}

/// Applies kerf compensation (half the kerf each side) to one closed cut path.
pub fn kerf_compensate(path: &Path2D, kerf_mm: f64, side: KerfSide) -> Result<Vec<Path2D>> {
    let half = kerf_mm / 2.0;
    let delta = match side {
        KerfSide::Outward => half,
        KerfSide::Inward => -half,
        KerfSide::None => return Ok(vec![path.clone()]),
    };
    offset_path(path, delta, JoinType::Miter)
}

#[cfg(test)]
mod tests {
    use super::*;
    use makerlaser_common::Point2;

    fn square(size: f64, clockwise: bool) -> Path2D {
        let mut pts = vec![
            Point2::new(0.0, 0.0),
            Point2::new(size, 0.0),
            Point2::new(size, size),
            Point2::new(0.0, size),
        ];
        if clockwise {
            pts.reverse();
        }
        Path2D::new(pts, true)
    }

    #[test]
    fn outward_kerf_grows_regardless_of_winding() {
        for cw in [false, true] {
            let sq = square(10.0, cw);
            let out = kerf_compensate(&sq, 0.4, KerfSide::Outward).unwrap();
            assert!(total_area(&out) > sq.area(), "winding cw={cw}");
        }
    }

    #[test]
    fn inward_kerf_shrinks_regardless_of_winding() {
        for cw in [false, true] {
            let sq = square(10.0, cw);
            let out = kerf_compensate(&sq, 0.4, KerfSide::Inward).unwrap();
            assert!(total_area(&out) < sq.area(), "winding cw={cw}");
        }
    }

    #[test]
    fn side_none_returns_the_input() {
        let sq = square(10.0, false);
        let out = kerf_compensate(&sq, 0.4, KerfSide::None).unwrap();
        assert_eq!(out, vec![sq]);
    }

    #[test]
    fn open_paths_are_never_offset() {
        let mut p = square(10.0, false);
        p.closed = false;
        let out = offset_path(&p, 1.0, JoinType::Miter).unwrap();
        assert_eq!(out, vec![p]);
    }

    #[test]
    fn a_feature_smaller_than_the_kerf_can_vanish() {
        let tiny = square(0.1, false);
        let out = kerf_compensate(&tiny, 0.5, KerfSide::Inward).unwrap();
        assert!(out.is_empty());
    }
}
