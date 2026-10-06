#!/usr/bin/env bash
# Builds MakerLaser on Linux: checks the prerequisites, installs the JavaScript packages and
# builds the app and its installers (.deb, .rpm, .AppImage).
#
#   bash build-linux.sh                 check, then build
#   bash build-linux.sh --check         only check; change nothing
#   bash build-linux.sh --verify        also run the full test suite before building
#   bash build-linux.sh --bundles deb   only build the .deb (other values: rpm, appimage)
#
# This script never installs anything itself and never uses sudo. When something is missing it
# prints the command for your distribution, and you run it.
set -u
cd "$(dirname "$0")" || exit 1

MODE=build
VERIFY=0
BUNDLES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE=check ;;
    --verify) VERIFY=1 ;;
    --bundles)
      shift
      if [ $# -eq 0 ] || [ -z "$1" ]; then echo "--bundles needs a value, for example: --bundles deb"; exit 2; fi
      BUNDLES="$1"
      ;;
    -h|--help) awk 'NR > 1 { if (/^#/) print substr($0, 3); else exit }' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 2 ;;
  esac
  shift
done

MISSING=0
ok()   { printf '  [ok]       %s\n' "$1"; }
miss() { printf '  [MISSING]  %s\n' "$1"; MISSING=$((MISSING + 1)); }
warn() { printf '  [warning]  %s\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---- which family of distribution is this? ---------------------------------------------
distro_family() {
  local words
  words=$( ( . /etc/os-release 2>/dev/null; echo "${ID:-} ${ID_LIKE:-}" ) )
  case " $words " in
    *" debian "*|*" ubuntu "*) echo debian ;;
    *" fedora "*|*" rhel "*|*" centos "*) echo fedora ;;
    *" arch "*) echo arch ;;
    *" suse "*|*" opensuse "*|*" opensuse-leap "*|*" opensuse-tumbleweed "*) echo suse ;;
    *" alpine "*) echo alpine ;;
    *) echo unknown ;;
  esac
}

print_install_hint() {
  echo
  echo "Install the missing system packages with the command for your distribution"
  echo "(from https://v2.tauri.app/start/prerequisites/, plus libudev for the serial port):"
  echo
  case "$(distro_family)" in
    debian)
      echo "  sudo apt update"
      echo "  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file pkg-config \\"
      echo "       libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libudev-dev"
      ;;
    fedora)
      echo "  sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file pkgconf-pkg-config \\"
      echo "       libappindicator-gtk3-devel librsvg2-devel libxdo-devel systemd-devel"
      echo "  sudo dnf group install \"c-development\""
      ;;
    arch)
      echo "  sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl \\"
      echo "       appmenu-gtk-module libappindicator-gtk3 librsvg xdotool"
      echo "  (libudev and pkgconf come with base-devel and systemd on Arch)"
      ;;
    suse)
      echo "  sudo zypper in webkit2gtk3-devel libopenssl-devel curl wget file libappindicator3-1 \\"
      echo "       librsvg-devel libudev-devel"
      echo "  sudo zypper in -t pattern devel_basis"
      ;;
    alpine)
      echo "  sudo apk add build-base webkit2gtk-4.1-dev curl wget file openssl \\"
      echo "       libayatana-appindicator-dev librsvg eudev-dev font-dejavu"
      ;;
    *)
      echo "  Your distribution was not recognised. See the list at the address above."
      echo "  You need: a C compiler, pkg-config, WebKitGTK 4.1 and GTK 3 development files,"
      echo "  and libudev development files."
      ;;
  esac
  echo
}

echo "MakerLaser Linux build check"
echo

# ---- JavaScript side -------------------------------------------------------------------
echo "Node.js"
if have node; then
  NODE_V=$(node -p "process.versions.node" 2>/dev/null || echo "0.0.0")
  NODE_MAJOR=${NODE_V%%.*}
  NODE_REST=${NODE_V#*.}
  NODE_MINOR=${NODE_REST%%.*}
  # Vite 7 needs Node 20.19 or newer (or 22.12 or newer).
  if [ "$NODE_MAJOR" -gt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -ge 12 ]; } || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -ge 19 ]; }; then
    ok "node $NODE_V"
  else
    miss "node $NODE_V is too old: Node 20.19 or newer (or 22.12 or newer) is required"
  fi
else
  miss "node: install Node.js 20.19 or newer (https://nodejs.org/ or your distribution's nodejs package)"
fi
if have npm; then ok "npm $(npm --version 2>/dev/null)"; else miss "npm (it comes with Node.js)"; fi

# ---- Rust side -------------------------------------------------------------------------
echo "Rust"
if have cargo && have rustc; then
  RUST_V=$(rustc --version | sed -n 's/^rustc \([0-9]*\.[0-9]*\).*/\1/p')
  RUST_MAJOR=${RUST_V%%.*}
  RUST_MINOR=${RUST_V#*.}
  if [ "${RUST_MAJOR:-0}" -gt 1 ] || { [ "${RUST_MAJOR:-0}" -eq 1 ] && [ "${RUST_MINOR:-0}" -ge 85 ]; }; then
    ok "rustc $(rustc --version | cut -d' ' -f2) (1.85 or newer is required)"
  else
    miss "rustc $RUST_V is too old: run 'rustup update stable' (1.85 or newer is required)"
  fi
else
  miss "cargo / rustc: install Rust with rustup: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   (then open a new terminal)"
fi

# ---- system libraries ------------------------------------------------------------------
echo "System libraries"
if have cc || have gcc; then ok "C compiler"; else miss "C compiler (gcc)"; fi
if have pkg-config; then
  ok "pkg-config"
  for lib in webkit2gtk-4.1 gtk+-3.0 libudev; do
    case "$lib" in
      webkit2gtk-4.1) what="WebKitGTK 4.1 development files (Tauri 2 needs the 4.1 series, not 4.0)" ;;
      gtk+-3.0)       what="GTK 3 development files" ;;
      libudev)        what="libudev development files (used to list serial ports)" ;;
    esac
    if pkg-config --exists "$lib" 2>/dev/null; then ok "$lib $(pkg-config --modversion "$lib" 2>/dev/null)"; else miss "$what  [pkg-config name: $lib]"; fi
  done
else
  miss "pkg-config"
fi

# ---- fonts (advice only) ---------------------------------------------------------------
if have fc-list; then
  FONTS=$(fc-list 2>/dev/null | wc -l | tr -d ' ')
  if [ "${FONTS:-0}" -eq 0 ]; then warn "no fonts are installed: text will not draw. Install one, for example fonts-dejavu-core or fonts-liberation."; fi
fi

echo
if [ "$MISSING" -gt 0 ]; then
  echo "$MISSING item(s) missing."
  print_install_hint
  exit 1
fi
echo "Everything needed is installed."
if [ "$MODE" = check ]; then exit 0; fi
echo

# ---- build -----------------------------------------------------------------------------
run() { echo ">>> $*"; "$@" || { echo; echo "FAILED: $*"; exit 1; }; }

run npm install
if [ "$VERIFY" -eq 1 ]; then run node scripts/verify.mjs; fi
if [ -n "$BUNDLES" ]; then run npm run build -- --bundles "$BUNDLES"; else run npm run build; fi

echo
echo "Done. Packages:"
found=0
for f in target/release/bundle/deb/*.deb target/release/bundle/rpm/*.rpm target/release/bundle/appimage/*.AppImage; do
  if [ -e "$f" ]; then ls -lh "$f" | awk '{print "  " $9 "  (" $5 ")"}'; found=1; fi
done
if [ "$found" -eq 0 ]; then echo "  none found under target/release/bundle: see the build output above."; fi
echo "The plain executable is target/release/makerlaser-rust-core"
echo
echo "Before connecting a laser, run: bash scripts/linux-serial-check.sh"
