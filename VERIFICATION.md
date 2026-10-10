# What has and has not been verified

Last updated: 10 October 2026.

MakerLaser is checked at two levels, and they are kept apart on purpose:

* **The merge bar (automated).** A change is merged when it compiles, passes every test and lint,
  runs in the app, and the CI run is green.
* **The laser bar (a real machine).** A change that alters what the laser does is only called
  verified once it has been run on the machine, on scrap, and the result is written in the table
  below.

Passing the first bar says nothing about the second. Where this file says "not yet", it means the
feature builds and its tests pass, but nobody has reported running it on a laser.

Code is often drafted in an environment that has no Rust toolchain, so the first real compile of a
change happens on the developer's PC and in CI. Treat "`cargo test` passes on the developer's PC
and CI is green" as the bar for merging, and nothing weaker.

## Automated checks

| Check | Where it runs | What it covers |
|---|---|---|
| Rust format check (`cargo fmt --check`) | CI (Ubuntu), `npm run verify` | Formatting of all Rust. Enforced: a badly formatted push fails CI. |
| `cargo test --workspace` | `npm run verify`, and on the developer's PC before every merge | Geometry and importers, CAM planning, toolpaths, G-code, safety checks, the GRBL protocol against a fake controller, `.mlp` files, Start From and framing programs, the console command checks. |
| `cargo clippy` | `npm run verify` | Lints. Warnings do not fail the build yet. |
| `tsc --noEmit`, ESLint (no warnings allowed), Vitest, `vite build` | CI (Frontend job), `npm run verify` | The front end. |
| Rust build | CI on Ubuntu 24.04 and Windows, every push to any branch | That the whole workspace compiles on both. See `.github/workflows/ci.yml` for exactly what each job runs. |
| `node --test scripts/check-docs.test.mjs` | Run by hand | The tests of the documentation checker. |
| `node scripts/check-docs.mjs` | Run by hand | That the documentation still matches the code: links, file names, the command table, version numbers (see CONTRIBUTING.md). |

`npm run verify` runs the first four rows in one go and writes `verification.log`.

**Counts.** On 10 October 2026, after the canvas editing package, the developer's PC reported 271
Rust tests and 517 front-end tests, all passing, with lint and the type-check clean. Every package
since then has added tests, so run `npm run verify` for the current numbers instead of trusting a
figure written here.

**What the front-end tests cover.** The logic is kept in plain TypeScript files under
`apps/desktop-ui/src/lib` and `state`, which have no React, Konva or Tauri imports, so Vitest runs
them directly: the matrix maths, selection and bounds, undo and redo, the Measure tool, shapes and
text geometry, edit logic, fonts, shortcuts, the toolpath preview options, config files, and so on.
**Not covered by automated tests:** the React components, how the Konva canvas reacts to the mouse
(drawing, dragging, double-click), the Tauri bridge and real serial ports. Those are checked by
running the app by hand.

## Checked on a real machine

Machine: Two Trees TTS-55 Pro, GRBL 1.1, laser mode on (`$32=1`), homing and soft limits off
(`$22=0`, `$20=0`). Results are as reported by the project owner.

| What | Result | When |
|---|---|---|
| Connect over USB, read the settings with `$$` in the console box, laser-mode note shown | Worked | 10 Oct 2026 |
| Engraving a real SVG and a real JPEG | Worked | Early Oct 2026 |
| Frame with the laser on at low power (1 %) | Reported as working well | 10 Oct 2026 |

## Not yet checked on a laser

These build and pass their tests. Each has a short test routine in its own document. When you run
one, add a row to the table above with the date and what you saw.

| Feature | Test routine | Notes |
|---|---|---|
| Overscan | `docs/overscan.md`, "Testing it" | Needs the laser's focus set first, since edge quality depends on it. |
| Start From (Current position, User origin) and Job Origin | `docs/start-from.md`, "First run on a real laser" | Try Frame before anything powered. |
| Fill outline pass | `docs/fill-and-ramp.md`, "Trying them on the laser" | |
| Ramped power on score lines | `docs/fill-and-ramp.md`, "Trying them on the laser" | Needs `$32=1`. May show little difference with `M4`; see that document. |
| What Pause does with the beam | `SAFETY.md`, last item of the checklist | If Pause leaves the beam on, do not rely on it: use STOP. |
| Material presets | | The starter presets are conservative starting points, not tuned values. |

## Other things not verified

* **Running the app on a Linux or macOS desktop.** The Rust code builds on Ubuntu 24.04 in CI, but
  nobody has run the whole app on a Linux desktop, or at all on macOS. See `docs/linux.md`.
* **The installers** (`.msi`, `.exe`, `.deb`, `.rpm`, `.AppImage`) have been built but not tested on
  a clean machine, and they are not signed.
* **Performance** with very large SVGs, DXFs or photos. The importers and the planner have limits
  against runaway files, but the limits themselves have not been tested against huge real ones.
* **The licences of the built-in fonts.** `node scripts/font-licenses.mjs` lists the licence each
  font package declares; check its output before a public release (THIRD_PARTY_NOTICES.md).
* **Network connections** (WebSocket and Telnet, for example FluidNC): the setting is stored and
  validated, but only USB serial connects. See `docs/connection.md`.

## How a change is checked before it is merged

1. Work on a branch off `main`.
2. Format and test: `cargo fmt --all`, `cargo test --workspace`, then `npm run lint`, `npm run
   typecheck` and `npm test` in `apps/desktop-ui`.
3. Run the app from the repo root (`npm run dev`, which starts the desktop window; running it from
   `apps/desktop-ui` starts only the web page) and try the change.
4. Push, and wait for CI to go green.
5. If the change alters what the laser does, run its test routine on scrap and record the result in
   the table above.
6. Merge to `main` and delete the branch (see CONTRIBUTING.md).
