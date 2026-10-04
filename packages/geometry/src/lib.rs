//! `makerlaser-geometry`: the geometry kernel. Clipper2 boolean operations and offsetting,
//! curve flattening, path joining, and the SVG/DXF importers.

pub mod bezier;
pub mod clip;
pub mod dxf_import;
pub mod error;
pub mod join;
pub mod offset;
pub mod svg_import;

pub use clip::{difference, inflate, intersect, union, xor, JoinType};
pub use dxf_import::{parse_dxf, DxfImportResult};
pub use error::{GeometryError, Result};
pub use join::join_open_paths;
pub use offset::{kerf_compensate, offset_path, KerfSide};
pub use svg_import::{parse_svg, SvgImportResult};

use makerlaser_common::{BoundingBox, Path2D, Point2};

/// Translates `paths` so their combined bounding box starts at (0, 0) and returns the size
/// of that box. Imported artwork is normalised this way so each object has a predictable
/// local origin; the app then places it on the bed with the object transform.
pub fn normalize_to_origin(paths: &mut [Path2D]) -> Option<BoundingBox> {
    let bbox = paths
        .iter()
        .filter_map(|p| p.bounding_box())
        .reduce(|a, b| a.union(&b))?;
    let (dx, dy) = (-bbox.min.x, -bbox.min.y);
    for p in paths.iter_mut() {
        for q in p.points.iter_mut() {
            *q = Point2::new(q.x + dx, q.y + dy);
        }
    }
    Some(BoundingBox {
        min: Point2::ZERO,
        max: Point2::new(bbox.width(), bbox.height()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalise_moves_the_box_to_the_origin() {
        let mut paths = vec![Path2D::new(
            vec![Point2::new(100.0, -50.0), Point2::new(110.0, -30.0)],
            false,
        )];
        let b = normalize_to_origin(&mut paths).unwrap();
        assert_eq!(paths[0].points[0], Point2::ZERO);
        assert_eq!((b.width(), b.height()), (10.0, 20.0));
    }

    #[test]
    fn normalise_of_nothing_is_none() {
        assert!(normalize_to_origin(&mut []).is_none());
    }
}
