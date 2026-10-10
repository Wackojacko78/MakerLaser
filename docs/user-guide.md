# User guide

From an empty window to a finished job. Each step names the document with the details.

**First, read [`../SAFETY.md`](../SAFETY.md).** Try everything below with the **Simulator** first,
and the first real burns on scrap.

## 1. The window

| Where | What is there |
|---|---|
| Top bar | **New, Open, Save, Save as**, **Import**, **Undo, Redo, Duplicate, Delete**, **Fit**, **Arrange…**, **Test grid…**, **Machine…**, the project name, and on the right **Preview**, **Travel** and **Generate & Preview** |
| Left strip (Tools) | **Select**, **Measure**, the drawing tools (**Rectangle, Ellipse, Polygon, Star, Text**) and **Import** |
| Middle | The canvas: the machine bed, the grid, your artwork. Mouse wheel zooms, middle-drag pans |
| Right panels | **Properties** (position, size, and the settings of the selected shape or text), **Layers**, **Material library**. Drag the thin line beside them to resize; double-click it to reset |
| Bottom | The machine console: **Connection**, **Move**, **Job** and **Replay**, with a **Console** tab and a **G-code** tab. Drag its top edge to resize |

Everything is in millimetres unless the project is set to inches (Machine…). The origin of the
canvas is the top-left of the bed, and Y counts downwards, like the picture on the screen.
All mouse and key actions are in [canvas-interactions.md](canvas-interactions.md).

## 2. Choose your machine

Click **Machine…**. Pick your laser from the catalogue (19 machines, see [catalog.md](catalog.md))
or type its bed size, origin corner, maximum feed and S value by hand and press **Save as preset**.
**Check the numbers against your machine.** The bed size drives the "outside the bed" check and the
origin decides which way the job is mirrored. The same window has **Job placement** (step 8) and
**Connection** ([connection.md](connection.md)).

## 3. Bring in artwork

* **Import** (button, **Ctrl+I**, or drag a file onto the window): SVG, DXF, PNG, JPG, BMP. Anything
  that could not be imported is listed in a notice. What each format supports is in
  [import.md](import.md).
* **Draw a shape:** press **R** (rectangle), **E** (ellipse), **P** (polygon) or **S** (star), then
  drag on the canvas, or just click. A small editor opens beside the shape: type a width, press
  **Tab**, type a height, press **Enter**. Hold **Shift** while dragging for a square or a circle.
* **Add text:** press **T**, click where it should go, and type. Choose the font, size, bold,
  italic and alignment in the same box. 35 fonts are built in ([fonts.md](fonts.md)).
* **Change it later:** double-click a shape or text, or select it and use the boxes in the
  **Properties** panel ([shapes-and-text.md](shapes-and-text.md)).
* **Measure** with **M** ([measure.md](measure.md)). **Arrange…** aligns, spaces and repeats the
  selection. **Test grid…** adds a speed × power grid for trying a new material.

Move, resize and rotate with the mouse or by typing numbers in **Properties**. **Ctrl+Z** undoes.

## 4. Layers and materials

Every object belongs to one layer, and the layer says what the laser does with it:

| Layer | The laser | Its extra settings |
|---|---|---|
| **Cut** | Follows the outline, through the material | **Kerf** (width of the cut, to compensate for) |
| **Score** | Follows the outline lightly (fold lines, marking) | **Ramp** (power rises and falls at the ends of each line, [fill-and-ramp.md](fill-and-ramp.md)) |
| **Fill** | Fills closed shapes with parallel lines | **Spacing**, **Angle**, **Cross-hatch**, **Overscan** ([overscan.md](overscan.md)), **Outline** ([fill-and-ramp.md](fill-and-ramp.md)) |
| **Image** | Engraves pictures as dots | **Resolution**, **Dither**, **Scan** direction, **Bidirectional**, **Overscan**, **Brightness, Contrast, Gamma, Invert** |

Every layer also has **Speed**, **Power**, **Passes** (the whole job repeats) and **Air assist**.
Select objects and press **Assign** on a layer to move them to it. Each layer has a list of
**material presets** that fill in speed, power and passes. They are conservative starting points,
not tuned values: **test on scrap**. The **Material library** panel creates, edits, imports and
exports presets.

Engraving normally runs before cutting, so a cut-out piece cannot move before it is engraved. The
Layers panel lets you choose your own order instead, and then warns if something runs after a cut.

**For text:** Fill (the letters filled in) is usually what you want. Score or Cut traces both edges
of every stroke, which makes thin fonts come out as double lines.

## 5. Preview the job

Press **Generate & Preview** (**Ctrl+Enter**). MakerLaser plans the job, checks it, and draws it
over your artwork: red cuts, blue scores, green fills, purple engraving, and faint grey dashes for
the laser's moves with the beam off. **Preview** shows or hides the drawing; **Travel** shows or
hides the grey dashes. The **Replay** slider draws only part of the job so you can follow the
order. More in [preview.md](preview.md).

The report lists anything that will not run (an object on no layer, an image on a vector layer,
...) and the safety warnings. **A job that reaches outside the bed is refused.**
If you change anything afterwards, **Start** is disabled until you generate again.

## 6. Connect

In the console's **Connection** block, tick **Simulator** to try without hardware, or choose the
laser's port and press **Connect**. With a real machine, type `$$` in the command box on the
**Console** tab to read its settings ([console.md](console.md)). Check that `$32` is 1 (laser mode).

**Move** has the jog arrows, **Home**, **Unlock** (after an alarm) and **Set origin here**. Jog the
head to the corner you want as zero and press **Set origin here**.

## 7. Frame

**Frame** traces the outline of the job so you can see where it will land. With the laser off you
watch the head. **Frame with laser on** fires the laser at a very low power so the outline shows on
the material. It is off every time MakerLaser starts ([framing.md](framing.md)).

## 8. Where the job runs

By default the job runs where you see it, measured from the machine's origin corner. In
**Machine… > Job placement**, **Current position** and **User origin** place the job around the
head instead. Always Frame first, because MakerLaser cannot check the bed from where the head is
([start-from.md](start-from.md)).

## 9. Run

Press **Start…**. A pre-flight dialog shows the job summary and, for a real machine, asks you to
confirm. Then watch the progress. **Pause** and **Resume** hold the job. **STOP** halts everything
at once and switches the laser off. Stay with the machine until the job ends.

## 10. Save

**Save** writes a `.mlp` project (artwork, layers, machine and settings, with the images inside).
**Save G-code…** (a button on the **G-code** tab, once you have generated) writes the previewed
program as plain G-code: it has absolute coordinates and does not include the Start From placement. The project name in the top bar shows a dot when there are
unsaved changes, and closing the window asks before it discards them.

## If something does not work

| Problem | Try |
|---|---|
| Start is disabled | Generate again (an edit made the preview stale), connect, or read the message under the buttons |
| "Outside the bed" | Move or resize the artwork, or check the bed size in **Machine…** |
| The head moves the wrong way | Check the origin corner in **Machine…** with the laser unable to fire ([`../SAFETY.md`](../SAFETY.md)) |
| Burns look weak or strong | Focus, speed, power and the material differ from the preset: test on scrap |
| A shape or text will not open for editing | It is locked, imported, or made before editing existed: add it again with the tools |
| A typed command is refused | The console box does not send laser-on commands, `$RST` or real-time keys ([console.md](console.md)) |
| Something else | [`../INSTALL.md`](../INSTALL.md), "If something fails" |
