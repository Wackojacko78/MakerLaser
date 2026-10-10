# Importing artwork

**Import** (the button, **Ctrl+I**, or dragging a file onto the window) takes SVG, DXF and pictures
(PNG, JPG, JPEG, BMP). Anything that could not be imported is listed in the warnings that appear
after the import, so nothing is left out silently.

## SVG

Imported: `line`, `polyline`, `polygon`, `path` (every path command), `rect` (including rounded
corners), `circle` and `ellipse`, inside any number of nested groups with `transform`, plus `use`
and `symbol` (below). Curves are flattened to straight pieces within 0.02 mm. The size comes from the
`width` and `viewBox`; with no size, 96 pixels is taken to be one inch.

Not imported, with a warning: `text` (convert it to paths first), `image`, and anything in `clipPath`,
`mask`, `pattern` or `marker`. Anything with `display: none` is left out.

### `use` and `symbol`

A `use` draws a copy of the element it points at, wherever `x`, `y` and its own `transform` put it.
That is how a design repeats one shape many times, and how Inkscape clones and Illustrator symbols are
saved. All of these work:

- a `use` that points at a shape, a group, or another `use`;
- both `href="#id"` and the older `xlink:href="#id"`;
- a `use` inside a transformed group (the copy moves with the group);
- shapes in `defs`, which are only drawn through a `use`;
- a `symbol`. If it has a `viewBox` and the `use` gives a `width` and `height`, the symbol is scaled to
  fit, keeping its proportions and centred. With no size on the `use` it is drawn at its own scale.

The order is the one a browser uses: the element's own transform first, then `x` and `y`, then the
`use`'s `transform`, then its parent groups.

Skipped, with a warning: a `use` that points at another file (`other.svg#shape`), at something that is
not in the file, or at itself or at something that leads back to itself. If two elements have the same
`id`, the first is used.

## DXF

Imported: `LINE`, `CIRCLE`, `ARC`, `ELLIPSE`, `LWPOLYLINE` (with bulge arcs), `POLYLINE` with `VERTEX`,
`SPLINE`, and `INSERT` (below). The units come from the file (`$INSUNITS`) and are converted to
millimetres; a file that does not say is taken to be millimetres, with a warning. DXF is Y-up and is
flipped to the workspace's Y-down. Separate lines and arcs whose ends meet are joined into closed
loops, because cutting and kerf compensation need closed outlines. DXF layers are not used:
everything is imported.

Not imported, with a warning: `TEXT`, `MTEXT`, `HATCH`, `DIMENSION`, `ATTRIB` and other entities.

### `INSERT` (blocks)

CAD programs save a repeated part (a bolt hole, a bracket) once as a **block** and then place it with
`INSERT`. MakerLaser now places every copy:

- at the insertion point, with the block's **base point** as the point that lands there;
- with the **scale** (X and Y separately, negative values mirror) and the **rotation**, in that order;
- as an **array** when the insert has columns and rows (`MINSERT`): the grid of copies turns with the
  insert;
- **blocks inside blocks**, to any sensible depth. A block that is scaled up keeps its curves smooth:
  a circle drawn small and inserted at 100 times is flattened as finely as one drawn at full size.

Block names are not case sensitive. Skipped, with a warning: an `INSERT` of a block that is not in the
file, a block that contains itself (directly or through another block), and a scale of zero. A block's
text and attributes are not imported (they get the usual warning).

## Limits

- **Copies are capped** so a damaged or hostile file cannot fill the computer. One import places at
  most 50,000 `use` copies and 50,000 block copies, nests `use` 24 deep and blocks 16 deep, stops
  expanding `use` once an SVG has 2,000,000 paths, and takes at most 1,000,000 paths from blocks. A
  real design is nowhere near this. When a cap is hit the rest is skipped, with a warning that
  starts "Too many".
- A `symbol` is always fitted the default way (`preserveAspectRatio` is not read), and a `use` with no
  size shows it at its own scale rather than filling the whole picture.
- A nested `<svg>` is treated as a group: its own `x`, `y` and `viewBox` are not applied.
- A DXF `INSERT` with a flipped (negative extrusion) axis is placed without the flip, with a warning.
- Imported artwork is plain outlines. To make shapes and text that stay editable, draw them with the
  tools (docs/shapes-and-text.md).
