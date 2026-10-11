//! Boolean operations and offsets of whole shapes, for the Shape tools panel.
//!
//! Everything here works on closed paths in workspace millimetres and goes through `clip.rs` (the
//! only module that touches `clipper2`) and `offset.rs`, so results are snapped to the same 0.01 mm
//! grid. Open paths and paths with fewer than three points are not shapes and are left out.
//!
//! A shape may be made of several paths: an outer outline and the holes in it, and islands inside
//! those holes. Which paths are holes is worked out from which path lies inside which (not from
//! the direction each path was drawn in), so a shape imported with every path turning the same way
//! still has its holes.
use makerlaser_common::{BoundingBox, Path2D, Point2};

use crate::clip::{difference, intersect, union, xor, JoinType};
use crate::error::GeometryError;
use crate::offset::offset_path;

/// How the shapes are combined. The first shape is the one that is worked on; the others are
/// added to it, cut out of it, kept only where they overlap it, or kept only where they do not.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BooleanOp {
    Union,
    Subtract,
    Intersect,
    Exclude,
}

impl BooleanOp {
    /// The names the user interface sends: "union", "subtract", "intersect" and "exclude".
    pub fn from_name(name: &str) -> Option<BooleanOp> {
        match name {
            "union" => Some(BooleanOp::Union),
            "subtract" => Some(BooleanOp::Subtract),
            "intersect" => Some(BooleanOp::Intersect),
            "exclude" => Some(BooleanOp::Exclude),
            _ => None,
        }
    }
}

/// How the corners of an offset shape are made.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Corners {
    /// Pointed corners. Clipper2 cuts a very sharp point off flat (its miter limit is 2).
    Sharp,
    /// Rounded corners.
    Round,
}

impl Corners {
    fn join(self) -> JoinType {
        match self {
            Corners::Sharp => JoinType::Miter,
            Corners::Round => JoinType::Round,
        }
    }
}

fn describe(e: GeometryError) -> String {
    match e {
        GeometryError::BooleanOpFailed(message) => format!("The shape operation failed: {message}"),
        other => format!("The shape operation failed: {other:?}"),
    }
}

/// The paths that are real shapes: closed, three points or more, and every coordinate a number.
fn usable(paths: &[Path2D]) -> Vec<Path2D> {
    paths
        .iter()
        .filter(|p| p.closed && p.points.len() >= 3 && p.points.iter().all(|q| q.is_finite()))
        .cloned()
        .collect()
}

fn contains_point(polygon: &Path2D, p: Point2) -> bool {
    let pts = &polygon.points;
    let n = pts.len();
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

/// How many other paths each path lies inside: 0 for an outer outline, 1 for a hole in it, 2 for an
/// island in that hole, and so on. A path is "inside" another when its bounding box fits within
/// the other's and its first point lies inside the other polygon. Needs paths of three points or
/// more (see `usable`).
fn depths(paths: &[Path2D]) -> Vec<usize> {
    let boxes: Vec<Option<BoundingBox>> = paths.iter().map(|p| p.bounding_box()).collect();
    (0..paths.len())
        .map(|i| {
            let Some(inner) = boxes[i] else { return 0 };
            let probe = paths[i].points[0];
            (0..paths.len())
                .filter(|&j| {
                    j != i
                        && boxes[j].is_some_and(|outer| outer.contains_box(&inner))
                        && contains_point(&paths[j], probe)
                })
                .count()
        })
        .collect()
}

/// Turns every path so outlines run one way and holes the other, whichever way they were drawn.
fn orient_by_depth(paths: &[Path2D]) -> Vec<Path2D> {
    let depth = depths(paths);
    paths
        .iter()
        .zip(depth)
        .map(|(path, d)| {
            let mut path = path.clone();
            let counter_clockwise = path.signed_area() > 0.0;
            if counter_clockwise != (d % 2 == 0) {
                path.points.reverse();
            }
            path
        })
        .collect()
}

/// Combines shapes. `shapes[0]` is the base; every later shape is combined with the result so far,
/// one after the other. Subtracting several shapes cuts each of them out of the base. Anything
/// that is not a closed shape is ignored. The result can be empty: the shapes may not overlap, or
/// the shapes in front may cover the base completely.
pub fn combine(op: BooleanOp, shapes: &[Vec<Path2D>]) -> Result<Vec<Path2D>, String> {
    let mut sets = shapes.iter().map(|shape| orient_by_depth(&usable(shape)));
    let Some(mut result) = sets.next() else {
        return Ok(Vec::new());
    };
    for next in sets {
        if result.is_empty() && matches!(op, BooleanOp::Subtract | BooleanOp::Intersect) {
            return Ok(Vec::new());
        }
        let step = match op {
            BooleanOp::Union => union(&result, &next),
            BooleanOp::Subtract => difference(&result, &next),
            BooleanOp::Intersect => intersect(&result, &next),
            BooleanOp::Exclude => xor(&result, &next),
        };
        result = step.map_err(describe)?;
    }
    Ok(result)
}

/// Offsets one shape: a positive `delta_mm` makes it bigger by that much all round, a negative one
/// makes it smaller. Holes move the other way (a hole shrinks as the shape grows), and islands in
/// holes grow with the shape, so a ring stays a ring. The result can be several paths (a shape
/// that is shrunk can fall apart) or none (a shape that is shrunk can vanish).
pub fn offset_shape(
    paths: &[Path2D],
    delta_mm: f64,
    corners: Corners,
) -> Result<Vec<Path2D>, String> {
    if !delta_mm.is_finite() {
        return Err("The offset distance is not a number.".to_string());
    }
    let closed = usable(paths);
    if closed.is_empty() || delta_mm == 0.0 {
        return Ok(closed);
    }
    let depth = depths(&closed);
    let deepest = depth.iter().copied().max().unwrap_or(0);
    let join = corners.join();
    let mut region: Vec<Path2D> = Vec::new();
    // Level by level, from the outer outlines inwards: outlines are added to what is there, holes
    // are cut out of it. Each level lies inside the one before.
    for level in 0..=deepest {
        let hole = level % 2 == 1;
        let signed = if hole { -delta_mm } else { delta_mm };
        let mut moved: Vec<Path2D> = Vec::new();
        for (path, d) in closed.iter().zip(&depth) {
            if *d == level {
                let piece = offset_path(path, signed, join).map_err(describe)?;
                // Outlines that grow into each other (or holes that do) become one shape.
                moved = if moved.is_empty() {
                    piece
                } else {
                    union(&moved, &piece).map_err(describe)?
                };
            }
        }
        if moved.is_empty() {
            continue;
        }
        if hole {
            if !region.is_empty() {
                region = difference(&region, &moved).map_err(describe)?;
            }
        } else if region.is_empty() {
            region = moved;
        } else {
            region = union(&region, &moved).map_err(describe)?;
        }
    }
    Ok(region)
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

    fn reversed(mut p: Path2D) -> Path2D {
        p.points.reverse();
        p
    }

    /// Outlines count, holes take away, islands count again.
    fn net_area(paths: &[Path2D]) -> f64 {
        depths(paths)
            .iter()
            .zip(paths)
            .map(|(d, p)| if d % 2 == 0 { p.area() } else { -p.area() })
            .sum()
    }

    fn near(a: f64, b: f64) -> bool {
        (a - b).abs() < 0.05
    }

    fn two(a: Path2D, b: Path2D) -> Vec<Vec<Path2D>> {
        vec![vec![a], vec![b]]
    }

    #[test]
    fn the_operation_names_are_the_ones_the_interface_sends() {
        assert_eq!(BooleanOp::from_name("union"), Some(BooleanOp::Union));
        assert_eq!(BooleanOp::from_name("subtract"), Some(BooleanOp::Subtract));
        assert_eq!(
            BooleanOp::from_name("intersect"),
            Some(BooleanOp::Intersect)
        );
        assert_eq!(BooleanOp::from_name("exclude"), Some(BooleanOp::Exclude));
        assert_eq!(BooleanOp::from_name("Union"), None);
        assert_eq!(BooleanOp::from_name(""), None);
    }

    #[test]
    fn nesting_depth_of_outlines_holes_and_islands() {
        let paths = [
            square(0.0, 0.0, 100.0),
            square(10.0, 10.0, 50.0),
            square(20.0, 20.0, 10.0),
            square(200.0, 0.0, 5.0),
        ];
        assert_eq!(depths(&paths), vec![0, 1, 2, 0]);
    }

    #[test]
    fn union_joins_overlapping_squares() {
        let r = combine(
            BooleanOp::Union,
            &two(square(0.0, 0.0, 10.0), square(5.0, 5.0, 10.0)),
        )
        .unwrap();
        assert_eq!(r.len(), 1);
        assert!(near(net_area(&r), 175.0), "{}", net_area(&r));
    }

    #[test]
    fn subtract_cuts_the_second_shape_out_of_the_first() {
        let r = combine(
            BooleanOp::Subtract,
            &two(square(0.0, 0.0, 10.0), square(5.0, 5.0, 10.0)),
        )
        .unwrap();
        assert!(near(net_area(&r), 75.0), "{}", net_area(&r));
        // The other way round keeps the other square's part.
        let r = combine(
            BooleanOp::Subtract,
            &two(square(5.0, 5.0, 10.0), square(0.0, 0.0, 10.0)),
        )
        .unwrap();
        assert!(near(net_area(&r), 75.0), "{}", net_area(&r));
        let b = r[0].bounding_box().unwrap();
        assert!(near(b.max.x, 15.0) && near(b.max.y, 15.0));
    }

    #[test]
    fn intersect_keeps_only_the_overlap() {
        let r = combine(
            BooleanOp::Intersect,
            &two(square(0.0, 0.0, 10.0), square(5.0, 5.0, 10.0)),
        )
        .unwrap();
        assert_eq!(r.len(), 1);
        assert!(near(net_area(&r), 25.0), "{}", net_area(&r));
    }

    #[test]
    fn exclude_keeps_everything_except_the_overlap() {
        let r = combine(
            BooleanOp::Exclude,
            &two(square(0.0, 0.0, 10.0), square(5.0, 5.0, 10.0)),
        )
        .unwrap();
        assert!(near(net_area(&r), 150.0), "{}", net_area(&r));
    }

    #[test]
    fn nothing_left_gives_an_empty_result() {
        let apart = combine(
            BooleanOp::Intersect,
            &two(square(0.0, 0.0, 5.0), square(100.0, 100.0, 5.0)),
        )
        .unwrap();
        assert!(apart.is_empty());
        let covered = combine(
            BooleanOp::Subtract,
            &two(square(2.0, 2.0, 4.0), square(0.0, 0.0, 10.0)),
        )
        .unwrap();
        assert!(covered.is_empty());
        let same = combine(
            BooleanOp::Exclude,
            &two(square(0.0, 0.0, 10.0), square(0.0, 0.0, 10.0)),
        )
        .unwrap();
        assert!(same.is_empty());
    }

    #[test]
    fn subtracting_several_shapes_cuts_each_out_of_the_base() {
        let shapes = vec![
            vec![square(0.0, 0.0, 30.0)],
            vec![square(5.0, 5.0, 5.0)],
            vec![square(20.0, 20.0, 5.0)],
        ];
        let r = combine(BooleanOp::Subtract, &shapes).unwrap();
        assert_eq!(r.len(), 3, "one outline and two holes");
        assert!(near(net_area(&r), 850.0), "{}", net_area(&r));
    }

    #[test]
    fn several_shapes_are_all_united() {
        let shapes = vec![
            vec![square(0.0, 0.0, 10.0)],
            vec![square(8.0, 0.0, 10.0)],
            vec![square(16.0, 0.0, 10.0)],
        ];
        let r = combine(BooleanOp::Union, &shapes).unwrap();
        assert_eq!(r.len(), 1);
        assert!(near(net_area(&r), 260.0), "{}", net_area(&r));
    }

    #[test]
    fn a_shape_with_a_hole_keeps_its_hole_whichever_way_it_was_drawn() {
        let far = vec![square(100.0, 100.0, 10.0)];
        for hole in [square(5.0, 5.0, 10.0), reversed(square(5.0, 5.0, 10.0))] {
            let ring = vec![square(0.0, 0.0, 20.0), hole];
            let r = combine(BooleanOp::Union, &[ring, far.clone()]).unwrap();
            assert_eq!(r.len(), 3, "outline, hole and the far square");
            assert!(near(net_area(&r), 400.0), "{}", net_area(&r));
        }
    }

    #[test]
    fn a_square_dropped_into_the_hole_of_a_ring_stays_apart() {
        let ring = vec![square(0.0, 0.0, 40.0), square(10.0, 10.0, 20.0)];
        let r = combine(BooleanOp::Union, &[ring, vec![square(15.0, 15.0, 10.0)]]).unwrap();
        assert!(
            near(net_area(&r), 1600.0 - 400.0 + 100.0),
            "{}",
            net_area(&r)
        );
    }

    #[test]
    fn open_lines_and_tiny_paths_are_not_shapes() {
        let line = Path2D::new(
            vec![
                Point2::new(0.0, 0.0),
                Point2::new(30.0, 0.0),
                Point2::new(30.0, 30.0),
            ],
            false,
        );
        let two_points = Path2D::new(vec![Point2::new(0.0, 0.0), Point2::new(1.0, 1.0)], true);
        let shapes = vec![
            vec![square(0.0, 0.0, 10.0), line, two_points],
            vec![square(5.0, 5.0, 10.0)],
        ];
        let r = combine(BooleanOp::Union, &shapes).unwrap();
        assert_eq!(r.len(), 1);
        assert!(near(net_area(&r), 175.0), "{}", net_area(&r));
    }

    #[test]
    fn nothing_to_combine_gives_nothing() {
        assert!(combine(BooleanOp::Union, &[]).unwrap().is_empty());
        let r = combine(BooleanOp::Union, &[vec![square(0.0, 0.0, 10.0)]]).unwrap();
        assert!(near(net_area(&r), 100.0));
    }

    #[test]
    fn a_square_grows_and_shrinks_by_the_distance_on_every_side() {
        let sq = [square(0.0, 0.0, 10.0)];
        let out = offset_shape(&sq, 1.0, Corners::Sharp).unwrap();
        assert_eq!(out.len(), 1);
        let b = out[0].bounding_box().unwrap();
        assert!(near(b.min.x, -1.0) && near(b.min.y, -1.0), "{b:?}");
        assert!(near(b.max.x, 11.0) && near(b.max.y, 11.0), "{b:?}");
        assert!(near(net_area(&out), 144.0), "{}", net_area(&out));
        let inward = offset_shape(&sq, -1.0, Corners::Sharp).unwrap();
        assert!(near(net_area(&inward), 64.0), "{}", net_area(&inward));
    }

    #[test]
    fn the_direction_does_not_depend_on_which_way_the_shape_was_drawn() {
        for sq in [square(0.0, 0.0, 10.0), reversed(square(0.0, 0.0, 10.0))] {
            let out = offset_shape(&[sq.clone()], 1.0, Corners::Sharp).unwrap();
            assert!(near(net_area(&out), 144.0), "{}", net_area(&out));
            let inward = offset_shape(&[sq], -1.0, Corners::Sharp).unwrap();
            assert!(near(net_area(&inward), 64.0), "{}", net_area(&inward));
        }
    }

    #[test]
    fn rounded_corners_make_a_slightly_smaller_area_than_pointed_ones() {
        let sq = [square(0.0, 0.0, 10.0)];
        let round = offset_shape(&sq, 1.0, Corners::Round).unwrap();
        // 100 + four sides of 10 x 1 + a full circle of radius 1 = 143.14.
        let area = net_area(&round);
        assert!(area > 142.0 && area < 143.5, "{area}");
        assert!(round[0].points.len() > 8, "{}", round[0].points.len());
    }

    #[test]
    fn a_ring_stays_a_ring_when_it_is_offset() {
        for hole in [square(5.0, 5.0, 10.0), reversed(square(5.0, 5.0, 10.0))] {
            let ring = [square(0.0, 0.0, 20.0), hole];
            // The outline grows to 22 x 22 and the hole shrinks to 8 x 8.
            let out = offset_shape(&ring, 1.0, Corners::Sharp).unwrap();
            assert_eq!(out.len(), 2);
            assert!(near(net_area(&out), 484.0 - 64.0), "{}", net_area(&out));
            // The outline shrinks to 18 x 18 and the hole grows to 12 x 12.
            let inward = offset_shape(&ring, -1.0, Corners::Sharp).unwrap();
            assert_eq!(inward.len(), 2);
            assert!(
                near(net_area(&inward), 324.0 - 144.0),
                "{}",
                net_area(&inward)
            );
        }
    }

    #[test]
    fn an_island_inside_a_hole_moves_with_the_outline() {
        let shape = [
            square(0.0, 0.0, 40.0),
            square(5.0, 5.0, 30.0),
            square(15.0, 15.0, 10.0),
        ];
        let out = offset_shape(&shape, 1.0, Corners::Sharp).unwrap();
        assert_eq!(out.len(), 3);
        assert!(
            near(net_area(&out), 1764.0 - 784.0 + 144.0),
            "{}",
            net_area(&out)
        );
        let inward = offset_shape(&shape, -1.0, Corners::Sharp).unwrap();
        assert!(
            near(net_area(&inward), 1444.0 - 1024.0 + 64.0),
            "{}",
            net_area(&inward)
        );
    }

    #[test]
    fn two_shapes_that_grow_into_each_other_become_one() {
        let shapes = [square(0.0, 0.0, 10.0), square(12.0, 0.0, 10.0)];
        let out = offset_shape(&shapes, 2.0, Corners::Sharp).unwrap();
        assert_eq!(out.len(), 1);
        assert!(near(net_area(&out), 26.0 * 14.0), "{}", net_area(&out));
    }

    #[test]
    fn holes_that_grow_into_each_other_become_one_hole() {
        // Two holes 2 mm apart. Offsetting the shape inward by 2 mm grows each hole by 2 mm,
        // so they run into each other: one hole is left, not two overlapping ones.
        let shape = [
            square(0.0, 0.0, 40.0),
            square(5.0, 5.0, 10.0),
            square(17.0, 5.0, 10.0),
        ];
        let out = offset_shape(&shape, -2.0, Corners::Sharp).unwrap();
        assert_eq!(out.len(), 2, "one outline and one hole");
        assert!(
            near(net_area(&out), 36.0 * 36.0 - 26.0 * 14.0),
            "{}",
            net_area(&out)
        );
        // Going the other way the holes shrink and stay apart.
        let outward = offset_shape(&shape, 2.0, Corners::Sharp).unwrap();
        assert_eq!(outward.len(), 3);
        assert!(
            near(net_area(&outward), 44.0 * 44.0 - 2.0 * 36.0),
            "{}",
            net_area(&outward)
        );
    }

    #[test]
    fn a_shape_that_is_shrunk_away_leaves_nothing() {
        let out = offset_shape(&[square(0.0, 0.0, 2.0)], -2.0, Corners::Sharp).unwrap();
        assert!(out.is_empty());
    }

    #[test]
    fn a_hole_that_is_shrunk_away_just_disappears() {
        let ring = [square(0.0, 0.0, 20.0), square(9.5, 9.5, 1.0)];
        let out = offset_shape(&ring, 2.0, Corners::Sharp).unwrap();
        assert_eq!(out.len(), 1);
        assert!(near(net_area(&out), 576.0), "{}", net_area(&out));
    }

    #[test]
    fn an_offset_out_and_back_in_returns_the_square() {
        let grown = offset_shape(&[square(0.0, 0.0, 10.0)], 2.0, Corners::Sharp).unwrap();
        let back = offset_shape(&grown, -2.0, Corners::Sharp).unwrap();
        assert!(near(net_area(&back), 100.0), "{}", net_area(&back));
    }

    #[test]
    fn a_distance_of_zero_gives_the_shapes_back_and_bad_distances_are_refused() {
        let sq = [square(0.0, 0.0, 10.0)];
        assert_eq!(offset_shape(&sq, 0.0, Corners::Sharp).unwrap(), sq.to_vec());
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(offset_shape(&sq, bad, Corners::Sharp).is_err(), "{bad}");
        }
    }

    #[test]
    fn open_lines_are_not_offset() {
        let line = Path2D::new(
            vec![
                Point2::new(0.0, 0.0),
                Point2::new(10.0, 0.0),
                Point2::new(10.0, 10.0),
            ],
            false,
        );
        assert!(offset_shape(&[line], 1.0, Corners::Sharp)
            .unwrap()
            .is_empty());
    }
}
