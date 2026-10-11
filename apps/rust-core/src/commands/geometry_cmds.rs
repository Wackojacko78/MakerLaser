//! Shape tools: boolean operations and offsets of shapes (see docs/user-guide.md, "Combine, offset
//! and repeat"). The work is done in `makerlaser_geometry::shape_ops`; these two commands only check
//! what they are given. They take and return paths in workspace millimetres and change nothing in
//! the project: the interface decides what to do with the answer.
use makerlaser_common::Path2D;
use makerlaser_geometry::shape_ops::{combine, offset_shape, BooleanOp, Corners};

/// The most shapes one operation may combine.
const MAX_SHAPES: usize = 500;
/// The most points one operation may be given, over all its shapes.
const MAX_POINTS: usize = 2_000_000;
/// The largest offset, in mm, either way.
const MAX_OFFSET_MM: f64 = 1000.0;

fn check_size<'a>(paths: impl Iterator<Item = &'a Path2D>) -> Result<(), String> {
    let points: usize = paths.map(|p| p.points.len()).sum();
    if points > MAX_POINTS {
        return Err(format!(
            "That is {points} points, more than the limit of {MAX_POINTS}. Simplify the artwork first."
        ));
    }
    Ok(())
}

/// Combines shapes. `op` is "union", "subtract", "intersect" or "exclude"; `shapes` is one list of
/// paths per shape, the first being the one that is worked on. Returns the paths of the result,
/// which is an empty list when nothing is left.
#[tauri::command(async)]
pub fn boolean_paths(op: String, shapes: Vec<Vec<Path2D>>) -> Result<Vec<Path2D>, String> {
    let Some(operation) = BooleanOp::from_name(&op) else {
        return Err(format!("Unknown shape operation '{op}'."));
    };
    if shapes.len() < 2 {
        return Err("Select at least two shapes.".to_string());
    }
    if shapes.len() > MAX_SHAPES {
        return Err(format!(
            "That is {} shapes. At most {MAX_SHAPES} can be combined at once.",
            shapes.len()
        ));
    }
    check_size(shapes.iter().flatten())?;
    combine(operation, &shapes)
}

/// Offsets the shape made of `paths` by `delta_mm` (positive grows it, negative shrinks it). With
/// `rounded` the new corners are rounded, otherwise pointed. Returns the paths of the new shape,
/// which is an empty list when a shrunk shape has vanished.
#[tauri::command(async)]
pub fn offset_paths(
    paths: Vec<Path2D>,
    delta_mm: f64,
    rounded: bool,
) -> Result<Vec<Path2D>, String> {
    if !delta_mm.is_finite() || delta_mm.abs() > MAX_OFFSET_MM {
        return Err(format!(
            "The offset must be a number from -{MAX_OFFSET_MM:.0} to {MAX_OFFSET_MM:.0} mm."
        ));
    }
    check_size(paths.iter())?;
    let corners = if rounded {
        Corners::Round
    } else {
        Corners::Sharp
    };
    offset_shape(&paths, delta_mm, corners)
}

#[cfg(test)]
mod tests {
    use super::*;
    use makerlaser_common::Point2;

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
    fn an_unknown_operation_is_refused() {
        let err = boolean_paths("merge".to_string(), vec![vec![], vec![]]).unwrap_err();
        assert!(err.contains("Unknown"), "{err}");
    }

    #[test]
    fn fewer_than_two_shapes_are_refused() {
        let err =
            boolean_paths("union".to_string(), vec![vec![square(0.0, 0.0, 5.0)]]).unwrap_err();
        assert!(err.contains("at least two"), "{err}");
    }

    #[test]
    fn too_many_shapes_are_refused() {
        let shapes = vec![vec![square(0.0, 0.0, 1.0)]; MAX_SHAPES + 1];
        let err = boolean_paths("union".to_string(), shapes).unwrap_err();
        assert!(err.contains("At most"), "{err}");
    }

    #[test]
    fn a_union_comes_back_as_one_path() {
        let shapes = vec![vec![square(0.0, 0.0, 10.0)], vec![square(5.0, 5.0, 10.0)]];
        let result = boolean_paths("union".to_string(), shapes).unwrap();
        assert_eq!(result.len(), 1);
        let b = result[0].bounding_box().unwrap();
        assert!((b.max.x - 15.0).abs() < 0.05 && (b.max.y - 15.0).abs() < 0.05);
    }

    #[test]
    fn an_empty_result_is_an_empty_list_not_an_error() {
        let shapes = vec![vec![square(0.0, 0.0, 5.0)], vec![square(100.0, 100.0, 5.0)]];
        assert!(boolean_paths("intersect".to_string(), shapes)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn an_offset_comes_back_bigger_and_rounded_corners_are_accepted() {
        let result = offset_paths(vec![square(0.0, 0.0, 10.0)], 1.0, false).unwrap();
        assert_eq!(result.len(), 1);
        let b = result[0].bounding_box().unwrap();
        assert!((b.min.x + 1.0).abs() < 0.05 && (b.max.x - 11.0).abs() < 0.05);
        let rounded = offset_paths(vec![square(0.0, 0.0, 10.0)], 1.0, true).unwrap();
        assert_eq!(rounded.len(), 1);
        assert!(rounded[0].points.len() > 8);
    }

    #[test]
    fn bad_distances_are_refused() {
        for bad in [f64::NAN, f64::INFINITY, 5000.0, -5000.0] {
            let err = offset_paths(vec![square(0.0, 0.0, 10.0)], bad, false).unwrap_err();
            assert!(err.contains("from -1000 to 1000"), "{bad}: {err}");
        }
    }
}
