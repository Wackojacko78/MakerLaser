# Roadmap

Last updated: 23 October 2026. What is built, in detail, is in `CHANGELOG.md` ("Unreleased"); what
has been tried on a laser is in `VERIFICATION.md`.

## Done (in `main`)

Since 0.1.0:

* **Placement:** Start From (absolute, current position, user origin) and Job Origin; Frame also
  with the laser on at low power (docs/start-from.md, docs/framing.md).
* **Drawing:** Rectangle, ellipse, polygon, star and text drawn on the canvas, typed sizes with Tab,
  editable afterwards (double-click), shortcut keys R E P S T (docs/shapes-and-text.md).
* **Fonts:** 35 built-in fonts and a grouped font list (docs/fonts.md).
* **Import:** SVG `<use>` and `<symbol>`, and DXF `INSERT` blocks and arrays (docs/import.md).
* **CAM:** Overscan for fill and image layers, a fill outline pass, ramped power on score lines
  (docs/overscan.md, docs/fill-and-ramp.md); material test grid; auto-arrange; run order control.
* **Presets:** material presets remember overscan, outline and ramp, the tab width and spacing (Cut), and the threshold and sharpen (Image) (docs/config-formats.md).
* **Layers and images:** layer colour, lock and drag to reorder; Threshold and Sharpen on Image layers
  (docs/user-guide.md).
* **Preview:** faint laser-off travel and a Travel switch (docs/preview.md).
* **Path planning:** filled objects nearest first, parts cut whole and shared lines cut once, as three choices in the Layers panel (docs/user-guide.md).
* **Time estimate:** follows GRBL's acceleration, corner slowing and look-ahead, with Rapid speed, Acceleration and Junction deviation in the Machine window (docs/user-guide.md).
* **Cut tabs:** Tab width and Tab spacing on Cut layers leave small uncut tabs in each outline (docs/user-guide.md).
* **Machine:** console command box for `$$` and settings (docs/console.md); connection settings for
  USB serial, WebSocket and Telnet, stored and validated (docs/connection.md).
* **Tools:** Measure tool (docs/measure.md); "unsaved changes" prompt when closing.
* **Catalogues:** 19 machines and 31 starter material presets; config import and export
  (docs/catalog.md, docs/config-formats.md).
* **Interface:** resizable console and right-hand panels.
* **Project:** Linux notes and an Ubuntu CI job (docs/linux.md); CI on every branch with the
  Rust format check enforced.
* **Documentation:** user guide, a docs index, the verification record, and
  `scripts/check-docs.mjs`.

## Next

1. **Hardware bring-up on the TTS-55 Pro** (`SAFETY.md`, `VERIFICATION.md`). Set the focus, then
   run each "not yet" test routine on scrap and record the result: overscan (0 against 3 mm),
   Start From and Job Origin, the fill outline, ramped power, and what Pause does with the beam.
   Tune the starter material presets as you go.
2. **A 0.2.0 release.** Move "Unreleased" in `CHANGELOG.md` to a 0.2.0 heading, bump the version in
   `Cargo.toml`, the `package.json` files and `tauri.conf.json` (`scripts/check-docs.mjs` checks they
   agree), build the installers (`INSTALL.md`) and tag it.
3. **CI hardening:** `clippy` with `-D warnings`, and a tighter content-security policy.

## Soon

* **Network connections.** WebSocket and Telnet (FluidNC) settings are stored today, but only USB
  serial connects (docs/connection.md).
* **Import what is still skipped:** SVG `text`, `image` and `clipPath`; DXF `TEXT`, `HATCH` and
  `DIMENSION`; DXF layers mapped to MakerLaser layers.
* **A separate colour for overscan in the preview.** The preview cannot tell overscan from other
  travel today (docs/preview.md); it needs a flag on each preview move.
* **Units:** inch display and a units setting wired through every panel (check what is already done).
* **Recent files** (check what is already done).
* **Installer signing and an auto-updater.** Signing needs a certificate, which costs money.

## Later

* A LightBurn feature comparison, to rank what to build next for a general audience.
* Per-object and per-layer start and end positions. Lower priority now that the job-level Start
  From exists.
* Job nesting.
* Image vectorisation (trace); more dithers; per-object raster settings.
* Single-line fonts (one stroke per letter) for very small text, fast serial numbers and pens. Fill is
  better for most text, so this waits until someone needs it.
* Camera alignment.
* **Ruida** controller driver and **galvo** support (new `Controller` implementations).
* Plugin/extension API; cloud material library.

## Build order for new features

Decided 11 October 2026. Each step is its own update, checked before the next.

1. **Hardware bring-up and 0.2.0** (see Next).
2. **Layers and image panel**, finished: lock, colour and drag order are in; a choice of grayscale
   conversion is not (it needs a change to how images are loaded).
3. **Boolean, offset and arrays in the interface**, done: the Shape tools panel (docs/user-guide.md) has
   Union, Subtract, Intersect, Exclude, Offset and a circular array. Rows and columns were already in
   Arrange. Not done: a preview of the array drawn on the canvas.
4. **Bitmap trace**, done: select a picture and open Trace… (docs/import.md). The outlines are straight-sided
   paths; editing their points is step 6, node editing.
5. **Fillets and chamfers**, done: Shape tools has Fillet and Chamfer for all corners, outside corners or inside
   corners of the selected shapes (docs/user-guide.md). Picking single corners waits for node editing, step 6.
6. **Node editing**, in stages (decided 23 October 2026). Nodes are kept next to the outlines (`nodes` beside `paths`, docs/project-format.md), so the planner, the preview and the shape tools do not change. Stages 1a (the model and its rules) and 1b (the editor on the canvas: pick, move, nudge, X and Y boxes, add and delete nodes, and Convert to outlines for text and shapes, which stay text until then) and 2 (handles and curves, with Corner, Smooth and Symmetric nodes, and circles and rounded corners converting to curve nodes) are in, and so is the first part of 3: Fit curves turns any outline into a few curve nodes. Still to come: 3 SVG and DXF keep their exact curves on import, and 4 join, break and fillet on chosen nodes.
7. **Cut tabs**, done: Tab width and Tab spacing on Cut layers (docs/user-guide.md).
8. **Library and templates, then camera.**
9. **Rotary**, only once there is hardware to check it on.

Already in place and only needing tuning: the preview with replay and time estimate, ordering of cuts
(holes first, least travel), and air assist (M8 and M9 are sent per layer when the machine has it).

## Known deliberate limits

Single G-code dialect (GRBL 1.1), 2D only, no Z axis.
