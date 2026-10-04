# LaserGRBL as a design reference

MakerLaser reimplements the *behaviour* users rely on in LaserGRBL; it contains **no LaserGRBL
source code**. LaserGRBL is GPLv3, so copying code would carry GPL obligations; the independent
Rust/TypeScript implementation does not.

## What was taken as a lesson

| Lesson | Where it lives |
|---|---|
| Decode `error:n` / `ALARM:n` into readable text with recovery advice | `packages/machine/src/grbl_codes.rs`, `apps/desktop-ui/src/lib/grblDiagnostics.ts` |
| Pause/Resume/Reset must work regardless of what the sender is doing | `RealtimeControl` |
| Job time estimate and live progress | `estimate_runtime`, `job-event` |
| Jogging, homing, unlock, feed overrides in the controls | machine console (overrides are on the roadmap) |
| Raster pipeline: greyscale conversion, 1-bit dithering, line-by-line, bidirectional | `packages/raster`, `toolpath::raster_runs` |
| Treat PWM and laser mode as firmware capabilities, not assumptions | `M5` before every travel; documented `$32` |
| Transport-agnostic design (USB now, Wi-Fi later) | `Link` and `Controller` abstractions |

## Deliberately different

* A modern multi-pane editor, layers and materials instead of a G-code sender with import.
* A project format (`.mlp`) with layers, materials and machine profile.
* Character-counting streaming instead of one line in flight.
* Nesting-aware cut ordering, kerf compensation, preview with replay.

## Licence boundary

If code is ever ported from LaserGRBL, record the upstream commit, files, copyright notice and
changes in `THIRD_PARTY_NOTICES.md` before merging, and keep the combined work GPL-compatible.
