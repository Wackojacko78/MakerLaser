# Project format (`.mlp`)

A `.mlp` file is a standard **zip archive**:

```text
project.json                       the project (pretty-printed JSON)
images/<asset-id>.<png|jpg|jpeg|bmp>   one entry per image asset
```

* An image **asset** is stored once even if several objects reference it.
* Assets that no object references are not written.
* Entries are Deflate-compressed.

## `project.json`

```jsonc
{
  "schema_version": 1,
  "id": "uuid", "name": "Untitled",
  "machine": { "name", "controller": "grbl1_1", "bed_width_mm", "bed_height_mm",
               "origin": "bottom_left", "max_feed_rate_mm_min", "max_spindle_value",
               "homing_supported", "air_assist_supported", "baud_rate",
               "connection": { "kind": "websocket", "host": "fluidnc.local", "port": 0 } },  // left out for USB serial
  "layers": [ { "id", "name", "kind": "cut|score|fill|image",
                "speed_mm_min", "power_percent", "passes", "air_assist", "enabled",
                "z_order", "color",
                "kerf_mm", "line_spacing_mm", "fill_angle_deg", "cross_hatch",
                "overscan_mm", "fill_outline", "ramp_mm",
                "raster": { "dpi", "dither", "direction", "bidirectional",
                            "brightness", "contrast", "gamma", "invert" } } ],
  "objects": [ { "id", "name", "layer_id", "visible", "locked", "z_index",
                 "transform": { "a","b","c","d","e","f" },
                 "kind": { "type": "vector", "paths": [ { "closed", "points": [{"x","y"}] } ],
                           "source": { ... } }          // only for text and shapes made in MakerLaser
                       | { "type": "image", "asset_id", "format", "width_px", "height_px", "dpi" } } ],
  "materials": { "presets": [ ... ] },
  "settings": { "units", "grid_spacing_mm", "show_grid", "show_origin",
                "start_from", "job_origin", "custom_run_order" }
}
```

Coordinates are millimetres in the Y-down workspace (see `architecture.md`).

### Text and shape sources

A text or shape object keeps what it was made from next to its outlines, so it can be edited again
(docs/shapes-and-text.md). The outlines (`paths`) are still what the planner uses; `source` is only
the recipe.

```jsonc
"source": { "type": "text", "text": "Hello", "font_family": "Roboto", "bold": false, "italic": false,
            "cap_height_mm": 10, "align": "left", "line_spacing": 1.2 }

"source": { "type": "shape", "shape": "rectangle",      // rectangle | ellipse | polygon | star
            "width_mm": 40, "height_mm": 20, "corner_radius_mm": 0,
            "sides": 5, "inner_ratio": 0.5 }              // sides: polygon sides or star points
```

The font is named, not stored: on a computer without it the text stays editable and is drawn in a
plain font until another is picked. Imported artwork, images and text or shapes made before editing
existed have no `source`.

### Layer settings added after 0.1.0

| Field | Meaning | Default |
|---|---|---|
| `overscan_mm` | Fill and Image: laser-off run-up and run-out past each scan line (docs/overscan.md) | 0 |
| `fill_outline` | Fill: trace the edge of each closed shape after the fill (docs/fill-and-ramp.md) | false |
| `ramp_mm` | Score: length of the power ramp at each end of a line (docs/fill-and-ramp.md) | 0 |

### Settings

`start_from` is `absolute`, `current_position` or `user_origin`, and `job_origin` is one of nine
anchor points (docs/start-from.md). `custom_run_order` is true when the layers run in your own
order instead of engraving before cutting. The stored User origin itself is **not** in the file:
it is a machine position and is forgotten when you disconnect.

## Compatibility

* **Atomic saves:** the archive is written to `<name>.mlp.tmp`, flushed, then renamed over the
  target, so a crash cannot corrupt an existing project.
* **Newer files:** a project whose `schema_version` is newer than the running version is
  refused with a clear message instead of being half-loaded.
* **Older files:** every field added later uses `#[serde(default)]` (for example `kerf_mm`,
  `line_spacing_mm`, `raster`, `overscan_mm`, `fill_outline`, `ramp_mm`, `start_from`, `source`,
  `connection`), so older projects keep loading and the new features start switched off. That is
  why `schema_version` is still 1. When a change cannot be defaulted, bump
  `PROJECT_SCHEMA_VERSION` and add a migration in `mlp::load_project`.
* **Older versions of MakerLaser** should open a newer project and ignore fields they do not know
  (serde skips unknown fields unless a type says otherwise), so text and shapes would open as
  ordinary artwork. This has not been tried.
