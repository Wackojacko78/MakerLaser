// Measuring: snapping, point and line measurements, and selection statistics. Pure TypeScript
// (no React, Konva or Tauri imports), so everything here is unit-tested in plain Node
// (tests/measure.test.ts). The canvas only feeds it the pointer position.
//
// Coordinates are workspace millimetres (Y points down), the same ones the Selection panel shows.
// Angles are measured anticlockwise on screen from the right-hand horizontal (up is positive),
// because that is what people expect from a measuring tool.
//
// Snapping looks at the visible artwork. Vector paths are stored as points (curves are already
// flattened into short straight segments), so "a line" is one straight segment of a path. To keep
// the pointer responsive on big drawings, a path is only scanned when its bounding box is near
// the pointer, and the boxes are cached against the path objects, which are never edited in place
// (see cloneProject in projectStore.ts).

import { applyToPoint, boundsOf, imageSizeMm, unionBounds, worldBounds, type Bounds } from '@/lib/transform';
import type { ImageObjectData, ObjectKind, Path2D, Point2, Transform2D, WorkspaceObject } from '@/types/domain';

/** How close (in screen pixels) the pointer has to be to snap. */
export const SNAP_PX = 10;
/** A segment gets a midpoint snap only if it is at least this many snap radii long on screen. */
const MIDPOINT_MIN_RADII = 3;
/** Lines closer to parallel than this (degrees) are treated as parallel. */
export const PARALLEL_DEG = 0.01;
const TINY_LEN2 = 1e-12; // a segment shorter than 1 micrometre is a point

// ---- what can be picked -----------------------------------------------------------------

export type PointSnap = 'vertex' | 'midpoint' | 'centre' | 'free';

export interface MeasurePoint {
  kind: 'point';
  p: Point2;
  snap: PointSnap;
}

export interface MeasureLine {
  kind: 'line';
  a: Point2;
  b: Point2;
}

export type MeasureItem = MeasurePoint | MeasureLine;

export const freePoint = (p: Point2): MeasurePoint => ({ kind: 'point', p: { x: p.x, y: p.y }, snap: 'free' });

const finite = (p: Point2): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);
const finiteItem = (i: MeasureItem): boolean => (i.kind === 'point' ? finite(i.p) : finite(i.a) && finite(i.b));

/** A line made of one point twice is really a point. */
function normalise(i: MeasureItem): MeasureItem {
  if (i.kind === 'line') {
    const dx = i.b.x - i.a.x;
    const dy = i.b.y - i.a.y;
    if (dx * dx + dy * dy < TINY_LEN2) return { kind: 'point', p: { ...i.a }, snap: 'vertex' };
  }
  return i;
}

/** The picks after one more click: two make a measurement, a third click starts again. */
export function nextPicks(picks: readonly MeasureItem[], item: MeasureItem): MeasureItem[] {
  return picks.length < 2 ? [...picks, item] : [item];
}

/**
 * What to measure right now. Nothing picked yet: whatever is under the pointer (hover over a line
 * to read its length). One pick: the item under the pointer is the live second one.
 */
export function itemsToMeasure(picks: readonly MeasureItem[], hover: MeasureItem | null): MeasureItem[] {
  if (picks.length === 0) return hover ? [hover] : [];
  return picks.length === 1 && hover ? [picks[0] as MeasureItem, hover] : [...picks];
}

// ---- snapping ---------------------------------------------------------------------------

interface Hit {
  d2: number;
  x: number;
  y: number;
}
interface EdgeHit {
  d2: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}
interface Acc {
  cx: number;
  cy: number;
  tol2: number;
  minMid2: number;
  vertex: Hit | null;
  midpoint: Hit | null;
  centre: Hit | null;
  edge: EdgeHit | null;
}

function offerPoint(acc: Acc, kind: 'vertex' | 'midpoint' | 'centre', x: number, y: number): void {
  const dx = x - acc.cx;
  const dy = y - acc.cy;
  const d2 = dx * dx + dy * dy;
  if (!(d2 <= acc.tol2)) return; // also rejects NaN
  const cur = acc[kind];
  if (!cur || d2 < cur.d2) acc[kind] = { d2, x, y };
}

function offerSegment(acc: Acc, ax: number, ay: number, bx: number, by: number): void {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (!(len2 >= TINY_LEN2)) return; // zero length (or NaN): not a line
  let t = ((acc.cx - ax) * dx + (acc.cy - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - acc.cx;
  const ey = ay + t * dy - acc.cy;
  const d2 = ex * ex + ey * ey;
  if (d2 <= acc.tol2 && (!acc.edge || d2 < acc.edge.d2)) acc.edge = { d2, ax, ay, bx, by };
  if (len2 >= acc.minMid2) offerPoint(acc, 'midpoint', ax + dx / 2, ay + dy / 2);
}

function offerPath(acc: Acc, path: { points: readonly Point2[]; closed: boolean }, t: Transform2D): void {
  const pts = path.points;
  const n = pts.length;
  let fx = 0;
  let fy = 0;
  let px = 0;
  let py = 0;
  for (let i = 0; i < n; i++) {
    const q = pts[i] as Point2;
    const x = t.a * q.x + t.c * q.y + t.e;
    const y = t.b * q.x + t.d * q.y + t.f;
    offerPoint(acc, 'vertex', x, y);
    if (i === 0) {
      fx = x;
      fy = y;
    } else {
      offerSegment(acc, px, py, x, y);
    }
    px = x;
    py = y;
  }
  if (path.closed && n > 1) offerSegment(acc, px, py, fx, fy);
}

const pathBoundsCache = new WeakMap<Path2D, Bounds | null>();
function pathBounds(path: Path2D): Bounds | null {
  let b = pathBoundsCache.get(path);
  if (b === undefined) {
    b = boundsOf(path.points);
    pathBoundsCache.set(path, b);
  }
  return b;
}

const kindBoundsCache = new WeakMap<ObjectKind, Bounds | null>();
/** Bounds of an object's own (untransformed) geometry. */
function kindBounds(kind: ObjectKind): Bounds | null {
  let b = kindBoundsCache.get(kind);
  if (b === undefined) {
    if (kind.type === 'image') {
      const [w, h] = imageSizeMm(kind);
      b = { minX: 0, minY: 0, maxX: w, maxY: h };
    } else {
      b = null;
      for (const p of kind.paths) b = unionBounds(b, pathBounds(p));
    }
    kindBoundsCache.set(kind, b);
  }
  return b;
}

const imagePathCache = new WeakMap<ImageObjectData, Path2D>();
function imagePath(img: ImageObjectData): Path2D {
  let p = imagePathCache.get(img);
  if (!p) {
    const [w, h] = imageSizeMm(img);
    p = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ],
    };
    imagePathCache.set(img, p);
  }
  return p;
}

/** Box around the transformed corners of `b`: never smaller than the true bounds of what is inside it. */
function worldAabb(b: Bounds, t: Transform2D): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 4; i++) {
    const x = i & 1 ? b.maxX : b.minX;
    const y = i & 2 ? b.maxY : b.minY;
    const wx = t.a * x + t.c * y + t.e;
    const wy = t.b * x + t.d * y + t.f;
    if (wx < minX) minX = wx;
    if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
  }
  return { minX, minY, maxX, maxY };
}

const nearBox = (b: Bounds, x: number, y: number, tol: number): boolean =>
  x >= b.minX - tol && x <= b.maxX + tol && y >= b.minY - tol && y <= b.maxY + tol;

export interface SnapOptions {
  /** Snap radius in millimetres: SNAP_PX divided by the pixels per millimetre on screen. */
  tolMm: number;
  /** The bed, so you can measure from its corners, edges and middle. Omit to leave it out. */
  bed?: { width: number; height: number } | null;
}

/**
 * What a click at `cursor` picks. In order of preference: a vertex, the middle of a segment, the
 * centre of an object, then a whole line (the nearest segment). Anything else is a free point at
 * the cursor. Objects win over the bed when they are equally close.
 */
export function snapAt(objects: readonly WorkspaceObject[], cursor: Point2, opts: SnapOptions): MeasureItem {
  const tol = opts.tolMm;
  if (!(tol > 0) || !finite(cursor)) return freePoint(cursor);
  const acc: Acc = {
    cx: cursor.x,
    cy: cursor.y,
    tol2: tol * tol,
    minMid2: (MIDPOINT_MIN_RADII * tol) ** 2,
    vertex: null,
    midpoint: null,
    centre: null,
    edge: null,
  };
  for (const o of objects) {
    if (!o.visible) continue;
    const kb = kindBounds(o.kind);
    if (!kb || !nearBox(worldAabb(kb, o.transform), cursor.x, cursor.y, tol)) continue;
    const c = applyToPoint(o.transform, { x: (kb.minX + kb.maxX) / 2, y: (kb.minY + kb.maxY) / 2 });
    offerPoint(acc, 'centre', c.x, c.y);
    if (o.kind.type === 'image') {
      offerPath(acc, imagePath(o.kind), o.transform);
    } else {
      for (const path of o.kind.paths) {
        const pb = pathBounds(path);
        if (pb && nearBox(worldAabb(pb, o.transform), cursor.x, cursor.y, tol)) offerPath(acc, path, o.transform);
      }
    }
  }
  const bed = opts.bed;
  if (bed && bed.width > 0 && bed.height > 0) {
    const rect = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: bed.width, y: 0 },
        { x: bed.width, y: bed.height },
        { x: 0, y: bed.height },
      ],
    };
    offerPath(acc, rect, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    offerPoint(acc, 'centre', bed.width / 2, bed.height / 2);
  }
  if (acc.vertex) return { kind: 'point', p: { x: acc.vertex.x, y: acc.vertex.y }, snap: 'vertex' };
  if (acc.midpoint) return { kind: 'point', p: { x: acc.midpoint.x, y: acc.midpoint.y }, snap: 'midpoint' };
  if (acc.centre) return { kind: 'point', p: { x: acc.centre.x, y: acc.centre.y }, snap: 'centre' };
  if (acc.edge) return { kind: 'line', a: { x: acc.edge.ax, y: acc.edge.ay }, b: { x: acc.edge.bx, y: acc.edge.by } };
  return freePoint(cursor);
}

// ---- geometry ---------------------------------------------------------------------------

export const distance = (a: Point2, b: Point2): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Direction from `a` to `b`, anticlockwise from the right (up is positive), in [0, 360). */
export function directedAngleDeg(a: Point2, b: Point2): number {
  const deg = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI;
  const n = ((deg % 360) + 360) % 360;
  return n >= 360 ? 0 : n;
}

/** Direction of a line, which has no front or back: in [0, 180). */
export function lineAngleDeg(a: Point2, b: Point2): number {
  const n = directedAngleDeg(a, b) % 180;
  return n >= 180 ? 0 : n;
}

/** Angle between two lines, the acute one: in [0, 90]. */
export function acuteAngleDeg(a1: Point2, b1: Point2, a2: Point2, b2: Point2): number {
  const x1 = b1.x - a1.x;
  const y1 = b1.y - a1.y;
  const x2 = b2.x - a2.x;
  const y2 = b2.y - a2.y;
  const cross = Math.abs(x1 * y2 - y1 * x2);
  const dot = Math.abs(x1 * x2 + y1 * y2);
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

export interface PointToLine {
  /** Where the perpendicular from the point meets the (infinitely extended) line. */
  foot: Point2;
  /** Distance from the point to the extended line. */
  perpendicular: number;
  /** Whether `foot` lies on the segment itself rather than past one of its ends. */
  footOnSegment: boolean;
  /** Distance from the point to the nearest point of the segment itself. */
  nearestDistance: number;
}

export function pointToLine(p: Point2, a: Point2, b: Point2): PointToLine {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 < TINY_LEN2 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const foot = { x: a.x + t * dx, y: a.y + t * dy };
  const tc = t < 0 ? 0 : t > 1 ? 1 : t;
  const near = { x: a.x + tc * dx, y: a.y + tc * dy };
  return {
    foot,
    perpendicular: distance(p, foot),
    footOnSegment: t >= -1e-9 && t <= 1 + 1e-9,
    nearestDistance: distance(p, near),
  };
}

export interface SegmentPair {
  /** Nearest point on the first segment. */
  p: Point2;
  /** Nearest point on the second segment. */
  q: Point2;
  distance: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The shortest distance between two segments, and the two points that give it (zero if they cross). */
export function closestPointsOfSegments(p1: Point2, q1: Point2, p2: Point2, q2: Point2): SegmentPair {
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;
  const rx = p1.x - p2.x;
  const ry = p1.y - p2.y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  let s: number;
  let t: number;
  if (a <= TINY_LEN2 && e <= TINY_LEN2) {
    s = 0;
    t = 0;
  } else if (a <= TINY_LEN2) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= TINY_LEN2) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom > 1e-12 * a * e ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const p = { x: p1.x + d1x * s, y: p1.y + d1y * s };
  const q = { x: p2.x + d2x * t, y: p2.y + d2y * t };
  return { p, q, distance: distance(p, q) };
}

// ---- measurements -----------------------------------------------------------------------

type Pair = [Point2, Point2];

export type Measurement =
  | { type: 'point'; p: Point2; guide: null; extension: null }
  | { type: 'line'; a: Point2; b: Point2; length: number; dx: number; dy: number; angleDeg: number; guide: Pair; extension: null }
  | { type: 'point-point'; distance: number; dx: number; dy: number; angleDeg: number; guide: Pair; extension: null }
  | {
      type: 'point-line';
      /** Distance from the point to the extended line. */
      perpendicular: number;
      footOnSegment: boolean;
      /** Distance from the point to the nearest point of the segment itself. */
      nearestDistance: number;
      foot: Point2;
      guide: Pair;
      /** The dashed continuation of the line out to the foot, when the foot is past an end. */
      extension: Pair | null;
    }
  | {
      type: 'line-line';
      /** The acute angle between them, 0 to 90. */
      angleDeg: number;
      parallel: boolean;
      /** Shortest distance between the two segments (0 when they cross). */
      distance: number;
      /** For parallel lines: the gap between them, measured at right angles. */
      perpendicular: number | null;
      intersects: boolean;
      intersection: Point2 | null;
      /** The shortest connecting line, or null where the lines cross. */
      guide: Pair | null;
      extension: null;
    };

/** The measurement for the picked items (nothing for none, a position or length for one, a relationship for two). */
export function measure(items: readonly MeasureItem[]): Measurement | null {
  if (items.length === 0 || items.length > 2) return null;
  if (!items.every(finiteItem)) return null;
  const [first, second] = items.map(normalise) as [MeasureItem, MeasureItem | undefined];

  if (!second) {
    if (first.kind === 'point') return { type: 'point', p: first.p, guide: null, extension: null };
    const dx = first.b.x - first.a.x;
    const dy = first.b.y - first.a.y;
    return {
      type: 'line',
      a: first.a,
      b: first.b,
      length: Math.hypot(dx, dy),
      dx,
      dy,
      angleDeg: lineAngleDeg(first.a, first.b),
      guide: [first.a, first.b],
      extension: null,
    };
  }

  // a point always comes first
  const [x, y] = first.kind === 'line' && second.kind === 'point' ? [second, first] : [first, second];

  if (x.kind === 'point' && y.kind === 'point') {
    return {
      type: 'point-point',
      distance: distance(x.p, y.p),
      dx: y.p.x - x.p.x,
      dy: y.p.y - x.p.y,
      angleDeg: directedAngleDeg(x.p, y.p),
      guide: [x.p, y.p],
      extension: null,
    };
  }

  if (x.kind === 'point' && y.kind === 'line') {
    const r = pointToLine(x.p, y.a, y.b);
    let extension: Pair | null = null;
    if (!r.footOnSegment) {
      const nearEnd = distance(r.foot, y.a) < distance(r.foot, y.b) ? y.a : y.b;
      extension = [nearEnd, r.foot];
    }
    return {
      type: 'point-line',
      perpendicular: r.perpendicular,
      footOnSegment: r.footOnSegment,
      nearestDistance: r.nearestDistance,
      foot: r.foot,
      guide: [x.p, r.foot],
      extension,
    };
  }

  // two lines
  const l1 = x as MeasureLine;
  const l2 = y as MeasureLine;
  const angleDeg = acuteAngleDeg(l1.a, l1.b, l2.a, l2.b);
  const pair = closestPointsOfSegments(l1.a, l1.b, l2.a, l2.b);
  const parallel = angleDeg < PARALLEL_DEG;
  const intersects = !parallel && pair.distance < 1e-9;
  if (parallel) {
    const mid = { x: (l1.a.x + l1.b.x) / 2, y: (l1.a.y + l1.b.y) / 2 };
    const r = pointToLine(mid, l2.a, l2.b);
    return {
      type: 'line-line',
      angleDeg,
      parallel: true,
      distance: pair.distance,
      perpendicular: r.perpendicular,
      intersects: false,
      intersection: null,
      guide: [mid, r.foot],
      extension: null,
    };
  }
  return {
    type: 'line-line',
    angleDeg,
    parallel: false,
    distance: pair.distance,
    perpendicular: null,
    intersects,
    intersection: intersects ? pair.p : null,
    guide: intersects ? null : [pair.p, pair.q],
    extension: null,
  };
}

// ---- words ------------------------------------------------------------------------------

export type Units = 'mm' | 'inch';

/** "12.34 mm", or "0.486 in" when the project is in inches. Never "-0.00". */
export function formatLength(mm: number, units: Units = 'mm'): string {
  if (!Number.isFinite(mm)) return '\u2014';
  const digits = units === 'inch' ? 3 : 2;
  const v = units === 'inch' ? mm / 25.4 : mm;
  const r = Number(v.toFixed(digits));
  return `${(Object.is(r, -0) ? 0 : r).toFixed(digits)} ${units === 'inch' ? 'in' : 'mm'}`;
}

/** "33.3\u00b0", one decimal. */
export function formatAngle(deg: number): string {
  if (!Number.isFinite(deg)) return '\u2014';
  const r = Math.round(deg * 10) / 10;
  return `${(r >= 360 ? 0 : r).toFixed(1)}\u00b0`;
}

export interface MeasureRow {
  label: string;
  value: string;
}

/** The lines of the readout panel. */
export function measurementRows(m: Measurement, units: Units = 'mm'): MeasureRow[] {
  const len = (v: number) => formatLength(v, units);
  switch (m.type) {
    case 'point':
      return [
        { label: 'X', value: len(m.p.x) },
        { label: 'Y', value: len(m.p.y) },
      ];
    case 'line':
      return [
        { label: 'Length', value: len(m.length) },
        { label: '\u0394X', value: len(m.dx) },
        { label: '\u0394Y', value: len(m.dy) },
        { label: 'Angle', value: formatAngle(m.angleDeg) },
      ];
    case 'point-point':
      return [
        { label: 'Distance', value: len(m.distance) },
        { label: '\u0394X', value: len(m.dx) },
        { label: '\u0394Y', value: len(m.dy) },
        { label: 'Angle', value: formatAngle(m.angleDeg) },
      ];
    case 'point-line': {
      const rows: MeasureRow[] = [{ label: 'Distance to the line', value: len(m.perpendicular) }];
      if (!m.footOnSegment) {
        rows.push({ label: 'To the nearest end', value: len(m.nearestDistance) });
        rows.push({ label: 'Note', value: 'beyond the end of the line' });
      }
      return rows;
    }
    case 'line-line': {
      const rows: MeasureRow[] = [{ label: 'Angle between', value: formatAngle(m.angleDeg) }];
      if (m.parallel && m.perpendicular !== null) {
        rows.unshift({ label: 'Gap between lines', value: len(m.perpendicular) });
        if (Math.abs(m.distance - m.perpendicular) > 1e-6) rows.push({ label: 'Closest ends', value: len(m.distance) });
      } else if (m.intersects && m.intersection) {
        rows.push({ label: 'Cross at X', value: len(m.intersection.x) });
        rows.push({ label: 'Cross at Y', value: len(m.intersection.y) });
      } else {
        rows.unshift({ label: 'Shortest distance', value: len(m.distance) });
      }
      return rows;
    }
  }
}

/** The short text drawn on the canvas beside the measurement. */
export function measurementLabel(m: Measurement, units: Units = 'mm'): string {
  const len = (v: number) => formatLength(v, units);
  switch (m.type) {
    case 'point':
      return `X ${len(m.p.x)}  Y ${len(m.p.y)}`;
    case 'line':
      return len(m.length);
    case 'point-point':
      return len(m.distance);
    case 'point-line':
      return len(m.perpendicular);
    case 'line-line':
      if (m.parallel && m.perpendicular !== null) return len(m.perpendicular);
      if (m.intersects) return `\u2220 ${formatAngle(m.angleDeg)}`;
      return `${len(m.distance)}  \u2220 ${formatAngle(m.angleDeg)}`;
  }
}

// ---- selection --------------------------------------------------------------------------

/** Length of a path after the transform. A closed path includes its closing edge. */
export function pathLength(path: Path2D, t: Transform2D): number {
  const pts = path.points;
  const n = pts.length;
  if (n < 2) return 0;
  let total = 0;
  let prev = applyToPoint(t, pts[0] as Point2);
  const first = prev;
  for (let i = 1; i < n; i++) {
    const cur = applyToPoint(t, pts[i] as Point2);
    total += distance(prev, cur);
    prev = cur;
  }
  if (path.closed) total += distance(prev, first);
  return total;
}

export interface SelectionStats {
  count: number;
  vectorCount: number;
  imageCount: number;
  bounds: Bounds | null;
  width: number;
  height: number;
  /** Corner to corner of the bounding box. */
  diagonal: number;
  /** Total length of every vector outline (the length of cut or score line it would make). Null when nothing is a vector. */
  outlineLength: number | null;
}

export function selectionStats(objects: readonly WorkspaceObject[]): SelectionStats {
  let bounds: Bounds | null = null;
  let length = 0;
  let vectors = 0;
  let images = 0;
  for (const o of objects) {
    bounds = unionBounds(bounds, worldBounds(o));
    if (o.kind.type === 'image') {
      images++;
    } else {
      vectors++;
      for (const p of o.kind.paths) length += pathLength(p, o.transform);
    }
  }
  const width = bounds ? bounds.maxX - bounds.minX : 0;
  const height = bounds ? bounds.maxY - bounds.minY : 0;
  return {
    count: objects.length,
    vectorCount: vectors,
    imageCount: images,
    bounds,
    width,
    height,
    diagonal: Math.hypot(width, height),
    outlineLength: vectors > 0 ? length : null,
  };
}
