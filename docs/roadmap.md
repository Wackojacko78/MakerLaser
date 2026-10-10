# Roadmap

## Done (in main)

Since 0.1.0:

* Measure tool: snapping, point and line measurements, selection size.
* Start From (absolute, current position, user origin) and Job Origin.
* Overscan for fill and image layers (laser-off run-up and run-out).
* Material test grid (speed x power) generator.
* Text objects.
* Auto-arrange.
* Run order control (engrave, score, then cut, or your own order).
* "Unsaved changes" prompt when closing.
* Machine connection settings: USB serial, WebSocket, Telnet (FluidNC).
* Machine and material catalogues, config import and export.
* Resizable console and right-hand panel.
* Linux notes (docs/linux.md) and an Ubuntu job in CI.
* Frame with the laser on at low power (off by default; docs/framing.md).

## Next

1. Hardware bring-up on the TTS-55 Pro following `SAFETY.md`: verify Start From and overscan on
   scrap, record what Pause does with the beam, tune the starter material presets.
2. Verify framing with the laser on (docs/framing.md): is the beam visible on scrap, and does Stop put it out at once.
3. CI: clippy with `-D warnings`; tighten the CSP.

## Soon

* Shape objects (rectangle, ellipse, polygon). They resolve to `VectorData`, so the CAM engine
  does not change.
* Ramped power and a perimeter/outline fill mode.
* SVG `<use>` and DXF `INSERT` (blocks), so imports stop losing geometry.
* Inch display and a units setting wired into the UI (check what is already done).
* Recent files (check what is already done).
* Installer signing and an auto-updater.

## Later

* Per-object and per-layer start/end position modes (user origin, current position, absolute).
  Lower priority now that the job-level Start From exists.
* Tabs/bridges for cuts.
* Image vectorisation (trace); more dithers; per-object raster settings.
* Camera alignment.
* **Ruida** controller driver and **galvo** support (new `Controller` implementations).
* Plugin/extension API; cloud material library.

## Known deliberate limits

Single G-code dialect (GRBL 1.1), 2D only, no Z axis.
