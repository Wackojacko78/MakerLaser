# API reference (Tauri commands)

The TypeScript wrappers are in `apps/desktop-ui/src/lib/tauri.ts`; argument names are camelCase
in JS and snake_case in Rust. All commands return an error string on failure.

## Types

The Rust models in `packages/common` are mirrored **by hand** in
`apps/desktop-ui/src/types/domain.ts`, using the serde wire names (snake_case; enums such as
`LayerKind` are `"cut" | "score" | "fill" | "image"`; `ObjectKind` is tagged with `type`).
Change both together. The Rust tests that serialise the models and the TypeScript tests
that build them are the safety net.

`node scripts/check-docs.mjs` compares the commands registered in `apps/rust-core/src/main.rs` with
the table below and reports any that are missing or no longer exist.

## Commands

| Command | Arguments | Returns | Notes |
|---|---|---|---|
| `new_project` | | `ProjectFile` | Default layers, TTS-55 Pro profile |
| `machine_presets` | | `MachineProfile[]` | |
| `sync_project` | `project` | | UI → backend |
| `save_project_as` / `save_project` | `path` / – | path | Atomic; `.mlp` appended if missing |
| `open_project` | `path` | `ProjectFile` | Also loads image assets |
| `project_file_path` | | `string \| null` | |
| `import_artwork` | `path`, `zIndex` | `{ object, warnings }` | `.svg .dxf .png .jpg .jpeg .bmp` |
| `get_image_data_url` | `assetId` | `string \| null` | For the canvas |
| `raster_preview` | `assetId`, `params`, `maxDim` | PNG data URL | Dithered preview |
| `generate_gcode` | | `GenerateResponse` | Segments, stats, safety, warnings, estimate |
| `save_gcode` | `path` | | Last generated program |
| `list_serial_ports` | | `{name, description}[]` | |
| `machine_connect` | `port`, `baud`, `simulate` | | |
| `machine_disconnect` | | | Refused during a job |
| `machine_status` | | `GrblStatus` | Fails fast ("busy") during a job |
| `machine_jog` | `dx`, `dy`, `feed` | | **Screen** directions in mm; ≤ 1000 mm |
| `machine_home` / `machine_unlock` / `machine_set_origin` | | | `$H` / `$X` / `G10 L20 P1 X0 Y0` |
| `machine_frame` | `laserPercent` (optional) | | Traces the job extent. The laser is off unless `laserPercent` is given: then it is on at that power, 0.1 to 5 %. Refuses empty or out-of-bed |
| `machine_start` | | | Verifies safety, fingerprint, connection, single job |
| `machine_pause` / `machine_resume` / `machine_stop` | | | Real-time channel. Pause is refused when no job is running: use stop |
| `machine_send` | `line` | `string[]` | One typed command (the console box) and the reply lines. Only when a real machine is connected and no job is running; refuses laser-on, `$RST`, real-time characters and more than 80 characters (`docs/console.md`) |
| `machine_user_origin` | | `[x, y] \| null` | The stored User origin, in machine coordinates |
| `machine_clear_user_origin` | | | Forgets the stored User origin |
| `machine_set_user_origin` | | `[x, y]` | Stores the head's current machine position as the User origin and returns it. Refused while a job is running, and needs a connected machine (`docs/start-from.md`) | 
| `read_config_file` | `path` | `string` | Reads a machine or material JSON file and returns its text. Refuses a file over the size limit (`docs/config-formats.md`) | 
| `write_config_file` | `path`, `text` | | Writes a machine or material JSON file. Refuses text over the size limit |
| `boolean_paths` | `op`, `shapes` | `Path2D[]` | Shape tools: combines shapes (union, subtract, intersect or exclude). The first shape is the one worked on. The answer is empty when nothing is left. |
| `offset_paths` | `paths`, `deltaMm`, `rounded` | `Path2D[]` | Shape tools: offsets one shape outward (positive) or inward (negative); holes move the other way. |
| `import_materials` / `export_materials` | `path` (, `library`) | `MaterialLibrary` / – | JSON files |

## `GenerateResponse`

```ts
{
  gcode_preview: string;            // first 3000 lines
  line_count: number;
  segments: [x0, y0, x1, y1, kind][]; // kind 0 travel, 1 cut, 2 score, 3 fill, 4 engrave
  preview_simplified: boolean;      // true when decimated for display (> 150k moves)
  stats: { travel_mm, cut_mm, engrave_mm };
  safety: { errors: string[]; warnings: string[] };
  warnings: string[];               // objects that will not run, skipped images, ...
  estimated_seconds: number;
}
```

## Events

`job-event` with a `type` tag: `progress {done,total}`, `message {text}`, `paused`, `resumed`,
`completed`, `aborted`, `failed {message}`.
