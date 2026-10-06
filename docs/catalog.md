# Machine and material catalogue

## Machines (Machine window, Preset list, "Catalogue")

19 GRBL diode laser machines from 9 brands. Choosing one fills in bed size, feed limit, origin, S value,
baud rate, homing and air assist, then tells you where the numbers came from and what to check.

**It is a starting point.** The bed size drives the "outside the bed" check and the origin decides which way a
job is mirrored. Before a real job, with the laser off or the Simulator on:

1. Connect and jog a small distance from the front-left corner.
2. +X must move the head to the right and +Y must move it away from you. If not, the origin (or GRBL `$3`) is wrong for your machine.
3. Frame a job that fills the bed and check the head reaches the edges without hitting the frame.
4. Run `$$` in the console and check `$30` (max S) is 1000 and `$110`/`$111` are at or above the feed limit you use.

How the numbers were chosen:

- Bed sizes are from the maker's own page, manual or spec sheet where one was found (marked "from the maker" when you
  pick the machine) and from comparison or review pages otherwise. **Where sources disagreed, the smaller size is used.**
- Where no top speed was published (Atomstack X20 Pro, ACMER P1) a low 6000 mm/min default is used, and the entry says so.
- Origin is bottom-left for every machine. That is the common GRBL layout, **not verified per machine.**
- Max S is 1000 for every machine. Only Ortur publishes it.
- Homing is on only for machines whose sources mention limit or home switches (ACMER P1, ACMER P1 S Pro, Comgrow COMGO Z1).
- GRBL is "listed" when a source for that model says it works with LightBurn or LaserGRBL, and "assumed" otherwise.
  Two machines are assumed: Creality Falcon A1C Basic and Two Trees TS2 Pro.

| Machine | Laser | Bed (mm) | Max feed | Air | Bed source |
|---|---|---|---|---|---|
| Sculpfun S9 5.5W | 5.5 W | 410 x 415 | 6000 | no | listing |
| Sculpfun S30 Pro Max 20W | 20 W | 370 x 360 | 6000 | yes | maker |
| Atomstack A5 Pro 5W | 5 W | 410 x 400 | 6000 | no | listing |
| Atomstack A10 Pro V2 10W | 10 W | 410 x 380 | 10000 | no | maker |
| Atomstack A20 Pro V2 20W | 20 W | 400 x 365 | 10000 | yes | maker |
| Atomstack X20 Pro 20W | 20 W | 400 x 400 | 6000 (default) | yes | review |
| Creality Falcon2 22W | 22 W | 400 x 415 | 25000 | yes | maker |
| Creality Falcon2 Pro 22W | 22 W | 400 x 415 | 36000 | yes | listing |
| Creality Falcon A1C Basic 10W | 10 W | 150 x 150 | 15000 | no | listing |
| Ortur Laser Master 3 10W | 10 W | 400 x 400 | 20000 | no | maker |
| Ortur Laser Master 3 20W | 20 W | 400 x 380 | 20000 | no | maker |
| Ortur Laser Master 3 40W | 40 W | 400 x 380 | 20000 | no | maker |
| Two Trees TTS-55 5.5W | 5.5 W | 300 x 300 | 10000 | no | maker |
| Two Trees TS2 Pro 10W | 10 W | 450 x 450 | 15000 | no | listing |
| AlgoLaser Alpha MK2 20W | 20 W | 400 x 410 | 20000 | yes | maker |
| Longer Ray5 10W | 10 W | 400 x 400 | 6000 | no | review |
| ACMER P1 10W | 10 W | 400 x 410 | 6000 (default) | no | maker |
| ACMER P1 S Pro 10W | 10 W | 380 x 370 | 10000 | no | manual |
| Comgrow COMGO Z1 10W | 10 W | 400 x 400 | 5000 | no | review |

The full notes for each machine (disagreeing sources, what to check) are shown when you pick it and are in
`apps/desktop-ui/src/lib/machineCatalog.ts`, with a source link per machine.

### Not in the catalogue

This is 19 machines, not 50. These were looked at and left out, or not looked at:

- **Machines with conflicting bed sizes:** Creality Falcon A1 10W (sources give 305 x 381 and 268 x 358).
- **Not checked at all:** xTool (the D1 family), NEJE, Wainlux, Sculpfun S10/S30 Pro 10W/S30 Ultra, Longer Ray5 5W/20W, Atomstack A6/A12/A24/A30, Creality Falcon2 12W/40W and A1 Pro, and anything else not in the table. I did not verify whether xTool machines speak plain GRBL, so they are not included.
- **Not GRBL 1.1:** CO2 and galvo machines (Ruida and similar controllers). The profile format has `ruida` and `galvo` values, but nothing here supports those machines.

To add a machine: add one `mk({...})` line to `MACHINE_CATALOG` with a `source` URL and run the unit tests, which check every entry with the same validator an imported machine file goes through.

## Materials (Material library, Import)

`docs/catalog/makerlaser-materials-starter.json` is a standard MakerLaser material file with 31 presets. Import it with
the **Import...** button in the Material library. Nothing is overwritten: a preset with the same name but different
settings is kept alongside as "name (2)".

**Each preset keeps the laser power it was published for, and is named for it:**

- 19 are from Creality's published Falcon2 22 W table (8 engraving, 11 cutting), named `... (22 W Falcon2)`.
- 12 engraving presets are from Atomstack's published X20 Pro table (also listed for the A20 Pro and S20 Pro), named `... (20 W Atomstack)`. Line interval is in the note: set the Fill layer's spacing to match.

**Nothing is scaled to other lasers.** A 10 W laser needs roughly half the speed or twice the passes of a 22 W one at the same
power, but that scaling is not published, so it is not guessed here. Use these as a starting point for a laser of similar
power, or as a reference when running the Test grid on yours. Always test on scrap.

Left out on purpose: PVC and vinyl, ABS and other plastics, polycarbonate, galvanised metal, resin, foam, rubber and anything
the source did not identify. These give off harmful fumes or were not clearly named. Leather presets say vegetable-tanned only
(never chrome-tanned) and acrylic presets say dark or opaque only (a blue diode passes through clear acrylic).

Cutting and engraving paper, card, cardboard and wood is a fire risk: never leave a running machine unattended, and vent MDF smoke outside.

### Sources

- Creality Falcon2 22W parameter table: https://store.creality.com/blogs/all/falcon2-22w-laser-engraver-shopping-guide
- Atomstack X20 Pro engraving parameter table: https://atomstackshop.com/blogs/engraving-and-cutting-parameter/lightburn-x20-pro-engraving-parameter-table
- Machines: the `source` link on each entry in `machineCatalog.ts`.
