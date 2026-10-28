# MakerLaser: where we are up to

## START HERE (written at the end of 2026-10-14)

This section is the current state and the plan. The sections below it are a log of earlier updates, kept for history. Where one of them
says "Next task", "NOT confirmed", "NOT yet compiled", "on branch offset-layer" or "this replaces ...", this section wins.

### Where things stand
- Project: MakerLaser, laser engraver software. A Tauri desktop app: a Rust workspace (packages and apps/rust-core) and a React plus
  TypeScript interface (apps/desktop-ui). Repo C:\Dev\MakerLaser, GitHub Wackojacko78/MakerLaser. The aim is software good enough for a
  wide range of makers to compete with LightBurn, not just for the owner. Test machine: TTS-55 Pro, 300 x 300 mm bed, GRBL.
- On main, confirmed by Lee's own run on 2026-10-14 (git status clean, check-docs 0 errors and 0 warnings, typecheck and lint clean,
  45 test files and 895 tests passing): material presets that remember overscan, outline and ramp; layer colour, lock and drag order,
  image threshold and sharpen; Shape tools with Combine, Offset and a circular array; bitmap trace; the right-hand tabs; fillet and
  chamfer (5504700); Original shapes as one setting per tool (1eaac6d); and the Offset choice "Put the result on layer" (lib/offsetLayer.ts).
  Lee has tried the layer choice in the app.
- Also on main, confirmed from Lee's git log on 2026-10-14: the fix for the Sharp offset spike (4236e57; a new function, tidy, in
  packages/geometry/src/shape_ops.rs, found by git grep). Lee tried it in the app and said it fixed the spike. GitHub CI was green for 4236e57
  (runs 53 on the branch and 54 on main), which includes the Rust jobs and the enforced Rust format check. The assistant still has NOT seen the
  cargo test output for the four new tidy tests; whether the CI Rust jobs run the tests or only build was never confirmed (open the log of
  run 54 and look for a "test result" line).
- Also on main: "Border only steps on to the next frame" (35b3d09, fast-forward merge; the branch border-chain is deleted). It adds
  lib/borderChain.ts and its tests, and changes ShapeToolsPanel.tsx and the docs. Lee's checks on that branch before the merge: check-docs 0 errors
  and 0 warnings, typecheck and lint clean, 46 test files and 917 tests passing. GitHub CI was green (runs 55 and 56). The handoff update to this
  file is on main too (f7b82a2, CI runs 57 and 58 green). Lee tried the Border only update in the app and found the problem described under
  "Open problem" below. As of 2026-10-14 main has no other branches, local or on GitHub, and a clean tree.
- Always ask Lee first for: git status --short, git branch -a, git log --oneline -8, and whether CI is green. Lee often merges and deletes
  a branch before the next message, and has several times merged before CI finished: always ask him to wait for green.

### What Offset does now (so nothing is built twice)
- Offset (Shape tools tab, ShapeToolsPanel.tsx): Outward or Inward by a distance, sharp or round corners, Result "Whole shape" or
  "Border only (a frame)", "Put the result on layer" (starts on "Same layer as the original"; the choices are the Cut, Score and Fill layers),
  and Original shapes (Replace, Hide, Leave; Offset starts on Leave). The boolean and offset work is done in Rust
  (packages/geometry/src/shape_ops.rs, commands in apps/rust-core/src/commands/geometry_cmds.rs); the planning is TypeScript.
- Border only used to treat a frame as an ordinary shape. A frame is a ring (an outline with a hole), and Offset moves a hole the other way,
  so a second Outward also made a band INSIDE the original, and a second Inward on a ring narrower than the distance returned the whole ring
  again on top of itself. Lee found this with a screenshot (three Outward clicks on a rectangle left rings inside it).
- The fix (lib/borderChain.ts, state in ShapeToolsPanel.tsx): the panel remembers, for each frame Border only makes, the shape it came from
  (the base) and where its band lies as signed distances from the base (0 to 2 is the first band outside, -2 to 0 the first band inside).
  Outward on a frame steps to the band beyond (2 to 4, then 4 to 6); Inward steps back towards the base and on inside it. Every band is the
  base offset by two distances with the inner one cut out of the outer, so nothing builds up from the last result. Limits: the memory is in
  the panel only (lost when the app closes; a frame that was moved or edited is treated as an ordinary shape again); it keeps the last 100
  frames; a band may reach at most 1000 mm from its base; Fillet, Chamfer and Combine on a frame are not changed.
- The Sharp spike: Clipper2 snaps every result to a 0.01 mm grid, so a result carries edges 0.01 mm long, and offsetting such a shape again
  with Sharp (miter) corners could throw one point hundreds of millimetres away (found with two throwaway Rust test files on Lee's PC:
  13 of 18 in / out sequences on ellipses failed, Round corners never did, a 30 mm circle never did). offset_shape now tidies each path first
  (drops points closer than 0.05 mm to the one before and points within 0.002 mm of a straight line). The Kerf offset (offset_path, miter
  joins) was NOT changed and has the same kind of exposure in principle; untested.

### Resolved on 2026-10-21: Border only with Original shapes on Replace "keeps 2 layers active": a frame has two outlines, an outer and an inner one, which is right. Lee looked at three screenshots and said that is fine. The two older questions below are still unanswered but not important
- NOT understood yet, so nothing was changed for it. Lee said, after trying the border-chain update: "the border only keeps 2 layers active
  when setting it to remove". Replace is what the app calls the setting he means. Do not guess a fix: ask first.
- What to ask: a screenshot of the Objects list and the canvas after three Outward clicks with Original shapes on Replace, and what he means
  by "layers" (objects in the Objects list, or layers in the Layers panel, or outlines on the canvas).
- Readings to check, none confirmed: (a) he sees two OUTLINES, which is right, because a frame is an outer outline and an inner outline;
  (b) the previous frame is not replaced, so two frames stay, which would be a bug; (c) the first click left the original and the frame
  both in place. The assistant's browser tests (with a stand-in for the Rust geometry that is exact only for rectangles) showed ONE object
  left after each Replace click, so if two objects remain in the real app something differs between the stand-in and the real Rust or the
  real project store. Ask which shape he used (an ellipse? a rectangle? a result of an earlier tool?) and the Corners setting.
- Older, still unanswered: Lee's first report said that choosing a new layer "changes the previous layer cut/engrave type". The code only
  moves the shape onto the layer chosen; nothing edits a layer's own settings. Ask whether the shape moved layers (expected) or a layer's
  own settings changed. His first report also said Border only was "not replacing with the result": Offset starts on Leave, which explains it.

### What the program can do now
- Layers: Cut, Score, Fill and Image kinds, each with speed, power, passes, air assist (M8 and M9), overscan, ramp, outline, colour,
  lock artwork, drag to reorder, run order. Material presets that remember overscan, outline and ramp. Image layers: threshold and sharpen.
- Shape tools tab (apps/desktop-ui/src/components/ShapeToolsPanel.tsx, logic in lib/shapeOps.ts, lib/corners.ts, lib/originals.ts, lib/offsetLayer.ts
  and lib/borderChain.ts): Union, Subtract (with a "Subtract from" choice), Intersect, Exclude; Offset as above; Fillet and Chamfer; Circular
  array; Original shapes in each of Combine, Offset and Fillet / Chamfer. Results are plain straight-sided outlines. Open lines are left out
  of Offset and Fillet.
- Trace tab: picture to outlines, in TypeScript (lib/bitmapTrace.ts), with a live preview you can zoom and drag.
- Right-hand panel tabs (components/RightTabs.tsx). Toolbar buttons switch to the tabs. Ctrl or Shift adds to the selection.

### The plan, in the order agreed with Lee
Lee is keen to do ALL of these. Done: layers and image panel, boolean / offset / arrays, bitmap trace, fillets and chamfers, the Offset layer
choice, Border only stepping. Also path planning (f569ecf), a closer time estimate (1522a29) and cut tabs (see the last block of this file).
1. FIRST JOB: the git questions above (the state at the end of 2026-10-14 is clean, so a short check is enough), then carry on with the plan below. If convenient, the output of npm run rust:test for the tidy tests.
2. Hardware tests and release 0.2.0. Needs the laser and the focus cylinder: Lee's job, not the assistant's. Untried on real hardware:
   overscan, Start From and Job Origin, fill outline, ramped power, what Pause does with the beam. Add a VERIFICATION.md row per result,
   then cut 0.2.0.
3. Small and quick: presets that also remember threshold and sharpen. Also worth a look: does the Kerf offset (miter joins) need the same
   tidying as Offset, and should Border only frames be remembered in the project file (needs a field in the Rust project format).
4. Step 7, cut tabs and bridges (BUILT on 2026-10-22, see the last block of this file; the rest of this item is the original plan): small gaps left in a cut line so a part stays attached to the sheet. Width, count or spacing, and a
   preview of where they fall. Self-contained, so it can go before node editing. Needs the toolpath code.
5. Step 6, node editing. The big one. Paths are lists of straight segments today, so a Bezier handle has nothing to hold. Write a short
   DESIGN NOTE first and agree it with Lee: the new path model (segments that are lines or cubic curves); what loads and saves (old
   projects must open unchanged); where curves are flattened (CAM, offset, boolean, trace and corners all expect straight segments); and how
   editing on the canvas works (select a node, drag, add and remove, line to curve, handles). Then build in stages, each its own checked
   update. After it, single corners can be picked for fillets.
6. Step 8: library and templates (one "reusable things" item), then camera (needs lens calibration and a camera to test with).
7. Step 9: rotary, only when there is hardware to check it on.
Other ideas not started: a live preview of Offset / Fillet / Chamfer on the canvas before pressing the button; a "repeat last action"
button; a choice of grayscale conversion for pictures; Layers as its own tab; remembering the selected tab, the preview zoom and the tool
settings between sessions; Arrange and Test grid are still pop-up dialogs. Known limits: Fillet makes a plain outline (a rectangle loses its
own Radius box; a very large size can make a result overlap itself).

### How to start tomorrow

The assistant's sandbox is empty at the start of every session and can also reset in the middle of one (it did on 2026-10-14). Nothing is
remembered except this file, the saved memories and the conversation history. So:

1. Lee uploads STATUS.md (this file) and says what he wants. The assistant reads this section first and does the FIRST JOB above.
2. For each piece of work the assistant asks for a bundle of the files it needs. Lee makes it with the Bundle function below and uploads
   it. Uploads can be renamed to end in .txt if they are blocked; very large bundles (over about 300 KB) sometimes fail, so ask for a
   smaller one. The assistant rebuilds the files from the bundle with a few lines of Python (split on the "===== path =====" lines).
3. Always ask for what the code really looks like before changing it. Never guess at a file that was not in a bundle.

The Bundle function (paste into PowerShell in the repo root, then call it with a list of files; missing files are skipped):

    function Bundle($out, $files) {
      $nl = [char]10
      $files = $files | Where-Object { Test-Path $_ } | Sort-Object -Unique
      $files
      $files | ForEach-Object { "$nl===== $_ =====$nl" + (Get-Content $_ -Raw -Encoding UTF8) } | Set-Content -Encoding UTF8 $out
      "{0}: {1:N0} KB" -f $out, ((Get-Item $out).Length / 1KB)
    }

Files to ask for, ready to paste. For the Border only problem (the open problem above):

    Bundle C:\Dev\bundle-border.txt @(
      'apps/desktop-ui/src/components/ShapeToolsPanel.tsx', 'apps/desktop-ui/src/lib/borderChain.ts',
      'apps/desktop-ui/src/lib/originals.ts', 'apps/desktop-ui/src/lib/shapeOps.ts', 'apps/desktop-ui/src/lib/offsetLayer.ts',
      'apps/desktop-ui/src/state/projectStore.ts', 'apps/desktop-ui/src/lib/tauri.ts', 'apps/desktop-ui/src/types/domain.ts',
      'apps/desktop-ui/tests/borderChain.test.ts', 'docs/user-guide.md', 'CHANGELOG.md'
    )

For cut tabs (and presets that remember threshold and sharpen):

    $files = @(
      'apps/desktop-ui/src/components/ShapeToolsPanel.tsx', 'apps/desktop-ui/src/lib/shapeOps.ts',
      'apps/desktop-ui/src/lib/originals.ts', 'apps/desktop-ui/src/lib/traceObject.ts', 'apps/desktop-ui/src/components/TracePanel.tsx',
      'apps/desktop-ui/src/components/PanelParts.tsx', 'apps/desktop-ui/src/components/LayersPanel.tsx',
      'apps/desktop-ui/src/components/PropertiesPanel.tsx', 'apps/desktop-ui/src/types/domain.ts', 'apps/desktop-ui/src/lib/tauri.ts',
      'packages/project/src/toolpath.rs', 'packages/project/src/cam.rs', 'packages/project/src/gcode.rs',
      'packages/common/src/layers.rs', 'packages/common/src/operations.rs', 'packages/common/src/objects.rs',
      'packages/common/src/project.rs', 'packages/common/src/geometry_types.rs',
      'apps/rust-core/src/commands/project_cmds.rs', 'apps/rust-core/src/main.rs',
      'docs/user-guide.md', 'docs/api.md', 'docs/roadmap.md', 'CHANGELOG.md'
    )
    Bundle C:\Dev\bundle-tabs-cut.txt $files

For the node editing design note (everything that touches paths; this list is long, so it may need two bundles):

    git grep -l -E "Path2D|[.]points" -- '*.rs' '*.ts' '*.tsx' ':!*/tests/*'

then add packages/geometry/src/bezier.rs, packages/geometry/src/svg_import.rs, packages/geometry/src/dxf_import.rs,
packages/project/src/mlp.rs, apps/desktop-ui/src/canvas/WorkspaceCanvas.tsx and apps/desktop-ui/src/lib/shapes.ts, plus the project
format and architecture documents in docs.

### How the assistant works with Lee (keep doing this)
- Lee works on Windows in PowerShell, wants commands he can paste, short answers for simple things and detail for risky or unclear
  ones, and a friendly informal tone. He tries every update in the app and reports what feels clumsy: treat that as the design brief.
  When a report is unclear ("keeps 2 layers active"), ask for a screenshot of the Objects list and what he meant. Do not guess.
- Each piece of work is ONE install script, written as an ES module that Lee saves in C:\Dev and runs from the repo root:
  node C:\Dev\apply-something.mjs --dry-run, then without --dry-run. The script: refuses to run on main (--force overrides); does not need
  a clean tree; checks every change first and writes NOTHING unless all of them fit; changes a file by an exact regular-expression
  anchor that must match exactly once; keeps each file's line endings; can be run twice (the second run does nothing); adds a block to
  STATUS.md; and updates docs/user-guide.md and CHANGELOG.md. Documentation edits that cannot find their text are skipped with a note
  instead of stopping everything. When the script replaces a whole function, it first checks that the function is the version it was
  written against and stops with a message if Lee has changed it.
- A script that replaces a whole existing file must tolerate the end of the file: PowerShell's Set-Content adds a newline, so a bundle
  copy of a file has one more blank line at the end than the real file. Compare ignoring trailing newlines, and fall back to small
  anchored edits if the file differs somewhere that does not matter. (This cost a round trip once.)
- Patterns for docs edits are regular expressions: escape every literal piece (asterisks, brackets, dots). Build them from the text
  with each run of whitespace matching any whitespace. (This broke an installer twice.) Check that the marker text a script uses to decide
  "already done" is really in the text it adds (one marker did not match, so a second run would have added a line twice).
- Every update ends with the git steps: git add -A, commit, push, WAIT for CI to go green on GitHub, switch to main, pull, merge the
  branch, push, delete the branch locally and on GitHub, git fetch --prune. USE THE REAL BRANCH NAME in the merge lines, and ask first
  which branches exist: on 2026-10-14 Lee was told to switch to a branch that had already been merged and deleted.
- Tell Lee exactly what to run to check it: node scripts/check-docs.mjs, npm run ui:typecheck, npm run ui:lint, npm run ui:test (and
  npm run rust:test, npm run rust:lint and npm run rust:fmt when Rust changed), then a short list of things to try in npm run dev.
- Throwaway Rust diagnostics: a test file in packages/geometry/tests, run from packages/geometry with cargo test --test NAME -- --nocapture,
  deleted afterwards and never committed. Give each file a distinct name and tell Lee the exact folder: on 2026-10-14 he ran the old file
  twice because a second file had a similar name and landed in the wrong folder. Ask him to confirm it with Select-String on the test
  function name before running. If a download link does not show, present the file again under a new name.
- Warn Lee not to run git checkout . or git restore . while work is uncommitted.
- Never call something verified until it has been run. Say plainly what was and was not tried. Keep STATUS.md up to date, and make
  every backticked file name in it a file that exists (check-docs warns about the rest).

### Working notes for the assistant's sandbox
- Available: Python (shapely for independent geometry checks, PIL), Node, TypeScript (tsc), React and react-dom 19 development builds
  in /opt/oai-docgen/node_modules, and a headless Chromium under /opt/pw-browsers. There is no Rust, no cargo, no PowerShell, no vitest, and
  no Clipper (shapely is the independent check for geometry).
- Playwright for Python looks for a browser version that is not installed: pass executable_path to the chromium_headless_shell-* binary (the version number changes between sessions: it was 1208, then 1228, so find it with glob.glob("/opt/pw-browsers/chromium_headless_shell-*/*/chrome-headless-shell"))
  (find it with glob) and args ["--no-sandbox"]. A page made with set_content has no crypto.randomUUID: add a small polyfill in the test harness.
- How each update was checked, and it was worth it every time: strict tsc (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes,
  noUnusedLocals) with small typed stubs for anything not in the bundle; a tiny stand-in for vitest (describe, it, expect, toBe, toEqual,
  toBeNull, toHaveLength, toContain, toBeGreaterThan) to run the unit tests; real browser tests that bundle the real React panels with a few
  lines of Node (a mini bundler that follows require calls and maps the @/ alias) and drive them with Playwright, using stand-ins for the
  project store (useSyncExternalStore), NumberField, transform.ts, arrange.ts, selectionKeys.ts, corners.ts and the Tauri calls; and mutation
  checks, where the compiled code is broken on purpose in several ways to prove the tests fail. Several "passing" tests turned out to test
  nothing until this was done. The stand-in for the two Rust geometry commands is exact only for rectangles: it cannot find a bug in the
  real Rust, and nothing about ellipses or other curves can be claimed from it.
- The tool call limit is 60 seconds. Run slow browser or mutation tests in the background with nohup and read the output after a sleep.
- Rebuild the user's files from the bundle and run each installer on that copy: dry run, real run, second run, on main, with a drifted
  anchor, with CRLF, with a stray file in the tree, with the docs text changed. Compare the installed files byte for byte with the ones that
  were tested.
- Files in the sandbox can vanish between two commands, and the whole sandbox was reset in the middle of a session on 2026-10-14. Write the
  deliverable to /mnt/user-data/outputs early, and keep the generator scripts small enough to rewrite.
- Rust cannot be compiled here. Say so. Write Rust carefully, give Lee the cargo commands, and expect to fix a compile slip or a failing
  test from his output. A Python port of a Rust function is only a check of the idea, not of the Rust.

---

(Everything below this line is the log of earlier updates, kept for history. The START HERE section above is the current plan.)

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

## Update 2026-10-11: material presets remember overscan, outline and ramp

Done on branch `material-presets` (merge to main once CI is green):

- A material preset now stores `overscan_mm` (Fill and Image), `fill_outline` (Fill) and `ramp_mm` (Score).
  They are optional. A preset that leaves them out does not touch the layer when applied, so every older
  preset, project and library file behaves as before. Applying a preset that sets them sets them on the
  layer.
- "Save as preset" in the Layers panel stores the layer's values (0 and off included).
- "Preset in use" matches on these too and shows them, e.g. "Preset in use: Ply (overscan 3 mm, outline on)".
- Library files (`makerlaser.materials`, still version 1) carry the three fields; older apps ignore them.
- Rust: `MaterialPreset` in `packages/common/src/material.rs` (`Option` fields, `apply_to`). TypeScript:
  `selectionInfo.ts` (`applyPresetToLayer`, `extrasFromLayer`, `presetMatchesLayer`) and `configFormat.ts`.
- Not done: the Material library list does not edit these three values (hover a preset's type to read them).
  To change one, set it on a layer, save a new preset and delete the old one. The starter presets set none of
  them. Not yet tried on a real laser.

Next: whatever is chosen from the roadmap.

## Update 2026-10-11 (later): layers and image panel. This replaces "What is next" above.

Done on branch `layers-image` (merge to main once CI is green and it has been tried in the app):

- **Layers panel:** a Colour box per layer, a Lock artwork tick box (locks every object on the layer at
  that moment; it sets each object's own Locked flag, so no new saved field), and a drag handle that
  moves a layer in the list. Dragging uses pointer events, not HTML5 drag and drop, because Tauri's file
  drop handling can stop HTML5 drag and drop working on Windows. In the automatic order only layers of the
  same type swap places; the arrows still work. Logic is in `apps/desktop-ui/src/lib/layerTools.ts`.
- **Image layers:** `threshold` (0 to 255, default 128, u8) and `sharpen` (0 to 100, default 0, f64) on
  `RasterOperation`, with `#[serde(default)]`, so old projects load unchanged. `makerlaser_raster::sharpen`
  (3 x 3 unsharp mask, up to 3 times the detail added back) runs after Adjustments and before the dither,
  in both `raster_runs` (toolpath.rs) and `raster_preview` (project_cmds.rs). The preview is made at a
  smaller size than the engraving, so sharpening looks different there from the real job.
- Not done: a choice of grayscale conversion (needs a change to `load_grayscale`, which was not in the
  bundle), layer show/hide separate from Enabled (an object that is not visible does not run, so they
  would mean the same thing), presets that remember threshold and sharpen.
- **Not compiled and not run.** The Rust (including its new tests) has never been through `cargo`, and the
  drag handle has never been tried with a mouse. The first compile is on the owner's PC.
- Checked by grep this session: air assist already writes M8 and M9 (packages/project/src/gcode.rs); the
  interface has no boolean or offset tool (the engine is in the geometry crate).

**Build order decided 11 October 2026** (also in docs/roadmap.md): 1 hardware bring-up and 0.2.0 (needs
the laser); 2 layers and image panel (this update); 3 boolean, offset and arrays in the interface;
4 bitmap trace; 5 fillets and chamfers; 6 node editing (needs a path model with curves, plan it first);
7 cut tabs and bridges; 8 library, templates, camera; 9 rotary (only with hardware).

**Next task: step 3.** Before writing it the assistant needs to see how the geometry crate exposes
booleans and offsets. To make the bundle, run from the repo root (it finds the files itself):

    git grep -l -i -E "clipper|offset|difference|union|kerf_compensate" -- '*.rs'

and bundle those files plus `apps/desktop-ui/src/lib/arrange.ts`, `apps/desktop-ui/src/lib/transform.ts`,
`apps/desktop-ui/src/components/Toolbar.tsx`, `apps/desktop-ui/src/components/ToolsPanel.tsx`,
`apps/desktop-ui/src/state/projectStore.ts` and `apps/rust-core/src/main.rs` with the `Bundle` function
shown earlier in this file.

## Update 2026-10-11 (step 3): shape tools. This replaces "Next task: step 3" above.

Done on branch `shape-tools` (merge to main once CI is green and it has been tried in the app):

- **Shape tools** panel inside the Properties panel (`apps/desktop-ui/src/components/ShapeToolsPanel.tsx`, planning in
  `apps/desktop-ui/src/lib/shapeOps.ts`): Union, Subtract, Intersect, Exclude; Offset outward or inward with sharp or
  round corners and a Keep the original tick; a circular array (pieces, angle, centre X and Y, turn the copies). No
  pop-up windows: the answer is written under the buttons, and each action is one undo step.
- **Rust:** `packages/geometry/src/shape_ops.rs` (`combine`, `offset_shape`) sits on `clip.rs` and `offset.rs`. Holes are found
  by which path lies inside which, not by the direction a path was drawn in, and every path is turned the right way
  round before Clipper2 sees it, so the answer does not depend on the default fill rule. Offset goes level by level
  (outlines grow, holes shrink, islands grow again), so a ring stays a ring. Two new commands in
  `apps/rust-core/src/commands/geometry_cmds.rs`: `boolean_paths` and `offset_paths` (they take and return paths in
  workspace mm and change nothing in the project). Limits: 500 shapes, 2,000,000 points, offsets up to 1000 mm.
- Subtract keeps the shape furthest back (lowest `z_index`, lowest in the Objects list) and cuts the others out of it.
  The result replaces the selected shapes, joins the layer of the shape furthest back and has no `source`, so it is no
  longer editable as a rectangle or as text. Pictures, locked shapes and objects with open lines are refused by name.
- Rows and columns already existed in Arrange (`planArray` in `arrange.ts`), so only the circular array is new.
- Not done: a preview of the array drawn on the canvas (the panel gives a text summary and a bed warning), a way to swap
  which shape Subtract keeps, and Shape tools fields in inches (they are in mm).
- **Compiled and tested on the owner's PC (11 Oct 2026):** the Rust built first time. One test failed: shapes at the same level were offset one by one but not merged, so two shapes that grew into each other stayed as two overlapping paths. Fixed in `offset_shape` (they are united level by level), with a new test for holes that grow into each other. The panel has not been tried with a mouse yet. The install script also added one `pub mod` line to the commands module list.
- Documentation: `docs/user-guide.md` and `CHANGELOG.md`. The install script also tried to add two rows to the command
  table in `docs/api.md`; if `node scripts/check-docs.mjs` complains, that is the place to look.

**Next task: step 4, bitmap trace to vector** (import a JPG or PNG, adjust threshold and corner smoothing, preview, then
make ordinary editable paths). To make the bundle, run from the repo root with the `Bundle` function shown earlier in
this file:

    git grep -l -E "load_grayscale|import_artwork|ImageData|raster_preview|rasterPreview" -- '*.rs' '*.ts' '*.tsx' ':!*/tests/*'

and add `apps/rust-core/src/commands/import_cmds.rs`, `packages/raster/src/lib.rs`, `packages/raster/src/adjust.rs`,
`packages/raster/src/dither.rs`, `packages/geometry/src/lib.rs`, `packages/common/src/objects.rs`,
`apps/desktop-ui/src/lib/actions.ts`, `apps/desktop-ui/src/lib/tauri.ts`, `apps/desktop-ui/src/types/domain.ts`,
`apps/desktop-ui/src/components/ShapeToolsPanel.tsx`, `docs/import.md`, `docs/api.md`, `scripts/check-docs.mjs` and
`CHANGELOG.md`. If a tracing library is used rather than our own, check its licence against GPL-3.0-or-later.

## Update 2026-10-11 (step 3, panel pass): layout, base shape and border. Read with the step 3 notes above.

Changes made after trying the shape tools in the app (still on branch `shape-tools`, not merged yet):

- **Layout.** `ShapeToolsPanel.tsx` no longer uses the `.field-row` classes. It has its own two-column grid
  (`minmax(0, 1fr)`) with each label above its box, so nothing is squeezed or cut off in the narrow
  Properties column. Rendered with React in headless Chromium at 300 and 350 px wide with an approximation of
  the app's colours: no overflow. The app's real CSS was not available for that check.
- **Subtract from.** With two or more closed shapes selected there is a "Subtract from" list (name and size on
  the bed). The chosen shape is the base: Subtract cuts the others out of it and the result goes on its layer.
  It starts as the shape furthest back. `planBoolean(objects, ids, op, baseId)` takes the choice; the line under
  the list says exactly what will be cut out of what. This replaces the old "Not done: a way to swap which shape
  Subtract keeps".
- **Offset result: Border only.** Engraving (Fill) covers the whole of a shape, so an offset shape on its own
  also fills the middle, even when the original sits inside it on another layer. "Border only (a frame)" makes
  the band between the old outline and the new one instead: growing is new minus old, shrinking is old minus
  new (`planBorder` in `shapeOps.ts`; it calls the existing `boolean_paths` command, so there is no new Rust).
  A shape shrunk away gives the whole shape as its border. Names read "Square (border +3 mm)".
- Tests: `shapeOps.test.ts` now has 40 tests (they passed in a stand-in runner, not in the project's own).
  Not tried with a mouse yet.

## Update 2026-10-11 (step 3, window pass): Ctrl adds to the selection; Shape tools is a window. Read with the step 3 notes above.

Changes after trying the shape tools in the app (still on branch `shape-tools`, not merged yet):

- **Ctrl (Cmd on a Mac) now works like Shift for adding to the selection**, on the canvas (click and box select) and in
  the Objects list. Every selection check used `shiftKey` only (`WorkspaceCanvas.tsx`, `PropertiesPanel.tsx`); they now
  call `isAdditiveSelect` in `apps/desktop-ui/src/lib/selectionKeys.ts`. The Measure and drawing tools still use Shift
  for their own purposes and were not touched. The canvas hint reads "Shift or Ctrl: add to selection". The canvas
  (Konva) change is a one-word edit and has not been tried with a mouse yet.
- **Shape tools is a window, not a section of the Properties panel.** That panel only exists while something is
  selected, so the section vanished (and lost its settings) whenever the selection changed. Now: a "Shape tools…" button
  in the toolbar opens it and the x in its title bar closes it; in between it stays up whatever is selected and works on
  the current selection. `ShapeToolsPanel` is mounted once in `App.tsx` and draws nothing while closed, so its settings
  are kept; the open flag is state/shapeToolsStore.ts. Drag the title bar to move it; double-click the title bar to put
  it back (the position is CSS-clamped so it stays on screen). It sits beside the right-hand panel by default.
  The message under the buttons belongs to the selection it was about and hides when something else is selected
  (`selectionKey`).
- Checked in headless Chromium with the real component, real React and the app's own CSS values (34 checks: stays up
  while the selection changes, drag, clamp, reset, close and reopen with settings kept, Union / Border / array actions,
  no overflow, short window). The app's Konva canvas, the toolbar button and the real geometry commands were not part of
  that test. 50 unit tests (`shapeOps`, `selectionKeys`) passed in a stand-in runner, not the project's own.
- Not done: remembering the window's position between sessions; Esc does not close it (Esc clears the selection).

## Update 2026-10-11 (step 4): bitmap trace. This replaces "Next task: step 4" above.

Done on branch `bitmap-trace` (merge to main once the checks pass and it has been tried in the app):

- **Trace window** (`apps/desktop-ui/src/components/TracePanel.tsx`): "Trace…" in the toolbar. Select one picture (PNG, JPG, BMP)
  and a live preview shows the outlines over it. Settings: Threshold (a slider, 0 to 255), Invert, Smoothing (0 to 10),
  Ignore specks (mm²) and Simplify (mm). "Make outlines" adds ONE new vector object, on the layer you choose (a Score layer by
  default), placed exactly over the picture (it gets the picture's own transform, and its paths are in the picture's own
  millimetres), in one undo step. "Afterwards" hides (default), keeps or deletes the picture; a locked picture is never touched.
  The window stays open and keeps its settings, like Shape tools (state/traceStore.ts).
- **No Rust, no new command, no Cargo change.** The picture is decoded by the browser (`lib/traceImage.ts`, a canvas) and traced
  in TypeScript. This was chosen so it could be run and tested for real; the tracer is pure and unit-tested.
- **The tracer** (`lib/bitmapTrace.ts`): blur (Smoothing) -> a number per pixel that is positive where there is ink, with a
  border of "not ink" so outlines always close -> marching squares with interpolation between pixels (so edges are not
  stair-stepped) -> drop outlines under the Ignore-specks area -> Ramer-Douglas-Peucker to the Simplify tolerance. Holes run the
  opposite way to outlines; engraving a result as a fill uses even-odd, so holes work. Pictures are traced at 800 to 1400
  pixels along the longest side: small ones are enlarged first (bilinear), big ones shrunk. Smoothing is measured in the
  picture's OWN pixels (`blurScale`), so an enlarged small picture is blurred more; without that a 64 px icon kept its steps.
  A transparent pixel counts as white. Marching squares cuts each corner by half a pixel, so with Simplify the corners of a
  sharp-cornered logo are off by up to the tolerance. Outlines are straight-sided polylines (curves need the new path model
  planned for node editing, step 6).
- Limits: 50,000 outlines and 300,000 points per trace (`traceObject.ts`); the preview is only drawn up to 120,000 points; a
  photograph at full detail makes far more, so Make is refused with the numbers and what to change. Photographs belong on an
  Image layer.
- New shared pieces: components/FloatingWindow.tsx (the draggable window and small layout helpers). Shape tools has its own
  copy of the same code and was NOT changed; it could use FloatingWindow later.
- `apps/desktop-ui/src/lib/textTrace.ts` already traces text into outlines. It was not in the bundle, so it was NOT reused: the
  picture tracer is separate. They could be unified later.
- Checked: 80 unit tests (`bitmapTrace`, `traceObject`) passed in a stand-in runner, not the project's own; and 50 checks of the
  real window ran in headless Chromium with real PNG and JPEG files (preview, settings, Make, layer, hide/keep/delete, locked
  picture, transparent PNG, a 3000 x 2000 JPEG, a 1000 x 1000 noise picture hitting the limit, close and reopen, side by side
  with Shape tools). That used stand-ins for the project store, NumberField, `transform.ts` (including `imageSizeMm`) and the
  Tauri call. NOT tried in the real app's webview, and the Konva canvas was not part of it.
- Not done: tracing several pictures at once; a trace of only part of a picture; colour tracing; curve fitting; remembering the
  window's position between sessions.

**Next task: step 5, fillets and chamfers.** Per-corner picking needs node editing (step 6), so the plan is a window like Shape
tools that rounds or chamfers the corners of the selected shapes by a radius, with an angle limit so only the sharp corners are
touched. To make the bundle, run from the repo root with the `Bundle` function shown earlier in this file:

    git grep -l -i -E "corner_radius|rounded|fillet|chamfer" -- '*.rs' '*.ts' '*.tsx' ':!*/tests/*'

and add `apps/desktop-ui/src/lib/shapeOps.ts`, `apps/desktop-ui/src/lib/shapes.ts`, `apps/desktop-ui/src/lib/transform.ts`,
`apps/desktop-ui/src/components/ShapeToolsPanel.tsx`, `apps/desktop-ui/src/components/PanelParts.tsx`, `apps/desktop-ui/src/components/RightTabs.tsx`,
`apps/desktop-ui/src/components/TracePanel.tsx`, `apps/desktop-ui/src/components/Toolbar.tsx`, `apps/desktop-ui/src/App.tsx`,
`apps/desktop-ui/src/lib/tauri.ts`, `apps/desktop-ui/src/types/domain.ts`, `packages/geometry/src/lib.rs`,
`packages/geometry/src/shape_ops.rs`, `packages/geometry/src/bezier.rs`, `apps/rust-core/src/commands/geometry_cmds.rs`,
`apps/rust-core/src/main.rs`, `docs/user-guide.md`, `docs/api.md` and `CHANGELOG.md`.

## Update 2026-10-11 (right-hand tabs): Shape tools and Trace are tabs; the Trace preview zooms.

State first: the Trace window update and the Ctrl / Shape tools window update were already on `main` (the `bitmap-trace`
branch no longer exists). This update is on branch `right-tabs` (merge to main once the checks pass and it has been tried in the app):

- **The right-hand panel has tabs** (`apps/desktop-ui/src/components/RightTabs.tsx`): **Properties** (the selection and
  objects, then Layers and the Material library, exactly as before), **Shape tools** and **Trace**. The tab bar stays at the
  top while the panel scrolls. Left and right arrows, Home and End move between tabs (they call `stopPropagation`, so the
  arrow keys do not also nudge the artwork through the app-wide shortcuts). The toolbar buttons "Shape tools…" and "Trace…"
  switch to their tab, and back to Properties when pressed again (`state/rightTabStore.ts`, pure logic in `lib/rightTabs.ts`).
  The panels of tabs that are not showing stay mounted and are hidden (`hidden`), so what you typed in them is kept; Shape tools
  and Trace take an `active` prop and draw nothing, decode nothing and trace nothing while another tab is showing.
- `ShapeToolsPanel.tsx` and `TracePanel.tsx` are no longer floating windows: no title bar, no dragging. Their layout pieces moved
  to `components/PanelParts.tsx` (`PanelGroup`, `PanelField`, `PanelTick`, `PanelSlider`). **Removed:** FloatingWindow.tsx,
  state/shapeToolsStore.ts, state/traceStore.ts (the script only deletes a file when nothing imports it any more).
- **Zoomable Trace preview** (`components/ZoomPreview.tsx`, maths in `lib/previewView.ts`): the mouse wheel zooms towards the
  pointer (1x to 64x), dragging moves the picture, double-click shows all of it, and + − Fit 1:1 buttons do the same; a readout
  shows the real size on screen (100% = one picture pixel per screen pixel). The picture under the outlines is now the picture
  at the size it was traced (`previewUrl` in `lib/traceImage.ts`; it was a 360 px thumbnail, which would have gone blurry), and is
  drawn as sharp squares once each pixel is 2 or more screen pixels wide, so you can see exactly which pixels were traced. A
  "Show the picture under the outlines" tick hides the picture. The zoom is kept per picture (one at a time) and survives a
  visit to another tab; a different picture starts zoomed out. The wheel is a real non-passive listener, because React's own
  wheel handler cannot stop the panel behind from scrolling. The point under the pointer is worked out from the newest view
  (`pictureAt`), not from what is drawn, so a fast spin of the wheel does not drift.
- A wider panel gives a bigger preview (drag the line beside the panel); the preview is at most 320 px high.
- Checked: 43 unit tests (`previewView`, `rightTabs`) in a stand-in runner, not the project's own; and 65 checks in headless
  Chromium with real React, the real tab bar, preview and both converted panels, real PNG files, real wheel and mouse input
  (tabs, hidden panels keep their state, nothing is read while Trace is hidden, keyboard, sticky tab bar, no sideways overflow at
  300 and 360 px, zoom, pan, clamp, 1:1, pixel rendering, zoom kept per picture). Seven deliberate breakages were each caught.
  Stand-ins were used for the project store, `NumberField`'s helpers, the Tauri call, the Shape tools LOGIC (`shapeOps.ts`:
  unchanged by this update and tested before) and the three existing panels. **NOT tried in the real app**, and the Konva
  canvas was not part of it.
- Not done: remembering the selected tab or the zoom between sessions; splitting Layers into its own tab (the tab list is one
  array in `lib/rightTabs.ts`, so adding a tab is a few lines); Arrange and Test grid are still pop-up dialogs.

## Update 2026-10-11 (step 5): fillet and chamfer. This replaces "Next task: step 5" above.

State first: the right-hand tabs update is on `main` (commit 4ac9c8a, CI green: 813 front-end tests and both Rust jobs). This update
is on branch `corners` (merge to main once the checks pass and it has been tried in the app).

- **Fillet and chamfer** is a new group in the Shape tools tab (`ShapeToolsPanel.tsx`), under Offset: Size (mm), Skip bends gentler
  than (degrees), Which corners (all, outside, inside), a line saying how many corners the settings find, a Fillet button, a
  Chamfer button and Keep the original. It works on every selected closed shape on its own and makes one new object per shape
  (named like "Square (rounded 3 mm)", on the same layer, a plain outline with no recipe). It is one undo step and says what it did
  under the buttons. The original is kept unless Keep the original is off; a locked original, or one with open lines, is never replaced.
- **No Rust, no new command, no Cargo change.** The geometry is pure TypeScript in `lib/corners.ts`, unit-tested in
  `tests/corners.test.ts` (52 tests). It was also compared with an independent construction (shapely: shrink then grow back for
  outside corners, grow then shrink back for inside corners): 66 cases (square, rectangle, L, T, triangle, hexagon, a ring and a
  nested island, drawn both ways round, rotated), all within the allowance for the flat segments of the arcs (0.02 mm tolerance).
- **How it works.** Each closed outline is cleaned (repeated points out). At every point the turn angle is measured. A corner is any
  point that turns the outline by at least the minimum (30 degrees to start with, so circles and already-rounded rectangles are left
  alone; a spike that doubles back is never a corner). Outside or inside is worked out from nesting (which outline lies inside which),
  not from the direction an outline was drawn in, so a hole drawn the same way round as its outline is still a hole, and an island in
  a hole sticks out again. A fillet of radius r at a corner that turns by t cuts back r times tan(t / 2) along both edges and joins
  the two points with an arc, flattened like every shape; a chamfer cuts back the size. Where two neighbouring corners want the same
  edge it is shared in proportion to what each wants, so they never overlap; a corner whose neighbour is not changing may use the
  whole edge. A corner made smaller is counted and reported. One with less than 0.0001 mm of room is left alone and reported.
- Limits: size 0.01 to 500 mm; minimum bend 1 to 179 degrees; a shape with more than 5,000 outlines or 200,000 points is refused
  (working out which outline is inside which grows fast), so a big Trace result needs Simplify first. Open lines are left out, as with Offset.
- A rectangle made with the Rectangle tool keeps its own Radius box and stays editable. Fillet makes a plain outline from it, so
  use that box when the rectangle should stay a rectangle. Not done: setting that radius from this panel.
- Known limit: a size so large that it reaches another part of the same shape (a thin neck, a narrow notch) can make the result
  overlap itself, because only neighbouring corners are kept apart. Look at the result, or press Undo. Single corners cannot be
  picked: that needs node editing, step 6.
- Checked: 52 unit tests in a stand-in runner (not the project's own), with 12 deliberate breakages of the geometry each caught; and
  43 checks of the real panel in headless Chromium with real React and the real shape code (areas of the results, names, layers,
  one undo step, keep and replace, a locked original, a circle with no corners, a star's tips and notches, a huge size cut down to
  fit, a ring, a stretched object, names of what was left out, bad numbers, settings kept while the tab is hidden, no sideways
  overflow at 300, 340 and 380 px), plus deliberate breakages of the panel. Stand-ins were used for the project store, NumberField,
  selectionKeys, the Tauri call and arrange.ts (only two names from it are used). **NOT tried in the real app.**
- Documentation: user guide, changelog and roadmap.

**Next task: step 6, node editing.** This is the big one. Paths are lists of straight segments today, so there is nothing for a Bezier
handle to hold. Plan it before writing any code: a short design note that says what the new path model is (segments that can be
lines or cubic curves), what loads and saves (old projects must open unchanged), where curves are flattened (the CAM, offset,
boolean and trace code all expect straight segments), and how editing on the canvas works (select a node, drag it, add and
remove nodes, turn a line into a curve, handles). Then build in stages, each its own checked update. To make the first bundle,
run from the repo root with the `Bundle` function shown earlier in this file:

    git grep -l -E "Path2D|\.points\b" -- '*.rs' '*.ts' '*.tsx' ':!*/tests/*'

That list is long. For the design pass the most useful files are `packages/common/src/geometry_types.rs`,
`packages/common/src/objects.rs`, `packages/geometry/src/bezier.rs`, `packages/geometry/src/svg_import.rs`,
`packages/project/src/toolpath.rs`, `packages/project/src/mlp.rs`, `apps/desktop-ui/src/types/domain.ts`,
`apps/desktop-ui/src/canvas/WorkspaceCanvas.tsx`, `apps/desktop-ui/src/lib/shapes.ts`, `apps/desktop-ui/src/lib/textTrace.ts` and
`apps/desktop-ui/src/lib/corners.ts`, plus the project format and architecture documents in `docs`. Step 7 (cut tabs) does not
depend on step 6, so it could go first if node editing needs more thought.

## Update 2026-10-11 (original shapes): a result replaces the shapes it was made from.

State first: the fillet and chamfer update is on `main` (commit 5504700). This update is on branch `originals` (merge to main once
the checks pass and it has been tried in the app).

Why: every Shape tools action kept the original on the canvas by default and gave the result a longer name, so a few steps left
stacked copies and names like "Union (chamfered 100 mm)" beside "Union". The setting also lived in two places (a "Keep the original"
tick under Offset and another under Fillet and chamfer), and Combine always replaced.

- **One setting, "Original shapes", at the top of the Shape tools tab** (`ShapeToolsPanel.tsx`; logic in
  `apps/desktop-ui/src/lib/originals.ts`), used by Combine, Offset and Fillet / Chamfer. **Replace them with the result** is the new
  default: the result takes the place of the shapes it was made from, keeping their name, layer and position in the stacking order
  (z_index), so a shape you combine, offset and round stays one shape in the Objects list; Ctrl+Z brings the originals back. **Hide
  them** keeps the originals in the project with `visible: false` (they do not run; the eye in the Objects list shows them again) and
  names the result for what was done ("Square (rounded 3 mm)"). **Leave them as they are** is the old behaviour. The two old ticks are gone.
- A locked original, or one with open lines (a result would lose them), is never replaced or hidden, whichever mode is chosen: the
  result is then a new shape beside it, and the message says so. An original that produced no result (a circle with no corner to
  round, an inward offset bigger than the shape) is left exactly as it was.
- The result stays selected, so Offset, then Fillet, then Chamfer can be chained on one shape without selecting it again.
- Combine results are named after the BASE shape (the one picked under "Subtract from", or the one furthest back) and take its
  layer and position; under Hide and Leave they are called "Rectangle (union)" and so on, not just "Union".
- Not done: Circular array (it adds copies and keeps the original by definition); the setting is not remembered between sessions;
  Trace has its own "Afterwards" choice (hide, keep or delete the picture), which this does not change.
- Checked: 70 unit tests (`originals`, plus the 52 earlier `corners` tests) in a stand-in runner, with 10 deliberate breakages of
  the logic each caught; and 48 checks of the real panel in headless Chromium with real React and the real shape code
  (names, stacking position, layer, undo steps, selection, hidden originals, locked and open-line originals, three shapes at once,
  chained Offset then Fillet, results that make nothing, Combine under all three modes, the choice kept while the tab is hidden,
  no sideways overflow at 300, 340 and 380 px), plus deliberate breakages of the panel. Stand-ins were used for the project store,
  NumberField, selectionKeys, arrange.ts and the two Rust geometry commands (the real geometry is tested in Rust; the stand-ins
  return a plausible rectangle). **NOT tried in the real app.**
- Ideas not started, for a smoother design flow: a live preview of Offset, Fillet and Chamfer on the canvas before pressing the
  button (needs the canvas code, WorkspaceCanvas.tsx), and a "repeat the last action" button.

## Update 2026-10-11 (original shapes, one per tool): Offset keeps its original. This replaces the "one setting at the top" in the previous block.

State first: the Original shapes update is on `main` (commit 12c9f25). This update is on branch `per-tool-originals` (merge to main once
the checks pass and it has been tried in the app).

Why: the previous update put ONE "Original shapes" setting at the top of the Shape tools tab, defaulting to Replace for all three
tools. That is right for Fillet / Chamfer and Combine, which reshape a shape, but wrong for Offset, whose point is a NEW line round
the original (a cut line round an engraving, a border, an inlay clearance). Replacing the original there throws away the thing the
new line is meant to go round.

- **The setting is now one per tool**, just above each tool's buttons (`ShapeToolsPanel.tsx`; logic in `apps/desktop-ui/src/lib/originals.ts`):
  Combine starts on Replace, Offset starts on **Leave them as they are**, Fillet / Chamfer starts on Replace
  (`DEFAULT_ORIGINAL_MODES`). Each can be changed to Replace, Hide or Leave; the three are independent and are kept while the tab is
  hidden. The group at the top of the tab is gone.
- Offset with Leave: the new outline is a new object ("Square (offset +2 mm)", or "(border +2 mm)" for Border only), on the same layer,
  on top, and selected, so Fillet or another Offset can go straight on to it. The message is just "Made 1 offset shape." The original
  is untouched.
- `originalsNote(plan, tool)` stays quiet about what is simply the usual behaviour of the tool (a plain Replace for Combine and
  Fillet / Chamfer, and leaving the original for Offset) and speaks up about anything else (hidden, or the unusual Leave / Replace,
  and locked or open-line originals that were kept).
- Everything else from the previous update is unchanged: Replace keeps the original's name, layer and stacking position; Hide sets
  `visible: false`; a locked original or one with open lines is never replaced or hidden; an original that produced no result is left alone.
- Not done: Offset puts its result on the SAME layer as the original. A cut line round an engraving usually belongs on a different
  layer, so a "Put the result on layer" choice for Offset would save a step (Trace already has one). Not started. The settings are not
  remembered between sessions. Circular array is unchanged (it adds copies).
- Checked: 72 unit tests (`originals`, plus the 52 `corners` tests) in a stand-in runner; and 58 checks of the real panel in headless
  Chromium with real React and the real shape code (the three defaults, independence of the three settings, Offset keeping its
  original and Border only too, Offset set to Replace, Offset then Fillet chained, Fillet and Combine under all three modes, locked
  and open-line originals, several shapes at once, no sideways overflow at 300, 340 and 380 px), plus deliberate breakages. Stand-ins
  were used for the project store, NumberField, selectionKeys, arrange.ts and the two Rust geometry commands. **NOT tried in the real app.**

### Update 2026-10-14: Offset "Put the result on layer".
State first: main is at f42360a. The per-tool-originals update (1eaac6d) is on main, and Lee's local checks on main were all green (check-docs, typecheck, lint, 44 test files and 885 tests). This update is on branch offset-layer (merge to main once CI is green and it has been tried in the app).
- **Offset has a "Put the result on layer" box** (ShapeToolsPanel.tsx, in the Offset group, above Original shapes). It starts on "Same layer as the original", which is what Offset did before. Pick a layer and every result of that Offset goes on it, so a cut line round an engraving can go straight onto a Cut layer. The message under the buttons says which layer it went on, e.g. Made 1 offset shape on the layer "Cut".
- The choice is the layers a trace can use: Cut, Score and Fill layers, in the order of the Layers list (picture layers cannot hold outlines). It is kept while the tab is hidden, like the other Shape tools settings, but not between sessions. A pick whose layer has since been deleted counts as "Same layer as the original".
- It works with all three Original shapes choices and with Border only. With Replace the result still takes the original's name and place in the Objects list, but goes on the layer you picked.
- The logic is in apps/desktop-ui/src/lib/offsetLayer.ts (pure TypeScript, tests in apps/desktop-ui/tests/offsetLayer.test.ts). Combine and Fillet / Chamfer are unchanged: they still use the layer of the base shape or of the original.
- Not done: the same choice for Fillet / Chamfer or Combine; presets that also remember threshold and sharpen (the next small item).
- Checked in the assistant's sandbox (not the project's own tools): strict tsc (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noUnusedLocals) on offsetLayer.ts, its tests and the changed ShapeToolsPanel.tsx, with typed stand-ins for what was not in the bundle; 10 new unit tests in a stand-in runner (4 of 6 deliberate breakages caught, the other 2 change nothing that can be seen); and 30 checks of the real Shape tools panel in headless Chromium with real React (default behaviour unchanged, Cut and Score picked, Inward, two shapes at once, Border only, Replace and Hide, back to the same layer, choice kept while the tab is hidden and when the selection changes, a deleted layer, Combine unaffected, no sideways overflow at 300 px). 6 deliberate breakages of the panel were each caught. Stand-ins were used for the project store, NumberField, corners.ts, transform.ts, arrange.ts, selectionKeys and the two Rust geometry commands (they return a box). The installer was run on copies of the real files: dry run, real run, second run, on main, CRLF, a drifted anchor and a stray file in the tree.
- NOT run: the project's own vitest, ESLint and Prettier, check-docs, and the real app. Fillet / Chamfer, Combine and the array were not touched by this update. Expect 45 test files and 895 tests (44 and 885 before).

### Update 2026-10-14 (Sharp offset spike): offset_shape tidies a shape before it offsets it.
State first: this is on the same branch as the Offset "Put the result on layer" update (offset-layer), as a second commit (merge to main once CI is green and it has been tried in the app).
- **The bug (found by Lee).** Offsetting an ellipse Inward once and then Outward three times with Sharp corners grew a long thin spike. Rust test runs on Lee's PC (two throwaway test files, not kept) reproduced it: 13 of 18 in/out sequences on ellipses from 40 x 30 to 200 x 150 mm went wrong, the 30 x 30 circle did not, and every Round-corner run was fine. The input to the bad step always had edges 0.01 mm long and a turn of 159 to 179 degrees at one point. Clipper2 snaps every result to a 0.01 mm grid, so a result carries such edges, and the next pointed (miter) offset of it threw one point 30 to 900 mm away. The step that failed was the same whichever way it went (Inward or Outward), so it is the shape that is awkward, not the direction.
- **The fix.** offset_shape (packages/geometry/src/shape_ops.rs) now tidies every closed path first (a new private function, tidy): a point closer than 0.05 mm to the one before is dropped, and so is a point within 0.002 mm of the straight line between its neighbours; fewer than three points left means the path is dropped. A smooth curve keeps every point (a 30 mm circle of 64 points stays 64); a very long gentle curve can move by up to about 0.01 mm. A distance of zero still returns the shapes exactly as given. Only offset_shape is changed: the Kerf offset (offset_path, Miter joins) is NOT changed and has the same kind of exposure in principle, untested. Combine does not tidy.
- In the test run, tidying the shape before each step stopped every failure (0 of 18 wrong). The version in the code is a faster one-pass-at-a-time form of the tidying that was tested, so its own tests matter: three new unit tests for tidy and one that runs the in / out sequences on six ellipse sizes with Sharp corners and fails if any point strays.
- **Tried by Lee in the app on 2026-10-14: the spike is gone. The cargo test output was not seen by the assistant.** The assistant cannot compile Rust. The diagnostic test files showed the cause; the fix itself was only checked in a Python port of tidy (a hand-made messy square, a square and a circle left alone, a long gentle arc) and by reading. First compile and cargo test are on Lee's PC.
- Still open (the next update): Border only. A border is a ring, so Offset treats its hole as a second outline: a second Outward also makes a band inside the old outline; a second Inward on a ring narrower than the distance returns the whole ring again on top of itself (copies at the same place); Replace is not the default for Offset, so the previous border stays. Plan: chained clicks on a border make the next concentric band (waiting for Lee to choose between that and one band that gets wider).

### Update 2026-10-14 (Border only chain): a frame is stepped on from the shape it came from.
State first: this is on the same branch as the Offset "Put the result on layer" and the Sharp offset spike updates (offset-layer), as a third commit (merge to main once CI is green and it has been tried in the app).
- **The bug (found by Lee, with a screenshot).** Border only made repeatedly did not give concentric frames. Three Outward clicks on one rectangle left rings INSIDE the rectangle as well as outside it. Cause: a frame is a ring (an outline with a hole), and Offset moves a hole the other way, so the second click on a frame made a band outside it AND a band inside the original shape, and the third made another band further in (checked with an independent geometry model, shapely). Inward twice had the matching problem: a ring narrower than the distance counted as "shrunk away" and came back whole, on top of itself.
- **The fix.** The Shape tools panel now remembers, for each frame Border only makes, the shape it was made from (the base) and where its band lies, as signed distances from the base: 0 to 2 is the first band outside it, -2 to 0 the first band inside it (lib/borderChain.ts, state in ShapeToolsPanel.tsx). Outward on a frame steps to the band beyond it (2 to 4), Inward steps to the band nearer the base (and on inside it). Every band is the base offset by two distances and the inner one cut out of the outer, so each is worked out from the original shape and nothing builds up from the last result. The message says where the band lies ("The frame is 2 to 4 mm outside the shape it came from."), and a stepped-on frame is named "Square (border +2 to +4 mm)" unless Original shapes is Replace, which keeps the name. The first click on an ordinary shape is exactly as before.
- **Works with Original shapes.** Replace: each click swaps the frame for the next band (the previous band goes). Leave or Hide: the earlier frames stay, so three clicks give three concentric frames. Put the result on layer, Corners and the distance box are used as usual; the distance may differ between clicks.
- **Limits.** The memory lives in the panel, not in the project file: it is lost when the app closes. A frame that has been moved, resized or edited since, or one from an older session, is treated as an ordinary shape again, so Border only on it still moves its hole (this is the old behaviour, not fixed). Undo and Redo keep working: the memory is keyed by the frame's id and its outline. The memory keeps the last 100 frames. A band may reach at most 1000 mm from its base.
- Not done: Fillet / Chamfer and Combine on a frame; the memory is not saved in .mlp files (that would need a field in the Rust project format).
- **Not tried in the real app, and the Rust is unchanged.** Checked in the assistant's sandbox only: see the checks below.
- Checked in the assistant's sandbox (not the project's own tools): strict tsc (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noUnusedLocals) on borderChain.ts, its tests and the changed ShapeToolsPanel.tsx, with typed stand-ins for what was not in the bundle; 22 new unit tests in a stand-in runner (9 deliberate breakages of borderChain.ts, each caught); and 43 checks of the real Shape tools panel in headless Chromium with real React, including the reported case (Border only, Replace, three Outward clicks on a rectangle: one frame each time, at 0 to 2, 2 to 4 and 4 to 6 mm, nothing inside the rectangle), Leave, Inward down to nothing, out / out / in / in, Undo, a moved frame, two shapes, a changed distance, the layer choice, the 1000 mm limit and the other modes unchanged. 9 deliberate breakages of the panel and chain logic were each caught. The geometry in that test is a stand-in that is exact for rectangles; the real Rust offset and boolean commands were NOT part of it, and nothing here tested an ellipse. The installer was run on copies of the real files: dry run, real run, second run, CRLF, on main, a drifted anchor, a hand-edited offsetBy (it stops), a re-wrapped import and a stray file.
- NOT run: the project's own vitest, ESLint and Prettier, check-docs, and the real app. Expect 46 test files and 917 tests (45 and 895 before). The Rust is unchanged by this update.

### Update 2026-10-21 (path planning, part 1 of 2: the Rust).
Installed by apply-path-planning-1.mjs on branch path-optimiser. This part is the planner only: packages/project/src/toolpath/pathopt.rs (order_stops, remove_shared_lines), the changes to generate_toolpath in packages/project/src/toolpath.rs, and three new project settings in packages/common/src/project.rs (order_fills_by_distance, on for new projects and off for older ones; cut_part_by_part and cut_shared_lines_once, off). There is no way to change them in the interface until part 2 (apply-path-planning-2.mjs) is installed, so a project behaves exactly as before except that NEW projects burn filled objects nearest first. Compiled and run by Lee on 2026-10-21: cargo test and clippy ran, every new test passed. If part 2 has been installed, its block (the next one down) has the full description.

### Update 2026-10-21: path planning (fill order, part by part, shared lines once).
State first: main is at 4b995ce (Lee's git log on 2026-10-21 showed a clean tree and no other branches). This update is on branch path-optimiser (merge to main once CI is green and it has been tried on a real job).
- **Why.** Lee asked for the head to move in an optimal path that gives a clean result and keeps the time down, and how LightBurn does it. LightBurn has a Cut Planner: order by layer, group and priority, then "cut inner shapes first", "reduce travel moves", choose start points, and "remove overlapping lines". MakerLaser already had inside-first order, nearest-neighbour order within a nesting depth, nearest start vertex and engrave, score, cut. The gaps were: filled objects were burned in drawing order; every hole on the sheet was cut before any outline; and lines on top of each other were cut twice.
- **Lee's machine.** $110 and $111 are 30000 mm/min (500 mm/s), $120 and $121 are 2500 mm/s2. The time estimate (estimate_runtime in apps/rust-core/src/commands/gcode_cmds.rs) still assumes 6000 mm/min rapids, so it overstates travel time about five times. Not changed: it needs a rapid speed on the machine profile (machine.rs, the Machine dialog and the config formats were not in the bundle). Short hops are limited by acceleration, not top speed, so the saving from ordering is small in seconds: about 1 to 6 per cent of a job with 20 to 200 small filled objects, less for cuts. Leaving out shared lines is the real saving (a 5 x 5 grid of touching 40 mm squares has 40 per cent less cutting).
- **Three project settings** (ProjectSettings in packages/common/src/project.rs, all with serde default, mirrored in apps/desktop-ui/src/types/domain.ts as optional booleans): order_fills_by_distance (ON for new projects, OFF when the field is missing, so old projects run exactly as before), cut_part_by_part (off) and cut_shared_lines_once (off). They are three tick boxes at the top of the Layers panel (components/CutPlannerOptions.tsx, lib/cutPlanner.ts).
- **New Rust module** packages/project/src/toolpath/pathopt.rs, declared with mod pathopt in toolpath.rs. order_stops puts pieces of work in order (nearest first, then Or-opt passes that move one to three stops to a better place; at most 300 stops, more keep nearest first; never longer than nearest first). remove_shared_lines goes through the paths in their cutting order and skips any piece an earlier path has cut (either direction), splitting a line where another vertex lies on it so partial overlaps match; ends within 0.01 mm are the same; more than 60000 points are left alone. Because the order is not changed, holes still come before the outlines round them.
- **toolpath.rs.** Fill: scan lines of every object are worked out first, then the objects are put in order, then burned as before (passes, overscan and the outline pass are unchanged). Cut and Score: order_for_job picks order_part_by_part (a part is an outline with everything inside it: deepest first inside a part, parts ordered by the middle of their outline) or the old order_paths; AsDrawn is left alone. A Cut layer with kerf above 0 skips shared-line removal and says so in the job warnings. The job warnings also say how many mm were left out.
- **Checked in the sandbox.** A Python reference of the three algorithms was checked against shapely (independent geometry engine): shared-line removal agreed on 15 hand-made layouts (the one disagreement was my check being exact where the code deliberately treats ends 0.004 mm apart as the same) and 120 random grid-aligned rectangle sets; the ordering delta was checked against full recomputation (3736 moves) and against brute force (it lands about 1 per cent from the best order on 7 stops and is never worse than nearest first); part by part was never longer than the old order on 8 layouts and always cut each hole before its outline. Every number the Rust tests assert was recomputed with that reference.
- **Compiled and tested by Lee on 2026-10-21:** cargo test passed (every new pathopt, toolpath and project test), check-docs was clean and the front end had 47 test files and 923 tests. Lee then ran it in the app: with the shared-lines box ticked the job report said "left out 20.0 mm of cutting that was already done". Not yet tried on a real job.
- Not done: ordering Image (raster) objects; per-layer choices (the three are for the whole project); a travel-saved readout in the pre-flight dialog (the existing Travel figure shows the result; compare with a choice on and off); the estimate fix above; choosing start points (LightBurn's start point editor) and a manual priority per object.
- Front end checked in the sandbox: strict tsc (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noUnusedLocals) on the new files and the changed LayersPanel.tsx, with typed stand-ins for the modules that were not in the bundle; 6 new unit tests in a stand-in runner (4 deliberate breakages, each caught); 20 checks of the real Layers panel in headless Chromium with real React (an old project shows all three off, a new one has fills on, each box saves its own setting with true or false, the other settings are untouched, no sideways overflow at 300 px), with 6 deliberate breakages of the panel each caught. The installer was run on copies of the real files: dry run, real run, second run, CRLF, on main, edited code (it stops), a moved anchor (it stops), drifted docs, a file elsewhere that builds ProjectSettings by hand (it says so), a stray file.
- NOT run: the project's own vitest, ESLint and Prettier, check-docs, cargo, and the real app. Expect 47 front-end test files and 923 tests (46 and 917 before). Rust: 19 new tests in pathopt.rs, 10 in toolpath.rs (50 to 60) and 3 in project.rs (9 to 12), all run and passing on Lee's PC on 2026-10-21 (merged as f569ecf).

### Update 2026-10-22 (time estimate, part 1 of 2: the Rust).
Installed by apply-time-estimate-1.mjs on branch time-estimate. The planner is packages/machine/src/motion.rs (estimate_motion, MotionProfile); the machine profile (packages/common/src/machine.rs) gets three optional settings, rapid_feed_mm_min, acceleration_mm_s2 and junction_deviation_mm, with serde default so older projects and machine files load without them; generate_gcode (apps/rust-core/src/commands/gcode_cmds.rs) uses them and sends two more fields, estimated_travel_seconds and estimate_modelled. A machine without an acceleration is estimated exactly as before. The TTS-55 Pro preset now carries 30000 mm/min and 2500 mm/s2 (what Lee's $$ reported on 2026-10-21), so NEW projects use the new estimate and projects saved earlier keep the old one until the speeds are entered (part 2 adds the boxes). Compiled and tested by Lee on 2026-10-22: cargo test passed (70, 48 and 46 tests) and clippy showed only the old warnings. The full description is in the next block.

### Update 2026-10-22: a closer time estimate.
State first: this is on branch time-estimate (merge to main once CI is green and it has been tried in the app). Path planning (the previous update) was compiled and tested by Lee on 2026-10-21; see its block above.
- **Why.** Lee asked for a better time prediction. The estimate (apps/rust-core/src/commands/gcode_cmds.rs, estimate_runtime in packages/machine/src/simulator.rs) divided every move by its feed rate and assumed rapids of 6000 mm/min, but Lee's machine reports $110 and $111 = 30000 mm/min, $120 and $121 = 2500 mm/s2. It had no acceleration at all.
- **The model** (packages/machine/src/motion.rs, estimate_motion). It follows GRBL 1.1's planner: each move has a top speed (its feed rate, or the rapid speed for G0) and an acceleration, both scaled for a diagonal; where two moves meet the speed is limited by GRBL's junction deviation rule (straight on is free, turning straight back stops the head, a square corner is slow, a 5.6 degree bend is fast); the planner looks ahead over a window of 15 moves (GRBL's planner buffer), planned back from a stop at the end of the window and forward from the speed the head already has; each move is a trapezoid of speed, or a triangle when too short to reach its top speed. The split into laser-off travel and laser-on work is the same as before. With no usable acceleration the answer is exactly the old estimate_runtime at the profile's rapid speed (6000 if unset). The simulator's pacing still uses the old function.
- **What it changes** (the model run on G-code shaped like the generator's, for a machine with $110 30000, $120 2500, $11 0.01): a 30 x 30 mm fill with 0.1 mm lines at 3000 mm/min is unchanged (about 1 per cent longer); the same fill at 12000 mm/min takes 1.4 times as long, and at 18000 mm/min with overscan 1.8 times as long (acceleration, not speed, dominates short lines); cuts and rapids come out SHORTER (a 40 mm circle cut at 3000 mm/min: 6.2 s against 9.9 s, because the old figure spent 6000 mm/min on the rapid back to the origin). 1 mm moves at 300 mm/s are 8 per cent slower with the 15-move window than with unlimited look-ahead.
- **The settings** (machine profile, saved in .mlp files and machine files; all optional): rapid_feed_mm_min, acceleration_mm_s2, junction_deviation_mm. Limits 1 to 1000000, 1 to 1000000 and above 0 to 10. The Machine window has three boxes (0 clears one) and a Read from machine button that sends $$ and takes $110 and $111, $120 and $121 (the smaller of each pair, with a note if they differ) and $11 (components/MachineSettingsDialog.tsx, lib/machineMotion.ts, lib/grblSettings.ts). Loading a preset or a machine file clears the old machine's three values first. The pre-flight dialog shows the time, the laser-off part, and a note saying whether acceleration was used (components/PreflightDialog.tsx, lib/estimateInfo.ts). Machine files check the three fields (lib/configFormat.ts).
- **NOT verified against a real job.** The model was checked against closed-form cases and an independent grid solver in the sandbox (agreement to 0.011 per cent over 25 random paths). Whether it matches the TTS-55 Pro's real time is NOT known: it assumes the controller reaches $110 and $120 as reported (an AVR board can be limited by its step rate), plans like GRBL 1.1, and ignores serial throughput and pauses when the laser mode ($32) is off. FIRST THING TO DO WITH IT: time two or three real jobs (a fast fill, a cut with many short moves, a long rapid) and compare with the pre-flight figure. If it is consistently off, the next step is a calibration (a speed scale, or lower acceleration), not a new model.
- Not done: showing the real elapsed time next to the estimate after a job; per-axis settings (X and Y use one value, the smaller); the Simulator's pacing; the catalogue machines carry no speeds (only the TTS-55 Pro preset does).
- Checked in the assistant's sandbox (Rust cannot be compiled there): a Python reference of the planner agreed with closed-form cases (trapezoid, triangle, collinear, reversal, 90 degree corner, rapid, diagonal) and with an independent grid solver of the speed profile to 0.011 per cent over 25 random paths; every number the new Rust tests assert was recomputed with it. The interface: strict tsc (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noUnusedLocals) on the new files and the changed MachineSettingsDialog.tsx, PreflightDialog.tsx and configFormat.ts, with typed stand-ins for modules that were not in the bundle; 32 unit tests in a stand-in runner (13 deliberate breakages, each caught); 28 checks of the real Machine window and pre-flight dialog in headless Chromium with real React (old machine shows 6000 / 0 / 0.01, typing saves and 0 clears, Read from machine fills the boxes or reports an error, the two-axes note, a preset or file clears the old speeds, the time with and without the laser-off part, both notes), with 8 deliberate breakages of the dialogs each caught. The installers were run on copies of the real files: dry run, real run, second run, CRLF, on main, part 2 before part 1 (it refuses), drifted anchors (they stop, nothing written), a hand-edited machine.rs, another file that builds MachineProfile by hand (it says so), docs and STATUS.md missing or changed.
- Compiled and tested by Lee on 2026-10-22: cargo test passed (the common crate 70, the machine crate 48 and rust-core 46 tests), clippy showed only the six old warnings, check-docs was clean and the front end had 51 test files and 955 tests. Lee pressed Read from machine on the real TTS-55 Pro and it filled the three boxes from $$. Merged to main as 1522a29. NOT yet compared with the time of a real job: that is still the open question.

### Update 2026-10-22 (cut tabs, part 1 of 2: the Rust).
Installed by apply-cut-tabs-1.mjs on branch cut-tabs. Two new layer settings (packages/common/src/layers.rs): tab_width_mm (0 = off) and tab_spacing_mm (default 50), both with serde default, so older projects load without tabs. The tab maker is packages/project/src/toolpath/tabs.rs (add_tabs); generate_toolpath in packages/project/src/toolpath.rs calls it for Cut layers with a width above 0, after kerf and after shared lines are taken out, and says how many tabs it left in the job warnings. There is no way to set the two values in the interface until part 2 (apply-cut-tabs-2.mjs) is installed, so nothing changes yet. Also fixes four clippy warnings (three in the part-by-part and nesting code, one in a test). Not compiled and not run: the assistant cannot compile Rust. Lee runs cargo fmt --all, npm run rust:test and npm run rust:lint. The full description is in the next block once part 2 is installed.

### Update 2026-10-22: cut tabs.
State first: main is at 1522a29 (Lee's git log on 2026-10-22 showed a clean tree and no other branches; path planning f569ecf and the time estimate 1522a29 are both on main). This update is on branch cut-tabs (merge to main once CI is green and it has been tried on a real cut).
- **What.** Small stretches of a cut line are left uncut, so a part stays attached to the sheet until it is broken free by hand. Lee asked for it as the next step after path planning (part by part cutting means a released part could otherwise shift). He did not answer the design questions, so these choices were made: tabs are a width and a spacing, on each Cut layer, off to start with; made after kerf; holes get none. Change them if the first real cut says otherwise.
- **Layer settings** (packages/common/src/layers.rs, mirrored as optional numbers in apps/desktop-ui/src/types/domain.ts): tab_width_mm (0 = off; up to 20) and tab_spacing_mm (5 to 1000, default 50). Both have serde default. Layer::validate checks the ranges, so a bad value stops the job. The Layers panel shows Tab width and Tab spacing on Cut layers only (components/LayersPanel.tsx, lib/cutTabs.ts, which also keeps the typed numbers inside the limits).
- **The tab maker** (packages/project/src/toolpath/tabs.rs, add_tabs). Only closed outlines at an even nesting depth get tabs (a part, or an island in a hole): holes and open lines are left alone, and so is a path with no depth. About one tab for every spacing mm of outline (rounded), at least 2, at most 500, and all the tabs on an outline together are at most a quarter of its length; an outline that cannot hold even one tab of that width is left whole and counted. Tabs are spread evenly along the outline from its start vertex. A tab whose gap (plus half a width either side) would touch a bend of 30 degrees or more is moved along the outline, by steps of a quarter of its width (at least 0.25 mm), to the nearest place that is clear, but never so far that it comes within a width of the next tab; if there is no clear place it stays. Each outline with tabs is replaced, in its place in the cutting order, by one open run per tab (the first run goes from the end of the last tab round the start of the outline to the start of the first tab). What is cut is exactly what was cut, less the tabs.
- **toolpath.rs.** In the Cut arm, after kerf compensation and after shared lines are cut once, and before the passes: if the layer has a width above 0, nesting_depths of the final paths are worked out, add_tabs is called, and the job warnings get "Tabs on 'Cut': 3 tabs left on 1 outline. Break the parts free by hand." (and a line for outlines too small). Passes repeat the runs that are left, so every pass leaves the same tabs. A part that shared-line removal left open is not given tabs. A tab that falls on a shared edge leaves that edge uncut for both parts. The preview needs no change: each tab is a gap and a faint travel hop; it does number every run, so a part with tabs shows several numbers.
- **Checked in the sandbox.** A Python reference of the algorithm was checked against shapely (independent geometry): on 8 shapes (square, circle, star, strip, triangle, L shape) at 4 width and spacing combinations the cut length was the outline less the tabs, the independent gap length equalled tabs x width, every run lay on the outline and there was one run per tab; 300 random polygons agreed; a circle's gaps were 120 degrees apart; a square's gaps stayed at least 1.5 mm from every corner (without the avoidance one sat on a corner). Every number the new Rust tests assert was recomputed with that reference. The interface was checked with strict tsc, unit tests in a stand-in runner and a real browser test of the Layers panel.
- Interface checked in the sandbox: strict tsc (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noUnusedLocals) on cutTabs.ts, its tests and the changed LayersPanel.tsx, with typed stand-ins for the modules that were not in the bundle; 11 unit tests in a stand-in runner (7 deliberate breakages, each caught); and 23 checks of the real Layers panel in headless Chromium with real React (the two boxes are on Cut layers only, under Kerf; an older layer shows 0 and 50 and saves nothing until edited; typing saves the right setting; 0 and negatives mean off; too big, too small and not-a-number values are brought inside the limits; two Cut layers are independent; no sideways overflow at 300 and 340 px), with 6 deliberate breakages of the panel each caught. The installers were run on copies of the real files: dry run, real run, second run, CRLF, on main, part 2 before part 1 (it refuses), drifted anchors (they stop, nothing written), a hand-edited layers.rs, another file that builds a Layer by hand (it says so), docs and STATUS.md missing or changed.
- NOT run: cargo (fmt, test, clippy), the project's own vitest, ESLint and Prettier, check-docs, and the real app. Expect: Rust tests 13 new in tabs.rs, 6 in toolpath.rs (60 to 66) and 3 in layers.rs (10 to 13), so the common crate 73, the project crate 138, the machine crate 48 and rust-core 46; clippy should now show 2 old warnings fewer than the six it showed (the four path-planning ones are fixed, if cargo accepts the edits); front end 52 test files and 966 tests (51 and 955 before).
- Not done: tabs on Score layers; placing or moving single tabs by hand (needs node editing); a Tabs row in the preview that shows them in another colour; a material preset that remembers tab width and spacing; tabs on kerf-compensated shared edges. The project format document was not in the bundle, so check whether it lists the layer fields.

### Update 2026-10-23 (presets remember tabs, threshold and sharpen; node editing decisions; why CI is slow)
State: presets-more was merged to main as 9026b18 (see the next block for what was not seen).
- **Material presets remember more.** A Cut preset remembers tab_width_mm and tab_spacing_mm, an Image preset remembers threshold (0 to 255) and sharpen (0 to 100), in the same way overscan, outline and ramp are remembered: four optional fields on MaterialPreset (packages/common/src/material.rs, `Option`, left out of the file when not set), mirrored in apps/desktop-ui/src/types/domain.ts. Save as preset on a layer stores them, 0 and off included (a layer that never set them stores 0 mm tabs every 50 mm, threshold 128, sharpen off). Applying a preset sets only the ones it has and the layer type uses; a preset without them leaves the layer alone, so every older preset and file behaves as before. "Preset in use" matches on them and shows them, e.g. "(tabs 2 mm every 40 mm)" or "(overscan off, threshold 90, sharpen 35%)". The preset file format (makerlaser.materials, still version 1) carries them with the same range checks as the layer (tab width 0 to 20, spacing 5 to 1000, threshold a whole number 0 to 255, sharpen 0 to 100); older MakerLaser versions ignore them. The logic is lib/selectionInfo.ts (presetExtras, extrasFromLayer, applyPresetToLayer, presetMatchesLayer, describePresetExtras) and lib/configFormat.ts.
- **Not done:** the starter presets and the 31 catalogue presets set none of them (the right tab width depends on the material: set it on a Cut layer and Save as preset); the Material library list still does not edit the extras (hover a preset's type to read them); the preset that "Preset in use" shows is the FIRST that matches, so an older preset with the same speed, power and passes hides a newer one that also matches (this is how overscan, outline and ramp already worked).
- **Node editing: decisions from Lee on 2026-10-23.** The design note is node-editing-design.md (kept by the assistant's chat, not in the repo). (1) "Text should stay as text": text is never turned into plain paths by a node edit, and the same is applied to shapes (recipe kept). To edit the letters or corners the user presses an explicit Convert to outlines (one undo step), after which the object is an ordinary path. This is the assistant's reading of the answer: CONFIRM it with Lee before stage 1. (2) Combine, Offset, Fillet and Trace give straight-sided results with no nodes: accepted for now, Lee will see how he likes it. (3) Stage 3 may change the SVG and DXF importers so curves arrive as nodes: yes, after the editor works. Stage 1 still needs a second bundle (editStore.ts, toolShortcuts.ts, Toolbar.tsx, RightTabs.tsx, lib/rightTabs.ts, CanvasEditor.tsx, ObjectFields.tsx, PropertiesPanel.tsx, App.tsx, drawActions.ts, editActions.ts).
- **Why CI takes about 30 minutes.** From Lee's screenshots of run #65: Rust (ubuntu-24.04) 28m 7s, of which the step "Linux system dependencies (Tauri + serialport)" took 26m 44s; Build 10s, Test 2s, Clippy 2s (rust-cache works). Rust (windows-latest) took 2m 28s and Frontend 48s. This is a known, intermittent problem with the Azure package mirror on ubuntu-24.04 runners (actions/runner-images issues 14823 and 15040: the archives download at about 60 kB/s, and the runner's apt timeout only covers a stall, not a slow transfer). Re-running often takes about a minute. The installer includes an OPTIONAL change to .github/workflows/ci.yml: the package download is tried up to 4 times with a 4 minute limit each (apt resumes what it has), then installed. It was checked for valid YAML and its shell loop was simulated with a fake slow apt, but it has NOT been run on a real GitHub runner. The ci.yml uploaded on 2026-10-22 still had continue-on-error: true on the format check, while docs/roadmap.md and CHANGELOG.md say the format check is enforced: not resolved.
- Checked in the assistant's sandbox (Rust cannot be compiled there): strict tsc (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noUnusedLocals) on selectionInfo.ts, configFormat.ts, cutTabs.ts, LayersPanel.tsx, MaterialsPanel.tsx and all four preset test files, with typed stand-ins for modules that were not in the bundle (the stand-ins reproduce Lee's counts for the unchanged tests: configFormat 52, presetExtras 31, selectionInfo 12); 32 new unit tests in presetExtras2.test.ts and two existing expectations in presetExtras.test.ts updated; 17 deliberate breakages of the new logic, each caught; 22 checks of the real Layers panel in headless Chromium with real React (Save as preset from a Cut, Image and Score layer, applying to another layer, "Preset in use" and "Custom settings" as values change and change back, an older preset leaving the layer alone, a threshold of 0 saved as 0). The installer was run on copies of the real files: dry run, real run, second run, CRLF, on main, cut tabs missing, a changed selectionInfo.ts or configFormat.ts (it stops), a moved Rust anchor (it stops), drifted docs and ci.yml (skipped with a note), no STATUS.md.
- NOT run: cargo (fmt, test, clippy), the project's own vitest, ESLint and Prettier, check-docs, the new ci.yml on GitHub, and the real app. Expect: Rust 8 new tests in material.rs (12 to 20), so the common crate 81 tests (73 before); front end 53 test files and 998 tests (52 and 966 before).

### Update 2026-10-23 (node editing, stage 1a: the model; presets merged)
State first: presets-more (presets remember tabs, threshold and sharpen; the ci.yml apt retry; the format check enforced) was merged to main as 9026b18. Lee merged straight after pushing, so its CI run was NOT seen. Check the latest runs: (a) the Ubuntu step "Linux system dependencies" (it took 26m 44s before; look for "Attempt N" lines) and (b) the Format check step, which now fails the job on unformatted Rust. The preset behaviour itself was only tried as far as starting the app.
- Node editing is built in stages (the design note node-editing-design.md lives in the assistant's chat, not the repo; the decisions are in the previous blocks: text stays as text, Combine/Offset/Fillet/Trace give straight-sided results with no nodes for now, importers keep curves in stage 3). Stage 1a (this update) changes nothing on screen. Nodes are stored NEXT TO the outlines: packages/common/src/nodes.rs has Handle, NodeMode, PathNode and NodePath (JSON names in, out and mode; a plain corner is just x and y), and VectorData has a new optional field nodes (left out of the file when None; schema_version stays 1). Without the Rust field a save would drop the nodes. types/domain.ts mirrors it. Every rule is in lib/nodePath.ts: flatten nodes to outlines with the same algorithm and 0.02 mm tolerance as bezier.rs, nodes from outlines, the stale check, who may be edited (nodeAccess), move, delete, insert a node on a line or exactly on a curve, and finding nodes and segments.
- Rules to keep: paths is ALWAYS the flattened form of nodes (kindWithNodes writes both); every edit makes new values and never edits in place, because undo shares each kind between snapshots; text and shapes are refused until converted (convertToOutlines drops the recipe and keeps the outlines; no button yet); a closed outline left with two nodes becomes an open line and one left with fewer than two is removed; no more than 100,000 nodes per object. Seven places build a vector kind from scratch and none carries nodes over, so Combine, Offset, Fillet, Trace and text/shape edits give straight-sided objects with no nodes: that is the decided behaviour.
- Stage 1b (next, the on-canvas editor): node mode, drawing the nodes, click, Shift or Ctrl-click, box select, drag, arrow nudge, Delete, double-click a line to add a node, X and Y boxes, a Nodes tab and the N key, one undo step per drag, and the Convert to outlines button. It needs files the bundles did not have: lib/useAppEffects.ts and components/ToolsPanel.tsx (Delete, arrows, Esc and the tool keys are handled there), lib/editAccess.ts, components/DimInput.tsx, components/SelectionStats.tsx, state/jobStore.ts and styles/app.css. Ask Lee for them as bundle-nodes3.txt. Then stage 2 (curves, handles, Corner/Smooth/Symmetric, circles as 4 or 8 nodes), stage 3 (SVG and DXF keep curves, Simplify) and stage 4 (join, break, fillet on chosen nodes).
- Not done or unverified: nothing in the interface uses lib/nodePath.ts yet; the 4-or-8-node circle conversion is stage 2; an older MakerLaser opening a file with nodes should ignore them (not tried).
- Checked in the assistant's sandbox, which has NO Rust toolchain: the Rust (nodes.rs, the field in objects.rs, the exports in lib.rs, three tests in objects.rs, one in toolpath.rs, five in nodes.rs) was only read and bracket-matched, never compiled or run. Expect cargo to be the first thing that could object (clippy and rustfmt too: cargo fmt --all first). The front end: strict tsc (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noUnusedLocals) on lib/nodePath.ts and its 58-test file; the tests pass in a stand-in runner; 21 deliberate breakages of the logic were each caught; the flattener was compared with a literal Python port of bezier.rs on 300 random curves (same points, difference 0.0 mm); split curves were compared with the true cubic using shapely (largest distance 0.0013 mm); a 150-run random sequence of edits keeps the rules, never edits its input (frozen objects), and keeps paths equal to the flattened nodes. NOT run: the project's own vitest, ESLint, Prettier, check-docs, CI. Expect: Rust common crate 89 tests (81 before), project crate 139 (138); front end 54 files and 1056 tests (53 and 998).

### Update 2026-10-23 (node editing, stage 1b: the editor on the canvas)
State first: this needs stage 1a (apply-nodes-1a.mjs: the nodes model, nodes.rs, lib/nodePath.ts). Check `git log --oneline -5` for it, and that CI was green on it, before merging this.
- What 1b does. Select ONE outline (imported artwork, a trace, a result of the Shape tools, a converted shape) and press N, or press Edit nodes in Properties, or the Nodes button in the Tools strip (left), or double-click it (a double-click on text or a shape still opens its editor). Its nodes are drawn as small squares over it. Click picks, Shift or Ctrl adds or removes, a box on empty canvas picks the nodes in it, dragging a node moves all picked nodes (one undo step per drag, with a live outline while dragging), the arrow keys nudge 1 mm (Shift 10) and a burst is one undo step, X and Y boxes in Properties place the one picked node (typing is one undo step), double-clicking a line adds a node exactly there, Delete or Backspace deletes picked nodes (it refuses to empty the object), Esc clears the pick and then stops, V and N stop. Text and shapes STAY text and shapes (Lee's decision): in Properties they show Convert to outlines, which drops the recipe, keeps the outline, is one undo step and starts node editing.
- Design differences from the note: there is NO separate Nodes tab (the tab test in tests/rightTabs.test.ts is unchanged); the controls are a Nodes section in Properties (components/NodesPanel.tsx) plus the Nodes tool button. The rules are in lib/nodeEdit.ts (hit-testing, drag math, keys, guards: pure and unit-tested), state in state/nodeEditStore.ts, the project edits in canvas/nodeActions.ts (each edit is one mutate() call, replacing the object's kind and never editing it in place), keys and guards in canvas/useNodeEdit.ts, and the Konva drawing and mouse in canvas/NodeOverlay.tsx.
- How it is wired (so it can be debugged). While editing, NodeOverlay puts a huge transparent Rect over the artwork so the mouse reaches it and not the objects; the Transformer is detached (WorkspaceCanvas: nodeMode); the double-click handler of the canvas wrapper ignores node mode; useShortcuts (lib/useAppEffects.ts) skips Delete, Backspace, Esc and the arrows while nodes are edited (they are handled in useNodeEdit.ts); picking another object, a drawing tool or Measure, locking or deleting the object, or Undo to a state where it is text again, stops node editing; Undo and Redo empty the selection and node editing then picks the object again so it carries on. Mouse positions are turned into world mm with the pan and zoom, and the object's transform is undone before a node changes, so it works on objects that are moved, rotated, stretched or mirrored.
- Not done: curves and handles (stage 2: only straight segments can be edited, so a node has no handles yet), snapping, copy and paste of nodes, selecting a whole outline, joining and breaking (stage 4), the 4-or-8-node circle conversion (stage 2). An object with more than 5,000 nodes shows only the picked ones (the rest can still be picked); more than 100,000 cannot be edited.
- Checked in the assistant's sandbox (no Rust, Konva, zustand or Tauri there): strict tsc on every new file (against loose stand-in types for react and konva, which check the code but NOT the props of the Konva components); lib/nodeEdit.ts with 51 unit tests and 24 deliberate breakages of its rules, all caught; the actions run against the REAL projectStore (undo, redo, coalescing, shared kinds) with 31 tests and 8 breakages, all caught; the Properties section, the key handling and the guards run with real React in headless Chromium (45 checks, 11 breakages of the wiring, all caught). The edited files (WorkspaceCanvas.tsx, editActions.ts, useAppEffects.ts, PropertiesPanel.tsx, ToolsPanel.tsx) were only syntax-checked after the installer ran on copies of the real files, and the installer was run through its scenarios (see the update message).
- NOT run, and the part most likely to need a fix: canvas/NodeOverlay.tsx and the changes to WorkspaceCanvas.tsx (drawing the nodes, the mouse on the canvas, the live outline while dragging, double-click to add a node), and the Nodes button in ToolsPanel.tsx. Konva was not installed in the sandbox, so none of it has run once. Also not run: the project's own vitest, ESLint, Prettier, check-docs, CI, and the real app. Expect: front end 56 files and 1138 tests (54 and 1056 after 1a); Rust unchanged (89 common, 139 project).

### Update 2026-10-28 (node editing, stage 2: curves)
State first: stages 1a (88983ab) and 1b (ea36f07) are on main and CI was green on both (runs #71 and #72). Lee tried 1b in the app on 2026-10-28 and reported that the node editing works well, so the canvas parts built blind in 1b (the squares, picking, dragging, double-click to add) are now confirmed. This update is on branch nodes-2 and changes NO Rust.
- What stage 2 adds. A picked node shows its handles (a line from the node to a diamond on the tip of each handle): drag a tip to bend the curve. The Nodes section of Properties gets Corner, Smooth and Symmetric for the picked nodes, and Curve and Straight for the lines between them. Corner: the two handles are free. Smooth: the handles lie on one line pointing opposite ways, each keeping its length (dragging one swings the other round). Symmetric: the same and equal lengths (dragging one mirrors the other). Smooth and Symmetric make handles where there are none, a third of the way to each neighbour along the line between the neighbours. Curve gives a straight line handles a third of the way along it at both ends, ON the line, so the shape does not change until a handle is pulled; Straight takes them away. Which lines Curve and Straight act on: every line with both ends picked, or, with exactly one node picked, the lines either side of it. Convert to outlines now turns a circle or ellipse into 4 smooth curve nodes (8 when the larger radius is over 36 mm) and a rounded rectangle into 8 (fewer when a side is as long as the corner radius); the outline of the converted shape is those curves flattened, within about 0.015 mm of the true ellipse (0.03 mm of the old polygon outline for rounded corners). Polygons, stars, sharp rectangles and text still get one corner node per point and keep their outline exactly.
- Where it is. lib/shapeNodes.ts (shapes to nodes), lib/nodeCurves.ts (modes, moveHandle, segmentsOfPick, makeCurves, makeStraight: all pure and unit-tested), lib/nodeEdit.ts (a new gesture kind 'handle', handleTips, handleAt, pressOnCanvas which tries handles of picked nodes before nodes, moveHandleWorld, releaseAt now also returns handle), lib/nodePath.ts (convertToOutlines uses shapeNodes), canvas/nodeActions.ts (setPickedMode, curvePicked, straightenPicked, moveHandleByDrag: each is ONE undo step through commitNodes), canvas/NodeOverlay.tsx (draws handles and handle tips for the picked nodes, uses pressOnCanvas, commits a handle drag on mouse up), components/NodesPanel.tsx (the buttons). The rule that paths is always the flattened form of nodes still holds (kindWithNodes writes both).
- Decisions and limits. Shift-click on a line to curve it (mentioned in the design note) was NOT built: Shift already adds to the pick, so Curve and Straight are buttons. Handles are drawn only for the picked nodes (at most 300 of them). A handle can be grabbed only while its node is picked, and Shift or Ctrl never grabs a handle. Deleting a node leaves its neighbours' handles as they are (the new line may be a curve). Inserting a node on a curve (double-click) splits it exactly and the new node is smooth. Offset, Combine, Fillet and Trace still give straight-sided results with no nodes (accepted by Lee). No Alt-drag to break symmetry: use Corner.
- Not done: SVG and DXF importers keeping their curves, Simplify, join and break, fillet on chosen nodes (stages 3 and 4); dragging the middle of a line to bend it; snapping; copy and paste of nodes.
- Checked in the assistant's sandbox (no Konva, zustand, Tauri or Rust there): strict tsc on every new and changed file (against loose stand-in types for react and konva, which check the code but NOT the props of the Konva components); the new pure logic with 90 new unit tests, and the three existing node test files (58, 51 and 31) still pass unchanged; 32 deliberate breakages of the new logic, each caught (one gap was found and closed: a node marked as a corner must be saved without a mode); the circle and rounded-rectangle conversions compared with true ellipses and with the old outlines using shapely (worst distance 0.0148 mm from a true ellipse; rounded corners within 0.03 mm of the old outline; 4-node circle error 0.027 % of the radius, 8-node 0.0004 %); the actions run against the REAL projectStore (undo, redo, objects' kinds replaced and never edited); the Properties section run with real React in headless Chromium (28 checks, 7 deliberate breakages of the panel, all caught). The installer was run on copies of the real files through its scenarios (see the update message).
- NOT run, and the part most likely to need a fix: canvas/NodeOverlay.tsx (drawing the handle lines and diamonds, grabbing a handle with the mouse, the live curve while dragging a handle). Konva was not installed in the sandbox, so the overlay changes have never run once. The pure rules behind them (which handle is under the pointer, what a drag does, what is committed on mouse up) are unit-tested. Also not run: the project's own vitest, ESLint, Prettier, check-docs, CI and the real app. Expect: front end 60 test files and 1228 tests (56 and 1138 after 1b); Rust unchanged.
