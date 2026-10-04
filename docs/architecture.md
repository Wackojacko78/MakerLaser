# Architecture

## Pipeline

```text
Workspace objects + layers
   │  cam::plan_operations        (packages/project)
   ▼
Operations (Cut / Score / Fill / Raster)
   │  toolpath::generate_toolpath
   ▼
Toolpath: straight moves in workspace mm (Travel, Cut, Score, Fill, Engrave)
   │  gcode::generate_gcode        (workspace -> machine coordinates happens here)
   ▼
GRBL G-code ──► safety::check_all ──► Controller::run_program ──► hardware
```

`makerlaser_project::build_job` runs the whole chain. **The UI never builds G-code**: it asks
the backend for a job and renders the result.

## Layers

| Layer | Crate / folder | Responsibility |
|---|---|---|
| UI | `apps/desktop-ui` | Editing, preview, controls. Holds the project in a Zustand store |
| Application services | `apps/rust-core` | Tauri commands, state, threads, events. No CAM logic |
| Domain | `packages/common` | Serde models: objects, layers, machine, materials, operations, project |
| Geometry | `packages/geometry` | Clipper2 (one adapter file), offsetting, flattening, SVG/DXF import, joining |
| Raster | `packages/raster` | Adjustments, dithering, affine resampling, PNG |
| CAM | `packages/project` | Planner, toolpaths, G-code, safety, `.mlp` |
| Machine | `packages/machine` | `Controller` trait, GRBL driver, simulator |

## Coordinate conventions

* Millimetres everywhere.
* The **workspace is Y-down, origin at the top-left of the bed**: what you see on screen and
  how SVG is defined.
* `MachineProfile::workspace_to_machine` is the **only** place axes are flipped (bottom-left
  origin: `Y_machine = bed_height − Y_workspace`). G-code, framing and jogging all use it.
* Object transforms are SVG-style matrices `[a b c d e f]`; positive rotation is clockwise on
  screen. Importers bake any shear into the geometry, so object transforms are always
  translation × rotation × scale.
* DXF is Y-up and is mirrored on import.

## State ownership

The **React store is the source of truth while editing.** Before anything that needs Rust
(generate, save, frame, start) the UI sends the whole project with `sync_project`. Import returns
just the new object, so the UI adds it itself, with undo, without a round trip that could lose
unsynced edits. Image bytes live only in Rust, keyed by *asset id*; duplicated image objects
share the asset.

Undo/redo stores whole-project snapshots that **share each object's `kind` payload** (paths or
image reference), which is immutable by convention. A `revision` counter increments on every
change; the preview records the revision it was generated from, and Start is disabled
if they differ. The backend also stores a fingerprint of the generated project and refuses to
start if it no longer matches.

## Threading

* Blocking commands (`#[tauri::command(async)]`) never run on the UI thread.
* A job runs on its own thread and holds the controller lock for its duration. Manual commands
  use `try_lock` and fail fast with "machine busy" instead of freezing.
* **Pause / Resume / Stop** go through a `RealtimeControl` handle that only owns the serial
  writer, so they work while the job thread is blocked inside `run_program`.
* Progress is delivered as `job-event` events (`progress`, `message`, `paused`, `resumed`,
  `completed`, `aborted`, `failed`).

## Safety layers (defence in depth)

1. Layer and machine validation, bounds and NaN checks on the generated toolpath.
2. G-code generator: `M5` before every travel; discontinuities never become laser-on lines.
3. Stale-preview lock in the UI **and** a fingerprint check in the backend.
4. Pre-flight confirmation dialog.
5. Controller state check (must be Idle) before jobs, framing and origin changes.
6. Connection required for every motion; single job at a time.
7. Soft reset on any streaming failure; STOP always available.

## Error handling

Libraries return `Result` with `thiserror` enums; commands convert to `String` for the UI; the UI
shows them in a notice and the console. Lock poisoning is reported, not panicked on. The
release profile does **not** abort on panic.
