# Measure tool

Press **M**, or click **Measure** in the left strip. **V** or **Esc** (with nothing picked) goes back to Select.

Click a **point or a line**, then a second one. The numbers appear in the panel at the top left of the
canvas, and the measuring line and its value are drawn on the drawing. A third click starts again.
Right-click or **Esc** clears. Middle-drag still pans and the wheel still zooms.

With nothing picked, moving the pointer shows what a click would pick: hover over a line to read its
length. With one thing picked, the pointer shows the second one live.

## What a click picks

Within 10 screen pixels of the pointer, in this order:

1. a **corner** (a vertex of a path);
2. the **middle of a segment** (only on segments at least 3 snap distances long, so corners are not crowded);
3. the **centre of an object** (the middle of its own bounding box: the centre of a circle, of a rectangle);
4. an **edge**: the whole straight segment under the pointer, which is a *line*;
5. otherwise a **free point** exactly where you clicked.

The bed counts too: its corners, the middle of its edges, its centre, and its edges as lines, so you can
measure how far something is from the edge of the material. Hidden objects are ignored; locked ones are not.
Images have corners, edges and a centre.

Hold **Shift** to pick the exact point under the pointer, with no snapping.

## What you get

| You pick | You get |
|---|---|
| a point | X and Y |
| a line | length, the two differences, angle |
| point and point | distance, the two differences, angle |
| point and line | distance at right angles to the line (and, if that lands past the end of the line, the distance to the nearest end) |
| line and line, parallel | the gap between them, measured at right angles |
| line and line, crossing | the angle between them and where they cross |
| line and line, apart | the angle between them and the shortest distance between the two |

* Coordinates are millimetres from the **top-left** of the bed, with Y pointing **down**: the same numbers as
  the Selection panel. If the project is in inches, the readouts are in inches.
* **Angles** are measured anticlockwise from the right-hand horizontal, up is positive. A line has no front or
  back, so its angle is 0 to 180. The angle between two lines is the acute one, 0 to 90.
* The pointer position is shown in the bottom right corner of the canvas all the time.

## Selection panel

Under X, Y, W and H the Selection panel now shows, for the selected objects: how many there are, the
**diagonal** of their bounding box, and the **outline length**: the total length of all their vector outlines
(closed shapes include the closing edge), which is how much line a cut or score layer would draw. Images have
a size but no outline length, and the panel says so when they are in the selection.

## Things to know

* A curve is stored as many short straight segments, so picking a curve picks one of them. Snap to its
  corners (or measure between two points) instead.
* There is no area readout: shapes with holes need more care than a quick number deserves.
* A measurement is not saved, not undoable and does not mark the project as changed. Any change to the
  drawing (a move, undo, opening a file) clears it, because the numbers would be out of date.
* While the Measure tool is on, objects cannot be dragged, selected by clicking or boxed.
* Speed: snapping looks only at paths whose bounding box is near the pointer. On a 200,000-point drawing the
  worst case measured was about 5 ms per mouse move; ordinary drawings take well under 1 ms.

## For developers

* `src/lib/measure.ts`: all the maths (snapping, measurements, wording, selection statistics). Pure
  TypeScript, tested in `tests/measure.test.ts`.
* `src/state/measureStore.ts`: the tool, the picks, the hover and the pointer position. Not part of the
  project store on purpose.
* `src/canvas/MeasureOverlay.tsx` draws on the canvas; `src/components/MeasureReadout.tsx` is the panel and the
  pointer chip; `src/components/SelectionStats.tsx` is the Selection panel addition.
* `WorkspaceCanvas.tsx` is the only existing file with real logic added: in the Measure tool the mouse down
  handler picks instead of selecting, objects are not draggable and the Transformer is detached.
