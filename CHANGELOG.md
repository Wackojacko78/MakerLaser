# Changelog

## Unreleased

### Added
- Measure tool: snapping, point and line measurements, selection size.
- Start From (absolute, current position, user origin) and Job Origin.
- Overscan for fill and image layers: laser-off run-up and run-out so each scan line is burned at
  full speed. Sent as `M4 S0` + `G1`, never `M5` + `G0`. See docs/overscan.md.
- Material test grid (speed x power) generator.
- Text objects.
- Auto-arrange.
- Run order control: engrave, score, then cut, or your own layer order.
- "Unsaved changes" prompt when closing.
- Machine connection settings: USB serial, WebSocket and Telnet (FluidNC).
- Machine and material catalogues; config import and export.
- Resizable console and right-hand panel.
- Frame with the laser on at low power, so the outline can be seen on the material. Off by default
  and off again every time MakerLaser starts. See docs/framing.md.
- Console command box: send `$$`, `$32=1` and other typed commands to the controller and see the
  reply. No real-time characters, no laser-on, no `$RST`, and only when no job is running.
  See docs/console.md.
- Shape objects: rectangle (with rounded corners), ellipse or circle, polygon and star, from
  Toolbar > Shape. See docs/shapes-and-text.md.
- Text and shapes stay editable: double-click one, or press Edit text / Edit shape in the
  Properties panel, to change what it was made from. Position and rotation are kept.
- Shapes and text are drawn straight on the canvas and edited in place, with no pop-up boxes: pick a
  tool in the Tools panel, drag or click, type the sizes and Tab between the boxes.

### Changed
- Frontend toolchain upgraded to Vite 7 and Vitest 4.
- CI: actions updated to Node 24 versions, runners pinned to ubuntu-24.04, and CI now runs on
  pushes to every branch.

## 0.1.0

First source release. Consolidates and corrects the earlier prototype packages.

### Added
- Workspace canvas: pan, zoom, grid, bed, origin axes, box select, multi-select, transform
  handles, numeric X/Y/W/H, rotate 90, undo/redo with coalescing, keyboard shortcuts,
  native drag-and-drop import.
- SVG, DXF and raster image import (see README for supported elements).
- Clipper2-backed boolean operations, offsetting and kerf compensation.
- Raster pipeline with four dithering algorithms and a live preview; rotated and mirrored
  images engrave correctly.
- Nesting-aware CAM ordering, travel reduction, serpentine fill, bidirectional raster.
- GRBL 1.1 controller with character-counting streaming, real-time pause/resume/stop,
  state checks, alarm/error decoding; offline simulator.
- Toolpath preview overlay with replay, cut-order numbers and out-of-bed highlighting.
- `.mlp` project format with atomic saves; material library CRUD and import/export.
- Pre-flight confirmation, stale-preview lock, connection and single-job enforcement.
- Verification scripts, CI and release workflows, Windows build script.

### Fixed relative to the earlier prototype
- **Workspace Y axis** is now converted to machine coordinates (jobs were mirrored top to bottom).
- **Default TTS-55 Pro bed** corrected from 400 × 400 to 300 × 300 mm (manufacturer figure).
- Optimising travel could cut an outer boundary before the holes inside it.
- Multiple passes repeated each path instead of the whole job.
- SVG transform lists applied in the wrong order; `Z` followed by a number looped forever.
- DXF units (`$INSUNITS`) were ignored; SPLINE and ELLIPSE were unsupported; loose segments
  were not joined into closed loops.
- Raster: run end points were off by one, bidirectional scanning did not reverse, rotated
  images were distorted, transparent PNGs burned as black.
- GRBL: long moves timed out, partial lines were lost on read timeouts, jobs reported
  completion before motion finished, status parsing replaced a real zero position.
- Imports were not assigned to a layer; Frame on an empty project framed the whole bed.
- Blocking commands ran on the UI thread; Windows build lacked `icon.ico`; duplicated images
  lost their pixel data; `.mlp` saves were not atomic.
- Frontend: rotation was not persisted, path aliases were not resolved by the bundler,
  panning conflicted with selection, undo history copied all geometry on every edit.
