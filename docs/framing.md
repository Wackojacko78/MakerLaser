# Frame with the laser on

Frame traces the outline of the job so you can check where it will land. By default the laser is
off, so you watch the head. Switch **Frame with laser on** on and the laser fires at a very low
power while it traces, so the outline shows on the material itself.

## Using it

**Machine console > Job > Frame with laser on**, then set the power next to it.

- It asks you to confirm each time you switch it on, because the beam is on.
- It is **off every time MakerLaser starts**. Only the power is remembered.
- Power is a percentage of the machine's maximum S value, from 0.1% to 5%. The default is 1%.
  Framing shows where the job goes; it is not meant to mark the material, so 5% is the limit.
- While it runs the button reads "Framing..." and STOP stays available.
- Start From and Job Origin work as before: with Current position or User origin the outline is
  traced around the head and the head comes back to where it started.

## What is sent

The head goes to the first corner with the laser off, then the laser is switched on for the four
sides and switched off again:

```
G21
G90
M5
G92.1
G1 X10 Y260 F3000   ; first corner, laser off
M4 S10              ; laser on at 1% of S1000
G1 X40 Y260 F3000
G1 X40 Y290 F3000
G1 X10 Y290 F3000
G1 X10 Y260 F3000
M5                  ; laser off
```

With Start From relative to the head, `G92`, the move back to where the head started and `G92.1`
are added, as for a job. The laser is always off before the return move.

## Safety

- `M4` (dynamic power) is used, so with GRBL laser mode (`$32=1`) the beam drops to nothing
  whenever the head is not moving.
- The laser is switched off (`M5`) straight after the trace and before any rapid move, and the
  program ends with it off.
- **STOP** soft-resets the controller, which switches the laser off. An error part-way does the
  same.
- It only runs when the machine is idle, the artwork is inside the bed, and the power is within
  0.1 to 5%. The machine side checks this again whatever the screen sent.
- **Pause does not apply to framing.** It is greyed out, and the machine side refuses it when no
  job is running. Use STOP.
- Even at 1% the beam is an eye hazard: wear laser safety glasses for your laser, keep the area
  clear, and try it on scrap first.

## Limits

- MakerLaser does not read `$32`. With laser mode off (`$32=0`) GRBL treats `M4` as a spindle and
  the beam stays on at constant power for the whole trace, and STOP is then the only way to end
  it early. Check that `$32=1` on your machine.
- Whether the beam is visible, and whether it marks the material, depends on the laser, the
  material and the room. Frame speed is 3000 mm/min (or the machine's maximum if lower).
- The simulator has no beam. The console log says whether the laser was on.

## Testing it

1. Set the power to 1% and try Frame with laser on over scrap, with the laser head at the origin.
2. Check the dot is visible and the material is not marked. If it is hard to see, raise the
   power a little at a time. If it marks, lower it.
3. Press STOP part-way round and check the beam goes out at once.
4. Try Start From: Current position and check the outline is traced around the head and the head
   returns to where it started.
