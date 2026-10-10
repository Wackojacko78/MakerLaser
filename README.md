# MakerLaser

Laser engraving and cutting software for hobbyists, makers and small businesses. It targets
the **Two Trees TTS-55 Pro** first and any **GRBL 1.1** laser second, with a layered
architecture that leaves room for Ruida and galvo controllers later.

> **Status: pre-release (0.1.0 plus the changes under "Unreleased" in [`CHANGELOG.md`](CHANGELOG.md)).**
> It builds and tests clean on Windows and Ubuntu, runs on Windows, and has engraved real jobs on a
> TTS-55 Pro. Several newer features have not yet been run on a laser. Read
> [`VERIFICATION.md`](VERIFICATION.md) for exactly what has and has not been checked, and
> [`SAFETY.md`](SAFETY.md) before the first powered job.

## What it does

1. Start the app. **Import** an SVG, DXF, PNG, JPG or BMP (the Import button, Ctrl+I, or drop the
   file on the window), or draw shapes and type text straight onto the canvas.
2. Move, resize and rotate it on a bed that matches your machine.
3. Give it a **layer** (Cut, Score, Fill, Image) and pick a **material preset**.
4. **Generate & Preview**: a colour-coded toolpath, cut order, runtime estimate, safety checks.
5. **Connect**, set the origin, **Frame** the outline (laser off, or at low power so you can see
   it), then **Start**.
6. Everything also works against a built-in **simulator**, with no hardware.

New here? Read the [user guide](docs/user-guide.md). Every other document is listed in
[`docs/README.md`](docs/README.md).

| Area | Capabilities |
|---|---|
| Workspace | Pan/zoom canvas, grid, machine bed, origin marker, box and multi-select, move/resize/rotate, duplicate, delete, undo/redo, numeric position and size, native drag-and-drop, resizable panels |
| Drawing | Rectangle, ellipse, polygon, star and text, drawn by dragging or clicking on the canvas, sized by typing exact numbers and pressing Tab, and **editable afterwards** (double-click). 35 built-in fonts, plus the fonts installed on the computer |
| Import | SVG (all path commands, nested transforms, units, `<use>` and `<symbol>`), DXF (LINE, ARC, CIRCLE, ELLIPSE, LWPOLYLINE with bulges, POLYLINE, SPLINE, INSERT blocks and arrays; units; auto-join into closed loops), PNG/JPG/JPEG/BMP |
| Measure | Snap to corners, midpoints, centres and edges; distances, angles, gaps; selection size and outline length |
| Geometry | Clipper2 union / difference / intersection / XOR, offsetting, **kerf compensation** |
| Raster | Brightness, contrast, gamma, invert; Floyd-Steinberg, Jarvis, Stucki, Atkinson; live preview; works with rotated and mirrored images |
| CAM | Nesting-aware cut order (holes before the boundary that contains them), travel reduction, engrave-before-cut or your own run order, whole-job passes, serpentine fill, bidirectional raster, **overscan**, a fill **outline pass**, **ramped power** on score lines, material test grid, auto-arrange |
| G-code | GRBL 1.1: `M4` dynamic power, laser always off before travel, air assist `M8`/`M9`, modal-state tracking |
| Placement | Absolute, Current position or User origin, with a job origin point, and Frame to check where the job will land |
| Machine | USB serial GRBL with **character-counting streaming**, pause/resume/stop on the real-time channel, jog, home, unlock, set origin, frame (also with the laser on at low power), a **command box** for `$$` and settings, state checks, alarm/error decoding |
| Preview | Colour-coded moves, cut-order numbers, replay slider, out-of-bed highlight, faint laser-off travel with a Travel switch |
| Safety | Bed-bounds, layer and NaN checks; stale-preview lock; pre-flight confirmation; one job at a time; connection required for every motion |
| Project | `.mlp` zip archive, atomic saves, shared image assets, schema versioning |
| Machines and materials | A catalogue of 19 machines and 31 starter material presets; create, edit, import and export your own |

## Quick start (Windows)

```powershell
# one-time prerequisites, see INSTALL.md for details
winget install OpenJS.NodeJS.LTS Rustlang.Rustup Microsoft.VisualStudio.2022.BuildTools

cd C:\Dev\MakerLaser
npm install
.\verify-makerlaser.ps1        # compiles and tests everything; writes verification.log
npm run dev                    # launches the desktop app (run it from this folder)
.\build-windows.ps1            # builds the installers
```

Full instructions, macOS/Linux notes and troubleshooting: [`INSTALL.md`](INSTALL.md) and
[`docs/linux.md`](docs/linux.md).

## Architecture

```text
React UI  (Konva canvas, Zustand state)            apps/desktop-ui
   │  Tauri commands (typed, apps/rust-core)
   ▼
Application services  (state, import, generate, machine)   apps/rust-core
   ▼
Domain models  ──►  Operations  ──►  Toolpaths  ──►  G-code      packages/common, packages/project
   ▲                                                  │
Geometry (Clipper2, SVG/DXF)   Raster (dither)        ▼
packages/geometry              packages/raster     Machine layer (GRBL | Simulator)   packages/machine
                                                       ▼
                                                    Hardware
```

The UI never builds G-code. Details: [`docs/architecture.md`](docs/architecture.md).

## Repository layout

```text
apps/desktop-ui     React + TypeScript + Konva + Zustand
apps/rust-core      Tauri shell and commands
packages/common     Domain models (serde)
packages/geometry   Clipper2 adapter, offsetting, curve flattening, SVG + DXF import, path joining
packages/raster     Image adjustment, dithering, resampling
packages/machine    GRBL controller, simulator, status and error decoding
packages/project    CAM planner, toolpaths, G-code, safety, .mlp format
docs/               user guide, how each feature works, architecture, API, roadmap
tests/fixtures      SVG and DXF samples used by the integration tests
scripts/            verify.mjs, tauri.mjs, font-licenses.mjs, check-docs.mjs
```

## Tests

```text
cargo test --workspace      Rust unit + integration tests (geometry, CAM, G-code, GRBL protocol against a fake controller, .mlp)
npm run ui:test             front-end unit and state tests
npm run verify              everything above plus type-check, lint and a production build
node scripts/check-docs.mjs checks that these documents still match the code
```

## Licence

GPL-3.0-or-later (see [`LICENSE`](LICENSE)). No code from LaserGRBL or any other GPL project
is included; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
