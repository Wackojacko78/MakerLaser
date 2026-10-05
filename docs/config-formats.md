# Config file formats

Material libraries and machine profiles are exchanged as versioned JSON files, so they can be
shared, backed up and edited by hand. The code that reads and writes them is
`apps/desktop-ui/src/lib/configFormat.ts`; the Rust side (`config_cmds.rs`) only moves the text
to and from disk.

General rules for both formats:

- `format` names the kind of file and `version` is a whole number. Version 1 is the current one.
- A file with a newer `version` than the app understands is refused with a message asking you to
  update MakerLaser.
- Fields the app does not know are ignored, so later versions can add fields without breaking
  older files.
- Ids are never stored. They are created when a file is imported.
- Numbers must be JSON numbers (`300`, not `"300"`).
- Files may start with a byte-order mark.

## Material library: `makerlaser.materials`

```json
{
  "format": "makerlaser.materials",
  "version": 1,
  "presets": [
    {
      "name": "3mm birch ply - Cut",
      "for_layer_kind": "cut",
      "speed_mm_min": 150,
      "power_percent": 100,
      "passes": 3,
      "air_assist": true,
      "thickness_mm": 3,
      "notes": "Starting point only. Run a test on scrap first."
    }
  ]
}
```

| Field | Required | Rule |
|---|---|---|
| `name` | yes | Text, 1 to 100 characters. |
| `for_layer_kind` | yes | `cut`, `score`, `fill` or `image`. |
| `speed_mm_min` | yes | Number above 0. |
| `power_percent` | yes | Number above 0, at most 100. |
| `passes` | yes | Whole number, 1 to 100. |
| `air_assist` | no | `true` or `false`. Default `false`. |
| `thickness_mm` | no | Number above 0 (at most 1000), or `null`. |
| `notes` | no | Text up to 1000 characters, or `null`. |

Importing:

- Presets are added to the library; nothing is overwritten.
- A preset with the same name and the same settings as one already in the library is skipped.
- A preset with the same name but different settings is added as `name (2)`, `name (3)` and so on.
- A preset that fails the rules above is rejected with a message naming it. The rest of the file
  is still imported.
- Files written by earlier versions (`{ "presets": [...] }` with no `format`) are still read.

## Machine profile: `makerlaser.machine`

```json
{
  "format": "makerlaser.machine",
  "version": 1,
  "machine": {
    "name": "My diode laser",
    "controller": "grbl1_1",
    "bed_width_mm": 300,
    "bed_height_mm": 300,
    "origin": "bottom_left",
    "max_feed_rate_mm_min": 10000,
    "max_spindle_value": 1000,
    "homing_supported": false,
    "air_assist_supported": true,
    "baud_rate": 115200
  }
}
```

| Field | Required | Rule |
|---|---|---|
| `name` | yes | Text, 1 to 100 characters. |
| `controller` | no | `grbl1_1`, `ruida` or `galvo`. Default `grbl1_1`. |
| `bed_width_mm`, `bed_height_mm` | yes | Numbers from 10 to 5000. |
| `origin` | yes | `bottom_left`, `bottom_right`, `top_left` or `top_right`. Required because a wrong origin mirrors the job. |
| `max_feed_rate_mm_min` | yes | Number of at least 1. |
| `max_spindle_value` | yes | Whole number, 1 to 100000. Must match GRBL's `$30`. |
| `homing_supported` | no | `true` or `false`. Default `false`. |
| `air_assist_supported` | no | `true` or `false`. Default `false`. |
| `baud_rate` | no | Whole number of at least 300. Default `115200`. |

Importing a machine file replaces the machine settings of the open project and adds the machine
to your saved presets. A machine whose name matches a built-in preset is loaded but not saved.
Check the bed size and origin against your own machine before running a job.

## Your saved machine presets

The Machine dialog's **Save as preset** keeps the current settings under the Name field. Saved
presets appear in the preset list under "Saved by you", up to 50 of them. Saving with a name that
is already saved replaces that saved preset. A built-in preset name cannot be used.

Saved presets live in the app's local storage, which belongs to one build of the app: the dev
window and the installed app each have their own list. Use **Export** and **Import** to move a
machine between them or to another PC.

A laser that is not one of the built-in machines is set up the same way: change the values in
the Machine dialog by hand, then **Save as preset**.
