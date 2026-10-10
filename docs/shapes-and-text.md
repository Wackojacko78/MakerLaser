# Shapes, and editing text and shapes

## Adding a shape

**Toolbar > Shape...** opens a box with a live preview.

| Shape | Settings |
|---|---|
| Rectangle | Width, height, corner radius (0 for sharp corners) |
| Ellipse / circle | Width, height (make them equal for a circle) |
| Polygon | Width, height, number of sides (3 to 64) |
| Star | Width, height, number of points (3 to 64), inner size (10 to 95%) |

Pick a **Laser mode** (Engrave, Outline or Cut) and press **Add to project**. The shape is placed in
the middle of the bed on the layer for that mode. Drag it, or use the Properties panel, to move it.

- Sizes are from 0.1 mm to 2000 mm. The box warns when a shape is bigger than the bed.
- A rectangle's corner radius is limited to half its short side. At that limit the ends are fully
  round.
- Odd polygons point up. Even ones sit flat, so four sides is an upright square and six is a hexagon
  with a flat top and bottom.
- A polygon or star is stretched to fill the width and height you give, so a 5-pointed star that is
  40 x 40 mm is exactly 40 x 40 mm.
- Curves are built to within 0.02 mm of the true curve.

## Editing text and shapes later

Text and shapes remember what they were made from. To change one:

- **Double-click** it on the canvas, or
- select it and press **Edit text...** or **Edit shape...** in the Properties panel.

The same box opens with the current settings. Change anything, including the text itself, the font,
the size, the shape, or the laser mode, and press **Save changes**. It is one undo step.

What stays and what changes:

- **Kept:** position (its top-left corner), rotation, layer (unless you change the Laser mode),
  visibility, lock and stacking order.
- **Size:** if you resized it with the handles, the box opens with that size in it. After saving, the
  outlines are rebuilt at exactly the size shown, so nothing is left stretched. This is also how to
  undo stretching on text: open it and save.
- **Name:** renamed to match the new text or shape, unless you gave it a name yourself.
- **Locked objects** cannot be edited. Unlock them first.

Things that are not editable this way: imported SVG and DXF artwork, images, and text and shapes made
before this version (they have no saved settings). Add them again to make them editable.

If you move, rotate or resize an editable object it stays editable. If you duplicate it, the copy is
editable too. Anything that changes the outlines themselves, such as Arrange, still treats it as
ordinary artwork.

## Saved files

The settings are saved in the project file next to the outlines. Older versions of MakerLaser open
these files as ordinary artwork (the settings are ignored there).
