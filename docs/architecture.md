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
8. The console command box refuses laser-on commands, `$RST`, real-time characters, more than one
   line, and anything while a job is running; Pause is refused when no job is running.
9. Frame with laser on is capped at 5 % power on the Rust side, only runs when the machine is
   idle, and is switched off again every time the app starts.

## The front end

* **State** lives in Zustand stores in `apps/desktop-ui/src/state`: `projectStore` (the project,
  the selection, undo history and the revision counter), `viewStore` (pan and zoom), `measureStore`,
  `editStore` (the drawing tool, and which text or shape editor is open), `jobStore` (progress and
  the console log), `machineStore`, `noticeStore`, and two small remembered choices:
  `frameLaserStore` (the laser-on frame power; the on/off switch is never remembered) and
  `previewStore` (the Travel switch).
* **Logic** is plain TypeScript in `src/lib`, with no React, Konva or Tauri imports, so Vitest runs
  it directly: `transform.ts`, `shapes.ts`, `inlineEdit.ts` (the drawing gesture and the size
  boxes), `objectEdit.ts`, `textSettle.ts` (waits for a font to load before text is drawn),
  `fonts.ts` and `bundledFonts.ts`, `measure.ts`, `toolShortcuts.ts`, `previewOptions.ts` and more.
  Components in `src/components` and `src/canvas` stay thin. This is a rule (CONTRIBUTING.md), and it
  is why most of the front end is covered by tests.
* **The canvas:** `WorkspaceCanvas.tsx` handles the mouse (select, pan, draw), `CanvasEditor.tsx` is
  the floating editor next to a text or shape, and `ObjectFields.tsx` holds the boxes that it and
  the Properties panel share.

## Text and shapes

Text and shapes are ordinary vector outlines as far as the planner is concerned
(`ObjectKind::Vector`). A `source` next to the outlines (the text and font, or the shape kind and
sizes) is the recipe the editor rebuilds them from; see `project-format.md`. Editing replaces the
outlines and the source and keeps the object's place, rotation, layer and stacking (`objectEdit.ts`).
Text is drawn on an off-screen canvas and traced into outlines in the browser (`textRender.ts`,
`textTrace.ts`), which is why a built-in font has to be loaded before it is drawn (`fontLoad.ts`,
`textSettle.ts`).

## Settings that shape the toolpath

Layer settings reach the laser only through `packages/project/src/toolpath.rs`; the UI just stores
them.

* **Overscan** (Fill and Image): scan lines are grouped, and each group gets a laser-off run-up and
  run-out, clamped to the bed. They are `Travel` moves flagged `overscan`, which `gcode.rs` sends as
  `M4 S0` + `G1` instead of `M5` + `G0`, so GRBL's planner is not emptied. The flag also keeps them
  out of the job's bounds.
* **Fill outline** (Fill): after the fill lines, every closed path of the object is traced once,
  holes first.
* **Ramped power** (Score): `ramp_pieces` splits each path into eight power steps at either end.
  `gcode.rs` already sends a new `S` value whenever the power changes, so nothing else changes.

## Framing and typed commands

Frame with the laser off on the bed is the controller's own `frame`. With Start From relative to
the head, or with the laser on, it is a short program built in `apps/rust-core/src/placement.rs` and
streamed like a job, so STOP and error handling are the same. The laser-on power is capped at 5 % on
the Rust side whatever the screen sends. Typed commands go through `Controller::send_command` after
`apps/rust-core/src/console.rs` has checked them.

## Error handling

Libraries return `Result` with `thiserror` enums; commands convert to `String` for the UI; the UI
shows them in a notice and the console. Lock poisoning is reported, not panicked on. The
release profile does **not** abort on panic.
