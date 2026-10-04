// Hand-maintained mirror of the Rust types in `packages/common`. Field names are the
// serde wire names (snake_case). Keep in sync with docs/api.md.

export type UUID = string;

export interface Point2 {
  x: number;
  y: number;
}

/** SVG-style affine matrix: x' = a*x + c*y + e ; y' = b*x + d*y + f (Y-down, mm). */
export interface Transform2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface Path2D {
  points: Point2[];
  closed: boolean;
}

export type LayerKind = 'cut' | 'score' | 'fill' | 'image';
export type DitherAlgorithm = 'none' | 'floyd_steinberg' | 'jarvis' | 'stucki' | 'atkinson';
export type ScanDirection = 'horizontal' | 'vertical';

export interface RasterOperation {
  dpi: number;
  dither: DitherAlgorithm;
  direction: ScanDirection;
  bidirectional: boolean;
  brightness: number;
  contrast: number;
  gamma: number;
  invert: boolean;
}

export interface Layer {
  id: UUID;
  name: string;
  kind: LayerKind;
  speed_mm_min: number;
  power_percent: number;
  passes: number;
  air_assist: boolean;
  enabled: boolean;
  z_order: number;
  color: string;
  kerf_mm: number;
  line_spacing_mm: number;
  fill_angle_deg: number;
  cross_hatch: boolean;
  raster: RasterOperation;
}

export interface ImageObjectData {
  type: 'image';
  asset_id: UUID;
  format: 'png' | 'jpg' | 'jpeg' | 'bmp';
  source_path: string | null;
  width_px: number;
  height_px: number;
  dpi: number;
}

export interface VectorObjectData {
  type: 'vector';
  paths: Path2D[];
}

export type ObjectKind = ImageObjectData | VectorObjectData;

export interface WorkspaceObject {
  id: UUID;
  name: string;
  kind: ObjectKind;
  transform: Transform2D;
  layer_id: UUID | null;
  visible: boolean;
  locked: boolean;
  z_index: number;
}

export type MachineOrigin = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';

export interface MachineProfile {
  id: UUID;
  name: string;
  controller: 'grbl1_1' | 'ruida' | 'galvo';
  bed_width_mm: number;
  bed_height_mm: number;
  origin: MachineOrigin;
  max_feed_rate_mm_min: number;
  max_spindle_value: number;
  homing_supported: boolean;
  air_assist_supported: boolean;
  baud_rate: number;
}

export interface MaterialPreset {
  id: UUID;
  name: string;
  for_layer_kind: LayerKind;
  speed_mm_min: number;
  power_percent: number;
  passes: number;
  air_assist: boolean;
  thickness_mm: number | null;
  notes: string | null;
}

export interface MaterialLibrary {
  presets: MaterialPreset[];
}

export interface ProjectSettings {
  units: 'mm' | 'inch';
  grid_spacing_mm: number;
  show_grid: boolean;
  show_origin: boolean;
}

export interface ProjectFile {
  schema_version: number;
  id: UUID;
  name: string;
  machine: MachineProfile;
  layers: Layer[];
  objects: WorkspaceObject[];
  materials: MaterialLibrary;
  settings: ProjectSettings;
}

// ---- command responses ------------------------------------------------------------

export interface ImportedArtwork {
  object: WorkspaceObject;
  warnings: string[];
}

export interface SafetyReport {
  errors: string[];
  warnings: string[];
}

export interface ToolpathStats {
  travel_mm: number;
  cut_mm: number;
  engrave_mm: number;
}

/** `[x0, y0, x1, y1, kind]` in workspace mm. kind: 0 travel, 1 cut, 2 score, 3 fill, 4 engrave. */
export type PreviewSegment = [number, number, number, number, number];

export interface GenerateResponse {
  gcode_preview: string;
  line_count: number;
  segments: PreviewSegment[];
  preview_simplified: boolean;
  stats: ToolpathStats;
  safety: SafetyReport;
  warnings: string[];
  estimated_seconds: number;
}

export type MachineState =
  | 'idle'
  | 'run'
  | 'hold'
  | 'jog'
  | 'alarm'
  | 'door'
  | 'check'
  | 'home'
  | 'sleep'
  | 'unknown';

export interface GrblStatus {
  state: MachineState;
  position: { x: number; y: number; z: number };
  is_machine_position: boolean;
  feed_rate_mm_min: number;
  spindle_value: number;
}

export type JobEventPayload =
  | { type: 'progress'; done: number; total: number }
  | { type: 'message'; text: string }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'completed' }
  | { type: 'aborted' }
  | { type: 'failed'; message: string };

export interface SerialPortInfo {
  name: string;
  description: string | null;
}
