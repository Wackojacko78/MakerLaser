# Start From and Job Origin

*Machine window, "Job placement".* These decide where a job runs on the machine.

## Start from

| Mode | What happens |
|---|---|
| **Absolute coordinates** (default) | The workspace is the machine bed. The job runs where you see it, measured from the machine origin corner. This is how MakerLaser has always worked. |
| **Current position** | The job is placed around wherever the laser head is when you press Start. |
| **User origin** | Like Current position, but the head first goes to a start point you set earlier. |

## Job origin

The nine dots choose which point of the artwork's box sits on the head (or on the User origin):
a corner, the middle of an edge, or the centre. They are greyed out in Absolute mode. The box is
the artwork that will run: visible objects on enabled layers, the same box Frame traces.

## How to use it

1. Machine window > Job placement: pick **Current position** and a job origin, for example centre.
2. Jog the head to the spot (the middle of a coaster, say).
3. **Generate**, then **Frame**: the head traces the outline around itself with the laser off and comes back.
4. If the outline is where you want it, **Start**.

For **User origin**: choose it, jog to the start point, press **Set user origin** (the machine must be connected),
then jog anywhere. Frame and Start go to the stored point first.

## How it works

The preview and the G-code you see are always the absolute ones. Just before a job (or Frame) is
sent, a few lines are added:

* `G92.1` clears any `G92` offset left behind by an earlier run (every run, in every mode).
* Current position: `G92 X.. Y..` tells GRBL that the head is at the job's anchor point, so the unchanged
  program lands around the head.
* User origin: `G53 G0 X.. Y..` rapids to the stored machine position, `G4 P0` waits for it to arrive, then `G92`.
* The footer's "return to the work origin" becomes "return to where the job started", and `G92.1` runs again before the end.

`G92`, `G92.1`, `G53` and `G4` are all in GRBL 1.1's supported list, and FluidNC says it supports every G-code GRBL does.

## Limits (please read)

* **No bed check from the head's position.** The existing check still requires the artwork to fit inside the
  bed as drawn, so the job can never be bigger than the bed. But MakerLaser cannot check that the job stays
  on the bed from where the head is. **Use Frame first.** The Generate report warns about this.
* **Saved G-code is absolute.** "Save G-code" writes the previewed program, without the placement lines.
* **User origin needs machine position reporting** (GRBL setting `$10=1`, the default). It is a machine position,
  so it is forgotten when you connect, disconnect, stop a job, or a job fails: the controller may have lost its
  position. Set it again.
* **Absolute runs now start with a `G92.1` line.** It does nothing unless an offset is active, and it stops a stale
  one from shifting a job.
* The simulator treats `G92` like a move, so its position readout jumps in the relative modes. That is the
  simulator, not the machine.
* Not shown yet: a marker for the anchor on the canvas.

## First run on a real laser

Laser eye protection on, scrap material, a hand near Stop. Do these in order and stop at the first surprise:

1. **Absolute**: run a small job you have run before. It should be identical (one extra `G92.1` line).
2. **Current position, Frame only**: the outline should trace around the head with the anchor on the head, then return.
3. **Current position, low power**: a small square at low power, then check where it landed.
4. **User origin**: set it, jog away, Frame: the head should go to the stored point first.

## For developers

* Settings: `StartFrom` and `JobOrigin` in `packages/common/src/project.rs` (`settings.start_from`, `settings.job_origin`,
  defaulting to absolute / bottom left, so older projects load unchanged); mirrored in `apps/desktop-ui/src/types/domain.ts`.
* Placement logic: `apps/rust-core/src/placement.rs` (pure functions, unit-tested), used by `machine_start` and `machine_frame`
  in `apps/rust-core/src/commands/machine_cmds.rs`.
* The User origin lives in `AppState.user_origin`, not in the project file.
