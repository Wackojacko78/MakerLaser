# Canvas interactions

| Input | Action |
|---|---|
| Mouse wheel | Zoom, centred on the pointer |
| Middle-mouse drag | Pan |
| Left-drag on empty canvas | Rubber-band (box) select; objects the box touches are selected |
| Shift + box | Add to the current selection |
| Click an object | Select it (Shift toggles) |
| Drag a selected object, or the box around several | Move. Every selected object's final position is committed in one undo step |
| Drag a handle | Resize (proportional from corners) |
| Drag the rotate handle | Rotate, snapping within 4° of 45° steps |
| Arrow keys | Nudge 1 mm (Shift: 10 mm); one undo step per burst |
| Delete | Delete the selection (locked objects are kept) |
| Ctrl+D / Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y | Duplicate / undo / redo |
| Ctrl+S / Ctrl+Shift+S / Ctrl+O / Ctrl+N / Ctrl+I | Save / save as / open / new / import |
| Ctrl+Enter | Generate & Preview |
| Esc | Clear selection |
| Drop files on the window | Import |

Shortcuts are ignored while a text or number field has focus.

## Implementation notes

* Panning and box-select are handled manually rather than with Konva's `draggable` stage,
  which cannot tell mouse buttons apart and would fight with dragging objects.
* The bed, grid, origin and toolpath overlay do **not** listen to events, so clicks reach the
  stage and empty-space detection works.
* After a drag or transform, Konva reports the node's position, rotation and scale per node.
  They are recomposed into the affine matrix with `compose()` (the inverse of `decompose()`),
  and **all** selected nodes are committed in a single undo step. Skipping the rotation here
  was the cause of rotation being lost in the earlier prototype.
* The toolpath preview draws one canvas path per move kind from typed arrays, because a raster
  job can contain hundreds of thousands of moves.
