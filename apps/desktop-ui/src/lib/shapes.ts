// Shape objects: a rectangle (with optional rounded corners), an ellipse or circle, a regular
// polygon and a star, as closed outlines in mm. Pure TypeScript (no React, Konva or Tauri imports),
// so it is unit-tested in plain Node (tests/shapes.test.ts).
//
// Every shape is built so that its outline fills the box 0..width x 0..height exactly, with the
// top-left corner at (0, 0): the same convention as traced text, so a shape is placed and sized
// like any other object. The settings it was made from are kept with the object (its `source`), so
// the shape can be edited again later.

import type { Path2D, Point2, ShapeKind, ShapeSource } from '@/types/domain';

export const SHAPE_MIN_MM = 0.1;
export const SHAPE_MAX_MM = 2000;
export const SIDES_MIN = 3;
export const SIDES_MAX = 64;
export const INNER_MIN = 0.1;
export const INNER_MAX = 0.95;

/** How far a curve may stray from the true curve, in mm. Well below what a laser can hold. */
export const CHORD_TOLERANCE_MM = 0.02;

export const SHAPE_KINDS: readonly ShapeKind[] = ['rectangle', 'ellipse', 'polygon', 'star'];

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rectangle: 'Rectangle',
  ellipse: 'Ellipse / circle',
  polygon: 'Polygon',
  star: 'Star',
};

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** A complete set of settings for a shape of this kind. */
export function defaultShape(kind: ShapeKind): ShapeSource {
  switch (kind) {
    case 'rectangle':
      return { type: 'shape', shape: kind, width_mm: 40, height_mm: 20, corner_radius_mm: 0, sides: 5, inner_ratio: 0.5 };
    case 'ellipse':
      return { type: 'shape', shape: kind, width_mm: 30, height_mm: 30, corner_radius_mm: 0, sides: 5, inner_ratio: 0.5 };
    case 'polygon':
      return { type: 'shape', shape: kind, width_mm: 30, height_mm: 30, corner_radius_mm: 0, sides: 6, inner_ratio: 0.5 };
    case 'star':
      return { type: 'shape', shape: kind, width_mm: 40, height_mm: 40, corner_radius_mm: 0, sides: 5, inner_ratio: 0.5 };
  }
}

/** Settings made safe: sizes within limits, a whole number of sides, a corner radius that fits. */
export function clampShape(src: ShapeSource): ShapeSource {
  const width = clamp(finite(src.width_mm, 20), SHAPE_MIN_MM, SHAPE_MAX_MM);
  const height = clamp(finite(src.height_mm, 20), SHAPE_MIN_MM, SHAPE_MAX_MM);
  return {
    type: 'shape',
    shape: src.shape,
    width_mm: round3(width),
    height_mm: round3(height),
    corner_radius_mm: round3(clamp(finite(src.corner_radius_mm, 0), 0, Math.min(width, height) / 2)),
    sides: Math.round(clamp(finite(src.sides, 5), SIDES_MIN, SIDES_MAX)),
    inner_ratio: round3(clamp(finite(src.inner_ratio, 0.5), INNER_MIN, INNER_MAX)),
  };
}

/** Segments needed for a quarter circle of this radius to stay within the tolerance. */
export function arcSegments(radiusMm: number, toleranceMm: number = CHORD_TOLERANCE_MM): number {
  if (!(radiusMm > toleranceMm)) return 2;
  const stepRad = 2 * Math.acos(1 - toleranceMm / radiusMm); // angle one chord may span
  return clamp(Math.ceil(Math.PI / 2 / stepRad), 2, 90);
}

/** Points on a full ellipse: a multiple of four, so the four extreme points are always present. */
export function ellipseSegments(radiusMm: number, toleranceMm: number = CHORD_TOLERANCE_MM): number {
  const raw = radiusMm > toleranceMm ? Math.ceil(Math.PI / Math.acos(1 - toleranceMm / radiusMm)) : 16;
  return clamp(Math.ceil(raw / 4) * 4, 16, 1024);
}

/** Drops a point that repeats the one before it (including the last repeating the first). */
function dedupe(points: Point2[]): Point2[] {
  const out: Point2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) out.push(p);
  }
  while (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first && last && Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6) out.pop();
    else break;
  }
  return out;
}

/** A rectangle with rounded corners (radius 0 gives sharp corners), clockwise on screen from the top edge. */
export function rectanglePoints(widthMm: number, heightMm: number, cornerRadiusMm: number): Point2[] {
  const r = Math.max(0, Math.min(cornerRadiusMm, widthMm / 2, heightMm / 2));
  if (r <= 1e-9) {
    return [
      { x: 0, y: 0 },
      { x: widthMm, y: 0 },
      { x: widthMm, y: heightMm },
      { x: 0, y: heightMm },
    ];
  }
  const n = arcSegments(r);
  const points: Point2[] = [];
  const corner = (cx: number, cy: number, startDeg: number): void => {
    for (let i = 0; i <= n; i += 1) {
      const a = ((startDeg + (90 * i) / n) * Math.PI) / 180;
      points.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  };
  corner(widthMm - r, r, -90); // top right
  corner(widthMm - r, heightMm - r, 0); // bottom right
  corner(r, heightMm - r, 90); // bottom left
  corner(r, r, 180); // top left
  return dedupe(points);
}

/** An ellipse inscribed in the box, starting at the top and running clockwise on screen. */
export function ellipsePoints(widthMm: number, heightMm: number): Point2[] {
  const rx = widthMm / 2;
  const ry = heightMm / 2;
  const n = ellipseSegments(Math.max(rx, ry));
  const points: Point2[] = [];
  for (let k = 0; k < n; k += 1) {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n;
    points.push({ x: rx + rx * Math.cos(a), y: ry + ry * Math.sin(a) });
  }
  return points;
}

/** Stretches points so their bounding box is exactly 0..width x 0..height. */
function fitToBox(raw: Point2[], widthMm: number, heightMm: number): Point2[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of raw) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const spanX = maxX - minX > 1e-12 ? maxX - minX : 1;
  const spanY = maxY - minY > 1e-12 ? maxY - minY : 1;
  return raw.map((p) => ({ x: ((p.x - minX) / spanX) * widthMm, y: ((p.y - minY) / spanY) * heightMm }));
}

const onCircle = (angleDeg: number, radius: number): Point2 => {
  const a = (angleDeg * Math.PI) / 180;
  return { x: radius * Math.cos(a), y: radius * Math.sin(a) };
};

/**
 * A regular polygon stretched to fill the box. Odd polygons point up; even ones sit with a flat
 * bottom edge, so four sides is an upright square and six is a hexagon with flat top and bottom.
 */
export function polygonPoints(widthMm: number, heightMm: number, sides: number): Point2[] {
  const n = Math.max(SIDES_MIN, Math.round(sides));
  const offset = n % 2 === 0 ? 180 / n : 0;
  const raw: Point2[] = [];
  for (let k = 0; k < n; k += 1) raw.push(onCircle(-90 + offset + (360 * k) / n, 1));
  return fitToBox(raw, widthMm, heightMm);
}

/** A star with `points` tips, the first pointing up, stretched to fill the box. `innerRatio` is the inner radius over the outer. */
export function starPoints(widthMm: number, heightMm: number, points: number, innerRatio: number): Point2[] {
  const n = Math.max(SIDES_MIN, Math.round(points));
  const raw: Point2[] = [];
  for (let k = 0; k < n; k += 1) {
    raw.push(onCircle(-90 + (360 * k) / n, 1));
    raw.push(onCircle(-90 + (360 * (k + 0.5)) / n, innerRatio));
  }
  return fitToBox(raw, widthMm, heightMm);
}

/** The closed outline of a shape, in mm, filling 0..width x 0..height. */
export function shapePaths(src: ShapeSource): Path2D[] {
  const s = clampShape(src);
  let points: Point2[];
  switch (s.shape) {
    case 'rectangle':
      points = rectanglePoints(s.width_mm, s.height_mm, s.corner_radius_mm);
      break;
    case 'ellipse':
      points = ellipsePoints(s.width_mm, s.height_mm);
      break;
    case 'polygon':
      points = polygonPoints(s.width_mm, s.height_mm, s.sides);
      break;
    case 'star':
      points = starPoints(s.width_mm, s.height_mm, s.sides, s.inner_ratio);
      break;
  }
  return [{ points: points.map((p) => ({ x: round3(p.x), y: round3(p.y) })), closed: true }];
}

/** The name a new shape gets in the Objects list. */
export function shapeName(src: ShapeSource): string {
  const s = clampShape(src);
  const square = Math.abs(s.width_mm - s.height_mm) < 0.0005;
  switch (s.shape) {
    case 'rectangle':
      if (s.corner_radius_mm > 0) return square ? 'Rounded square' : 'Rounded rectangle';
      return square ? 'Square' : 'Rectangle';
    case 'ellipse':
      return square ? 'Circle' : 'Ellipse';
    case 'polygon':
      return `Polygon (${s.sides} sides)`;
    case 'star':
      return `Star (${s.sides} points)`;
  }
}
