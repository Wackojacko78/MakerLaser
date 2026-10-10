# Changelog

## Unreleased

### Added

**Drawing and text**
- Rectangle, ellipse, polygon, star and text tools: drag or click on the canvas, type exact sizes
  and press Tab between the boxes, with no pop-up dialogs. Text is typed straight onto the canvas.
  The keys R, E, P, S and T pick the tools. See docs/shapes-and-text.md.
- Text and shapes stay editable: double-click, press Enter or F2, or use the boxes in the Properties
  panel. What they were made from is saved with the project.
- 35 built-in fonts and a grouped font list; more of the fonts installed on the computer are
  found, and text waits for a font to load before it is drawn. See docs/fonts.md.

**Import**
- SVG `<use>` and `<symbol>`, and DXF `INSERT` (blocks, scaled, rotated, in arrays and nested), are
  placed instead of being skipped. Copies are capped so a damaged file cannot fill the computer.
  See docs/import.md.

**Laser settings and placement**
- Overscan for fill and image layers: a laser-off run-up and run-out so each scan line is burned at
  full speed. Sent as `M4 S0` + `G1`, never `M5` + `G0`. See docs/overscan.md.
- A fill outline pass that traces the edge of filled shapes once after the fill, and ramped power on
  score lines so the ends do not burn darker. Both are off by default. Ramping needs GRBL laser
  mode (`$32=1`) and warns when you generate. See docs/fill-and-ramp.md.
- Start From (absolute, current position, user origin) and Job Origin. See docs/start-from.md.
- Frame with the laser on at low power, so the outline can be seen on the material. Off by default
  and off again every time MakerLaser starts. See docs/framing.md.
- Material test grid (speed x power), auto-arrange, and run order control (engrave, score, then cut,
  or your own order).

**Machine**
- Console command box: send `$$`, `$32=1` and other typed commands and see the reply. No laser-on,
  no `$RST`, no real-time characters, and only when no job is running. See docs/console.md.
- Machine connection settings for USB serial, WebSocket and Telnet (FluidNC). Only USB serial
  connects so far. See docs/connection.md.
- Machine and material catalogues; config import and export. See docs/catalog.md.

**Interface**
- Measure tool with snapping. See docs/measure.md.
- Toolpath preview: laser-off moves are drawn faintly, and a Travel tick box hides them. See
  docs/preview.md.
- Resizable console and right-hand panel; an "unsaved changes" prompt when closing.

**Documentation and tooling**
- A user guide and a documentation index (docs/README.md); VERIFICATION.md now records what has been
  tried on a real laser; README, SAFETY, INSTALL, CONTRIBUTING, the architecture, API, project
  format and roadmap documents brought up to date.
- `scripts/check-docs.mjs` checks that the documents still match the code (links, file names, the
  command table, version numbers); `scripts/font-licenses.mjs` lists the licence of each built-in font.

### Changed
- Front-end toolchain upgraded to Vite 7 and Vitest 4.
- CI: actions updated to Node 24 versions, runners pinned to ubuntu-24.04, CI runs on pushes to every
  branch, and the Rust format check is enforced.
- Pause is refused when no job is running (use STOP to end a frame).

### Fixed
- Choosing the generic serif or monospace font drew sans-serif.

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
