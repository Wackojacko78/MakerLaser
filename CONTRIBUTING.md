# Contributing

## Branches
`main` is always releasable. `develop` integrates the next release. Work on `feature/<name>`
(from `develop`) or `hotfix/<name>` (from `main`). Pull requests need a green CI run.

## Commits
Conventional Commits: `feat(geometry): ...`, `fix(machine): ...`, `docs: ...`, `test: ...`.

## Before you push
```bash
cargo fmt --all
cargo test --workspace
npm run ui:typecheck && npm run ui:test && npm run ui:lint
```
`npm run verify` does all of it.

## Rules that keep the project safe
* **The UI never builds G-code.** Anything that affects what the laser does belongs in
  `packages/project` or `packages/machine`, with a test.
* **Axes are flipped in one place only**: `MachineProfile::workspace_to_machine`.
* **No `unwrap()`/`expect()`** on paths reachable from user input, files or hardware.
  Return a `Result`; surface a readable message.
* **Every behaviour change to toolpaths or G-code needs a regression test**, and the PR
  description should include a snippet of the generated G-code before and after.
* Keep the Rust types in `packages/common` and `apps/desktop-ui/src/types/domain.ts` in step;
  see `docs/api.md`.
* Object `kind` payloads (vector paths, image references) are immutable in the UI; undo
  history shares them between snapshots.

## Adding things
* **Machine profile:** `MachineProfile::presets()` in `packages/common/src/machine.rs`.
* **Controller (Ruida, galvo, ...):** implement `Controller` in `packages/machine`; see
  `docs/machine-layer.md`. Do not branch inside `GrblController`.
* **Import format:** add a parser in `packages/geometry`, a branch in
  `apps/rust-core/src/commands/import_cmds.rs`, fixtures in `tests/fixtures`, and tests.
