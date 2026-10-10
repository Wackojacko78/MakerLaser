# Installing and building MakerLaser

These steps assume **Windows 10/11**. macOS and Linux notes are at the end.

## 1. Prerequisites (one time)

Open **PowerShell** and run:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Then **close PowerShell and open a new window** (so the new tools are on `PATH`) and run:

```powershell
rustup default stable
rustup update stable
node --version      # must be 20 or newer
rustc --version     # must be 1.85 or newer
```

Notes:

* The **"Desktop development with C++"** workload is required by Rust (linker) and by
  the Clipper2 geometry library, which compiles C++ code.
* **WebView2** is already part of Windows 11 and current Windows 10. If the app opens to a
  blank window, install it from <https://developer.microsoft.com/microsoft-edge/webview2/>.
* If the Clipper2 build reports that **CMake** is missing, run `winget install Kitware.CMake`
  and open a new terminal.

## 2. Get the code

**From GitHub** (best: it keeps the history and lets you pull updates):

```powershell
cd C:\Dev
git clone https://github.com/Wackojacko78/MakerLaser.git
cd MakerLaser
```

**From a zip:** extract it into a **short path without spaces**, for example `C:\Dev`, so that this
file exists: `C:\Dev\MakerLaser\Cargo.toml`. (If Windows creates an extra outer folder, move the
inner `MakerLaser` folder up so there is no nesting.) Then:

```powershell
cd C:\Dev\MakerLaser
git init -b main
git add -A
git commit -m "Initial import of MakerLaser"
```

To update later: `git switch main`, `git pull`, then `npm install`, because new dependencies (the
built-in fonts, for example) arrive with the code.

## 3. Verify (recommended before anything else)

```powershell
npm install
.\verify-makerlaser.ps1
```

This runs, in order: JavaScript install, `cargo fmt`, `cargo check`, `cargo test`,
`cargo clippy`, TypeScript type-check, frontend tests, lint, and a production build. The
**first run takes several minutes** because every Rust dependency is compiled.

It runs *every* step even if one fails, prints a summary, and writes `verification.log`.
If anything fails, see "If something fails" below.

When everything passes, commit the lockfiles it created:

```powershell
git add Cargo.lock package-lock.json
git commit -am "Add lockfiles and formatted sources"
```

## 4. Run the app

```powershell
npm run dev
```

The first launch compiles the app (a few minutes). A window titled **MakerLaser** opens.
Use the **Simulator** checkbox in the lower-left panel to try everything without hardware.

Smoke test to run once, in this order:

1. Tick **Simulator**, click **Connect**.
2. Drag `tests\fixtures\nested.svg` onto the window. It appears on the **Score** layer.
3. Select it, change its layer to **Cut** in the right-hand panel, drag it, rotate it.
4. Press **R**, drag a rectangle on the empty canvas, type a width, press **Tab**, type a height,
   press **Enter**. Press **T**, click, type your name, then double-click it and pick another font
   from the list.
5. **Generate & Preview**. Red cut lines appear; the inner circle is numbered **1**.
6. **Frame**, then **Start...**, confirm, watch the progress bar.
7. **Save** as `test.mlp`, close the app, reopen, **Open** `test.mlp`. The rectangle and the text
   should still open for editing when you double-click them.

## 5. Build installers

```powershell
.\build-windows.ps1
```

This checks the prerequisites, installs dependencies, verifies, then builds. The installers are
written to:

```text
target\release\bundle\msi\MakerLaser_0.1.0_x64_en-US.msi
target\release\bundle\nsis\MakerLaser_0.1.0_x64-setup.exe
```

To tag a release through GitHub Actions instead: `git tag v0.1.0 && git push origin v0.1.0`.

## If something fails

| Symptom | Cause and fix |
|---|---|
| `link.exe not found` or `linker 'link.exe' failed` | The C++ build tools are missing. Re-run the Build Tools command in step 1, then open a new terminal. |
| `failed to run custom build command for clipper2c-sys` | C++ toolchain or CMake missing; see the notes in step 1. |
| `edition2024 is required` or `requires rustc 1.85` | Run `rustup update stable`. |
| `error[E0432]: unresolved import clipper2::...` or another `clipper2` error | The `clipper2` crate changed its API. All use is isolated in `packages/geometry/src/clip.rs`; adjust that one file (see `VERIFICATION.md`). |
| Tauri says it cannot find `tauri.conf.json` | Run the command from `apps/rust-core`: `cd apps\rust-core; npx tauri dev`. |
| `Port 5173 is already in use` | Another dev server is running; close it. The port is fixed in `vite.config.ts` and `tauri.conf.json`. |
| `failed to read plugin permissions` | Delete `apps\rust-core\gen` and rebuild. |
| Blank white window | Install WebView2 (step 1) and check the terminal for a Vite error. |
| `cargo clippy` prints warnings | They do not fail the build. Fix them over time; see `CONTRIBUTING.md`. |
| `cargo fmt --check` fails in CI | Run `cargo fmt --all` locally and commit. |
| Cannot open the serial port | Close any other program using it (LaserGRBL, LightBurn, a serial monitor). Install the USB driver your board needs (often CH340/CP210x). |
| `npm run dev` opens only a web page, or the machine buttons do nothing | It was run from `apps\desktop-ui`, which starts only the user interface. Run it from the repo root (`C:\Dev\MakerLaser`): that starts the desktop app with the Rust side. |
| The built-in fonts are missing, or the `bundledFontsInstalled` tests fail | The font packages are not installed. Run `npm install` from the repo root. |
| The app looks like an old version | You are on a branch without the newer work, or an old window is still open. Run `git branch --show-current`, close every MakerLaser window, and run `npm run dev` again from the repo root. |
| Git opens Vim, or output stops at `(END)` | See "Git on Windows" in `CONTRIBUTING.md`. |
| GitHub says "Invalid workflow file" | A mistake in `.github/workflows/ci.yml`; GitHub names the line. Every step needs a `- name:` or `- uses:` line above its `run:`. |

If a compiler error appears that is not covered here, send the first error in
`verification.log`; it is almost always a small, local fix.

## macOS and Linux

* **macOS:** install Xcode command line tools (`xcode-select --install`), Node 20+ and Rust via
  rustup. Then the same `npm install`, `node scripts/verify.mjs`, `npm run dev`, `npm run build`.
* **Linux (Debian/Ubuntu):**
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
       librsvg2-dev libudev-dev pkg-config build-essential
  sudo usermod -aG dialout $USER     # serial port access; log out and in afterwards
  ```
  Then the same npm/node commands.
