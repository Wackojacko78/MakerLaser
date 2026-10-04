# What has and has not been verified

This package was produced in an environment **with no Rust toolchain and no access to the
crates.io or npm registries**. So the headline fact is:

> **The Rust code (≈8,500 lines) has never been compiled, and `npm install` / `vite build` /
> Vitest have never run against the real libraries.** Expect a small number of compile or
> type errors on the first build. They are the ordinary kind (a missing import, a borrow, a
> changed library signature) and are quick to fix, but they will exist.

`npm run verify` (or `.\verify-makerlaser.ps1`) is how you find out, in one go.

## Checks that were actually run here

| Check | Result |
|---|---|
| 54 frontend unit/state tests executed under Node with the real TypeScript compiler (matrix maths, rotation round-trips, rubber-band selection, bounds, undo/redo and coalescing, store behaviour, toolpath preview helpers, diagnostics, formatting) | all pass |
| TypeScript strict type-check of all 33 source and test files (library typings stubbed, so API-signature mismatches with React/Konva/Tauri are **not** covered); negative-tested by injecting errors | clean |
| Rust syntax: all 46 `.rs` files parsed with a real Rust grammar (tree-sitter-rust) | clean after fixing one real bug it found (a raw string terminated early by `"#` in a test) |
| Rust name resolution: every `use crate::…` / `use makerlaser_*::…` resolves to an existing `pub` item; every type and free function used is defined, imported or generic; negative-tested | clean |
| Review of every `.method()` call that is not defined in the workspace | only std and external-crate methods |
| Python re-implementations of the subtle algorithms (NURBS/De Boor, DXF bulge arcs, path joining, SVG transform-list order, raster runs and bidirectional/mirror, serpentine even-odd fill), asserting the same numbers the Rust tests assert | all agree |
| JSON, YAML and JS config syntax; the icon set (all required ICO layers, RGBA PNGs) | valid |
| `scripts/verify.mjs` failure path (log, summary, exit code) | works |

## Dependency APIs checked against documentation

* `clipper2` 0.6: `Paths::to_clipper_subject().add_clip(..).difference(FillRule)`,
  `Paths::inflate(delta, JoinType, EndType, miter)`, `Vec<(f64,f64)> -> Paths` and
  `Paths -> Vec<Vec<(f64,f64)>>` (docs.rs). *Not* confirmed from the docs: the builder's
  `union`/`intersect`/`xor` method names (the crate lists those operations) and
  `Vec<Vec<(f64,f64)>> -> Paths`. The kerf path uses only the confirmed forms.
* Tauri 2: synchronous commands run on the main thread, so every blocking command uses
  `#[tauri::command(async)]`; `icons/icon.ico` is required for Windows builds; webview
  drag-drop and dialog `ask/open/save` APIs.
* GRBL: character-counting streaming, 128-byte RX buffer, real-time bytes.
* Two Trees TTS-55 Pro: manufacturer lists a **300 × 300 mm** working area (the earlier
  prototype's 400 × 400 was unsupported).

## NOT verified (please treat as open)

1. **`cargo build` / `cargo test`.** See above. Most likely trouble spots, in order:
   * `packages/geometry/src/clip.rs`, the only file that touches `clipper2`. If the crate's
     builder method names or conversions differ, change them there and nowhere else.
   * `#[tauri::command(async)]` combined with `State<'_, AppState>` arguments.
   * Borrow-checker details in `toolpath.rs` and `grbl.rs`.
   * Several tests assert numeric results that depend on Clipper2's behaviour (kerf grows a
     shape, a hole smaller than the kerf vanishes).
2. **Tauri configuration discovery.** `scripts/tauri.mjs` runs the CLI from `apps/rust-core`
   because the config is not in a conventional `src-tauri` folder. If the CLI cannot find it,
   run the CLI from that folder directly or rename the folder to `src-tauri`.
3. **`npm install` and the build.** Konva/react-konva typings were not available; a few prop
   types may need adjusting.
4. **The UI has never been rendered.** Layout, spacing, and interaction feel are unseen.
5. **Real hardware.** Nothing has run against a TTS-55 Pro or any GRBL board. In particular:
   whether Pause turns the beam off on your firmware, USB driver behaviour on Windows, and
   framing speed.
6. **Performance** with very large SVGs, DXFs or photos.
7. **No `Cargo.lock` / `package-lock.json`** (they need network access to create). Commit
   them after the first successful install.

## Known limitations (by design, listed in `docs/roadmap.md`)

Text and shape primitives, galvo/Ruida controllers, nesting, image vectorisation, per-object
settings, DXF blocks (`INSERT`), SVG `<use>`/text, unit display in inches, installer signing,
and a window-close "unsaved changes" prompt are not implemented.
