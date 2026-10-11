// Rounding (fillet) and cutting off (chamfer) the corners of shapes. Pure TypeScript (no React, Konva or
// Tauri imports), so it is unit-tested in plain Node (tests/corners.test.ts).
//
// A shape is a closed outline of straight segments (curves are already flattened into short segments), so
// a "corner" is a point where the outline turns. Three settings choose which corners change:
//   * how much the outline turns there: a square corner turns it by 90 degrees, a point on a smooth curve
//     by a few degrees, so a minimum turn keeps curves from being treated as corners;
//   * which kind: outside corners (sticking out) or inside corners (notches), worked out from which
//     outlines lie inside which, not from the direction each was drawn in (the same rule as shape_ops.rs);
//   * the size: a fillet's radius, or the length a chamfer cuts along each edge.
// Where the edges next to a corner are too short for the size asked for, that corner is made smaller
// rather than overlapping its neighbour. Everything is in workspace millimetres. Nothing here changes
// what it is given.
import { hasLoosePaths, worldShapePaths } from '@/lib/shapeOps';
import { CHORD_TOLERANCE_MM } from '@/lib/shapes';
import type { Path2D, Point2, WorkspaceObject } from '@/types/domain';

export type CornerStyle = 'round' | 'chamfer';
export type CornerWhich = 'all' | 'outside' | 'inside';

export const CORNER_WHICH: readonly CornerWhich[] = ['all', 'outside', 'inside'];
export const CORNER_WHICH_LABELS: Record<CornerWhich, string> = {
  all: 'All corners',
  outside: 'Outside corners (sticking out)',
  inside: 'Inside corners (notches)',
};

/** Which corners change: the ones that turn the outline by at least `minTurnDeg`, of the kind chosen. */
export interface CornerFilter {
  minTurnDeg: number;
  which: CornerWhich;
}

export interface CornerOptions extends CornerFilter {
  style: CornerStyle;
  /** A fillet's radius, or how far a chamfer cuts along each of the two edges, in mm. */
  sizeMm: number;
}

export const DEFAULT_CORNER_SIZE_MM = 3;
export const DEFAULT_MIN_TURN_DEG = 30;
export const MAX_CORNER_MM = 500;
export const MIN_TURN_DEG = 1;
export const MAX_TURN_DEG = 179;
/** One shape may have at most this many outlines and points: working out which outline is inside which grows fast. */
export const MAX_CORNER_PATHS = 5_000;
export const MAX_CORNER_POINTS = 200_000;

/** A bend this sharp is a spike that doubles back on itself, not a corner. */
const SPIKE_TURN_RAD = (179.5 * Math.PI) / 180;
/** A corner that could only be changed by less than this many mm is left alone. */
const MIN_LEG_MM = 1e-4;
const MAX_ARC_SEGMENTS = 720;
const SAME_POINT_MM = 1e-9;

const trimNumber = (v: number): string => String(Number(v.toFixed(3)));

/** Problems with the settings typed in the panel (empty when fine). */
export function validateCornerOptions(o: { sizeMm: number; minTurnDeg: number }): string[] {
  const problems: string[] = [];
  if (!Number.isFinite(o.sizeMm) || o.sizeMm <= 0) problems.push('The size must be more than 0.');
  else if (o.sizeMm > MAX_CORNER_MM) problems.push(`The size can be at most ${MAX_CORNER_MM} mm.`);
  if (!Number.isFinite(o.minTurnDeg) || o.minTurnDeg < MIN_TURN_DEG || o.minTurnDeg > MAX_TURN_DEG) {
    problems.push(`"Skip bends gentler than" must be from ${MIN_TURN_DEG} to ${MAX_TURN_DEG} degrees.`);
  }
  return problems;
}

// ---- which outline is inside which --------------------------------------------------------------

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boxOf(points: readonly Point2[]): Box | null {
  let box: Box | null = null;
  for (const p of points) {
    if (!box) box = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    else {
      if (p.x < box.minX) box.minX = p.x;
      if (p.y < box.minY) box.minY = p.y;
      if (p.x > box.maxX) box.maxX = p.x;
      if (p.y > box.maxY) box.maxY = p.y;
    }
  }
  return box;
}

function pointInPolygon(poly: readonly Point2[], p: Point2): boolean {
  let inside = false;
  let j = poly.length - 1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    j = i;
  }
  return inside;
}

/**
 * How many other outlines each outline lies inside: 0 for an outer outline, 1 for a hole in it, 2 for an
 * island in that hole, and so on. An outline is "inside" another when its box fits within the other's box
 * and its first point lies inside the other outline.
 */
export function nestingDepths(rings: readonly (readonly Point2[])[]): number[] {
  const boxes = rings.map((r) => boxOf(r));
  return rings.map((ring, i) => {
    const inner = boxes[i];
    const probe = ring[0];
    if (!inner || !probe) return 0;
    let depth = 0;
    for (let j = 0; j < rings.length; j++) {
      const outer = boxes[j];
      const other = rings[j];
      if (j === i || !outer || !other) continue;
      if (outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY && pointInPolygon(other, probe)) {
        depth++;
      }
    }
    return depth;
  });
}

// ---- reading the corners of an outline ----------------------------------------------------------

/** The outline without repeated points (a last point that repeats the first is dropped too). */
function clean(points: readonly Point2[]): Point2[] {
  const out: Point2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > SAME_POINT_MM) out.push(p);
  }
  while (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (Math.hypot(first.x - last.x, first.y - last.y) <= SAME_POINT_MM) out.pop();
    else break;
  }
  return out;
}

function signedArea(points: readonly Point2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

interface Vertex {
  /** True when this corner is to be changed. */
  selected: boolean;
  /** How far the outline turns here, in radians: 0 is straight on, pi is a U-turn. */
  turn: number;
  /** Positive when the outline turns one way, negative the other. */
  cross: number;
  /** The unit direction of the edge arriving here and of the edge leaving. */
  d1: Point2;
  d2: Point2;
}

interface Analysis {
  points: Point2[];
  /** The length of the edge from point i to point i + 1. */
  lengths: number[];
  vertices: Vertex[];
}

const filterTurnRad = (f: CornerFilter): number => {
  const deg = Number.isFinite(f.minTurnDeg) ? Math.min(MAX_TURN_DEG, Math.max(MIN_TURN_DEG, f.minTurnDeg)) : DEFAULT_MIN_TURN_DEG;
  return (deg * Math.PI) / 180;
};

/** Reads every corner of one closed outline. `oddDepth` is true for a hole (or an island in a hole's hole...). */
function analyse(raw: readonly Point2[], oddDepth: boolean, f: CornerFilter): Analysis | null {
  const points = clean(raw);
  const n = points.length;
  if (n < 3) return null;
  const area = signedArea(points);
  if (!(Math.abs(area) > 1e-12)) return null;
  const minTurn = filterTurnRad(f);
  const lengths: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % n]!;
    lengths.push(Math.hypot(q.x - p.x, q.y - p.y));
  }
  const vertices: Vertex[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i + n - 1) % n]!;
    const cur = points[i]!;
    const next = points[(i + 1) % n]!;
    const la = lengths[(i + n - 1) % n]!;
    const lb = lengths[i]!;
    const ax = (cur.x - prev.x) / la;
    const ay = (cur.y - prev.y) / la;
    const bx = (next.x - cur.x) / lb;
    const by = (next.y - cur.y) / lb;
    const cross = ax * by - ay * bx;
    const dot = ax * bx + ay * by;
    const turn = Math.atan2(Math.abs(cross), dot);
    // Convex for this outline when it turns the way the outline goes round. For the material it is the
    // same for an outer outline and the opposite for a hole.
    const convexForOutline = cross * area > 0;
    const convexForMaterial = convexForOutline !== oddDepth;
    const kind = f.which === 'all' || (f.which === 'outside' ? convexForMaterial : !convexForMaterial);
    vertices.push({ selected: kind && turn >= minTurn - 1e-9 && turn <= SPIKE_TURN_RAD, turn, cross, d1: { x: ax, y: ay }, d2: { x: bx, y: by } });
  }
  return { points, lengths, vertices };
}

/** The closed outlines worth working on, cleaned, and how deep each lies (0 when the kind of corner does not matter). */
function prepare(paths: readonly Path2D[], f: CornerFilter): Analysis[] {
  const rings = paths
    .filter((p) => p.closed && p.points.length >= 3 && p.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)))
    .map((p) => clean(p.points))
    .filter((r) => r.length >= 3);
  const depths = f.which === 'all' ? rings.map(() => 0) : nestingDepths(rings);
  const out: Analysis[] = [];
  rings.forEach((ring, i) => {
    const a = analyse(ring, (depths[i] ?? 0) % 2 === 1, f);
    if (a) out.push(a);
  });
  return out;
}

/** How many corners of these outlines would be changed (before any is made smaller or skipped for being too close). */
export function findCorners(paths: readonly Path2D[], f: CornerFilter): number {
  let found = 0;
  for (const a of prepare(paths, f)) for (const v of a.vertices) if (v.selected) found++;
  return found;
}

// ---- making the new corners ---------------------------------------------------------------------

export interface CornerResult {
  /** Every closed outline, with its corners changed. */
  paths: Path2D[];
  /** How many corners were found to change. */
  found: number;
  /** How many were changed. */
  changed: number;
  /** Of those, how many were made smaller than asked for because the edges next to them are short. */
  reduced: number;
  /** Corners that could not be changed at all, because they sit too close to the next corner. */
  skipped: number;
}

/** The two points a corner is cut back to, and for a fillet the points of the arc between them. */
function cornerPoints(at: Point2, v: Vertex, leg: number, style: CornerStyle): Point2[] {
  const a: Point2 = { x: at.x - v.d1.x * leg, y: at.y - v.d1.y * leg };
  const b: Point2 = { x: at.x + v.d2.x * leg, y: at.y + v.d2.y * leg };
  if (style === 'chamfer') return [a, b];
  const radius = leg / Math.tan(v.turn / 2);
  const side = v.cross > 0 ? 1 : -1;
  // The centre lies on the inside of the turn, a radius away from the first tangent point.
  const centre: Point2 = { x: a.x + -side * v.d1.y * radius, y: a.y + side * v.d1.x * radius };
  const start = Math.atan2(a.y - centre.y, a.x - centre.x);
  const step = radius > CHORD_TOLERANCE_MM ? 2 * Math.acos(1 - CHORD_TOLERANCE_MM / radius) : Math.PI / 4;
  const segments = Math.min(MAX_ARC_SEGMENTS, Math.max(2, Math.ceil(v.turn / step)));
  const points: Point2[] = [a];
  for (let k = 1; k < segments; k++) {
    const angle = start + side * v.turn * (k / segments);
    points.push({ x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) });
  }
  points.push(b);
  return points;
}

/**
 * Rounds or chamfers the corners of every closed outline. Outlines that are not closed, or have fewer than
 * three points, are left out of the result.
 */
export function roundCorners(paths: readonly Path2D[], o: CornerOptions): CornerResult {
  const result: CornerResult = { paths: [], found: 0, changed: 0, reduced: 0, skipped: 0 };
  const usableSize = Number.isFinite(o.sizeMm) && o.sizeMm > 0;
  for (const a of prepare(paths, o)) {
    const n = a.points.length;
    // How much of each edge a corner would like to use: for a fillet the tangent length, for a chamfer the size.
    const wanted = a.vertices.map((v) => (!v.selected || !usableSize ? 0 : o.style === 'round' ? o.sizeMm * Math.tan(v.turn / 2) : o.sizeMm));
    // An edge shared by two corners is split between them in proportion to what each wants, so they never overlap.
    const leg = wanted.map((d, i) => {
      if (d <= 0) return 0;
      const before = (i + n - 1) % n;
      const after = (i + 1) % n;
      return Math.min(d, (a.lengths[before]! * d) / (d + wanted[before]!), (a.lengths[i]! * d) / (d + wanted[after]!));
    });
    const out: Point2[] = [];
    a.points.forEach((p, i) => {
      const v = a.vertices[i]!;
      const want = wanted[i]!;
      if (v.selected) result.found++;
      if (want <= 0) {
        out.push(p);
        return;
      }
      const l = leg[i]!;
      if (l < MIN_LEG_MM) {
        result.skipped++;
        out.push(p);
        return;
      }
      result.changed++;
      if (l < want * (1 - 1e-6)) result.reduced++;
      out.push(...cornerPoints(p, v, l, o.style));
    });
    const ring = clean(out);
    if (ring.length >= 3) result.paths.push({ points: ring, closed: true });
  }
  return result;
}

// ---- planning: which shapes, what they are called, what to say ----------------------------------

export interface CornerItem {
  id: string;
  name: string;
  layerId: string | null;
  /** The closed outlines, in workspace mm. */
  paths: Path2D[];
  /** The object also has open lines or tiny paths, which are not part of the result. */
  hasLoose: boolean;
  locked: boolean;
}

export type CornerPlan =
  | { ok: false; message: string }
  | {
      ok: true;
      items: CornerItem[];
      /** Selected objects that are not closed shapes. */
      skipped: string[];
      /** Selected shapes with more outlines or points than a corner search can handle. */
      tooDetailed: string[];
    };

const quoted = (objects: readonly WorkspaceObject[]): string => objects.map((o) => `"${o.name}"`).join(', ');

/** The selected shapes whose corners can be changed (each on its own), and the ones that are left out. */
export function planCorners(objects: readonly WorkspaceObject[], ids: readonly string[]): CornerPlan {
  const wanted = new Set(ids);
  const chosen = objects.filter((o) => wanted.has(o.id));
  if (chosen.length === 0) return { ok: false, message: 'Select a shape to round or chamfer.' };
  const items: CornerItem[] = [];
  const skipped: string[] = [];
  const tooDetailed: string[] = [];
  for (const o of chosen) {
    const paths = worldShapePaths(o);
    if (paths.length === 0) {
      skipped.push(o.name);
      continue;
    }
    const points = paths.reduce((sum, p) => sum + p.points.length, 0);
    if (paths.length > MAX_CORNER_PATHS || points > MAX_CORNER_POINTS) {
      tooDetailed.push(o.name);
      continue;
    }
    items.push({ id: o.id, name: o.name, layerId: o.layer_id, paths, hasLoose: hasLoosePaths(o), locked: o.locked });
  }
  if (items.length === 0) {
    if (tooDetailed.length > 0 && skipped.length === 0) {
      return { ok: false, message: `${tooDetailed.map((n) => `"${n}"`).join(', ')} has too much detail to search for corners. Simplify it first (Trace has a Simplify setting).` };
    }
    return { ok: false, message: `${quoted(chosen)} ${chosen.length === 1 ? 'is' : 'are'} not a closed shape, so there are no corners to change.` };
  }
  return { ok: true, items, skipped, tooDetailed };
}

/** "Square (rounded 3 mm)" or "Square (chamfered 2.5 mm)". */
export function cornersName(name: string, style: CornerStyle, sizeMm: number): string {
  return `${name} (${style === 'round' ? 'rounded' : 'chamfered'} ${trimNumber(sizeMm)} mm)`;
}

export interface CornerTotals {
  /** Shapes that had at least one corner changed. */
  shapes: number;
  changed: number;
  reduced: number;
  skipped: number;
}

/** What was done: "Rounded 8 corners on 2 shapes." and anything that had to be made smaller. */
export function cornersSummary(style: CornerStyle, t: CornerTotals): string {
  const verb = style === 'round' ? 'Rounded' : 'Chamfered';
  let text = `${verb} ${t.changed} ${t.changed === 1 ? 'corner' : 'corners'} on ${t.shapes} ${t.shapes === 1 ? 'shape' : 'shapes'}.`;
  if (t.reduced > 0) {
    text += ` ${t.reduced} ${t.reduced === 1 ? 'was' : 'were'} made smaller because the edges next to ${t.reduced === 1 ? 'it are' : 'them are'} short.`;
  }
  if (t.skipped > 0) text += ` ${t.skipped} ${t.skipped === 1 ? 'was' : 'were'} too close to the next corner to change.`;
  return text;
}

/** What to say when no corner matched. */
export function noCornersMessage(f: CornerFilter): string {
  const kind = f.which === 'outside' ? ' outside' : f.which === 'inside' ? ' inside' : '';
  return `No${kind} corner turns the outline by ${trimNumber(f.minTurnDeg)} degrees or more. Lower "Skip bends gentler than", or choose another kind under "Which corners".`;
}

/** The line under the settings: how many corners the current settings would find. */
export function cornersHint(plan: CornerPlan, found: number, shapes: number, f: CornerFilter): string {
  if (!plan.ok) return plan.message;
  if (found === 0) return noCornersMessage(f);
  return `${found} ${found === 1 ? 'corner' : 'corners'} on ${shapes} ${shapes === 1 ? 'shape' : 'shapes'} can be changed.`;
}
