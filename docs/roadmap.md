# Roadmap

## Next (finish 0.1)
1. First clean `npm run verify` on a developer machine; commit lockfiles.
2. Hardware bring-up on the TTS-55 Pro following `SAFETY.md`; record what Pause does with the
   beam; tune the starter material presets.
3. Visual polish after the first real run of the UI.
4. Tighten CSP, enable `clippy -D warnings`, enforce `cargo fmt` in CI.

## Soon
* Per-object and per-layer start/end position modes (user origin, current position, absolute).
* Test-grid generator (speed × power) for new materials.
* Window-close "unsaved changes" prompt; recent files.
* Inch display and units setting wired into the UI.
* Perimeter/outline fill mode, overscan for fast fills, ramped power.
* DXF `INSERT` (blocks), SVG `<use>` and basic text.
* Installer signing and an auto-updater.

## Later
* Text and shape (rectangle, ellipse, polygon) objects. Both resolve to `VectorData`, so the
  CAM engine does not change.
* Job nesting/auto-layout; tabs/bridges for cuts.
* Image vectorisation (trace); more dithers; per-object raster settings.
* Camera alignment.
* **Ruida** controller driver and **galvo** support (new `Controller` implementations).
* Plugin/extension API; cloud material library.

## Known deliberate limits
Single G-code dialect (GRBL 1.1), 2D only, no Z axis.
