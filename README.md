# MakerLaser

Laser engraving and cutting software for hobbyists, makers and small businesses. It targets
the **Two Trees TTS-55 Pro** first and any **GRBL 1.1** laser second, with a layered
architecture that leaves room for Ruida and galvo controllers later.

> **Status: 0.1.0, source release. Not yet hardware-tested.**
> The code has not been compiled or run on a real machine by the author of this package.
> Read [`VERIFICATION.md`](VERIFICATION.md) for exactly what has and has not been checked,
> and [`SAFETY.md`](SAFETY.md) before the first powered job.

## What it does

1. Launch, drop an **SVG, DXF, PNG, JPG or BMP** file onto the window.
2. Move, resize and rotate it on a bed that matches your machine.
3. Pick a **layer** (Cut, Score, Fill, Image) and a **material preset**.
4. **Generate & Preview**: a colour-coded toolpath, cut order, runtime estimate, safety checks.
5. **Connect**, set the origin, **Frame** the outline with the laser off, then **Start**.
6. Everything also works against a built-in **simulator**, with no hardware.

| Area | Capabilities |
|---|---|
| Workspace | Pan/zoom canvas, grid, machine bed, origin marker, box and multi-select, move/resize/rotate, duplicate, delete, undo/redo, numeric position and size, native drag-and-drop |
| Import | SVG (all path commands, nested transforms, units), DXF (LINE, ARC, CIRCLE, ELLIPSE, LWPOLYLINE with bulges, POLYLINE, SPLINE; units; auto-join into closed loops), PNG/JPG/JPEG/BMP |
| Geometry | Clipper2 union / difference / intersection / XOR, offsetting, **kerf compensation** |
| Raster | Brightness, contrast, gamma, invert; Floyd-Steinberg, Jarvis, Stucki, Atkinson; live preview; works with rotated and mirrored images |
| CAM | Nesting-aware cut order (holes before the boundary that contains them), travel reduction, engrave-before-cut, whole-job passes, serpentine fill, bidirectional raster, overscan, a fill outline pass, ramped power on score lines |
| G-code | GRBL 1.1: `M4` dynamic power, laser always off before travel, air assist `M8`/`M9`, modal-state tracking |
| Machine | USB serial GRBL with **character-counting streaming**, pause/resume/stop on the real-time channel, jog, home, unlock, set origin, frame, state checks, alarm/error decoding |
| Safety | Bed-bounds, layer and NaN checks; stale-preview lock; pre-flight confirmation; one job at a time; connection required for every motion |
| Project | `.mlp` zip archive, atomic saves, shared image assets, schema versioning |
| Materials | Create, edit, delete, import and export presets |

## Quick start (Windows)

```powershell
# one-time prerequisites, see INSTALL.md for details
winget install OpenJS.NodeJS.LTS Rustlang.Rustup Microsoft.VisualStudio.2022.BuildTools

cd C:\Dev\MakerLaser
npm install
.\verify-makerlaser.ps1        # compiles and tests everything; writes verification.log
npm run dev                    # launches the app
.\build-windows.ps1            # builds the installers
```

Full instructions, macOS/Linux notes and troubleshooting: [`INSTALL.md`](INSTALL.md).

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
docs/               architecture, API, project format, machine layer, roadmap
tests/fixtures      SVG and DXF samples used by the integration tests
scripts/            verify.mjs, tauri.mjs
```

## Tests

```text
cargo test --workspace      Rust unit + integration tests (geometry, CAM, G-code, GRBL protocol against a fake controller, .mlp)
npm run ui:test             frontend unit and state tests
npm run verify              everything above plus type-check, lint and a production build
```

## Licence

GPL-3.0-or-later (see [`LICENSE`](LICENSE)). No code from LaserGRBL or any other GPL project
is included; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
