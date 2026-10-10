# Shapes and text: drawing and editing on the canvas

Shapes and text are drawn straight on the canvas and edited in place. There are no pop-up boxes.

## Drawing a shape

1. Pick **Rectangle**, **Ellipse**, **Polygon** or **Star** in the Tools panel on the left.
2. Either **drag** on the canvas to the size you want, or just **click** to place a default-sized
   shape centred on the click. While you drag, the outline and its size follow the pointer.
   Hold **Shift** to keep it square (a circle, for the ellipse).
3. A small editor opens next to the shape with a box for each size. The width box already has the
   cursor: type a number, press **Tab** to go to the next box, type the next number, and press
   **Enter** when you are done. The shape follows what you type.

The tool goes back to Select after each shape. Press **Esc** (or **V**) to leave a drawing tool
without drawing.

| Shape | Boxes, in Tab order |
|---|---|
| Rectangle | W, H, Radius (corner radius) |
| Ellipse | W, H (make them equal for a circle) |
| Polygon | W, H, Sides (3 to 64) |
| Star | W, H, Points (3 to 64), Inner (10 to 95 %) |

The size boxes also take a little sum: type `12.5*2` or `(40-4)/3` and the result is used. Only
numbers, `+ - * /` and brackets are understood. Sizes are in mm, from 0.1 to 2000.

## Adding text

1. Pick **Text** in the Tools panel and click where the text should start.
2. A text box opens next to it with the word "Text" selected. Type your text. It is drawn on the
   canvas as you type.
3. Choose the font, size, bold, italic, alignment, line spacing and laser mode in the same box.
4. Press **Esc** or **Ctrl+Enter** when you are done, or click anywhere else.

Enter starts a new line in the text box. If you clear the box completely the last text that could be
drawn is kept.

## Editing later

- **Double-click** a shape or text to open the same editor next to it, or
- select it and use the boxes in the **Properties** panel on the right. They are always there for a
  single selected shape or text, and change it live.

Everything is one undo step per burst of typing, so **Ctrl+Z** takes back an edit.

What stays and what changes when you edit:

- **Kept:** position (the top-left corner), rotation, layer (unless you change the laser mode),
  visibility, lock and stacking order. A locked object cannot be edited: unlock it first.
- **Size:** if you stretched it with the handles, the boxes show that size. After you change a box
  the outlines are rebuilt at exactly the size shown, so nothing is left stretched.
- **Name:** follows the text or shape unless you renamed it yourself.

For a shape the Properties panel shows its own W and H, not the bounding box, so a rotated shape
still shows its real width and height.

Not editable this way: imported SVG and DXF artwork, images, and text or shapes made before they
kept their settings. Add those again to make them editable.

## Saved files

The settings are saved in the project file next to the outlines. Older versions of MakerLaser open
these files as ordinary artwork and ignore the settings.

## Tips and limits

- A click places the shape on the bed. A drag stays exactly where you drew it, even over the edge:
  Generate will warn you if anything leaves the bed.
- Typing in a box does not trigger the app's shortcuts, so Delete and the arrow keys do what a text
  box expects.
- The Tools panel buttons have no keyboard shortcuts yet.
- Curves are built to within 0.02 mm of the true curve.
