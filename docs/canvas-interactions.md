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
| Double-click other artwork (imported, traced, the result of a shape tool) | Edit its nodes (see Nodes below) |
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
| **N** | Node editing of the selected outline (see Nodes below) |

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

## Nodes

Select one outline (imported artwork, a trace, the result of a shape tool) and press **N**, press **Edit nodes (N)** in Properties, press **Nodes** in the Tools strip, or double-click it. Its points are drawn as small squares. Text and shapes stay text and shapes until you press **Convert to outlines** in Properties, which is one undo step. A circle or ellipse becomes 4 curve nodes (8 when it is large) and a rectangle with rounded corners becomes 8, with the corners as curves; a polygon, a star and text become one corner node for each point.

| Input | Action |
|---|---|
| Click a node | Pick it |
| Shift or Ctrl + click a node | Add it to the pick, or take it out |
| Drag a box on empty canvas | Pick the nodes inside it (Shift or Ctrl adds to the pick) |
| Drag a node | Move it. All picked nodes move together. One undo step for the whole drag |
| Arrow keys | Nudge the picked nodes 1 mm (Shift: 10 mm). A burst of keys is one undo step |
| X and Y boxes (Properties) | Type an exact position for the one picked node |
| Double-click a line | Add a node there. The shape does not change |
| Drag the end of a handle (a picked node shows them) | Bend the curve. A smooth node swings its other handle round to match, a symmetric one mirrors it, a corner leaves it alone |
| **Corner**, **Smooth**, **Symmetric** (Properties) | The type of the picked nodes. Smooth and Symmetric make handles where there are none |
| **Curve**, **Straight** (Properties) | Turn the line between two picked neighbouring nodes (or the lines either side of one picked node) into a curve, or back into a straight line. A new curve has its handles on the line, so it does not change shape until you pull a handle |
| Delete or Backspace | Delete the picked nodes. A closed outline left with two nodes becomes an open line, and the last node of an object cannot be deleted |
| Esc | Clear the pick. Esc again, or **V** or **N**, stops node editing |

While node editing is on, the artwork cannot be moved, resized or picked. Picking another object, a drawing tool or Measure stops it. **Ctrl+Z** and **Ctrl+Y** work as usual. A picked node shows its handles, which bend the lines next to it into curves. The outline the laser follows is always the curves flattened to 0.02 mm, so a curve is cut as a smooth line. Combine, Offset, Fillet and Trace still give straight-sided results without nodes.

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
