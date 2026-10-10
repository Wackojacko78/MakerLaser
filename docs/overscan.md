# Overscan

Overscan makes the laser head run past each end of a scan line with the laser off, so the
burn itself happens at full, steady speed. Without it the head is still accelerating or braking
at the edges of a fast fill or photo engraving, and the edges come out darker or smeared.

## Setting

**Layers panel > Fill or Image layer > Overscan (mm).** Default 0 (off). Range 0 to 25 mm.
Cut and Score layers do not use it. Old projects load with overscan off.

Rule of thumb: the distance the head needs to reach full speed is roughly
`speed² / (2 × acceleration)`. At 6000 mm/min (100 mm/s) and 1000 mm/s² that is 5 mm. Start
around 2 to 5 mm and raise it only if the edges still look uneven. Check your machine's
acceleration setting (`$120` and `$121` in GRBL) if you want to calculate it.

## What it does

For every scan line (or group of runs on one line that are less than 10 mm apart):

1. Run-up: a laser-off move to the start of the line, from the overscan distance before it.
2. The burn: unchanged. The burned lines are identical with and without overscan.
3. Run-out: a laser-off move past the end of the line, by the overscan distance.

Gaps shorter than 10 mm between runs on one line, and the hop to the next line, are crossed
without stopping. Longer gaps are an ordinary rapid move and each side gets its own run-up and
run-out. Run-ups and run-outs are shortened, or dropped, where they would leave the bed.

## G-code

Overscan moves are sent as `M4 S0` followed by `G1` at the layer's feed rate, never as `M5` +
`G0`. GRBL empties its motion planner when the laser is switched off with `M5`, which would stop
the head and undo the run-up. `M5` is still sent before every `G0` rapid move and at the end of
the job, so the laser is never on during a rapid move.

Example (a fill line from X50 to X60 at 3000 mm/min, 3 mm overscan, 40% power on a 1000 S machine):

```
G0 X47 Y249.5      ; rapid to the start of the run-up (laser off)
M4 S0
G1 X50 Y249.5 F3000
M4 S400
G1 X60 Y249.5      ; the burn
M4 S0
G1 X63 Y249.5      ; run-out
G1 X63 Y248.5      ; hop to the next line, no stop
G1 X60 Y248.5      ; next run-up
M4 S400
G1 X50 Y248.5      ; the burn, other direction
```

## Limits

- **Start From / Job Origin relative to the laser head:** MakerLaser cannot check that the
  overscan stays on the bed from where the head is. Leave at least the overscan distance clear
  around the artwork and use Frame first. Pre-flight shows a warning when this applies.
- **Preview, Frame and job bounds:** overscan moves are Travel-type moves, so the preview draws
  them faintly with the other travel, and the **Travel** tick box hides them (docs/preview.md). The
  preview cannot show them in a colour of their own. They are not part of the job's bounds, so
  Frame and Job Origin still refer to the artwork.
- **Not yet tried on a laser.** See `VERIFICATION.md`.
- **Estimated time and distance:** overscan moves count as travel distance.
- **Soft limits:** if $20 (soft limits) is on and the head is close to the machine edge, GRBL can
  raise an alarm for an overscan move. The bed clamp prevents this in Absolute mode.
- **Presets:** a material preset saved from a Fill or Image layer remembers its overscan, and applying
  the preset sets it. Older presets do not set overscan, so applying one leaves it as it was. To change
  the overscan stored in a preset, set it on a layer, save a new preset and delete the old one.

## Testing it

1. Engrave a fast fill or photo at the speed you normally use with overscan 0. Look at the
   left and right edges.
2. Set overscan to 3 mm and repeat on scrap material. Edges should be cleaner, and the Fill or
   Image should not be longer or wider.
3. Frame first, and keep your hand near the stop button as usual.
