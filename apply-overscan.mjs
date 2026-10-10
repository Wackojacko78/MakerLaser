#!/usr/bin/env node
// apply-overscan.mjs - adds per-layer Overscan to MakerLaser.
//
// Run from the repo root, on a clean branch:
//     git switch -c overscan
//     node apply-overscan.mjs --dry-run     (optional: checks every edit, writes nothing)
//     node apply-overscan.mjs
//
// Every edit is checked before anything is written. If any anchor is missing or ambiguous the
// script stops and changes nothing. Running it twice is harmless: finished edits are skipped.
// Line endings (LF or CRLF) and a UTF-8 BOM are preserved.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const DRY = process.argv.includes('--dry-run');
const ROOT = process.cwd();
const bt = (s) => s.replaceAll('§', '`'); // § stands for a backtick inside the payloads below

/* ------------------------------------------------------------------------------------------ */
/* Edits                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const edits = [];
const edit = (file, label, marker, find, replace) => edits.push({ file, label, marker, find, replace });
const append = (file, label, marker, text) => edits.push({ file, label, marker, append: text });

// ============================== packages/common/src/layers.rs ===============================
const LAYERS = 'packages/common/src/layers.rs';

edit(LAYERS, 'MAX_OVERSCAN_MM constant', 'MAX_OVERSCAN_MM: f64',
  String.raw`use crate::operations::RasterOperation;
`,
  String.raw`use crate::operations::RasterOperation;

/// Largest overscan a layer may ask for, in mm.
pub const MAX_OVERSCAN_MM: f64 = 25.0;
`);

edit(LAYERS, 'Layer.overscan_mm field', 'pub overscan_mm: f64',
  String.raw`    /// Image layers: raster pipeline settings.
    #[serde(default)]
    pub raster: RasterOperation,
}`,
  String.raw`    /// Image layers: raster pipeline settings.
    #[serde(default)]
    pub raster: RasterOperation,
    /// Fill and Image layers: how far the head runs past each end of a scan line, laser off, so
    /// the burn happens at full speed. 0 = off.
    #[serde(default)]
    pub overscan_mm: f64,
}`);

edit(LAYERS, 'Layer::new default', '            overscan_mm: 0.0,\n',
  String.raw`            cross_hatch: false,
            raster: RasterOperation::default(),
`,
  String.raw`            cross_hatch: false,
            raster: RasterOperation::default(),
            overscan_mm: 0.0,
`);

edit(LAYERS, 'Layer::validate', 'overscan must be between',
  String.raw`                "Layer '{n}': raster DPI must be between 25 and 2540"
            ));
        }
        problems`,
  String.raw`                "Layer '{n}': raster DPI must be between 25 and 2540"
            ));
        }
        if !(0.0..=MAX_OVERSCAN_MM).contains(&self.overscan_mm) {
            problems.push(format!(
                "Layer '{n}': overscan must be between 0 and {:.0} mm",
                MAX_OVERSCAN_MM
            ));
        }
        problems`);

edit(LAYERS, 'layers tests', 'fn overscan_is_off_by_default',
  String.raw`    #[test]
    fn default_set_has_four_layers_in_order() {`,
  String.raw`    #[test]
    fn overscan_is_off_by_default_and_old_files_load_with_it_off() {
        assert_eq!(Layer::new("Fill", LayerKind::Fill, 0).overscan_mm, 0.0);
        let json = r##"{"id":"6f9c1c0e-5b0e-4a77-9a67-2f0a1d3f9a11","name":"Fill","kind":"fill",
            "speed_mm_min":3000.0,"power_percent":40.0,"passes":1,"air_assist":false,
            "enabled":true,"z_order":2,"color":"#00FF00"}"##;
        let l: Layer = serde_json::from_str(json).unwrap();
        assert_eq!(l.overscan_mm, 0.0);
    }

    #[test]
    fn overscan_outside_its_range_is_rejected() {
        let mut l = Layer::new("Fill", LayerKind::Fill, 0);
        l.overscan_mm = 5.0;
        assert!(l.validate(100.0, 10_000.0).is_empty());
        for bad in [-1.0, MAX_OVERSCAN_MM + 1.0, f64::NAN] {
            l.overscan_mm = bad;
            assert_eq!(l.validate(100.0, 10_000.0).len(), 1, "{bad}");
        }
    }

    #[test]
    fn default_set_has_four_layers_in_order() {`);

// ============================== packages/project/src/toolpath.rs ============================
const TOOLPATH = 'packages/project/src/toolpath.rs';

edit(TOOLPATH, 'overscan constants', 'OVERSCAN_JOIN_MM: f64',
  String.raw`const RAPID_FEED_MM_MIN: f64 = 6000.0;
`,
  String.raw`const RAPID_FEED_MM_MIN: f64 = 6000.0;
/// Overscan: runs on one scan line closer together than this are joined by a laser-off move at
/// the layer's feed rate instead of a stop.
const OVERSCAN_JOIN_MM: f64 = 10.0;
/// Overscan moves shorter than this are dropped.
const OVERSCAN_MIN_MM: f64 = 0.01;
`);

edit(TOOLPATH, 'ToolpathSegment.overscan field', 'pub overscan: bool',
  String.raw`    pub power_percent: f64,
    pub air_assist: bool,
}
`,
  String.raw`    pub power_percent: f64,
    pub air_assist: bool,
    /// A laser-off move that belongs to an overscan run-up, run-out or join. The kind is
    /// Travel, but G-code sends it as M4 S0 + G1 at feed_mm_min (never M5 + G0), so GRBL's
    /// planner is not emptied between scan lines.
    #[serde(default)]
    pub overscan: bool,
}
`);

edit(TOOLPATH, 'Toolpath::bounds ignores overscan', '.filter(|s| !s.overscan)',
  String.raw`    /// Bounding box of every point the laser head visits (travel included).
    pub fn bounds(&self) -> Option<BoundingBox> {
        BoundingBox::from_points(self.segments.iter().flat_map(|s| [&s.from, &s.to]))
    }`,
  String.raw`    /// Bounding box of every point the laser head visits (travel included). Overscan moves
    /// are left out: they are clamped to the bed when they are made, and including them would
    /// move the job's edges (and so Start From / Job Origin) by the overscan distance.
    pub fn bounds(&self) -> Option<BoundingBox> {
        BoundingBox::from_points(
            self.segments
                .iter()
                .filter(|s| !s.overscan)
                .flat_map(|s| [&s.from, &s.to]),
        )
    }`);

edit(TOOLPATH, 'Builder::travel_to literal', '                air_assist: false,\n                overscan: false,',
  String.raw`                power_percent: 0.0,
                air_assist: false,
            });`,
  String.raw`                power_percent: 0.0,
                air_assist: false,
                overscan: false,
            });`);

edit(TOOLPATH, 'Builder::draw literal', '            overscan: false,\n        });\n        self.cursor = to;',
  String.raw`            air_assist: layer.air_assist,
        });
        self.cursor = to;`,
  String.raw`            air_assist: layer.air_assist,
            overscan: false,
        });
        self.cursor = to;`);

edit(TOOLPATH, 'Builder overscan methods', 'fn scan_lines(',
  String.raw`    fn path(&mut self, path: &Path2D, kind: MoveKind, layer: &Layer) {
`,
  String.raw`    /// A laser-off move to "to" at the layer's feed rate: an overscan run-up, run-out or join.
    /// G-code sends it as M4 S0 + G1, never M5 + G0, so GRBL's planner is not emptied and the
    /// head keeps its speed.
    fn dark(&mut self, to: Point2, layer: &Layer) {
        let from = self.cursor;
        if from.distance_to(&to) > 1e-9 {
            self.toolpath.segments.push(ToolpathSegment {
                from,
                to,
                kind: MoveKind::Travel,
                feed_mm_min: layer.speed_mm_min,
                power_percent: 0.0,
                air_assist: layer.air_assist,
                overscan: true,
            });
        }
        self.cursor = to;
    }

    /// Moves to the start of the next run-up. Short hops stay at the layer's feed rate so the
    /// head does not stop between scan lines; longer ones are ordinary rapid travel.
    fn link_to(&mut self, target: Point2, layer: &Layer) {
        let distance = self.cursor.distance_to(&target);
        if distance <= 1e-6 {
            self.cursor = target;
        } else if distance <= OVERSCAN_JOIN_MM {
            self.dark(target, layer);
        } else {
            self.travel_to(target);
        }
    }

    /// Burns scan lines with overscan. Each line is a list of runs in travel order. Runs on a
    /// line that are close together are burned as one chain (the gaps are crossed with the laser
    /// off, without stopping); each chain gets a laser-off run-up before it and run-out after it.
    fn scan_lines(
        &mut self,
        lines: &[Vec<(Point2, Point2)>],
        kind: MoveKind,
        layer: &Layer,
        bed: &BoundingBox,
    ) {
        let mut first = true;
        for line in lines {
            let mut start = 0;
            while start < line.len() {
                let mut end = start + 1;
                while end < line.len()
                    && line[end - 1].1.distance_to(&line[end].0) <= OVERSCAN_JOIN_MM
                {
                    end += 1;
                }
                self.scan_chain(&line[start..end], kind, layer, bed, first);
                first = false;
                start = end;
            }
        }
    }

    fn scan_chain(
        &mut self,
        chain: &[(Point2, Point2)],
        kind: MoveKind,
        layer: &Layer,
        bed: &BoundingBox,
        first: bool,
    ) {
        let (Some(&(head, along)), Some(&(_, tail))) = (chain.first(), chain.last()) else {
            return;
        };
        let length = head.distance_to(&along);
        let (run_up, run_out) = if length > 1e-9 {
            let (dx, dy) = ((along.x - head.x) / length, (along.y - head.y) / length);
            (
                extend_within_bed(head, -dx, -dy, layer.overscan_mm, bed),
                extend_within_bed(tail, dx, dy, layer.overscan_mm, bed),
            )
        } else {
            (head, tail)
        };
        // The first line of an operation is approached by a normal rapid move.
        if first {
            self.travel_to(run_up);
        } else {
            self.link_to(run_up, layer);
        }
        self.dark(head, layer);
        for (i, &(a, z)) in chain.iter().enumerate() {
            if i > 0 {
                self.dark(a, layer);
            }
            self.draw(a, z, kind, layer);
        }
        self.dark(run_out, layer);
    }

    fn path(&mut self, path: &Path2D, kind: MoveKind, layer: &Layer) {
`);

edit(TOOLPATH, 'overscan helper functions', 'fn extend_within_bed(',
  String.raw`fn world_paths(obj: &WorkspaceObject) -> Vec<Path2D> {
`,
  String.raw`/// The point reached by moving from "p" along the unit direction (dx, dy) by up to "max_mm",
/// stopping at the bed edge. Returns "p" itself when there is less than OVERSCAN_MIN_MM of room.
fn extend_within_bed(p: Point2, dx: f64, dy: f64, max_mm: f64, bed: &BoundingBox) -> Point2 {
    let mut reach = max_mm;
    if dx > 1e-12 {
        reach = reach.min((bed.max.x - p.x) / dx);
    } else if dx < -1e-12 {
        reach = reach.min((bed.min.x - p.x) / dx);
    }
    if dy > 1e-12 {
        reach = reach.min((bed.max.y - p.y) / dy);
    } else if dy < -1e-12 {
        reach = reach.min((bed.min.y - p.y) / dy);
    }
    if reach < OVERSCAN_MIN_MM {
        p
    } else {
        Point2::new(p.x + dx * reach, p.y + dy * reach)
    }
}

/// Splits raster runs (already in scan order) into scan lines: consecutive runs that share a row
/// (horizontal scan) or a column (vertical scan).
fn group_scan_lines(runs: &[(Point2, Point2)], horizontal: bool) -> Vec<Vec<(Point2, Point2)>> {
    let mut lines: Vec<Vec<(Point2, Point2)>> = Vec::new();
    let mut line_pos = f64::NAN;
    for &(a, z) in runs {
        let pos = if horizontal { a.y } else { a.x };
        let same_line = !lines.is_empty() && (pos - line_pos).abs() < 1e-9;
        if same_line {
            if let Some(line) = lines.last_mut() {
                line.push((a, z));
            }
        } else {
            lines.push(vec![(a, z)]);
            line_pos = pos;
        }
    }
    lines
}

fn world_paths(obj: &WorkspaceObject) -> Vec<Path2D> {
`);

edit(TOOLPATH, 'bed bounds', 'let bed = project.machine.bed_bounds();',
  String.raw`    let home = project.machine.machine_to_workspace(Point2::ZERO);
`,
  String.raw`    let home = project.machine.machine_to_workspace(Point2::ZERO);
    let bed = project.machine.bed_bounds();
`);

edit(TOOLPATH, 'Fill uses overscan', 'b.scan_lines(&rows',
  String.raw`                    for _ in 0..passes {
                        for row in &rows {
                            for (a, z) in row {
                                b.draw(*a, *z, MoveKind::Fill, layer);
                            }
                        }
                    }`,
  String.raw`                    for _ in 0..passes {
                        if layer.overscan_mm > 0.0 {
                            b.scan_lines(&rows, MoveKind::Fill, layer, &bed);
                        } else {
                            for row in &rows {
                                for (a, z) in row {
                                    b.draw(*a, *z, MoveKind::Fill, layer);
                                }
                            }
                        }
                    }`);

edit(TOOLPATH, 'Raster uses overscan', 'group_scan_lines(&runs',
  String.raw`                        Ok(runs) => {
                            for _ in 0..passes {
                                for (a, z) in &runs {
                                    b.draw(*a, *z, MoveKind::Engrave, layer);
                                }
                            }
                        }`,
  String.raw`                        Ok(runs) => {
                            let lines = if layer.overscan_mm > 0.0 {
                                let horizontal = params.direction == ScanDirection::Horizontal;
                                group_scan_lines(&runs, horizontal)
                            } else {
                                Vec::new()
                            };
                            for _ in 0..passes {
                                if layer.overscan_mm > 0.0 {
                                    b.scan_lines(&lines, MoveKind::Engrave, layer, &bed);
                                } else {
                                    for (a, z) in &runs {
                                        b.draw(*a, *z, MoveKind::Engrave, layer);
                                    }
                                }
                            }
                        }`);

edit(TOOLPATH, 'toolpath tests', 'fn overscan_adds_laser_off_run_up_and_run_out',
  String.raw`    #[test]
    fn travel_starts_from_the_machine_origin_in_workspace_terms() {`,
  String.raw`    // ---- overscan --------------------------------------------------------------------

    fn fill_project(paths: Vec<Path2D>, spacing: f64, overscan_mm: f64) -> ProjectFile {
        let mut p = project_with(LayerKind::Fill, paths);
        let layer = p
            .layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Fill)
            .unwrap();
        layer.line_spacing_mm = spacing;
        layer.overscan_mm = overscan_mm;
        p
    }

    fn burns(r: &ToolpathResult) -> Vec<(Point2, Point2)> {
        r.toolpath
            .segments
            .iter()
            .filter(|s| s.kind == MoveKind::Fill)
            .map(|s| (s.from, s.to))
            .collect()
    }

    fn dark_moves(r: &ToolpathResult) -> Vec<&ToolpathSegment> {
        r.toolpath.segments.iter().filter(|s| s.overscan).collect()
    }

    fn rapid_moves(r: &ToolpathResult) -> usize {
        r.toolpath
            .segments
            .iter()
            .filter(|s| s.kind == MoveKind::Travel && !s.overscan)
            .count()
    }

    #[test]
    fn overscan_is_off_unless_a_fill_or_image_layer_asks_for_it() {
        let plain = generate(&fill_project(vec![square(50.0, 50.0, 10.0)], 1.0, 0.0));
        assert!(dark_moves(&plain).is_empty());
        // Cut layers have no overscan, even if the value is set.
        let mut cut = project_with(LayerKind::Cut, vec![square(50.0, 50.0, 10.0)]);
        cut.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Cut)
            .unwrap()
            .overscan_mm = 5.0;
        assert!(dark_moves(&generate(&cut)).is_empty());
    }

    #[test]
    fn overscan_adds_laser_off_run_up_and_run_out_without_changing_the_burn() {
        let plain = generate(&fill_project(vec![square(50.0, 50.0, 10.0)], 1.0, 0.0));
        let with = generate(&fill_project(vec![square(50.0, 50.0, 10.0)], 1.0, 3.0));
        assert_eq!(burns(&with), burns(&plain));
        let segs = &with.toolpath.segments;
        let first_burn = segs
            .iter()
            .position(|s| s.kind == MoveKind::Fill)
            .unwrap();
        let near = |a: f64, b: f64| (a - b).abs() < 1e-6;
        // Run-up: 3 mm before the first burn, on the same scan line, laser off.
        let run_up = &segs[first_burn - 1];
        assert!(run_up.overscan && run_up.kind == MoveKind::Travel && run_up.power_percent == 0.0);
        assert!(
            near(run_up.from.x, 47.0) && near(run_up.to.x, 50.0) && near(run_up.to.y, 50.5),
            "{run_up:?}"
        );
        // Run-out: 3 mm past the end of the burn.
        let run_out = &segs[first_burn + 1];
        assert!(run_out.overscan);
        assert!(
            near(run_out.from.x, 60.0) && near(run_out.to.x, 63.0),
            "{run_out:?}"
        );
        // Dark moves run at the layer's feed rate, not the rapid rate.
        assert!(dark_moves(&with).iter().all(|s| s.feed_mm_min == 3000.0));
    }

    #[test]
    fn fill_lines_are_joined_at_feed_rate_instead_of_stopping_between_them() {
        let r = generate(&fill_project(vec![square(50.0, 50.0, 10.0)], 1.0, 3.0));
        // The only rapid move is the approach to the first run-up.
        assert_eq!(rapid_moves(&r), 1);
        // Ten lines: ten run-ups, ten run-outs and nine joins between lines.
        assert_eq!(dark_moves(&r).len(), 29);
    }

    #[test]
    fn overscan_never_leaves_the_bed() {
        // The shape touches the right edge of the 300 mm bed, so no run-out is possible there.
        let r = generate(&fill_project(vec![square(290.0, 100.0, 10.0)], 1.0, 5.0));
        for s in &r.toolpath.segments {
            for q in [s.from, s.to] {
                assert!(
                    q.x >= -1e-6 && q.x <= 300.0 + 1e-6 && q.y >= -1e-6 && q.y <= 300.0 + 1e-6,
                    "{s:?}"
                );
            }
        }
        // The left-hand side has room, so those run-ups and run-outs are kept.
        assert!(dark_moves(&r)
            .iter()
            .any(|s| s.from.x.min(s.to.x) < 288.0));
    }

    #[test]
    fn distant_runs_on_one_line_each_get_their_own_run_up_and_run_out() {
        let shapes = || vec![square(50.0, 100.0, 10.0), square(150.0, 100.0, 10.0)];
        let plain = generate(&fill_project(shapes(), 5.0, 0.0));
        let with = generate(&fill_project(shapes(), 5.0, 2.0));
        assert_eq!(burns(&with), burns(&plain));
        // Nothing crosses the 90 mm gap at feed rate: the gap is a rapid move.
        assert!(dark_moves(&with)
            .iter()
            .all(|s| s.from.distance_to(&s.to) <= 5.0 + 1e-6));
        assert!(rapid_moves(&with) >= 3, "{}", rapid_moves(&with));
    }

    #[test]
    fn raster_lines_get_run_ups_and_run_outs_and_the_burn_is_unchanged() {
        // Row 0: black black white black. Placed away from the bed edge so nothing is clamped.
        let (mut p, bytes) = raster_project([[0, 0, 255, 0], [255; 4]], false);
        p.objects[0].transform = Transform2D::translate(100.0, 100.0);
        let plain = engrave(&p, &bytes);
        p.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Image)
            .unwrap()
            .overscan_mm = 1.0;
        assert_eq!(engrave(&p, &bytes), plain);
        let plan = plan_operations(&p);
        let tp = generate_toolpath(&p, &plan.operations, &bytes)
            .unwrap()
            .toolpath;
        let dark: Vec<&ToolpathSegment> = tp.segments.iter().filter(|s| s.overscan).collect();
        // Run-up, the 0.1 mm gap between the two runs (crossed, not stopped), and run-out.
        assert_eq!(dark.len(), 3, "{dark:?}");
        let near = |a: f64, b: f64| (a - b).abs() < 1e-6;
        assert!(near(dark[0].from.x, 99.0) && near(dark[0].to.x, 100.0));
        assert!(near(dark[1].from.x, 100.2) && near(dark[1].to.x, 100.3));
        assert!(near(dark[2].from.x, 100.4) && near(dark[2].to.x, 101.4));
    }

    #[test]
    fn travel_starts_from_the_machine_origin_in_workspace_terms() {`);

// ============================== packages/project/src/gcode.rs ===============================
const GCODE = 'packages/project/src/gcode.rs';

edit(GCODE, 'gcode module doc', 'Overscan moves (laser-off',
  '//! * Air assist uses ',
  bt(String.raw`//! * Overscan moves (laser-off run-ups, run-outs and joins) are sent as §M4 S0§ + §G1§, never
//!   §M5§ + §G0§, so GRBL's planner is not emptied between scan lines.
//! * Air assist uses `));

edit(GCODE, 'travel arm skips overscan moves', 'MoveKind::Travel if !seg.overscan => {',
  String.raw`            MoveKind::Travel => {
`,
  String.raw`            MoveKind::Travel if !seg.overscan => {
`);

edit(GCODE, 'burn arm also handles overscan moves', '            | MoveKind::Engrave => {',
  String.raw`            MoveKind::Cut | MoveKind::Score | MoveKind::Fill | MoveKind::Engrave => {
`,
  String.raw`            MoveKind::Travel
            | MoveKind::Cut
            | MoveKind::Score
            | MoveKind::Fill
            | MoveKind::Engrave => {
`);

edit(GCODE, 'overscan power is zero', 'let mut s = if seg.overscan {',
  String.raw`                let mut s = (seg.power_percent / 100.0 * max_s)
                    .round()
                    .clamp(0.0, max_s) as u32;
                if s == 0 && seg.power_percent > 0.0 {
                    s = 1;
                }`,
  String.raw`                // Overscan moves keep the laser armed (M4) at zero power, so GRBL never has to
                // empty its planner to switch it off.
                let mut s = if seg.overscan {
                    0
                } else {
                    (seg.power_percent / 100.0 * max_s)
                        .round()
                        .clamp(0.0, max_s) as u32
                };
                if s == 0 && !seg.overscan && seg.power_percent > 0.0 {
                    s = 1;
                }`);

edit(GCODE, 'gcode test helper literal', '            air_assist: air,\n            overscan: false,',
  String.raw`            air_assist: air,
        }`,
  String.raw`            air_assist: air,
            overscan: false,
        }`);

edit(GCODE, 'gcode tests', 'fn overscan_moves_stay_armed_at_s0',
  String.raw`    #[test]
    fn header_and_footer() {`,
  String.raw`    fn dark(from: (f64, f64), to: (f64, f64), feed: f64) -> ToolpathSegment {
        ToolpathSegment {
            from: Point2::new(from.0, from.1),
            to: Point2::new(to.0, to.1),
            kind: MoveKind::Travel,
            feed_mm_min: feed,
            power_percent: 0.0,
            air_assist: false,
            overscan: true,
        }
    }

    #[test]
    fn overscan_moves_stay_armed_at_s0_so_grbl_never_empties_its_planner() {
        // Workspace (0, 300) is the machine origin on the TTS-55 Pro.
        let g = gen(vec![
            dark((0.0, 300.0), (2.0, 300.0), 3000.0),
            seg(
                (2.0, 300.0),
                (10.0, 300.0),
                MoveKind::Fill,
                3000.0,
                80.0,
                false,
            ),
            dark((10.0, 300.0), (12.0, 300.0), 3000.0),
        ]);
        let lines = body(&g);
        assert_eq!(
            &lines[5..11],
            [
                "M4 S0",
                "G1 X2 Y0 F3000",
                "M4 S800",
                "G1 X10 Y0",
                "M4 S0",
                "G1 X12 Y0"
            ]
        );
        // Only the header and the end of the job switch the laser off.
        assert_eq!(lines.iter().filter(|l| **l == "M5").count(), 2, "{lines:?}");
    }

    #[test]
    fn a_real_travel_after_an_overscan_move_switches_the_laser_off_first() {
        let g = gen(vec![
            dark((0.0, 300.0), (2.0, 300.0), 3000.0),
            seg(
                (2.0, 300.0),
                (50.0, 250.0),
                MoveKind::Travel,
                6000.0,
                0.0,
                false,
            ),
        ]);
        let lines = body(&g);
        let rapid = lines.iter().position(|l| l.starts_with("G0 X50")).unwrap();
        assert_eq!(lines[rapid - 1], "M5");
    }

    #[test]
    fn header_and_footer() {`);

// ============================== packages/project/src/safety.rs ==============================
const SAFETY = 'packages/project/src/safety.rs';

edit(SAFETY, 'safety overscan warning', 'Overscan adds up to',
  String.raw`    report
}

pub fn check_all(`,
  String.raw`    let overscan_mm = project
        .layers
        .iter()
        .filter(|l| {
            l.enabled
                && matches!(
                    l.kind,
                    makerlaser_common::LayerKind::Fill | makerlaser_common::LayerKind::Image
                )
        })
        .map(|l| l.overscan_mm)
        .fold(0.0_f64, f64::max);
    if overscan_mm > 0.0 && project.settings.start_from.is_relative() {
        report.warnings.push(format!(
            "Overscan adds up to {overscan_mm:.1} mm of laser-off travel beyond each end of every scan line. Start From is relative to the laser head, so MakerLaser cannot keep that inside the bed: leave at least that much clear space around the artwork, and use Frame first."
        ));
    }
    report
}

pub fn check_all(`);

edit(SAFETY, 'safety test helper literal', '                air_assist: false,\n                overscan: false,\n            })',
  String.raw`                air_assist: false,
            })`,
  String.raw`                air_assist: false,
                overscan: false,
            })`);

edit(SAFETY, 'safety tests', 'fn overscan_with_a_relative_start_is_warned_about',
  String.raw`    #[test]
    fn a_job_inside_the_bed_is_safe() {`,
  String.raw`    #[test]
    fn overscan_with_a_relative_start_is_warned_about_but_not_blocked() {
        let mut p = ProjectFile::new("T", MachineProfile::tts55_pro());
        p.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Fill)
            .unwrap()
            .overscan_mm = 3.0;
        assert!(!check_project(&p)
            .warnings
            .iter()
            .any(|w| w.contains("Overscan")));
        p.settings = serde_json::from_str(
            r#"{"units":"mm","grid_spacing_mm":10.0,"show_grid":true,"show_origin":true,"start_from":"current_position","job_origin":"center"}"#,
        )
        .unwrap();
        let r = check_project(&p);
        assert!(r.is_safe_to_run());
        assert!(r.warnings.iter().any(|w| w.contains("Overscan adds up to 3.0 mm")));
    }

    #[test]
    fn a_job_inside_the_bed_is_safe() {`);

// ============================== packages/project/tests/pipeline.rs ==========================
append('packages/project/tests/pipeline.rs', 'pipeline test', 'fn overscan_removes_the_stop_at_every_scan_line',
  String.raw`
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
`);

// ============================== apps/desktop-ui ============================================
const DOMAIN = 'apps/desktop-ui/src/types/domain.ts';
edit(DOMAIN, 'Layer.overscan_mm (TypeScript)', 'overscan_mm?: number;',
  String.raw`  raster: RasterOperation;
}`,
  String.raw`  raster: RasterOperation;
  /** Fill and Image layers: laser-off run-up and run-out past each scan line, in mm. Absent in older files, which means 0. */
  overscan_mm?: number;
}`);

const PANEL = 'apps/desktop-ui/src/components/LayersPanel.tsx';
edit(PANEL, 'Overscan field (Fill layers)', "patch('overscan-fill'",
  String.raw`            <input type="checkbox" checked={layer.cross_hatch} onChange={(e) => patch('hatch', (l) => (l.cross_hatch = e.target.checked))} />
            <span className="unit" />
`,
  String.raw`            <input type="checkbox" checked={layer.cross_hatch} onChange={(e) => patch('hatch', (l) => (l.cross_hatch = e.target.checked))} />
            <span className="unit" />
            <label>Overscan</label>
            <NumberField value={layer.overscan_mm ?? 0} min={0} max={25} onCommit={(v) => patch('overscan-fill', (l) => (l.overscan_mm = v))} />
            <span className="unit">mm (0 = off)</span>
`);
edit(PANEL, 'Overscan field (Image layers)', "patch('overscan-image'",
  String.raw`            <input type="checkbox" checked={layer.raster.bidirectional} onChange={(e) => patchRaster('bidirectional', e.target.checked)} />
            <span className="unit" />
`,
  String.raw`            <input type="checkbox" checked={layer.raster.bidirectional} onChange={(e) => patchRaster('bidirectional', e.target.checked)} />
            <span className="unit" />
            <label>Overscan</label>
            <NumberField value={layer.overscan_mm ?? 0} min={0} max={25} onCommit={(v) => patch('overscan-image', (l) => (l.overscan_mm = v))} />
            <span className="unit">mm (0 = off)</span>
`);

/* ------------------------------------------------------------------------------------------ */
/* Docs                                                                                       */
/* ------------------------------------------------------------------------------------------ */

const DOC_PATH = 'docs/overscan.md';
const DOC = bt(`# Overscan

Overscan makes the laser head run past each end of a scan line with the laser off, so the
burn itself happens at full, steady speed. Without it the head is still accelerating or braking
at the edges of a fast fill or photo engraving, and the edges come out darker or smeared.

## Setting

**Layers panel > Fill or Image layer > Overscan (mm).** Default 0 (off). Range 0 to 25 mm.
Cut and Score layers do not use it. Old projects load with overscan off.

Rule of thumb: the distance the head needs to reach full speed is roughly
§speed² / (2 × acceleration)§. At 6000 mm/min (100 mm/s) and 1000 mm/s² that is 5 mm. Start
around 2 to 5 mm and raise it only if the edges still look uneven. Check your machine's
acceleration setting (§$120§ and §$121§ in GRBL) if you want to calculate it.

## What it does

For every scan line (or group of runs on one line that are less than 10 mm apart):

1. Run-up: a laser-off move to the start of the line, from the overscan distance before it.
2. The burn: unchanged. The burned lines are identical with and without overscan.
3. Run-out: a laser-off move past the end of the line, by the overscan distance.

Gaps shorter than 10 mm between runs on one line, and the hop to the next line, are crossed
without stopping. Longer gaps are an ordinary rapid move and each side gets its own run-up and
run-out. Run-ups and run-outs are shortened, or dropped, where they would leave the bed.

## G-code

Overscan moves are sent as §M4 S0§ followed by §G1§ at the layer's feed rate, never as §M5§ +
§G0§. GRBL empties its motion planner when the laser is switched off with §M5§, which would stop
the head and undo the run-up. §M5§ is still sent before every §G0§ rapid move and at the end of
the job, so the laser is never on during a rapid move.

Example (a fill line from X50 to X60 at 3000 mm/min, 3 mm overscan, 40% power on a 1000 S machine):

§§§
G0 X47 Y249.5      ; rapid to the start of the run-up (laser off)
M4 S0
G1 X50 Y249.5 F3000
M4 S400
G1 X60 Y249.5      ; the burn
M4 S0
G1 X63 Y249.5      ; run-out
G1 X63 Y248.5      ; hop to the next line, no stop
G1 X60 Y248.5      ; next run-up
M4 S400
G1 X50 Y248.5      ; the burn, other direction
§§§

## Limits

- **Start From / Job Origin relative to the laser head:** MakerLaser cannot check that the
  overscan stays on the bed from where the head is. Leave at least the overscan distance clear
  around the artwork and use Frame first. Pre-flight shows a warning when this applies.
- **Preview, Frame and job bounds:** overscan moves are Travel-type moves, so the preview should
  draw them as travel, and they are not part of the job's bounds. Frame and Job Origin still
  refer to the artwork.
- **Estimated time and distance:** overscan moves count as travel distance.
- **Soft limits:** if $20 (soft limits) is on and the head is close to the machine edge, GRBL can
  raise an alarm for an overscan move. The bed clamp prevents this in Absolute mode.
- **Presets:** material presets do not store overscan yet.

## Testing it

1. Engrave a fast fill or photo at the speed you normally use with overscan 0. Look at the
   left and right edges.
2. Set overscan to 3 mm and repeat on scrap material. Edges should be cleaner, and the Fill or
   Image should not be longer or wider.
3. Frame first, and keep your hand near the stop button as usual.
`);

/* ------------------------------------------------------------------------------------------ */
/* Machinery                                                                                  */
/* ------------------------------------------------------------------------------------------ */

const fail = (msg) => {
  console.error('\nSTOPPED, nothing was changed.\n' + msg + '\n');
  process.exit(1);
};

if (!fs.existsSync(path.join(ROOT, 'packages/project/src/toolpath.rs'))) {
  fail('Run this from the MakerLaser repo root (the folder that contains packages/ and apps/).');
}

// Git state: warn on the branch, refuse on uncommitted changes to tracked files.
try {
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
  const dirty = execSync('git status --porcelain --untracked-files=no', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
  if (dirty && !process.argv.includes('--force')) {
    fail('There are uncommitted changes to tracked files:\n' + dirty + '\nCommit or stash them first (or pass --force).');
  }
  if (branch === 'main' || branch === 'master') {
    console.log("Note: you are on '" + branch + "'. Consider 'git switch -c overscan' first so main stays clean.\n");
  }
} catch {
  console.log('Note: git was not available, so the clean-tree check was skipped.\n');
}

// Load every file once. Text is edited exactly as it is on disk: the anchors are converted to
// the file's own line endings, so lines the script does not touch are never altered.
const files = new Map();
const load = (rel) => {
  if (!files.has(rel)) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) fail('Missing file: ' + rel);
    const raw = fs.readFileSync(abs, 'utf8');
    const bom = raw.charCodeAt(0) === 0xfeff;
    const text = bom ? raw.slice(1) : raw;
    const crlf = (text.match(/\r\n/g) || []).length;
    const lf = (text.match(/(?<!\r)\n/g) || []).length;
    files.set(rel, { eol: crlf > lf ? '\r\n' : '\n', bom, text, changed: false });
  }
  return files.get(rel);
};

const count = (hay, needle) => (needle === '' ? 0 : hay.split(needle).length - 1);
const withEol = (s, eol) => s.replace(/\n/g, eol);
const results = [];

for (const e of edits) {
  const f = load(e.file);
  const styles = [...new Set([f.eol, '\n', '\r\n'])];
  if (styles.some((eol) => f.text.includes(withEol(e.marker, eol)))) {
    results.push(['skip', e]);
    continue;
  }
  if (e.append !== undefined) {
    f.text = f.text.replace(/(\r?\n)*$/, f.eol) + withEol(e.append, f.eol);
    f.changed = true;
    results.push(['done', e]);
    continue;
  }
  const eol = styles.find((s) => count(f.text, withEol(e.find, s)) === 1);
  if (eol === undefined) {
    const n = Math.max(...styles.map((s) => count(f.text, withEol(e.find, s))));
    fail(
      e.file + ': cannot apply "' + e.label + '".\n' +
        (n === 0
          ? 'The text to change was not found. The file may differ from the one this script was written for.'
          : 'The text to change appears ' + n + ' times, so the edit would be ambiguous.') +
        '\nFirst line looked for: ' + JSON.stringify(e.find.split('\n')[0]),
    );
  }
  const from = withEol(e.find, eol);
  const to = withEol(e.replace, eol);
  f.text = f.text.replace(from, () => to);
  f.changed = true;
  results.push(['done', e]);
}

// Scan for code that builds the changed structs by hand, which would need the new field.
const walk = (dir, out = []) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['target', 'node_modules', '.git', 'dist'].includes(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith('.rs')) out.push(p);
  }
  return out;
};
const patched = new Set([...files.keys()]);
const warnings = [];
for (const dir of ['packages', 'apps']) {
  if (!fs.existsSync(path.join(ROOT, dir))) continue;
  for (const abs of walk(path.join(ROOT, dir))) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (patched.has(rel)) continue;
    fs.readFileSync(abs, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/\bToolpathSegment\s*\{/.test(line) && !/struct\s+ToolpathSegment|impl\b/.test(line)) {
          warnings.push(rel + ':' + (i + 1) + '  builds a ToolpathSegment by hand: add "overscan: false,"');
        }
        if (/(^|[^\w])Layer\s*\{/.test(line) && !/struct\s+Layer|impl\b|for\s+Layer/.test(line)) {
          warnings.push(rel + ':' + (i + 1) + '  builds a Layer by hand: add "overscan_mm: 0.0,"');
        }
      });
  }
}

// Report, then write.
for (const [state, e] of results) {
  console.log((state === 'skip' ? '  already applied  ' : '  ' + (DRY ? 'would apply' : 'applied') + '        ') + e.file + '  (' + e.label + ')');
}

const docAbs = path.join(ROOT, DOC_PATH);
const docExists = fs.existsSync(docAbs);
console.log('  ' + (DRY ? 'would write' : 'wrote') + '          ' + DOC_PATH + (docExists ? ' (replacing the existing file)' : ''));

if (!DRY) {
  for (const [rel, f] of files) {
    if (!f.changed) continue;
    const out = (f.bom ? '\uFEFF' : '') + f.text;
    fs.writeFileSync(path.join(ROOT, rel), out);
  }
  fs.mkdirSync(path.dirname(docAbs), { recursive: true });
  fs.writeFileSync(docAbs, DOC);
}

const applied = results.filter(([s]) => s === 'done').length;
console.log('\n' + (DRY ? 'Dry run: ' : '') + applied + ' edit(s) ' + (DRY ? 'would be applied' : 'applied') + ', ' + (results.length - applied) + ' already in place.');

if (warnings.length) {
  console.log('\nCheck these (code outside the files this script edits):');
  for (const w of warnings) console.log('  ' + w);
}

console.log(`
Next:
  cargo test --workspace            (expect 12 new tests; 236 -> 248 if nothing else changed)
  cd apps/desktop-ui
  npm run lint
  npm run typecheck
  npm test
  cd ..\\..
  git add -A
  git commit -m "Add overscan for fill and image layers"
`);
