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
  /** Fill and Image layers: laser-off run-up and run-out past each scan line, in mm. Absent in older files, which means 0. */
  overscan_mm?: number;
  /** Fill layers: trace the edge of every closed shape once after the fill. Absent in older files, which means off. */
  fill_outline?: boolean;
  /** Score layers: power ramp length at the ends of each line, in mm. Absent in older files, which means 0. */
  ramp_mm?: number;
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

export type TextAlignment = 'left' | 'center' | 'right';

/** What a text object was made from, so it can be edited again. */
export interface TextSource {
  type: 'text';
  text: string;
  font_family: string;
  bold: boolean;
  italic: boolean;
  /** Letter height in mm. */
  cap_height_mm: number;
  align: TextAlignment;
  line_spacing: number;
}

export type ShapeKind = 'rectangle' | 'ellipse' | 'polygon' | 'star';

/** What a shape object was made from, so it can be edited again. */
export interface ShapeSource {
  type: 'shape';
  shape: ShapeKind;
  width_mm: number;
  height_mm: number;
  /** Rectangles only. */
  corner_radius_mm: number;
  /** Polygons: the number of sides. Stars: the number of points. */
  sides: number;
  /** Stars only: the inner radius over the outer, 0.1 to 0.95. */
  inner_ratio: number;
}

export type ObjectSource = TextSource | ShapeSource;

export interface VectorObjectData {
  type: 'vector';
  paths: Path2D[];
  /** Set for text and shapes made in MakerLaser: what they were made from. Absent for imported artwork and for older files. */
  source?: ObjectSource;
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

/** How MakerLaser reaches a machine. USB serial is the default; WebSocket and Telnet are for FluidNC. */
export type ConnectionKind = 'serial' | 'websocket' | 'telnet';

export interface ConnectionSettings {
  kind: ConnectionKind;
  /** Host name or IPv4 address for websocket and telnet. Ignored for serial. */
  host: string;
  /** TCP port. 0 means the usual port for the kind (81 for WebSocket, 23 for Telnet). */
  port: number;
}

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
  /** How to reach the machine. Absent in older files, which means USB serial. */
  connection?: ConnectionSettings;
}

export interface MaterialPreset {
  id: UUID;
  name: string;
  for_layer_kind: LayerKind;
  speed_mm_min: number;
  power_percent: number;
  passes: number;
  air_assist: boolean;
  /** Fill and Image presets: overscan in mm. Absent means the preset does not set it. */
  overscan_mm?: number;
  /** Fill presets: trace the edge after the fill. Absent means the preset does not set it. */
  fill_outline?: boolean;
  /** Score presets: power ramp length in mm. Absent means the preset does not set it. */
  ramp_mm?: number;
  thickness_mm: number | null;
  notes: string | null;
}

export interface MaterialLibrary {
  presets: MaterialPreset[];
}

/** Where the job is placed: on the bed, or relative to the laser head. */
export type StartFrom = 'absolute' | 'current_position' | 'user_origin';

/** Which point of the job sits on the head for the relative modes (the nine dots). */
export type JobOrigin = 'top_left' | 'top' | 'top_right' | 'left' | 'center' | 'right' | 'bottom_left' | 'bottom' | 'bottom_right';

export interface ProjectSettings {
  units: 'mm' | 'inch';
  grid_spacing_mm: number;
  show_grid: boolean;
  show_origin: boolean;
  /** false: engrave, score, then cut. true: layers run from the top of the Layers list to the bottom. */
  custom_run_order?: boolean;
  /** Where the job is placed. Absent in older projects, which means 'absolute'. */
  start_from?: StartFrom;
  /** Which point of the job sits on the head when start_from is not 'absolute'. Absent means 'bottom_left'. */
  job_origin?: JobOrigin;
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
