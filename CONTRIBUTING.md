# Contributing

## Branches and merging

`main` is always releasable. Work on a short-lived branch off `main`, one feature or fix each:

```powershell
git switch main
git pull
git switch -c my-feature
# ... make the change ...
cargo fmt --all
cargo test --workspace
cd apps\desktop-ui; npm run lint; npm run typecheck; npm test; cd ..\..
git add -A
git commit -m "Say what changed"
git push -u origin HEAD
```

CI runs on every pushed branch (and on pull requests to `main`). Wait for it to go green. Then
merge, and delete the finished branch locally and on GitHub:

```powershell
git switch main
git pull
git merge my-feature --no-edit
git push
git branch -d my-feature
git push origin --delete my-feature
git fetch --prune
```

`git branch --merged main` lists branches that are safe to delete, and `git branch --no-merged main`
lists work that is not in `main` yet. (An older `develop` branch is no longer used.)

Commit messages are plain sentences in the imperative: "Add a fill outline pass", "Fix the
generic serif font".

### Git on Windows

* `git config --global core.editor notepad` stops Git opening Vim for merge messages. If Vim does
  open, press **Esc**, type `:wq` and press Enter.
* `git config --global core.pager cat` stops long output (`git diff`, `git log`) stopping at
  `(END)`. Otherwise press **q** to leave it.
* Check `git status --short` before `git add -A`. One-off helper scripts (`apply-*.mjs`) belong
  outside the repository and are ignored by `.gitignore`.
* `npm run dev` must be run from the repo root to get the desktop app. Run from `apps/desktop-ui`
  it starts only the web page, with no Rust behind it.

## Before you push

```bash
cargo fmt --all
cargo test --workspace
npm run ui:typecheck && npm run ui:test && npm run ui:lint
node scripts/check-docs.mjs
```
`npm run verify` does the first three. CI fails a push whose Rust is not formatted, so run
`cargo fmt --all` last, after any edit to a `.rs` file.

## Documentation

When behaviour changes, change the matching document in the same branch, and add a line under
"Unreleased" in `CHANGELOG.md`. `node scripts/check-docs.mjs` finds broken links, file names that
no longer exist, a document missing from `docs/README.md`, a Tauri command missing from
`docs/api.md`, and version numbers that disagree. A feature that has not been run on a laser
belongs in the "not yet" table in `VERIFICATION.md` until someone has run it.

## Rules that keep the project safe

* **The UI never builds G-code.** Anything that affects what the laser does belongs in
  `packages/project` or `packages/machine`, with a test.
* **Axes are flipped in one place only**: `MachineProfile::workspace_to_machine`.
* **No `unwrap()`/`expect()`** on paths reachable from user input, files or hardware.
  Return a `Result`; surface a readable message.
* **Every behaviour change to toolpaths or G-code needs a regression test**, and the description
  should include a snippet of the generated G-code before and after.
* **Anything that can make the laser fire needs its own limit and warning.** See how Frame with
  laser on (`docs/framing.md`) and the console box (`docs/console.md`) are fenced.
* **New settings must default to off.** Every field added to a saved type uses `#[serde(default)]`
  so older projects still load, and is mirrored in `apps/desktop-ui/src/types/domain.ts`
  (see `docs/api.md` and `docs/project-format.md`).
* **Put logic in plain TypeScript.** Keep the maths and the rules in `apps/desktop-ui/src/lib` and
  `state` files with no React, Konva or Tauri imports, and test them with Vitest. Components stay
  thin. This is why most of the front end is tested.
* Object `kind` payloads (vector paths, image references) are immutable in the UI; undo
  history shares them between snapshots.

## Adding things

* **A layer setting** (like overscan, outline or ramp): a field on `Layer` in
  `packages/common/src/layers.rs` with `#[serde(default)]` and a range check in `validate`; use it
  in `packages/project/src/toolpath.rs` (not in the UI); add it to the `Layer` type and the
  Layers panel in the UI; a pre-flight warning in `safety.rs` if it needs something from the
  machine; tests at each step; a document in `docs/`.
* **A drawing tool or shape:** `apps/desktop-ui/src/lib/shapes.ts` (geometry), `inlineEdit.ts` (the
  boxes and the drawing gesture), `ToolsPanel.tsx` (the button and key). See `docs/shapes-and-text.md`.
* **A font:** `docs/fonts.md`, "Adding another font".
* **Machine profile:** `MachineProfile::presets()` in `packages/common/src/machine.rs`, or one
  `mk({...})` line in the machine catalogue (`docs/catalog.md`).
* **Controller (Ruida, galvo, ...):** implement `Controller` in `packages/machine`; see
  `docs/machine-layer.md`. Do not branch inside `GrblController`.
* **Import format:** add a parser in `packages/geometry`, a branch in
  `apps/rust-core/src/commands/import_cmds.rs`, fixtures in `tests/fixtures`, and tests.
* **A Tauri command:** a `#[tauri::command(async)]` function in `apps/rust-core/src/commands`,
  registered in `main.rs`, wrapped in `apps/desktop-ui/src/lib/tauri.ts`, and added to
  `docs/api.md` (the checker fails until it is).
