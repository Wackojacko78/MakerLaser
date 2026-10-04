# Safety

A laser can start fires, injure eyes and skin, and release harmful fumes. **MakerLaser's
checks reduce risk; they do not replace your own supervision, your machine's own protections
or common sense.** This is 0.1.0 software that has not been tested on real hardware.

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
  mode setting. Framing runs with the laser off.
* Any controller error during a job sends a **soft reset** (halts motion, laser off).
* **STOP** sets the abort flag first, then soft-resets the controller. It works while a job
  is streaming.

## What the software cannot do

* It cannot know your material, focus, or whether something flammable is under the beam.
* It cannot see the machine. **The STOP button is software.** Know where your machine's own
  power switch or emergency stop is, and be able to reach it.
* It cannot protect against wrong machine settings (see below).

## Before the first powered job

1. **Verify the build first**: `npm run verify` must pass (see `INSTALL.md`).
2. **Check GRBL settings** on the controller (send `$$` from any GRBL console):

   | Setting | Needed | Why |
   |---|---|---|
   | `$30` | matches *Max S value* in Machine settings (usually 1000) | power scaling |
   | `$31` | 0 | minimum S |
   | `$32` | 1 (laser mode) | recommended; MakerLaser still emits `M5` before travel |
   | `$130`, `$131` | match the bed size in Machine settings | soft-limit and bounds agreement |
   | `$20` | 1 only if you home reliably | soft limits |

   The TTS-55 Pro's standard working area is listed as **300 × 300 mm**. Confirm your own
   frame and change it in **Machine…** if needed. The "outside the bed" check uses that number.
3. **Prove the axes with the laser unable to fire**: put the lens cap on or disconnect the
   laser, connect, jog with the arrows and confirm *up on the screen is away from you* (or
   whatever your machine does). If an axis is reversed, change **Origin corner** in Machine
   settings.
4. **Set the origin**: jog the head to the bed's origin corner (bottom-left by default), then
   click **Set origin here**. Jobs are absolute from that point.
5. **Frame** a small job and confirm the outline lands where the preview says it should.
6. **First burn**: small, low power, scrap material, on the **Score** layer, with you present.
   Only then try cutting.
7. **Test pause/stop**: start a job, press **Pause** (the head should stop and the beam go
   out), **Resume**, then **STOP**. Confirm the beam goes out at once. If pausing leaves the
   beam on while stationary, do not rely on Pause; use Stop and report it.

## Always

* Wear laser safety glasses rated for your laser's wavelength (a 445 nm diode needs
  appropriate protection) and never look at the beam or its reflections.
* Run extraction or ventilation; some materials (PVC, vinyl, some plastics) release toxic
  gas when burned and must never be cut.
* Keep a fire extinguisher or fire blanket nearby and **never leave a running job unattended**.
* Material presets are conservative starting points, not tuned values. Test on scrap.
