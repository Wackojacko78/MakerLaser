//! Joins connected open segments into polylines/closed loops. CAD exports (notably
//! Fusion 360 DXF) describe a profile as separate LINE/ARC entities; without joining they
//! could not be kerf-compensated or nesting-classified, because both need closed paths.

use makerlaser_common::Path2D;

/// Chains open paths whose end points lie within `tol` of each other. Closed paths pass
/// through unchanged. A chain whose ends meet becomes a closed path.
pub fn join_open_paths(paths: Vec<Path2D>, tol: f64) -> Vec<Path2D> {
    let mut out: Vec<Path2D> = Vec::new();
    let mut open: Vec<Path2D> = Vec::new();
    for p in paths {
        if p.closed {
            out.push(p);
        } else if p.points.len() >= 2 {
            open.push(p);
        }
    }

    while let Some(mut chain) = open.pop() {
        loop {
            if chain.points.len() >= 3 && ends_meet(&chain, tol) {
                chain.points.pop();
                chain.closed = true;
                break;
            }
            let tail = chain.points[chain.points.len() - 1];
            let head = chain.points[0];

            // (index, attach_at_tail, reverse_candidate)
            let mut found: Option<(usize, bool, bool)> = None;
            for (i, c) in open.iter().enumerate() {
                let cs = c.points[0];
                let ce = c.points[c.points.len() - 1];
                if tail.distance_to(&cs) <= tol {
                    found = Some((i, true, false));
                } else if tail.distance_to(&ce) <= tol {
                    found = Some((i, true, true));
                } else if head.distance_to(&ce) <= tol {
                    found = Some((i, false, false));
                } else if head.distance_to(&cs) <= tol {
                    found = Some((i, false, true));
                }
                if found.is_some() {
                    break;
                }
            }

            let Some((i, at_tail, reverse)) = found else {
                break;
            };
            let mut c = open.swap_remove(i);
            if reverse {
                c.points.reverse();
            }
            if at_tail {
                chain.points.extend(c.points.into_iter().skip(1));
            } else {
                c.points.pop(); // candidate's last point coincides with the chain head
                c.points.append(&mut chain.points);
                chain.points = c.points;
            }
        }
        out.push(chain);
    }
    out
}

fn ends_meet(p: &Path2D, tol: f64) -> bool {
    p.points[0].distance_to(&p.points[p.points.len() - 1]) <= tol
}

#[cfg(test)]
mod tests {
    use super::*;
    use makerlaser_common::Point2;

    fn seg(a: (f64, f64), b: (f64, f64)) -> Path2D {
        Path2D::new(vec![Point2::new(a.0, a.1), Point2::new(b.0, b.1)], false)
    }

    #[test]
    fn four_lines_become_one_closed_square() {
        let lines = vec![
            seg((0.0, 0.0), (10.0, 0.0)),
            seg((10.0, 10.0), (10.0, 0.0)), // reversed on purpose
            seg((10.0, 10.0), (0.0, 10.0)),
            seg((0.0, 10.0), (0.0, 0.0)),
        ];
        let joined = join_open_paths(lines, 0.01);
        assert_eq!(joined.len(), 1);
        assert!(joined[0].closed);
        assert_eq!(joined[0].points.len(), 4);
    }

    #[test]
    fn disconnected_segments_stay_separate() {
        let joined = join_open_paths(
            vec![seg((0.0, 0.0), (1.0, 0.0)), seg((5.0, 5.0), (6.0, 5.0))],
            0.01,
        );
        assert_eq!(joined.len(), 2);
        assert!(joined.iter().all(|p| !p.closed));
    }

    #[test]
    fn closed_paths_pass_through() {
        let closed = Path2D::new(
            vec![
                Point2::new(0.0, 0.0),
                Point2::new(1.0, 0.0),
                Point2::new(1.0, 1.0),
            ],
            true,
        );
        let joined = join_open_paths(vec![closed.clone()], 0.01);
        assert_eq!(joined, vec![closed]);
    }

    #[test]
    fn tolerance_bridges_small_gaps() {
        let joined = join_open_paths(
            vec![
                seg((0.0, 0.0), (10.0, 0.0)),
                seg((10.005, 0.0), (20.0, 0.0)),
            ],
            0.01,
        );
        assert_eq!(joined.len(), 1);
        assert_eq!(joined[0].points.len(), 3);
    }
}
