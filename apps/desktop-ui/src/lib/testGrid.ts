// Speed x power material test grid. Pure TypeScript (no React, Konva or Tauri), unit-tested
// in plain Node (tests/testGrid.test.ts).
//
// The grid is built from ordinary layers and objects, so the existing planner, preview,
// preflight and G-code pipeline run it unchanged: every square gets its OWN layer carrying
// that square's speed and power. Speed increases left to right, power increases top to bottom.
// To keep a pick for later, use "Save these settings as a preset" on that square's layer.

import type { Layer, Path2D, WorkspaceObject } from '@/types/domain';

/** Every layer created by the generator starts with this, so it can be found and removed. */
export const TEST_PREFIX = 'TEST ';
export const MAX_STEPS_PER_AXIS = 10;

export type TestGridKind = 'fill' | 'score' | 'cut';

export interface TestGridLimits {
  bedWidthMm: number;
  bedHeightMm: number;
  /** Machine maximum feed, mm/min. */
  maxFeedMmMin: number;
  /** Highest power percent a layer may use (normally 100). */
  maxPowerPercent: number;
}

export interface TestGridOptions {
  /** fill = engrave solid squares, score / cut = draw the square outlines. */
  kind: TestGridKind;
  speedStart: number; // mm/min, left column
  speedEnd: number; // mm/min, right column
  speedSteps: number;
  powerStart: number; // percent, top row
  powerEnd: number; // percent, bottom row
  powerSteps: number;
  cellMm: number; // square size
  gapMm: number; // gap between squares
  /** Workspace position (mm) of the top-left corner of the first square. */
  x: number;
  y: number;
  /** Engrave the speed (above) and power (left) values next to the squares. */
  labels: boolean;
  /** Settings of the single layer the labels are drawn on. */
  labelSpeed: number;
  labelPower: number;
  /** Fill squares only. */
  lineSpacingMm: number;
  passes: number;
  airAssist: boolean;
  /** First z_order / z_index to use, so new layers and objects sit above existing ones. */
  baseLayerZ: number;
  baseObjectZ: number;
}

export type TestGridInput = Partial<TestGridOptions> & { limits: TestGridLimits };

export const DEFAULT_TEST_GRID: TestGridOptions = {
  kind: 'fill',
  speedStart: 1000,
  speedEnd: 5000,
  speedSteps: 5,
  powerStart: 10,
  powerEnd: 50,
  powerSteps: 5,
  cellMm: 10,
  gapMm: 4,
  x: 20,
  y: 20,
  labels: true,
  labelSpeed: 1000,
  labelPower: 20,
  lineSpacingMm: 0.1,
  passes: 1,
  airAssist: false,
  baseLayerZ: 100,
  baseObjectZ: 100,
};

export interface TestGridCell {
  layerId: string;
  objectId: string;
  row: number;
  col: number;
  speedMmMin: number;
  powerPercent: number;
}

export interface TestGridResult {
  layers: Layer[];
  objects: WorkspaceObject[];
  cells: TestGridCell[];
  /** Size of the squares only (no labels). */
  widthMm: number;
  heightMm: number;
  /** Extent of everything generated, labels included. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  warnings: string[];
}

// ---- number helpers ---------------------------------------------------------------------

/** `n` evenly spaced values from `start` to `end` inclusive (just `start` when n is 1). */
export function ramp(start: number, end: number, n: number): number[] {
  if (n <= 1) return [start];
  return Array.from({ length: n }, (_, i) => start + ((end - start) * i) / (n - 1));
}

const round0 = (v: number) => Math.round(v);
const round1 = (v: number) => Math.round(v * 10) / 10;

/** "40", "12.5": no trailing zeros, so the label glyphs stay digits and one dot. */
export function formatValue(v: number): string {
  return String(Number(v.toFixed(1)));
}

// ---- stroke font for the labels ---------------------------------------------------------

const CHAR_W = 1.8; // mm
const CHAR_H = 3.0; // mm
const CHAR_GAP = 0.8; // mm between characters
const DOT_W = 0.6; // advance for '.'

type Pt = readonly [number, number];
/** Seven-segment strokes in a 1 x 2 box (Y down). */
const SEGMENTS: Record<string, readonly [Pt, Pt]> = {
  a: [[0, 0], [1, 0]],
  b: [[1, 0], [1, 1]],
  c: [[1, 1], [1, 2]],
  d: [[0, 2], [1, 2]],
  e: [[0, 1], [0, 2]],
  f: [[0, 0], [0, 1]],
  g: [[0, 1], [1, 1]],
};
const DIGIT_SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
};

/** Width in mm of `text` drawn with the label font. */
export function textWidth(text: string): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += text[i] === '.' ? DOT_W : CHAR_W;
    if (i < text.length - 1) w += CHAR_GAP;
  }
  return w;
}

export const TEXT_HEIGHT = CHAR_H;

/** Open paths (workspace mm) for `text`, its top-left corner at (left, top). */
export function textPaths(text: string, left: number, top: number): Path2D[] {
  const paths: Path2D[] = [];
  let cx = left;
  for (const ch of text) {
    if (ch === '.') {
      paths.push({
        points: [
          { x: cx + DOT_W / 2, y: top + CHAR_H },
          { x: cx + DOT_W / 2, y: top + CHAR_H - 0.5 },
        ],
        closed: false,
      });
      cx += DOT_W + CHAR_GAP;
      continue;
    }
    const segs = DIGIT_SEGMENTS[ch];
    if (!segs) throw new Error(`The label font has no glyph for '${ch}'.`);
    for (const s of segs) {
      const [p, q] = SEGMENTS[s]!;
      paths.push({
        points: [
          { x: cx + p[0] * CHAR_W, y: top + (p[1] * CHAR_H) / 2 },
          { x: cx + q[0] * CHAR_W, y: top + (q[1] * CHAR_H) / 2 },
        ],
        closed: false,
      });
    }
    cx += CHAR_W + CHAR_GAP;
  }
  return paths;
}

// ---- builders ---------------------------------------------------------------------------

const KIND_COLOR: Record<TestGridKind | 'label', string> = {
  fill: '#3DDC84',
  score: '#4D8DFF',
  cut: '#FF4D4D',
  label: '#4D8DFF',
};

function makeLayer(
  id: string,
  name: string,
  kind: 'fill' | 'score' | 'cut',
  color: string,
  z: number,
  o: { speed: number; power: number; passes: number; air: boolean; spacing: number },
): Layer {
  return {
    id,
    name,
    kind,
    speed_mm_min: o.speed,
    power_percent: o.power,
    passes: o.passes,
    air_assist: o.air,
    enabled: true,
    z_order: z,
    color,
    kerf_mm: 0,
    line_spacing_mm: o.spacing,
    fill_angle_deg: 0,
    cross_hatch: false,
    // Same defaults as RasterOperation::default() in packages/common.
    raster: {
      dpi: 254,
      dither: 'floyd_steinberg',
      direction: 'horizontal',
      bidirectional: true,
      brightness: 0,
      contrast: 0,
      gamma: 1,
      invert: false,
    },
  };
}

const defaultId = () => globalThis.crypto.randomUUID();

/** Human-readable problems with the options (empty when valid). */
export function validateTestGrid(o: TestGridOptions, limits: TestGridLimits): string[] {
  const p: string[] = [];
  const finite = (...v: number[]) => v.every((n) => Number.isFinite(n));
  if (!finite(o.speedStart, o.speedEnd, o.powerStart, o.powerEnd, o.cellMm, o.gapMm, o.x, o.y)) {
    p.push('All values must be numbers.');
    return p;
  }
  for (const [label, steps] of [['Speed', o.speedSteps], ['Power', o.powerSteps]] as const) {
    if (!Number.isInteger(steps) || steps < 1 || steps > MAX_STEPS_PER_AXIS) {
      p.push(`${label} steps must be a whole number from 1 to ${MAX_STEPS_PER_AXIS}.`);
    }
  }
  for (const [label, v] of [['Speed start', o.speedStart], ['Speed end', o.speedEnd]] as const) {
    if (!(v > 0 && v <= limits.maxFeedMmMin)) {
      p.push(`${label} ${v} mm/min is outside (0, ${limits.maxFeedMmMin}].`);
    }
  }
  for (const [label, v] of [['Power start', o.powerStart], ['Power end', o.powerEnd]] as const) {
    if (!(v > 0 && v <= limits.maxPowerPercent)) {
      p.push(`${label} ${v}% is outside (0, ${limits.maxPowerPercent}].`);
    }
  }
  if (o.speedSteps > 1 && o.speedStart === o.speedEnd) p.push('Speed start and end are equal but there is more than one speed step.');
  if (o.powerSteps > 1 && o.powerStart === o.powerEnd) p.push('Power start and end are equal but there is more than one power step.');
  if (!(o.cellMm >= 2 && o.cellMm <= 100)) p.push('Square size must be between 2 and 100 mm.');
  if (!(o.gapMm >= 0 && o.gapMm <= 50)) p.push('Gap must be between 0 and 50 mm.');
  if (!Number.isInteger(o.passes) || o.passes < 1 || o.passes > 100) p.push('Passes must be a whole number from 1 to 100.');
  if (o.kind === 'fill' && !(o.lineSpacingMm >= 0.01)) p.push('Fill line spacing must be at least 0.01 mm.');
  if (o.labels) {
    if (!(o.labelSpeed > 0 && o.labelSpeed <= limits.maxFeedMmMin)) p.push('Label speed is outside the machine limits.');
    if (!(o.labelPower > 0 && o.labelPower <= limits.maxPowerPercent)) p.push('Label power is outside the machine limits.');
  }
  return p;
}

/**
 * Builds the test grid. Does not touch any project: the caller adds `layers` and `objects`
 * (as one undo step) to the project. Throws Error with a readable message on invalid input.
 */
export function buildTestGrid(input: TestGridInput, newId: () => string = defaultId): TestGridResult {
  const { limits, ...rest } = input;
  const o: TestGridOptions = { ...DEFAULT_TEST_GRID, ...rest };
  const problems = validateTestGrid(o, limits);
  if (problems.length > 0) throw new Error(problems.join(' '));

  const speeds = ramp(o.speedStart, o.speedEnd, o.speedSteps).map(round0);
  const powers = ramp(o.powerStart, o.powerEnd, o.powerSteps).map(round1);
  const pitch = o.cellMm + o.gapMm;
  const widthMm = speeds.length * o.cellMm + (speeds.length - 1) * o.gapMm;
  const heightMm = powers.length * o.cellMm + (powers.length - 1) * o.gapMm;

  const layers: Layer[] = [];
  const objects: WorkspaceObject[] = [];
  const cells: TestGridCell[] = [];
  let z = o.baseLayerZ;
  let oz = o.baseObjectZ;

  const square: Path2D = {
    points: [
      { x: 0, y: 0 },
      { x: o.cellMm, y: 0 },
      { x: o.cellMm, y: o.cellMm },
      { x: 0, y: o.cellMm },
    ],
    closed: true,
  };

  powers.forEach((power, row) => {
    speeds.forEach((speed, col) => {
      const layerId = newId();
      const objectId = newId();
      const name = `${TEST_PREFIX}${speed} mm/min ${formatValue(power)}%`;
      layers.push(
        makeLayer(layerId, name, o.kind, KIND_COLOR[o.kind], z++, {
          speed,
          power,
          passes: o.passes,
          air: o.airAssist,
          spacing: o.lineSpacingMm,
        }),
      );
      objects.push({
        id: objectId,
        name,
        kind: { type: 'vector', paths: [{ points: square.points.map((pt) => ({ ...pt })), closed: true }] },
        transform: { a: 1, b: 0, c: 0, d: 1, e: o.x + col * pitch, f: o.y + row * pitch },
        layer_id: layerId,
        visible: true,
        locked: false,
        z_index: oz++,
      });
      cells.push({ layerId, objectId, row, col, speedMmMin: speed, powerPercent: power });
    });
  });

  let x0 = o.x;
  let y0 = o.y;
  let x1 = o.x + widthMm;
  const y1 = o.y + heightMm;

  if (o.labels) {
    const labelPaths: Path2D[] = [];
    // Speed above each column, centred on it.
    speeds.forEach((s, col) => {
      const text = String(s);
      const left = o.x + col * pitch + (o.cellMm - textWidth(text)) / 2;
      const top = o.y - 2 - TEXT_HEIGHT;
      labelPaths.push(...textPaths(text, left, top));
      y0 = Math.min(y0, top);
      x0 = Math.min(x0, left);
      x1 = Math.max(x1, left + textWidth(text));
    });
    // Power left of each row, right-aligned and vertically centred.
    powers.forEach((p, row) => {
      const text = formatValue(p);
      const left = o.x - 2 - textWidth(text);
      const top = o.y + row * pitch + (o.cellMm - TEXT_HEIGHT) / 2;
      labelPaths.push(...textPaths(text, left, top));
      x0 = Math.min(x0, left);
    });

    const labelLayerId = newId();
    layers.push(
      makeLayer(labelLayerId, `${TEST_PREFIX}labels`, 'score', KIND_COLOR.label, z++, {
        speed: o.labelSpeed,
        power: o.labelPower,
        passes: 1,
        air: false,
        spacing: o.lineSpacingMm,
      }),
    );
    objects.push({
      id: newId(),
      name: `${TEST_PREFIX}labels`,
      kind: { type: 'vector', paths: labelPaths },
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      layer_id: labelLayerId,
      visible: true,
      locked: false,
      z_index: oz++,
    });
  }

  const warnings: string[] = [];
  if (x0 < 0 || y0 < 0 || x1 > limits.bedWidthMm || y1 > limits.bedHeightMm) {
    warnings.push(
      `The test grid (${round1(x1 - x0)} x ${round1(y1 - y0)} mm) does not fit the ${limits.bedWidthMm} x ${limits.bedHeightMm} mm bed at this position. Reduce the size or move it.`,
    );
  }
  if (o.kind === 'cut') {
    warnings.push('Cut squares can cut through the material: start with low power and test on scrap.');
  }

  return { layers, objects, cells, widthMm, heightMm, bounds: { x0, y0, x1, y1 }, warnings };
}

/** Removes everything the generator created (layers named "TEST ..." and their objects). */
export function removeTestGrid<L extends { id: string; name: string }, O extends { layer_id: string | null }>(
  layers: L[],
  objects: O[],
): { layers: L[]; objects: O[]; removedLayers: number; removedObjects: number } {
  const gone = new Set(layers.filter((l) => l.name.startsWith(TEST_PREFIX)).map((l) => l.id));
  const keptObjects = objects.filter((ob) => ob.layer_id === null || !gone.has(ob.layer_id));
  return {
    layers: layers.filter((l) => !gone.has(l.id)),
    objects: keptObjects,
    removedLayers: gone.size,
    removedObjects: objects.length - keptObjects.length,
  };
}
