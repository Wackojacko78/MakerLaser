// Drawing shapes and typing text straight onto the canvas: the pure helpers behind it. No React,
// Konva or Tauri imports, so everything here is unit-tested in plain Node (tests/inlineEdit.test.ts).
//
// All positions and sizes are in workspace millimetres unless a name says "client" (screen pixels).

import { makeTextSource, textObjectName, type LaserMode, type TextForm } from '@/lib/objectEdit';
import {
  INNER_MAX,
  INNER_MIN,
  SHAPE_MIN_MM,
  clampShape,
  shapeName,
  shapePaths,
} from '@/lib/shapes';
import type { Bounds } from '@/lib/transform';
import type { Layer, Path2D, ShapeKind, ShapeSource, UUID, WorkspaceObject } from '@/types/domain';

export interface Point {
  x: number;
  y: number;
}

/** A box in mm: the top-left corner and the size. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A rectangle in screen pixels. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The drawing tools: one per shape, and Text. */
export type DrawTool = ShapeKind | 'text';

/** A drag in progress with a drawing tool: where it started and where the pointer is now. */
export interface Draft {
  tool: DrawTool;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Shift is held: keep the shape square (a circle, for an ellipse). */
  square: boolean;
}

/** A drag shorter than this many screen pixels is a click. */
export const DRAG_THRESHOLD_PX = 4;

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

// ---- drawing with the mouse ---------------------------------------------------------------

/** True when the pointer has moved far enough from where it went down to count as a drag. */
export function isDragGesture(a: Point, b: Point, pxPerMm: number, thresholdPx: number = DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) * pxPerMm >= thresholdPx;
}

/**
 * The box a drag from `a` to `b` draws, whichever way it was dragged. Sizes are rounded to 0.1 mm so
 * a dragged shape has clean numbers. `square` makes the two sides equal, using the longer one.
 */
export function gestureBox(a: Point, b: Point, square: boolean): Box {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (square) {
    const longest = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * longest;
    dy = (dy < 0 ? -1 : 1) * longest;
  }
  const w = Math.max(SHAPE_MIN_MM, round1(Math.abs(dx)));
  const h = Math.max(SHAPE_MIN_MM, round1(Math.abs(dy)));
  return { x: round1(dx < 0 ? a.x - w : a.x), y: round1(dy < 0 ? a.y - h : a.y), w, h };
}

/** A box of the given size centred on a point: where a plain click puts a default-sized shape. */
export function centredBox(centre: Point, w: number, h: number): Box {
  return { x: round1(centre.x - w / 2), y: round1(centre.y - h / 2), w, h };
}

/** Moves a box so it lies on the bed. A box bigger than the bed is lined up with the top-left corner. */
export function placeInside(box: Box, bed: { width: number; height: number }): Box {
  const fit = (pos: number, size: number, room: number): number => {
    const max = room - size;
    return max <= 0 ? 0 : Math.min(Math.max(pos, 0), max);
  };
  return { ...box, x: fit(box.x, box.w, bed.width), y: fit(box.y, box.h, bed.height) };
}

/** The live label shown next to a shape while it is dragged out. */
export function dimensionLabel(w: number, h: number): string {
  return `${round2(w)} \u00d7 ${round2(h)} mm`;
}

// ---- typing numbers -----------------------------------------------------------------------

const MAX_EXPRESSION_CHARS = 64;

/**
 * Reads what was typed into a size box: a plain number, or a small sum such as "12.5*2" or
 * "(40-4)/3". Numbers, + - * / and brackets only, and nothing is ever run as code. Returns null for
 * anything else, for an unfinished sum ("10+"), and for a result that is not a finite number.
 */
export function evalExpression(raw: string): number | null {
  // Two numbers with only a space between them ("5 5") are a mistake, not 55.
  if (/[\d.]\s+[\d.]/.test(raw.trim())) return null;
  const s = raw.replace(/\s+/g, '');
  if (s === '' || s.length > MAX_EXPRESSION_CHARS) return null;
  let i = 0;

  const number = (): number | null => {
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const factor = (): number | null => {
    const c = s[i];
    if (c === '+') {
      i += 1;
      return factor();
    }
    if (c === '-') {
      i += 1;
      const v = factor();
      return v === null ? null : -v;
    }
    if (c === '(') {
      i += 1;
      const v = sum();
      if (v === null || s[i] !== ')') return null;
      i += 1;
      return v;
    }
    return number();
  };
  const product = (): number | null => {
    let v = factor();
    while (v !== null && (s[i] === '*' || s[i] === '/')) {
      const op = s[i];
      i += 1;
      const r = factor();
      if (r === null) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  function sum(): number | null {
    let v = product();
    while (v !== null && (s[i] === '+' || s[i] === '-')) {
      const op = s[i];
      i += 1;
      const r = product();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  const result = sum();
  return result !== null && i === s.length && Number.isFinite(result) ? result : null;
}

/** A number as it is shown in a size box: at most three decimals, no trailing zeros. */
export function formatNumber(v: number): string {
  return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '';
}

/**
 * Tab and Shift+Tab inside a floating editor go round in a circle instead of leaving it. Given the
 * index of the field that has focus, returns the index to move to when the circle has to wrap, or
 * null when the browser's own Tab does the right thing.
 */
export function wrapTab(index: number, count: number, backwards: boolean): number | null {
  if (count <= 0) return null;
  if (!backwards && index === count - 1) return 0;
  if (backwards && index <= 0) return count - 1;
  return null;
}

// ---- where the floating editor goes -----------------------------------------------------------

/** Screen position of a workspace-mm bounding box, given the pan and zoom and where the canvas sits. */
export function boundsToClientRect(
  b: Bounds,
  view: { x: number; y: number; scale: number },
  origin: { left: number; top: number },
  pxPerMm: number,
): Rect {
  const k = pxPerMm * view.scale;
  return {
    left: origin.left + view.x + b.minX * k,
    top: origin.top + view.y + b.minY * k,
    width: (b.maxX - b.minX) * k,
    height: (b.maxY - b.minY) * k,
  };
}

/**
 * Where to put a floating editor of a known size next to an object: below it if there is room,
 * otherwise above it, otherwise along the bottom of the canvas, and never outside the canvas.
 */
export function overlayPlacement(
  anchor: Rect,
  overlay: { width: number; height: number },
  container: Rect,
  gap = 8,
): { left: number; top: number } {
  const bottom = container.top + container.height;
  let top = anchor.top + anchor.height + gap;
  if (top + overlay.height > bottom) {
    const above = anchor.top - gap - overlay.height;
    top = above >= container.top ? above : bottom - overlay.height - gap;
  }
  top = Math.max(container.top + gap, top);
  const maxLeft = container.left + container.width - overlay.width - gap;
  const left = maxLeft < container.left + gap ? container.left + gap : Math.min(Math.max(anchor.left, container.left + gap), maxLeft);
  return { left, top };
}

// ---- the size boxes of each shape ---------------------------------------------------------------

export type FieldKey = 'width_mm' | 'height_mm' | 'corner_radius_mm' | 'sides' | 'inner_percent';

export interface FieldSpec {
  key: FieldKey;
  label: string;
  unit: string;
}

const WIDTH: FieldSpec = { key: 'width_mm', label: 'W', unit: 'mm' };
const HEIGHT: FieldSpec = { key: 'height_mm', label: 'H', unit: 'mm' };

/** The boxes shown for a kind of shape, in Tab order. */
export function shapeFields(kind: ShapeKind): FieldSpec[] {
  switch (kind) {
    case 'rectangle':
      return [WIDTH, HEIGHT, { key: 'corner_radius_mm', label: 'Radius', unit: 'mm' }];
    case 'ellipse':
      return [WIDTH, HEIGHT];
    case 'polygon':
      return [WIDTH, HEIGHT, { key: 'sides', label: 'Sides', unit: '' }];
    case 'star':
      return [
        WIDTH,
        HEIGHT,
        { key: 'sides', label: 'Points', unit: '' },
        { key: 'inner_percent', label: 'Inner', unit: '%' },
      ];
  }
}

/** The number a size box shows for a shape. */
export function readShapeField(source: ShapeSource, key: FieldKey): number {
  switch (key) {
    case 'width_mm':
      return source.width_mm;
    case 'height_mm':
      return source.height_mm;
    case 'corner_radius_mm':
      return source.corner_radius_mm;
    case 'sides':
      return source.sides;
    case 'inner_percent':
      return Math.round(source.inner_ratio * 100);
  }
}

/** The shape with one box changed. The result is always valid: out-of-range numbers are pulled back. */
export function patchShape(source: ShapeSource, key: FieldKey, value: number): ShapeSource {
  switch (key) {
    case 'width_mm':
      return clampShape({ ...source, width_mm: value });
    case 'height_mm':
      return clampShape({ ...source, height_mm: value });
    case 'corner_radius_mm':
      return clampShape({ ...source, corner_radius_mm: value });
    case 'sides':
      return clampShape({ ...source, sides: value });
    case 'inner_percent':
      return clampShape({ ...source, inner_ratio: Math.min(INNER_MAX, Math.max(INNER_MIN, value / 100)) });
  }
}

/** The same shape settings as a different kind of shape (the size is kept). */
export function changeShapeKind(source: ShapeSource, kind: ShapeKind): ShapeSource {
  return clampShape({ ...source, shape: kind });
}

// ---- making the objects -----------------------------------------------------------------------------

/** Everything needed to build a new object that does not come from the drawing itself. */
export interface NewObjectContext {
  id: UUID;
  layers: readonly Layer[];
  nextZ: number;
  bed: { width: number; height: number };
  /** Layers whose name starts with this are test-grid layers and are never chosen. */
  testPrefix: string;
}

/** The first layer for a laser mode that is not a test-grid layer, or null when there is none. */
export function pickLayerId(layers: readonly Layer[], mode: LaserMode, testPrefix: string): UUID | null {
  return layers.find((l) => l.kind === mode && !l.name.startsWith(testPrefix))?.id ?? null;
}

const at = (x: number, y: number) => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });

/**
 * A new shape object with its top-left corner at `topLeft`. With `keepOnBed` (a click) it is moved
 * onto the bed if it would hang off the edge; a dragged shape stays exactly where it was drawn.
 */
export function buildShapeObject(
  source: ShapeSource,
  topLeft: Point,
  ctx: NewObjectContext,
  keepOnBed: boolean,
  mode: LaserMode = 'score',
): WorkspaceObject {
  const s = clampShape(source);
  const box = { x: topLeft.x, y: topLeft.y, w: s.width_mm, h: s.height_mm };
  const placed = keepOnBed ? placeInside(box, ctx.bed) : box;
  return {
    id: ctx.id,
    name: shapeName(s),
    kind: { type: 'vector', paths: shapePaths(s), source: s },
    transform: at(placed.x, placed.y),
    layer_id: pickLayerId(ctx.layers, mode, ctx.testPrefix),
    visible: true,
    locked: false,
    z_index: ctx.nextZ,
  };
}

/** What the text renderer gives back: outlines in mm with the top-left of the text at (0, 0). */
export interface RenderedText {
  paths: Path2D[];
  widthMm: number;
  heightMm: number;
}

export type TextForm0 = Omit<TextForm, 'mode'>;

/** A renderer turns the typed settings into outlines, or null when there is nothing to draw. */
export type TextRenderer = (form: TextForm0) => RenderedText | null;

/** The settings a new text object starts with. */
export function defaultTextForm(fontFamily: string): TextForm0 {
  return { text: 'Text', fontFamily, bold: false, italic: false, capHeight: '10', align: 'left', lineSpacing: '1.2' };
}

/** A new text object with its top-left corner at `topLeft` (moved onto the bed if needed), or null if nothing can be drawn. */
export function buildTextObject(
  form: TextForm0,
  topLeft: Point,
  ctx: NewObjectContext,
  render: TextRenderer,
): WorkspaceObject | null {
  const shape = render(form);
  if (!shape) return null;
  const source = makeTextSource(form);
  const placed = placeInside({ x: topLeft.x, y: topLeft.y, w: shape.widthMm, h: shape.heightMm }, ctx.bed);
  return {
    id: ctx.id,
    name: textObjectName(source.text),
    kind: { type: 'vector', paths: shape.paths, source },
    transform: at(placed.x, placed.y),
    layer_id: pickLayerId(ctx.layers, 'fill', ctx.testPrefix),
    visible: true,
    locked: false,
    z_index: ctx.nextZ,
  };
}
