# Fill outline and ramped power

Two layer settings that shape what the laser does at the edges. Both are off by default and both are
set in the Layers panel.

## Outline pass (Fill layers)

Tick **Outline** on a Fill layer and, after the fill, the laser traces the edge of every closed shape
once, at the layer's own speed and power. Holes are traced first, then the outside, and the outline
comes after the fill lines so it covers their ends.

It is for fills whose edges look ragged or soft. The first and last fill lines sit half a
line-spacing in from the top and bottom edge, and on a fast fill the ends of the lines can be uneven.
The outline draws a clean line around the shape.

- With several passes, every pass is a fill and then its outline.
- It uses the layer's speed and power. A different power for the outline is not offered: put the
  outline on its own Score layer for that.
- It works with overscan. The head makes a rapid move from the last fill line to the outline, and the
  outline itself is an ordinary burning line with no overscan.
- Open paths on a Fill layer are not filled and are not outlined.
- The preview shows the outline in the same green as the fill.

## Ramped power (Score layers)

Set **Ramp** on a Score layer to a length in mm (0 = off, up to 10) and the power rises over that
distance at the start of each line and falls over the same distance at the end. It is for marking
lines where the ends burn darker than the middle.

Cut layers are never ramped. A ramp makes the ends of a line lighter, so a cut could be left
unfinished there. Fill and Image layers are not ramped either.

### How the ramp is made

The ramp is eight equal steps, each burned at one power:

- **An open line** starts at 20 % of the layer's power, rises to the full power and falls back to 20 %
  at the other end, so both ends are still marked.
- **A closed shape** starts from nothing and runs once round at full power. It then carries on over
  its first stretch again while the power falls. Going up and coming down add up to exactly the full
  power at every point of that stretch, so there is no weak spot where the loop closes and no dark dot
  where the head starts and stops. It costs one ramp length of extra travel.
- A ramp is never longer than half the line, so a short line ramps over half its length each way and
  does not reach the full power.
- A corner inside a ramp ends a step, so a step never turns a corner.

### What it needs

- **GRBL laser mode (`$32=1`).** The power changes in steps along every line. In laser mode GRBL changes
  power without stopping; with laser mode off the head pauses at each step and burns dark spots. MakerLaser
  warns about it in the safety warnings when you generate, whenever a Score layer has a ramp. Type `$$` in the console to see `$32`.
- Quite a lot more G-code: about 16 extra power changes for every line or loop.

### How much it will help

MakerLaser sends `M4`, dynamic power, in which GRBL already turns the power down while the head
speeds up and slows down. On a machine in that mode the starts and ends of lines are already lighter,
and a ramp may make little visible difference. It does most when the head stops or slows a lot at the
ends, for example with a high acceleration limit, a very low speed, or lines that turn sharply. Try it
on scrap before relying on it.

## Trying them on the laser

1. **Outline.** Fill a small shape at a fast speed with Outline off, then on, on scrap. Compare the edge.
2. **Ramp.** Score a line and a small square at your usual power with Ramp 0, then 3 mm. Look at the
   ends of the line and at the corner where the square starts and ends.
3. Frame first, as always.

## Limits

- One ramp length for the whole layer, and one shape of ramp (a straight rise in eight steps).
- The ramp counts the path as the toolpath has it: a Score line made of many tiny segments (a flattened
  curve) ramps over the right distance, but a path of tiny segments that is shorter than the ramp ramps
  over half its length.
- Neither setting is stored in material presets yet.
