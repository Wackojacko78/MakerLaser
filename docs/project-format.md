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
                           "source": { ... },         // only for text and shapes made in MakerLaser
                           "nodes": [ ... ] }         // only after the outlines have been edited as nodes (see Nodes below)
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
| `tab_width_mm` | Cut: width of the tabs left uncut in each outline (docs/user-guide.md) | 0 |
| `tab_spacing_mm` | Cut: about how far apart the tabs are, in mm of outline | 50 |

### Nodes

A vector object may carry `nodes` next to its `paths`: the editable form of the same outlines (one list of nodes for each path, in the same order, with the same `closed` flag). `paths` is what the planner, the preview and the shape tools use, and when `nodes` is present it is always the flattened form of it, to 0.02 mm. The Rust types are in `packages/common/src/nodes.rs` and the rules that edit and flatten them are in `apps/desktop-ui/src/lib/nodePath.ts`.

```jsonc
"nodes": [ { "closed": true, "nodes": [
    { "x": 0,  "y": 10, "out": { "x": 0, "y": -5.5 } },
    { "x": 10, "y": 0,  "in":  { "x": -5.5, "y": 0 }, "mode": "smooth" },
    { "x": 10, "y": 10 } ] } ]
```

A segment is straight unless the first node has an `out` handle or the second has an `in` handle; then it is a cubic Bezier whose control points are the node plus its handle (a missing handle counts as zero). Handles are offsets from their node, in mm. `mode` is `corner` (the usual, left out of the file), `smooth` or `symmetric`. A file without `nodes` is exactly as it was, and an object whose `nodes` no longer match its `paths` (a file changed by something that does not know about them) has them rebuilt as plain corners the first time it is edited as nodes. Nothing in the planner reads them, so they cannot change a job. `schema_version` stays 1. An older MakerLaser should ignore the field and use `paths`; this has not been tried.

### Settings

`start_from` is `absolute`, `current_position` or `user_origin`, and `job_origin` is one of nine
anchor points (docs/start-from.md). `custom_run_order` is true when the layers run in your own
order instead of engraving before cutting. The stored User origin itself is **not** in the file:
it is a machine position and is forgotten when you disconnect. Three more settings choose how the head moves inside a layer (`order_fills_by_distance`, `cut_part_by_part` and `cut_shared_lines_once`: docs/user-guide.md), and the machine may carry `rapid_feed_mm_min`, `acceleration_mm_s2` and `junction_deviation_mm`, which only the time estimate uses (docs/config-formats.md).

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
