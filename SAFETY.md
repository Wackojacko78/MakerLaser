# Safety

A laser can start fires, injure eyes and skin, and release harmful fumes. **MakerLaser's
checks reduce risk; they do not replace your own supervision, your machine's own protections
or common sense.** The software has been used by its author on one machine (a Two Trees
TTS-55 Pro). [`VERIFICATION.md`](VERIFICATION.md) lists what has and has not been tried on a laser.
Treat anything marked "not yet" there as untested.

## What the software enforces

* No motion unless a machine or the simulator has been explicitly **connected**.
* **Start** only runs the G-code you previewed. Any edit after *Generate & Preview*
  disables Start until you generate again (the backend independently re-checks this).
* A job outside the machine bed, with invalid layer settings, or with non-finite numbers
  is **refused**.
* A pre-flight dialog shows the job summary and, for real machines, requires three
  acknowledgements before **Start job** is enabled.
* Only **one job** runs at a time; jog, home and frame are refused while a job runs.
* Before a job (and before Frame / Set origin) the controller must report **Idle**; alarms,
  holds and open doors block it.
* The laser is switched off (`M5`) before **every** travel move, regardless of GRBL's laser
  mode setting. Overscan moves keep the laser armed at zero power (`M4 S0`) so that GRBL does
  not stop, and `M5` still comes before every rapid `G0`.
* Any controller error during a job sends a **soft reset** (halts motion, laser off).
* **STOP** sets the abort flag first, then soft-resets the controller. It works while a job
  is streaming, and while a laser-on frame is running.
* **Frame** runs with the laser off unless you switch on **Frame with laser on**. That option is
  off every time MakerLaser starts, asks for confirmation, is limited to 0.1 to 5 % power, and
  only runs when the machine is idle (docs/framing.md).
* **Pause** only applies to a running job. A frame is ended with STOP.
* The **command box** in the console cannot send `M3`/`M4` (laser on), `$RST` (wipes the
  settings), real-time characters, more than one line, or anything while a job is running
  (docs/console.md).
* Generating the job **warns** when: Start From is relative to the laser head (MakerLaser cannot
  check that the job stays on the bed from there); overscan is used with a relative start; a Score
  layer has a power ramp (which needs GRBL laser mode).

## What the software cannot do

* It cannot know your material, your focus, or whether something flammable is under the beam.
* It cannot see the machine. **The STOP button is software.** Know where your machine's own
  power switch or emergency stop is, and be able to reach it.
* It cannot protect against wrong machine settings (see below). Notably, **with soft limits off
  (`$20=0`) GRBL will not stop the head at the edge of the bed.** MakerLaser's own bed check, and
  your Frame, are then the only things keeping the head on the bed.
* It does not know where the head is when you use Start From (Current position or User origin).
  **Use Frame first.**

## Before the first powered job

1. **Verify the build first**: `npm run verify` must pass (see `INSTALL.md`).
2. **Check GRBL settings** on the controller. Connect, type `$$` in the console box and press
   Enter (see docs/console.md). MakerLaser adds a line saying whether laser mode is on.

   | Setting | Needed | Why |
   |---|---|---|
   | `$30` | matches *Max S value* in Machine settings (usually 1000) | power scaling |
   | `$31` | 0 | minimum S |
   | `$32` | 1 (laser mode) | needed for a power ramp and for Frame with laser on; MakerLaser still emits `M5` before travel. If it is 0, type `$32=1` |
   | `$130`, `$131` | match the bed size in Machine settings | the machine's own idea of the bed |
   | `$20` | 1 only if you home reliably | soft limits. With 0, only MakerLaser's bed check keeps the head on the bed |

   The TTS-55 Pro's standard working area is listed as **300 × 300 mm**. Confirm your own
   frame and change it in **Machine…** if needed. The "outside the bed" check uses that number.
3. **Prove the axes with the laser unable to fire**: put the lens cap on or disconnect the
   laser, connect, jog with the arrows and confirm *up on the screen is away from you* (or
   whatever your machine does). If an axis is reversed, change **Origin corner** in Machine
   settings.
4. **Set the origin**: jog the head to the bed's origin corner (bottom-left by default), then
   click **Set origin here**. Jobs are absolute from that point.
5. **Set the focus** for your laser and material. A diode laser's burn depends heavily on the
   distance from the lens to the surface. Use the focus tool or gauge your laser comes with, and
   set it the same way each time.
6. **Frame** a small job and confirm the outline lands where the preview says it should. To see
   the outline on the material, tick **Frame with laser on** (start at 1 %), on scrap, with
   glasses on.
7. **First burn**: small, low power, scrap material, on the **Score** layer, with you present.
   Only then try cutting. Try any new layer setting (overscan, outline, ramp) on scrap first.
8. **Test pause/stop**: start a job, press **Pause** (the head should stop and the beam go
   out), **Resume**, then **STOP**. Confirm the beam goes out at once. If pausing leaves the
   beam on while stationary, do not rely on Pause; use Stop and report it.

## Always

* Wear laser safety glasses rated for your laser's wavelength (a 445 nm diode needs
  appropriate protection) and never look at the beam or its reflections, including the low-power
  beam used for framing.
* Run extraction or ventilation; some materials (PVC, vinyl, some plastics) release toxic
  gas when burned and must never be cut.
* Keep a fire extinguisher or fire blanket nearby and **never leave a running job unattended**.
* Material presets are conservative starting points, not tuned values. Test on scrap.
