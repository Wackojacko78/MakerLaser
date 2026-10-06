# MakerLaser on Linux

**Status: should build and run, but not yet verified on a real Linux desktop.** The code is
cross-platform (Tauri 2, Rust and a web front end), nothing in it is Windows-only, and the
helper scripts below were tested on Linux. But nobody has yet built the whole app and run it on
a Linux desktop with a laser attached, so treat the first run as a test and report what you find.

## 1. Install the prerequisites

Tauri uses the system's WebKitGTK web view. **Tauri 2 needs the 4.1 series** (`webkit2gtk-4.1`),
not 4.0. Check what is missing without changing anything:

```bash
bash build-linux.sh --check
```

It prints the install command for your distribution. For reference, from
<https://v2.tauri.app/start/prerequisites/> plus `libudev` (used to list serial ports):

| Distribution | Command |
|---|---|
| Debian, Ubuntu | `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file pkg-config libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libudev-dev` |
| Fedora | `sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file pkgconf-pkg-config libappindicator-gtk3-devel librsvg2-devel libxdo-devel systemd-devel` then `sudo dnf group install "c-development"` |
| Arch | `sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool` |
| openSUSE | `sudo zypper in webkit2gtk3-devel libopenssl-devel curl wget file libappindicator3-1 librsvg-devel libudev-devel` then `sudo zypper in -t pattern devel_basis` |
| Alpine | `sudo apk add build-base webkit2gtk-4.1-dev curl wget file openssl libayatana-appindicator-dev librsvg eudev-dev font-dejavu` |

You also need **Node.js 20.19 or newer** (or 22.12+) and **Rust 1.85 or newer** (install with
[rustup](https://rustup.rs), then open a new terminal).

On a very minimal system, install at least one font package (for example `fonts-dejavu-core` or
`fonts-liberation`), or text will not draw.

## 2. Build

```bash
bash build-linux.sh                  # check, install JavaScript packages, build everything
bash build-linux.sh --verify         # run the whole test suite first
bash build-linux.sh --bundles deb    # only the .deb (or: rpm, appimage)
```

The script never uses `sudo` and never installs anything itself. Results:

| File | Where |
|---|---|
| `.deb` | `target/release/bundle/deb/` |
| `.rpm` | `target/release/bundle/rpm/` |
| `.AppImage` | `target/release/bundle/appimage/` |
| plain executable | `target/release/makerlaser-rust-core` |

To run it from source while developing: `npm run dev`.

**Which distribution to build on.** Packages built on a newer system can need a newer system
library (glibc) than an older machine has, and then fail with `GLIBC_2.xx not found`. If you
want the package to run on several distributions, build it on the oldest one you support
(Ubuntu 22.04 and Debian 12 both have WebKitGTK 4.1) or in a container.

## 3. Serial port (your laser)

On Linux the laser appears as `/dev/ttyUSB0` or `/dev/ttyACM0`. Three things commonly stop an
app from opening it. Plug the laser in and run this read-only check:

```bash
bash scripts/linux-serial-check.sh
```

It tells you which of these applies and the exact command to fix it. It changes nothing.

1. **Permission.** The device belongs to a group, usually `dialout` (on Arch and some others
   `uucp`). Add yourself, then **log out and back in**:
   `sudo usermod -aG dialout $USER`
2. **brltty.** The Braille display service that Ubuntu installs can claim common USB serial
   chips (CH340, CP210x, FTDI): the port appears and then vanishes. Check with `dmesg | grep -i brltty`.
   If you do not use a Braille display, remove it (`sudo apt remove brltty`) or mask it
   (`sudo systemctl mask brltty brltty-udev`), then unplug and replug the laser.
   (Arduino's help page describes this problem; the same applies to GRBL laser boards.)
3. **Another program has the port.** Close LaserGRBL, LightBurn, serial monitors and a second
   MakerLaser. ModemManager can also probe serial ports; if connecting is unreliable,
   `sudo systemctl stop ModemManager` while you work.

If the computer does not list the laser at all, run `lsusb`. If it is not there, try another
cable (many cables only charge) or another USB port.

## 4. If the window is blank or white

WebKitGTK sometimes disagrees with the graphics driver, most often with NVIDIA GPUs, and the
window opens blank, flickers or crashes when resized. This is a known issue with Tauri apps, and
the Tauri documentation lists these workarounds. Try them in order from a terminal:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./makerlaser-rust-core
__NV_DISABLE_EXPLICIT_SYNC=1 ./makerlaser-rust-core        # Wayland "Error 71" crashes
WEBKIT_DISABLE_COMPOSITING_MODE=1 ./makerlaser-rust-core    # last resort: slower
```

If one works, set it permanently in the launcher or your shell profile. MakerLaser does not set
these itself, because they slow down people whose graphics work fine. Tell me which one you
needed and I can add a Linux-only default.

## 5. Differences from Windows

- **Fonts.** Arial, Calibri and Segoe UI are Windows fonts. The Text tool now lists only the
  fonts installed on the computer it runs on, and starts with a sensible default. On Linux,
  names like Arial are mapped to metric-compatible Liberation fonts by the system, so they draw.
  A font name you type that is not installed gets a warning.
- **Saved machine presets** live in the app's own storage, which belongs to one build of the
  app. Use **Export** and **Import** in the Machine window to move one between computers.
- **File dialogs** are the desktop's own (GTK). Drag and drop from the file manager is
  supported.
- **Everything else** (importing SVG, DXF and images, generating G-code, running jobs, the
  simulator) uses the same code as Windows.

## 6. What has and has not been tested

| Tested | How |
|---|---|
| `build-linux.sh`: every check, the version comparisons, the build sequence, failure handling | run on Linux with stand-in tools |
| `scripts/linux-serial-check.sh`: all branches | run on Linux with stand-in devices |
| Font detection | unit tests, plus the real detection run in Chromium on a Linux machine |
| **Not yet tested** | a full `cargo` build and run on Linux, WebKitGTK rendering, serial communication with a real laser on Linux, the `.deb` / `.rpm` / `.AppImage` installers |

Please report what happens on your machine, including the output of `bash build-linux.sh --check`.
