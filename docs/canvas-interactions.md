# Canvas interactions

## Mouse

| Input | Action |
|---|---|
| Mouse wheel | Zoom, centred on the pointer |
| Middle-mouse drag | Pan |
| Left-drag on empty canvas | Rubber-band (box) select; objects the box touches are selected |
| Shift or Ctrl + box | Add to the current selection |
| Click an object | Select it (Shift or Ctrl toggles) |
| Double-click a shape or text | Open its editor (docs/shapes-and-text.md) |
| Drag a selected object, or the box around several | Move. Every selected object's final position is committed in one undo step |
| Drag a handle | Resize (proportional from corners) |
| Drag the rotate handle | Rotate, snapping within 4° of 45° steps |
| Drop files on the window | Import |
| Drag the line beside the right-hand panels, or the edge of the console | Resize them. Double-click the line to reset. The sizes are remembered |

## Tools

| Key | Tool |
|---|---|
| **V** | Select |
| **M** | Measure (docs/measure.md) |
| **R** | Rectangle |
| **E** | Ellipse |
| **P** | Polygon |
| **S** | Star |
| **T** | Text |

The same tools are in the Tools strip on the left. Pressing the key of the tool that is already
picked puts it down again. **Esc** (or **V**) leaves a drawing tool without drawing.

With a drawing tool picked:

| Input | Action |
|---|---|
| Drag on the canvas | Draw the shape to the size you drag. A preview and its size follow the pointer |
| Click on the canvas | Place a default-sized shape centred on the click (text starts at the click) |
| Hold **Shift** while dragging | Keep the shape square (a circle, for the ellipse) |

The editor that opens next to a new shape or text:

| Key | Action |
|---|---|
| **Tab** / **Shift+Tab** | Next / previous box (it goes round in a circle) |
| **Enter** | Done (for text, **Ctrl+Enter**, because Enter starts a new line) |
| **Esc** | Done |

## Keyboard

| Input | Action |
|---|---|
| Arrow keys | Nudge 1 mm (Shift: 10 mm); one undo step per burst |
| Delete | Delete the selection (locked objects are kept) |
| Enter or F2 | Open the editor of the selected shape or text |
| Ctrl+D / Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y | Duplicate / undo / redo |
| Ctrl+S / Ctrl+Shift+S / Ctrl+O / Ctrl+N / Ctrl+I | Save / save as / open / new / import |
| Ctrl+Enter | Generate & Preview |
| Esc | Clear the selection (or leave a drawing tool, or close an editor) |

Shortcuts are ignored while a text or number field has focus. The tool keys are also ignored
while a dialog is open and when Ctrl, Alt or Shift is held, so Ctrl+S still saves.

## Implementation notes

* Panning and box-select are handled manually rather than with Konva's `draggable` stage,
  which cannot tell mouse buttons apart and would fight with dragging objects.
* The bed, grid, origin and toolpath overlay do **not** listen to events, so clicks reach the
  stage and empty-space detection works.
* After a drag or transform, Konva reports the node's position, rotation and scale per node.
  They are recomposed into the affine matrix with `compose()` (the inverse of `decompose()`),
  and **all** selected nodes are committed in a single undo step. Skipping the rotation here
  was the cause of rotation being lost in the earlier prototype.
* With a drawing tool picked, objects are not draggable or selectable, so a drag over existing
  artwork starts a new shape instead of moving the old one.
* Double-click is detected on the canvas element itself, not on the drawn shape: Konva only reports
  a double-click when both clicks land on the very same drawn shape, which thin outlines and text
  often miss.
* The toolpath preview draws one canvas path per move kind from typed arrays, because a raster
  job can contain hundreds of thousands of moves.
