# Toolpath preview

**Generate & Preview** draws the toolpath over the artwork. The artwork is dimmed to 30 % so the
moves stand out. Untick **Preview** in the toolbar to see the plain artwork again.

## Colours

| Colour | Move |
|---|---|
| Red | Cut |
| Blue | Score |
| Green | Fill |
| Purple | Engrave (image) |
| Grey, dashed and faint | Travel: the laser head moving with the beam off |
| Orange, thick | A move that reaches outside the bed |

Cut and score paths have a number at their start, in the order they run.

The **Replay** slider in the machine console draws only part of the toolpath, so you can follow the
order the laser takes.

## Travel

Travel is every move the laser makes with the beam off:

- the fast moves between separate shapes;
- the hops across gaps between the separate runs on one scan line. A line of text engraved with
  Fill has these between its letters on every scan line;
- the run-ups, run-outs and joins that **overscan** adds (docs/overscan.md).

There can be thousands of them, drawn together they look like a grey hatching over the artwork,
and none of it burns. So they are drawn faintly, and the **Travel** tick box in the toolbar (next to
Preview) hides them. Only the moves that burn are left. The choice is remembered.

The preview cannot tell the kinds of travel apart, so one tick box covers them all. Hiding travel
changes nothing about the job: the G-code is the same.

## Limits

- Hiding travel does not shorten the job. Travel still takes time and is still in the estimate.
- A very large job is drawn simplified (the Replay caption says so). The G-code is not simplified.
