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
  /** Grey level (0 to 255) at which a pixel turns white or black. Absent in older files, which means 128. */
  threshold?: number;
  /** Sharpening (0 to 100). Absent in older files, which means 0. */
  sharpen?: number;
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
  /** Cut layers: width of the tabs left uncut in every outline, in mm. Absent in older files, which means 0 (no tabs). */
  tab_width_mm?: number;
  /** Cut layers: about how far apart the tabs are, in mm of outline. Absent in older files, which means 50. */
  tab_spacing_mm?: number;
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

/** How the two handles of a node are tied together when one is dragged. Absent means corner (the handles are free). */
export type NodeMode = 'corner' | 'smooth' | 'symmetric';
/** A Bezier handle, as an offset from its node in mm. */
export interface NodeHandle {
  x: number;
  y: number;
}
/** One editable point of an outline. A segment is straight unless the node before it has an out handle or this one has an in handle. */
export interface PathNode {
  x: number;
  y: number;
  /** The handle on the side of the previous node. Absent: none. */
  in?: NodeHandle;
  /** The handle on the side of the next node. Absent: none. */
  out?: NodeHandle;
  mode?: NodeMode;
}
/** The editable form of one outline: nodes, with the same closed flag as the outline in `paths`. */
export interface NodePath {
  closed: boolean;
  nodes: PathNode[];
}
export interface VectorObjectData {
  type: 'vector';
  /** The outlines as straight segments. This is what the laser, the preview and the shape tools use. When `nodes` is present it is always the flattened form of it. */
  paths: Path2D[];
  /** Set for text and shapes made in MakerLaser: what they were made from. Absent for imported artwork and for older files. */
  source?: ObjectSource;
  /** The editable nodes of `paths` (same outlines, same order). Absent until the outlines are first edited as nodes. */
  nodes?: NodePath[];
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
  /** The fastest the machine moves, in mm/min ($110 and $111). Only the time estimate uses it. Absent: 6000 is assumed. */
  rapid_feed_mm_min?: number;
  /** How fast it speeds up and slows down, in mm/s2 ($120 and $121). Only the time estimate uses it. Absent: the estimate ignores acceleration. */
  acceleration_mm_s2?: number;
  /** GRBL's junction deviation ($11), in mm. Only the time estimate uses it. Absent: 0.01 is assumed. */
  junction_deviation_mm?: number;
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
  /** Cut presets: tab width in mm (0 is off). Absent means the preset does not set it. */
  tab_width_mm?: number;
  /** Cut presets: about how far apart the tabs are, in mm. Absent means the preset does not set it. */
  tab_spacing_mm?: number;
  /** Image presets: the grey level where a pixel turns black or white (0 to 255). Absent means the preset does not set it. */
  threshold?: number;
  /** Image presets: sharpening (0 to 100). Absent means the preset does not set it. */
  sharpen?: number;
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
  /** Fill layers: burn the filled objects nearest first. On for new projects; absent in older projects, which means off. */
  order_fills_by_distance?: boolean;
  /** Cut and Score layers: finish each part (its holes, then its outline) before the next. Absent means off. */
  cut_part_by_part?: boolean;
  /** Cut and Score layers: cut lines that lie on top of each other once. Absent means off. */
  cut_shared_lines_once?: boolean;
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
  /** How much of estimated_seconds is the laser off. Absent in a response from an older build. */
  estimated_travel_seconds?: number;
  /** True when the estimate uses the machine's acceleration. Absent in a response from an older build. */
  estimate_modelled?: boolean;
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
