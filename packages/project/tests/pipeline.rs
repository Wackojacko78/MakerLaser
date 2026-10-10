//! Cross-crate integration tests: file import -> project -> toolpath -> G-code -> safety.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use makerlaser_common::{
    BoundingBox, LayerKind, MachineProfile, Path2D, Point2, ProjectFile, Transform2D,
    WorkspaceObject,
};
use makerlaser_geometry::{normalize_to_origin, parse_dxf, parse_svg};
use makerlaser_project::{build_job, GcodeOptions, MoveKind};

fn fixture(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures")
        .join(name);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {path:?}: {e}"))
}

/// Places imported paths on the bed at (x, y) on the given layer kind.
fn project_with(paths: Vec<Path2D>, kind: LayerKind, x: f64, y: f64) -> ProjectFile {
    let mut project = ProjectFile::new("Integration", MachineProfile::tts55_pro());
    let layer = project.layers.iter().find(|l| l.kind == kind).unwrap().id;
    let mut obj = WorkspaceObject::new_vector("imported", paths, 0);
    obj.transform = Transform2D::translate(x, y);
    obj.layer_id = Some(layer);
    project.objects.push(obj);
    project
}

fn g1_coordinates(gcode: &str) -> Vec<(f64, f64)> {
    gcode
        .lines()
        .filter(|l| l.starts_with("G1"))
        .map(|l| {
            let mut x = f64::NAN;
            let mut y = f64::NAN;
            for word in l.split_whitespace() {
                if let Some(v) = word.strip_prefix('X') {
                    x = v.parse().unwrap();
                }
                if let Some(v) = word.strip_prefix('Y') {
                    y = v.parse().unwrap();
                }
            }
            (x, y)
        })
        .collect()
}

#[test]
fn svg_square_becomes_valid_grbl_gcode_in_the_right_place() {
    let svg = parse_svg(&fixture("square.svg")).unwrap();
    let project = project_with(svg.paths, LayerKind::Cut, 10.0, 10.0);
    let job = build_job(&project, &HashMap::new(), &GcodeOptions::default()).unwrap();

    assert!(job.safety.is_safe_to_run(), "{:?}", job.safety);
    assert!(job.warnings.is_empty(), "{:?}", job.warnings);
    for needle in ["G21\n", "G90\n", "M4 S", "G1 ", "M5\n", "M2\n"] {
        assert!(
            job.gcode.contains(needle),
            "missing {needle:?} in:\n{}",
            job.gcode
        );
    }
    assert!(!job.gcode.contains("NaN"));

    // The square sits at workspace (10..20, 10..20) = machine X 10..20, Y 280..290 on a
    // 300 mm bed with a bottom-left origin. A missing Y flip would put it at Y 10..20.
    let coords = g1_coordinates(&job.gcode);
    assert_eq!(coords.len(), 4);
    for (x, y) in coords {
        assert!((10.0..=20.0).contains(&x), "x {x}");
        assert!(
            (280.0..=290.0).contains(&y),
            "y {y}: the workspace Y axis was not flipped"
        );
    }
}

#[test]
fn a_hole_is_cut_before_the_boundary_that_contains_it() {
    let svg = parse_svg(&fixture("nested.svg")).unwrap();
    assert_eq!(svg.paths.len(), 2);
    let project = project_with(svg.paths, LayerKind::Cut, 10.0, 10.0);
    let job = build_job(&project, &HashMap::new(), &GcodeOptions::default()).unwrap();

    // Circle: centre (50,50) r=10 inside the 100 mm square, both offset by (10,10), so the
    // circle spans 50..70 in both axes and the square spans 10..110.
    let first_cut = job
        .toolpath
        .toolpath
        .segments
        .iter()
        .find(|s| s.kind == MoveKind::Cut)
        .expect("a cut move");
    for p in [first_cut.from, first_cut.to] {
        assert!(
            p.x > 49.9 && p.x < 70.1 && p.y > 49.9 && p.y < 70.1,
            "first cut at {p:?} is not on the circle"
        );
    }
}

#[test]
fn svg_group_transform_and_curves_are_applied() {
    let svg = parse_svg(&fixture("transformed_curve.svg")).unwrap();
    assert_eq!(svg.paths.len(), 1);
    assert!(svg.paths[0].closed);
    let b = svg.paths[0].bounding_box().unwrap();
    // translate(10,5) scale(2): x spans 10..30; the curve peaks at y = 7.5 -> 15 + 5.
    assert!(
        (b.min.x - 10.0).abs() < 1e-6 && (b.max.x - 30.0).abs() < 1e-6,
        "{b:?}"
    );
    assert!(
        (b.min.y - 5.0).abs() < 1e-6 && (b.max.y - 20.0).abs() < 0.05,
        "{b:?}"
    );
}

#[test]
fn dxf_in_inches_is_converted_and_loose_lines_are_joined() {
    let dxf = parse_dxf(&fixture("square_inches.dxf")).unwrap();
    assert!(dxf.warnings.is_empty(), "{:?}", dxf.warnings);
    assert_eq!(dxf.paths.len(), 1, "four lines must join into one loop");
    assert!(dxf.paths[0].closed);
    let b = dxf.paths[0].bounding_box().unwrap();
    assert!((b.width() - 25.4).abs() < 1e-9 && (b.height() - 25.4).abs() < 1e-9);
}

#[test]
fn a_fusion_style_slot_of_lines_and_arcs_becomes_one_closed_cut() {
    let dxf = parse_dxf(&fixture("stadium_mm.dxf")).unwrap();
    assert_eq!(
        dxf.paths.len(),
        1,
        "lines and arcs must chain into one loop"
    );
    assert!(dxf.paths[0].closed);
    let b = dxf.paths[0].bounding_box().unwrap();
    assert!((b.width() - 30.0).abs() < 0.05, "width {}", b.width());
    assert!((b.height() - 10.0).abs() < 0.05, "height {}", b.height());

    // And it must be cuttable with kerf compensation, which needs the closed loop.
    let mut paths = dxf.paths;
    normalize_to_origin(&mut paths).unwrap();
    let mut project = project_with(paths, LayerKind::Cut, 20.0, 20.0);
    project
        .layers
        .iter_mut()
        .find(|l| l.kind == LayerKind::Cut)
        .unwrap()
        .kerf_mm = 0.2;
    let job = build_job(&project, &HashMap::new(), &GcodeOptions::default()).unwrap();
    assert!(job.safety.is_safe_to_run(), "{:?}", job.safety);
    let bounds: BoundingBox = job.toolpath.toolpath.bounds().unwrap();
    assert!(bounds.width() > 0.0);
    assert!(job.warnings.is_empty(), "{:?}", job.warnings);
}

#[test]
fn artwork_outside_the_bed_is_refused() {
    let svg = parse_svg(&fixture("nested.svg")).unwrap();
    // 100 mm square placed so it overhangs the right edge of the 300 mm bed.
    let project = project_with(svg.paths, LayerKind::Cut, 250.0, 10.0);
    let job = build_job(&project, &HashMap::new(), &GcodeOptions::default()).unwrap();
    assert!(!job.safety.is_safe_to_run());
    assert!(
        job.safety.errors.iter().any(|e| e.contains("outside")),
        "{:?}",
        job.safety.errors
    );
}

#[test]
fn imported_artwork_on_no_layer_runs_nothing_and_says_so() {
    let svg = parse_svg(&fixture("square.svg")).unwrap();
    let mut project = project_with(svg.paths, LayerKind::Cut, 10.0, 10.0);
    project.objects[0].layer_id = None;
    let job = build_job(&project, &HashMap::new(), &GcodeOptions::default()).unwrap();
    assert!(job.toolpath.toolpath.segments.is_empty());
    assert!(job.warnings.iter().any(|w| w.contains("not assigned")));
}

#[test]
fn the_job_never_lights_the_laser_during_travel() {
    let svg = parse_svg(&fixture("nested.svg")).unwrap();
    let project = project_with(svg.paths, LayerKind::Cut, 10.0, 10.0);
    let job = build_job(&project, &HashMap::new(), &GcodeOptions::default()).unwrap();

    let mut laser_on = false;
    for line in job.gcode.lines() {
        if line.starts_with("M4") || line.starts_with("M3") {
            laser_on = true;
        } else if line.starts_with("M5") {
            laser_on = false;
        } else if line.starts_with("G0") {
            assert!(!laser_on, "rapid move with the laser on: {line}");
        }
    }
    assert!(!laser_on, "program must end with the laser off");
}

#[test]
fn the_pipeline_is_deterministic() {
    let svg = parse_svg(&fixture("nested.svg")).unwrap();
    let project = project_with(svg.paths, LayerKind::Cut, 10.0, 10.0);
    let a = build_job(&project, &HashMap::new(), &GcodeOptions::default()).unwrap();
    let b = build_job(&project, &HashMap::new(), &GcodeOptions::default()).unwrap();
    assert_eq!(a.gcode, b.gcode);
}

#[test]
fn bed_corner_points_map_to_machine_corners() {
    let m = MachineProfile::tts55_pro();
    assert_eq!(
        m.workspace_to_machine(Point2::new(0.0, 0.0)),
        Point2::new(0.0, 300.0)
    );
    assert_eq!(
        m.workspace_to_machine(Point2::new(300.0, 300.0)),
        Point2::new(300.0, 0.0)
    );
}

/// Reads every `M4 S...` value out of the G-code.
fn spindle_values(gcode: &str) -> Vec<u32> {
    gcode
        .lines()
        .filter_map(|l| l.strip_prefix("M4 S")?.trim().parse().ok())
        .collect()
}

/// The laser is never on during a rapid move, and the program ends with it off.
fn assert_laser_off_during_rapids_and_at_the_end(gcode: &str) {
    let mut laser_on = false;
    for line in gcode.lines() {
        if line.starts_with("M4") || line.starts_with("M3") {
            laser_on = true;
        } else if line.starts_with("M5") {
            laser_on = false;
        } else if line.starts_with("G0") {
            assert!(!laser_on, "rapid move with the laser on: {line}");
        }
    }
    assert!(!laser_on, "program must end with the laser off");
}

#[test]
fn a_ramped_score_line_sends_stepped_power_to_the_gcode() {
    let svg = parse_svg(&fixture("square.svg")).unwrap();
    let mut project = project_with(svg.paths, LayerKind::Score, 10.0, 10.0);
    let layer = project
        .layers
        .iter_mut()
        .find(|l| l.kind == LayerKind::Score)
        .unwrap();
    layer.ramp_mm = 3.0;
    let layer_power = layer.power_percent;
    let max_s = project.machine.max_spindle_value as f64;
    let full = (layer_power / 100.0 * max_s).round() as u32;

    let job = build_job(&project, &HashMap::new(), &GcodeOptions::default()).unwrap();
    assert!(job.safety.is_safe_to_run(), "{:?}", job.safety);
    let values = spindle_values(&job.gcode);
    let distinct: std::collections::BTreeSet<u32> = values.iter().copied().collect();
    assert_eq!(*distinct.iter().max().unwrap(), full);
    assert!(*distinct.iter().min().unwrap() > 0, "{distinct:?}");
    // Eight steps up and the full power: nine different values, and the same eight on the way down.
    assert!(distinct.len() >= 9, "{distinct:?}");
    assert!(values.len() > 16, "{}", values.len());
    assert!(!job.gcode.contains("NaN"));
    assert_laser_off_during_rapids_and_at_the_end(&job.gcode);
}

#[test]
fn without_a_ramp_a_score_square_burns_at_one_power() {
    let svg = parse_svg(&fixture("square.svg")).unwrap();
    let project = project_with(svg.paths, LayerKind::Score, 10.0, 10.0);
    let job = build_job(&project, &HashMap::new(), &GcodeOptions::default()).unwrap();
    let distinct: std::collections::BTreeSet<u32> =
        spindle_values(&job.gcode).into_iter().collect();
    assert_eq!(distinct.len(), 1, "{distinct:?}");
}

#[test]
fn a_fill_outline_adds_one_trace_of_every_closed_shape_and_stays_safe() {
    let svg = parse_svg(&fixture("nested.svg")).unwrap();
    let mut project = project_with(svg.paths, LayerKind::Fill, 100.0, 100.0);
    project
        .layers
        .iter_mut()
        .find(|l| l.kind == LayerKind::Fill)
        .unwrap()
        .line_spacing_mm = 1.0;
    let plain = build_job(&project, &HashMap::new(), &GcodeOptions::default()).unwrap();
    project
        .layers
        .iter_mut()
        .find(|l| l.kind == LayerKind::Fill)
        .unwrap()
        .fill_outline = true;
    let job = build_job(&project, &HashMap::new(), &GcodeOptions::default()).unwrap();
    assert!(job.safety.is_safe_to_run(), "{:?}", job.safety);
    // The square adds 4 moves and the circle adds one per side of the polygon it was flattened to.
    let (before, after) = (
        g1_coordinates(&plain.gcode).len(),
        g1_coordinates(&job.gcode).len(),
    );
    assert!(after >= before + 4 + 16, "{before} -> {after}");
    assert!(!job.gcode.contains("NaN"));
    assert_laser_off_during_rapids_and_at_the_end(&job.gcode);
    // Every point is still on the bed.
    for (x, y) in g1_coordinates(&job.gcode) {
        assert!(
            (0.0..=300.0).contains(&x) && (0.0..=300.0).contains(&y),
            "{x} {y}"
        );
    }
}

#[test]
fn overscan_removes_the_stop_at_every_scan_line_and_never_moves_rapidly_with_the_laser_on() {
    let svg = parse_svg(&fixture("nested.svg")).unwrap();
    let mut project = project_with(svg.paths, LayerKind::Fill, 100.0, 100.0);
    project
        .layers
        .iter_mut()
        .find(|l| l.kind == LayerKind::Fill)
        .unwrap()
        .line_spacing_mm = 1.0;
    let plain = build_job(&project, &HashMap::new(), &GcodeOptions::default()).unwrap();
    project
        .layers
        .iter_mut()
        .find(|l| l.kind == LayerKind::Fill)
        .unwrap()
        .overscan_mm = 3.0;
    let job = build_job(&project, &HashMap::new(), &GcodeOptions::default()).unwrap();
    assert!(job.safety.is_safe_to_run(), "{:?}", job.safety);
    assert!(!plain.gcode.contains("M4 S0\n"));
    assert!(job.gcode.contains("M4 S0\n"));
    // Without overscan the laser is switched off (M5) before the rapid move to every scan line.
    // With it the head keeps moving, so there are far fewer.
    assert!(
        job.gcode.matches("M5\n").count() < plain.gcode.matches("M5\n").count(),
        "with overscan {} / without {}",
        job.gcode.matches("M5\n").count(),
        plain.gcode.matches("M5\n").count()
    );
    // The laser is never on during a rapid move, and the program ends with it off.
    let mut laser_on = false;
    for line in job.gcode.lines() {
        if line.starts_with("M4") || line.starts_with("M3") {
            laser_on = true;
        } else if line.starts_with("M5") {
            laser_on = false;
        } else if line.starts_with("G0") {
            assert!(!laser_on, "rapid move with the laser on: {line}");
        }
    }
    assert!(!laser_on, "program must end with the laser off");
}
