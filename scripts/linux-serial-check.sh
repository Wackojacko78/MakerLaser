#!/usr/bin/env bash
# Checks whether MakerLaser will be able to open your laser's USB serial port on this Linux
# machine, and says what to change if not. READ-ONLY: it never changes anything and never
# uses sudo. Run it with the laser plugged in:   bash scripts/linux-serial-check.sh
#
# (Set MAKERLASER_SERIAL_GLOB to check other device paths, for example when testing.)
set -u
shopt -s nullglob

USER_NAME=$(id -un)
GROUPS_NOW=" $(id -nG) "
PROBLEMS=0
say_ok()   { printf '  [ok]       %s\n' "$1"; }
say_bad()  { printf '  [PROBLEM]  %s\n' "$1"; PROBLEMS=$((PROBLEMS + 1)); }
say_note() { printf '  [note]     %s\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

echo "MakerLaser serial port check (read-only)"
echo

# shellcheck disable=SC2206
GLOBS=${MAKERLASER_SERIAL_GLOB:-"/dev/ttyUSB* /dev/ttyACM*"}
# shellcheck disable=SC2206
DEVICES=( $GLOBS )

echo "Devices"
if [ "${#DEVICES[@]}" -eq 0 ]; then
  say_bad "No serial device found (looked for $GLOBS). Plug the laser in with a data cable (some cables only charge), then run this again."
  echo
  echo "     If it never appears: run 'lsusb' to see whether the computer sees the USB device at all."
  echo "     If lsusb lists it but no /dev/ttyUSB0 appears, the usual cause is the brltty package (see below)."
fi

for dev in "${DEVICES[@]}"; do
  grp=$(stat -c %G "$dev" 2>/dev/null || echo "?")
  echo "  $dev   (group: $grp)"
  if [ -r "$dev" ] && [ -w "$dev" ]; then
    say_ok "$USER_NAME can read and write $dev"
  else
    if [[ "$GROUPS_NOW" == *" $grp "* ]]; then
      say_bad "$dev is not readable and writable by you even though you are in group '$grp'. Check its permissions with: ls -l $dev"
    elif getent group "$grp" 2>/dev/null | cut -d: -f4 | tr ',' '\n' | grep -qx "$USER_NAME"; then
      say_bad "You are in group '$grp' but this login session does not have it yet. Log out and back in (or reboot), then run this again."
    else
      say_bad "You are not in the '$grp' group, which owns $dev. Run:   sudo usermod -aG $grp $USER_NAME   then log out and back in."
    fi
  fi
  if have fuser; then
    pids=$(fuser "$dev" 2>/dev/null | tr -s ' ' | sed 's/^ //')
    if [ -n "$pids" ]; then say_bad "$dev is already open in another program (process $pids). Close LaserGRBL, LightBurn, a serial monitor or another MakerLaser."; fi
  fi
done

echo
echo "Programs that can interfere"
if pgrep -x brltty >/dev/null 2>&1; then
  say_bad "brltty (Braille display support) is running. It can claim common USB serial chips (CH340, CP210x, FTDI) so the port appears and then vanishes. If you do not use a Braille display, remove the brltty package (Debian and Ubuntu: sudo apt remove brltty) or mask its services (sudo systemctl mask brltty brltty-udev), then unplug and replug the laser."
elif have brltty; then
  say_note "brltty is installed but not running right now. If the port vanishes after you plug the laser in, remove or mask it (see the Linux guide)."
else
  say_ok "brltty is not installed"
fi
if have systemctl && systemctl is-active --quiet ModemManager 2>/dev/null; then
  say_note "ModemManager is running. It probes serial ports and can briefly hold one. If connecting is unreliable, stop it while you work:   sudo systemctl stop ModemManager"
else
  say_ok "ModemManager is not running"
fi

echo
if [ "$PROBLEMS" -eq 0 ]; then
  echo "No problems found. In MakerLaser, press the refresh button next to the port list, choose the port, and connect."
else
  echo "$PROBLEMS problem(s) found. Fix them, then run this check again."
fi
exit 0
