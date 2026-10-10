# MakerLaser: where we are up to

Written: 10 October 2026, end of the evening session. Last commit on `main` when this was
written: `2a53aae` ("List the missing commands in docs/api.md").

**This file is for a new chat.** The assistant does not remember earlier chats, and its scratch
workspace is wiped between sessions. To carry on, upload this file and say: "Continue from
STATUS.md". Then upload whatever files the section "What to upload for the next task" asks for.
Everything below is what was true when it was written; check `git log` if in doubt.

## The project in one paragraph

MakerLaser is desktop laser engraving and cutting software: React, TypeScript and Konva on the
front end, Rust and Tauri behind it. It targets the Two Trees TTS-55 Pro first, then any GRBL 1.1
laser, and the owner wants it to be good enough for a wide range of makers, not just for himself.
It is open source (GPL-3.0-or-later) at https://github.com/Wackojacko78/MakerLaser, built on
Windows in PowerShell, with Linux kept working. Read `README.md`, then `docs/README.md` for the
index and `docs/user-guide.md` for how it is used.

## State of the repository

* One branch, `main`, with nothing waiting to merge. All feature branches have been merged and deleted.
* Tests on the owner's PC: **334 Rust tests and 593 front-end tests, all passing**, lint and
  type-check clean. CI (Ubuntu 24.04, Windows and the front end) is green on `main`.
* `node scripts/check-docs.mjs` reports 0 errors and 0 warnings. Run it before merging anything
  that changes behaviour or adds a Tauri command.
* The Rust format check is **enforced** in CI, so always run `cargo fmt --all` after touching a `.rs` file.
* Version is still 0.1.0. "Unreleased" in `CHANGELOG.md` holds everything built since.

## What has been built since 0.1.0 (all on `main`)

In the order it was built, each as its own checked installer script (see "How the assistant works here"):

```
apply-overscan.mjs            overscan for fill and image layers
apply-housekeeping.mjs        CI actions, roadmap, changelog
apply-frame-laser.mjs         Frame with the laser on at low power (0.1 to 5 %, off at every start)
apply-console-box.mjs         command box in the console: $$, $32=1 and so on
apply-shapes-and-text.mjs     shapes, and text and shapes that stay editable
apply-canvas-editing.mjs      draw on the canvas, type sizes, Tab between boxes, no pop-ups
apply-edit-fix.mjs            double-click, Enter and F2 open the editor
apply-fonts.mjs               35 built-in fonts and a grouped font list
apply-shortcuts-preview.mjs   R E P S T tool keys, and a Travel switch for the preview
apply-import-use-insert.mjs   SVG use and symbol, DXF INSERT blocks and arrays
apply-fill-outline-ramp.mjs   fill outline pass, ramped power on score lines
apply-docs-refresh.mjs        README, SAFETY, VERIFICATION, user guide, docs index, docs checker
```

Features that came earlier (Measure tool, Start From and Job Origin, run order, test grid,
auto-arrange, machine and material catalogues, connection settings) are described in `CHANGELOG.md`.

## What has been tried on the real laser

Machine: Two Trees TTS-55 Pro. The controller board identifies itself as MKS_DLC, GRBL 1.1.
Settings seen with `$$`: `$30=1000`, `$32=1` (laser mode on), `$20=0` and `$22=0` (soft limits and
homing off), `$120` and `$121` = 2500 mm/s², `$130` and `$131` = 300 mm. The **focus measuring
cylinder has not arrived yet**, so the focus is not set properly.

* Worked: connecting over USB; `$$` in the console box; engraving a real SVG and a real JPEG; Frame with the laser on.
* **Not yet run on the laser:** overscan, Start From and Job Origin, the fill outline pass, ramped
  power, and what Pause does with the beam. Each has a test routine in its own document and a "not yet"
  row in `VERIFICATION.md`. Do not call any of them verified until a row has been added there.
* Judge edge quality only after the focus is set.

## What is next

**1. Material presets that remember overscan, outline and ramp (was about to start).**
Material presets today store speed, power, passes and air assist. The aim is for a preset to also
carry the layer's overscan (Fill and Image), outline (Fill) and ramp (Score), so those settings follow
the material. Plan, not yet built:

* Add the three as **optional** fields on the preset (`#[serde(default)]` on the Rust side), so every
  existing preset, project and file still loads and the starter catalogue needs no change.
* Applying a preset sets each of them only when the preset has it and the layer kind uses it
  (overscan: Fill and Image; outline: Fill; ramp: Score). A preset that does not have a field leaves
  the layer's value alone.
* Matching "which preset is this layer on?" must take the new fields into account.
* The material file format (`makerlaser.materials`, version 1) gets the optional fields. Unknown
  fields are already ignored by older versions, so the version does not change. Validate them with
  the same ranges as the layer (overscan 0 to 25 mm, ramp 0 to 10 mm).
* "Save as preset" from a layer should include them, if the Material library panel has that.
* Update `docs/config-formats.md`, `docs/overscan.md`, `docs/fill-and-ramp.md`, `CHANGELOG.md`.

**2. After that, in rough order of value:**

* Laser test checklist: record each result in the `VERIFICATION.md` table once the focus is set.
* A LightBurn comparison, to rank what to build next for a general audience (the earlier one was lost).
* A 0.2.0 release: move "Unreleased" under a 0.2.0 heading, bump the version in `Cargo.toml`, both
  `package.json` files and `tauri.conf.json` (the docs checker checks they agree), build the installers, tag.
* A separate colour for overscan in the preview (needs a flag on each preview move).
* Network connections (WebSocket and Telnet for FluidNC): the settings are stored, only USB serial connects.
* Import what is still skipped (SVG text and clip paths, DXF text and hatches); clippy with `-D warnings`; a tighter CSP.
* The full list is in `docs/roadmap.md`. Single-line fonts were discussed and parked: fill is better
  for most text, so they wait until someone needs fast serial numbers or very small text.

## Known gaps and things that surprised us

* The assistant cannot compile Rust or run the app. **The first real compile of any new Rust is on the
  owner's PC (`cargo test --workspace`) and then in CI.** Expect the occasional small compile error
  and paste the first one back.
* Text and shapes made before editing was added cannot be edited (their settings were not saved). Add them again.
* The preview cannot tell overscan moves from other laser-off travel, so one Travel switch covers both.
* The font licences have not been checked: run `node scripts/font-licenses.mjs` before any public release.
* `docs/api.md` command rows were added by hand twice. Add a row whenever a command is registered in `apps/rust-core/src/main.rs`; the checker fails until it is there.
* Not known: whether the Rust CI jobs run the tests or only build. Local `cargo test` is the real check.

## Practical lessons from this project (they cost time)

* **`npm run dev` must be run from the repo root.** From `apps/desktop-ui` it starts only the web page.
* **Run one block at a time when a step needs hand editing.** A pasted block that runs past the
  editing step produces an empty commit and a branch that has to be redone.
* A `ci.yml` step that is half commented out ("Unexpected value 'run'") breaks the whole workflow
  before any job starts. Every step needs a `- name:` or `- uses:` line above its `run:`.
* Git opens Vim for merge messages unless `git config --global core.editor notepad` is set; press
  Esc then `:wq` to leave it. `git config --global core.pager cat` stops output stopping at `(END)`.
* Check `git status --short` before `git add -A`. Installer scripts and bundle files live outside
  the repository (in `C:\Dev\`), and `apply-*.mjs` is in `.gitignore`.
* An installer script must be merged and committed before the next one is run, because each refuses
  to run over uncommitted changes and some need the files an earlier one made.
* If a feature branch is built on top of another, merge the newest and the older ones come with it.
  Do not assume a branch holds what its name says: check with `git grep` or `git log -S"text"` first.

## How the assistant works here (so a new chat can match it)

* **Delivery:** every change is a single checked installer script (`apply-<name>.mjs`) that the owner
  runs from the repo root on a clean branch. It edits existing files by finding exact text (also when
  `cargo fmt` or Prettier has re-wrapped it), keeps each file's line endings, refuses to continue if an
  edit cannot be found, does nothing a second time, and has `--dry-run`. It is tested on copies of the
  owner's real files (LF and CRLF) before it is handed over. Whole new files and docs come with it.
* **To write a change against the real code**, the assistant needs the current files. The owner
  makes a bundle with a short PowerShell function (below) and uploads it. The assistant has no
  access to GitHub or the repository.
* **Verification:** logic is put in plain TypeScript or pure Rust functions with unit tests. Where
  Rust cannot be compiled, a Python port of the algorithm is run against the numbers the tests expect,
  and the installed Rust is lexed and read through. Claims are kept to what was actually checked;
  anything untested on the laser is said to be untested.
* **Every update ends with git instructions:** commit, push, check that CI is green, merge to `main`,
  delete the finished branch (locally and on GitHub). The owner asked for this.
* **Safety:** anything that can make the laser fire needs its own limit and warning, new settings
  default to off, and every saved field uses `#[serde(default)]` so old projects load.
* **Style:** step-by-step PowerShell, one thing at a time, plain explanations, honest about what is
  not known. New Zealand English. Documents are kept in step with the code in the same change.

## What to upload for the next task (material presets)

Run this in PowerShell from the repo root. It writes a file outside the repository, skips any file
that does not exist, and finds the preset code itself:

```powershell
cd C:\Dev\MakerLaser
function Bundle($out, $files) {
  $files = $files | Where-Object { Test-Path $_ } | Sort-Object -Unique
  $files
  $files | ForEach-Object { "`n===== $_ =====`n" + (Get-Content $_ -Raw -Encoding UTF8) } | Set-Content -Encoding UTF8 $out
  "{0}: {1:N0} KB" -f $out, ((Get-Item $out).Length / 1KB)
}
$found = @(git grep -l -E "MaterialPreset|for_layer_kind|findMatchingPreset" -- '*.rs' '*.ts' '*.tsx' ':!*/tests/*')
$more = @(
  'packages/common/src/layers.rs',
  'apps/desktop-ui/src/types/domain.ts',
  'apps/desktop-ui/tests/configFormat.test.ts',
  'apps/desktop-ui/tests/selectionInfo.test.ts',
  'docs/config-formats.md',
  'docs/overscan.md',
  'docs/fill-and-ramp.md',
  'CHANGELOG.md'
)
Bundle C:\Dev\bundle-presets.txt ($found + $more)
```

If the upload is blocked, rename the file to end in `.txt.txt`. The starter catalogue
(`docs/catalog/makerlaser-materials-starter.json`) is not needed unless its format has to change.

## Start-of-session checklist

1. Upload this file (and the bundle for the task).
2. Say what you want done, or "continue from STATUS.md".
3. Before the first install, `git status --short` should print nothing and `git branch` should show only `main`.
