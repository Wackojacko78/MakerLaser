// Typed wrappers around the Rust commands in apps/rust-core. Tauri maps camelCase argument
// names here to snake_case on the Rust side.

import { invoke } from '@tauri-apps/api/core';
import type {
  GenerateResponse,
  GrblStatus,
  ImportedArtwork,
  MachineProfile,
  MaterialLibrary,
  Path2D,
  ProjectFile,
  RasterOperation,
  SerialPortInfo,
} from '@/types/domain';

export const api = {
  newProject: () => invoke<ProjectFile>('new_project'),
  machinePresets: () => invoke<MachineProfile[]>('machine_presets'),
  syncProject: (project: ProjectFile) => invoke<void>('sync_project', { project }),
  saveProjectAs: (path: string) => invoke<string>('save_project_as', { path }),
  saveProject: () => invoke<string>('save_project'),
  openProject: (path: string) => invoke<ProjectFile>('open_project', { path }),
  projectFilePath: () => invoke<string | null>('project_file_path'),
  imageDataUrl: (assetId: string) => invoke<string | null>('get_image_data_url', { assetId }),
  rasterPreview: (assetId: string, params: RasterOperation, maxDim: number) =>
    invoke<string | null>('raster_preview', { assetId, params, maxDim }),
  importArtwork: (path: string, zIndex: number) =>
    invoke<ImportedArtwork>('import_artwork', { path, zIndex }),
  generate: () => invoke<GenerateResponse>('generate_gcode'),
  saveGcode: (path: string) => invoke<void>('save_gcode', { path }),

  ports: () => invoke<SerialPortInfo[]>('list_serial_ports'),
  connect: (port: string, baud: number, simulate: boolean) =>
    invoke<void>('machine_connect', { port, baud, simulate }),
  disconnect: () => invoke<void>('machine_disconnect'),
  status: () => invoke<GrblStatus>('machine_status'),
  /** Jog in screen directions: negative `dy` moves up the screen. */
  jog: (dx: number, dy: number, feed: number) => invoke<void>('machine_jog', { dx, dy, feed }),
  home: () => invoke<void>('machine_home'),
  unlock: () => invoke<void>('machine_unlock'),
  setOrigin: () => invoke<void>('machine_set_origin'),
  /** Remembers where the head is now (machine position, mm) as the User origin for Start From. */
  setUserOrigin: () => invoke<[number, number]>('machine_set_user_origin'),
  userOrigin: () => invoke<[number, number] | null>('machine_user_origin'),
  clearUserOrigin: () => invoke<void>('machine_clear_user_origin'),
  /** Traces the job outline. A laserPercent fires the laser at that low power for the trace; null keeps it off. */
  frame: (laserPercent: number | null = null) => invoke<void>('machine_frame', { laserPercent }),
  start: () => invoke<void>('machine_start'),
  pause: () => invoke<void>('machine_pause'),
  resume: () => invoke<void>('machine_resume'),
  stop: () => invoke<void>('machine_stop'),
  /** Sends one typed command and returns the lines the controller printed back (see docs/console.md). */
  send: (line: string) => invoke<string[]>('machine_send', { line }),

  importMaterials: (path: string) => invoke<MaterialLibrary>('import_materials', { path }),
  exportMaterials: (path: string, library: MaterialLibrary) =>
    invoke<void>('export_materials', { path, library }),
  /** Plain-text .json config files (material libraries, machine profiles): see lib/configFormat.ts. */
  readConfigFile: (path: string) => invoke<string>('read_config_file', { path }),
  writeConfigFile: (path: string, text: string) => invoke<void>('write_config_file', { path, text }),
  /** Shape tools (see lib/shapeOps.ts). Paths are in workspace mm. `op` is union, subtract, intersect or exclude. */
  booleanPaths: (op: string, shapes: Path2D[][]) => invoke<Path2D[]>('boolean_paths', { op, shapes }),
  /** Offsets one shape: a positive `deltaMm` grows it, a negative one shrinks it. */
  offsetPaths: (paths: Path2D[], deltaMm: number, rounded: boolean) => invoke<Path2D[]>('offset_paths', { paths, deltaMm, rounded }),
};
