// Node editing, stage 1: the model and the rules. Pure TypeScript (no React, Konva or Tauri imports), so it is
// unit-tested in plain Node (tests/nodePath.test.ts). Nothing here draws anything or touches the project store.
//
// An object may carry `nodes` next to its `paths`: the editable form of the same outlines. `paths` stays the straight-
// segment form that the laser, the preview, Combine, Offset, Trace and Measure read, and when `nodes` is present it is
// always its flattened form (see `kindWithNodes`). A segment from one node to the next is straight unless the first node
// has an `out` handle or the second an `in` handle; then it is a cubic Bezier whose control points are the node plus its
// handle, with a missing handle counting as zero. Handles are offsets from their node, so they travel with it.
//
// Every function here returns new values and never changes what it is given: the undo history shares each object's `kind`
// between snapshots (see cloneProject in state/projectStore.ts), so a kind is replaced, never edited in place.
// Coordinates are the object's own (local) millimetres, the same as `paths`.
import { shapeNodes } from '@/lib/shapeNodes';
import type { NodeHandle, NodeMode, NodePath, ObjectKind, Path2D, PathNode, Point2, VectorObjectData } from '@/types/domain';

/** How far a curve may stray from the true curve when it is flattened, in mm. The same tolerance imports use. */
export const FLATTEN_TOLERANCE_MM = 0.02;
/** The most nodes one object may have. Above it the outlines are left as they are. */
export const MAX_NODES_PER_OBJECT = 100_000;
/** Matches MAX_DEPTH in packages/geometry/src/bezier.rs. */
const MAX_DEPTH = 16;
const ZERO = 1e-12;
const MODES: readonly NodeMode[] = ['corner', 'smooth', 'symmetric'];

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ---- references -----------------------------------------------------------------------------

/** One node: which outline, and which node of it. */
export interface NodeRef {
  path: number;
  node: number;
}
/** One segment: which outline, and which segment of it (from node `segment` to the next node, which wraps for a closed outline). */
export interface SegmentRef {
  path: number;
  segment: number;
}
export const refKey = (r: NodeRef): string => `${r.path}:${r.node}`;
export const sameRef = (a: NodeRef, b: NodeRef): boolean => a.path === b.path && a.node === b.node;

export function nodeCount(nodes: readonly NodePath[]): number {
  let n = 0;
  for (const p of nodes) n += p.nodes.length;
  return n;
}

/** How many segments an outline has: one fewer than its nodes when open, as many as its nodes when closed. */
export function segmentCount(p: NodePath): number {
  const n = p.nodes.length;
  if (n < 2) return 0;
  return p.closed ? n : n - 1;
}

// ---- reading a segment -------------------------------------------------------------------------

export interface SegmentControls {
  p0: Point2;
  p1: Point2;
  p2: Point2;
  p3: Point2;
  /** True when neither end has a handle that reaches anywhere: the segment is a straight line. */
  straight: boolean;
}

const isZero = (h: NodeHandle | undefined): boolean => !h || (Math.abs(h.x) <= ZERO && Math.abs(h.y) <= ZERO);

/** The four control points of a segment (the two middle ones equal their end when there is no handle). */
export function segmentControls(p: NodePath, segment: number): SegmentControls {
  const n = p.nodes.length;
  const a = p.nodes[segment] as PathNode;
  const b = p.nodes[(segment + 1) % n] as PathNode;
  const out = a.out ?? { x: 0, y: 0 };
  const into = b.in ?? { x: 0, y: 0 };
  return {
    p0: { x: a.x, y: a.y },
    p1: { x: a.x + out.x, y: a.y + out.y },
    p2: { x: b.x + into.x, y: b.y + into.y },
    p3: { x: b.x, y: b.y },
    straight: isZero(a.out) && isZero(b.in),
  };
}

const mid = (a: Point2, b: Point2): Point2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function distanceToLine(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** Adds the points between the two ends of a cubic (not the ends). The same flatness test as bezier.rs: both control points near the chord. */
function flattenCubic(p0: Point2, p1: Point2, p2: Point2, p3: Point2, tol: number, depth: number, out: Point2[]): void {
  if (depth >= MAX_DEPTH || (distanceToLine(p1, p0, p3) <= tol && distanceToLine(p2, p0, p3) <= tol)) return;
  const p01 = mid(p0, p1);
  const p12 = mid(p1, p2);
  const p23 = mid(p2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const m = mid(p012, p123);
  flattenCubic(p0, p01, p012, m, tol, depth + 1, out);
  out.push(m);
  flattenCubic(m, p123, p23, p3, tol, depth + 1, out);
}

// ---- nodes to outlines and back --------------------------------------------------------------------

/** The outline of one node path as straight segments: every node, and the points of each curve between them. The first point is not repeated at the end of a closed outline. */
export function flattenNodePath(np: NodePath, tol: number = FLATTEN_TOLERANCE_MM): Path2D {
  const points: Point2[] = [];
  const segments = segmentCount(np);
  np.nodes.forEach((node, i) => {
    points.push({ x: node.x, y: node.y });
    if (i < segments) {
      const s = segmentControls(np, i);
      if (!s.straight) flattenCubic(s.p0, s.p1, s.p2, s.p3, tol, 0, points);
    }
  });
  return { points, closed: np.closed };
}

export function flattenNodes(nodes: readonly NodePath[], tol: number = FLATTEN_TOLERANCE_MM): Path2D[] {
  return nodes.map((np) => flattenNodePath(np, tol));
}

/** One corner node for every point of every outline. Flattening the result gives the outlines back exactly. */
export function nodesFromPaths(paths: readonly Path2D[]): NodePath[] {
  return paths.map((p) => ({ closed: p.closed, nodes: p.points.map((q): PathNode => ({ x: q.x, y: q.y })) }));
}

/** True when `nodes` flatten to exactly these outlines (to a millionth of a millimetre): same count, same closed flags, same points. */
export function nodesMatchPaths(nodes: readonly NodePath[], paths: readonly Path2D[], eps = 1e-6): boolean {
  if (nodes.length !== paths.length) return false;
  for (let i = 0; i < nodes.length; i++) {
    const np = nodes[i] as NodePath;
    const path = paths[i] as Path2D;
    if (np.closed !== path.closed) return false;
    const flat = flattenNodePath(np).points;
    if (flat.length !== path.points.length) return false;
    for (let k = 0; k < flat.length; k++) {
      const a = flat[k] as Point2;
      const b = path.points[k] as Point2;
      if (Math.abs(a.x - b.x) > eps || Math.abs(a.y - b.y) > eps) return false;
    }
  }
  return true;
}

function sanitizeHandle(raw: unknown): NodeHandle | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') return null;
  const h = raw as Record<string, unknown>;
  return finite(h.x) && finite(h.y) ? { x: h.x, y: h.y } : null;
}

/**
 * Checks nodes that came from a file (or from anywhere that is not this module) and returns a clean copy, or null when
 * anything is wrong: not a list, a number that is not finite, an unknown mode, or more than the limit.
 * Nothing is repaired: a file with broken nodes simply has no nodes, and its outlines stand.
 */
export function sanitizeNodes(raw: unknown, maxNodes: number = MAX_NODES_PER_OBJECT): NodePath[] | null {
  if (!Array.isArray(raw)) return null;
  const out: NodePath[] = [];
  let total = 0;
  for (const item of raw as unknown[]) {
    if (typeof item !== 'object' || item === null) return null;
    const p = item as Record<string, unknown>;
    if (typeof p.closed !== 'boolean' || !Array.isArray(p.nodes)) return null;
    const nodes: PathNode[] = [];
    for (const n of p.nodes as unknown[]) {
      if (typeof n !== 'object' || n === null) return null;
      const r = n as Record<string, unknown>;
      if (!finite(r.x) || !finite(r.y)) return null;
      const into = sanitizeHandle(r.in);
      const away = sanitizeHandle(r.out);
      if (into === null || away === null) return null;
      if (r.mode !== undefined && !MODES.includes(r.mode as NodeMode)) return null;
      const node: PathNode = { x: r.x, y: r.y };
      if (into) node.in = into;
      if (away) node.out = away;
      if (r.mode !== undefined && r.mode !== 'corner') node.mode = r.mode as NodeMode;
      nodes.push(node);
    }
    total += nodes.length;
    if (total > maxNodes) return null;
    out.push({ closed: p.closed, nodes });
  }
  return out;
}

// ---- who can be edited -----------------------------------------------------------------------------

export type NodeAccessProblem = 'not-vector' | 'has-recipe' | 'too-many' | 'nothing';

export type NodeAccess =
  | {
      ok: true;
      nodes: NodePath[];
      /** The nodes were made from the outlines just now (the object had none). */
      fromPaths: boolean;
      /** The object had nodes, but they no longer matched its outlines, so they were rebuilt as plain corners. */
      stale: boolean;
    }
  | { ok: false; reason: NodeAccessProblem };

/**
 * The nodes to edit for an object. An object that has nodes which still match its outlines uses them. Otherwise nodes are
 * made from the outlines: one corner node per point. Pictures, text and shapes (they keep their recipe until converted),
 * outlines with more than the limit of nodes, and objects with nothing to edit are refused.
 */
export function nodeAccess(kind: ObjectKind): NodeAccess {
  if (kind.type !== 'vector') return { ok: false, reason: 'not-vector' };
  if (kind.source) return { ok: false, reason: 'has-recipe' };
  const points = kind.paths.reduce((sum, p) => sum + p.points.length, 0);
  if (points > MAX_NODES_PER_OBJECT) return { ok: false, reason: 'too-many' };
  if (!kind.paths.some((p) => p.points.length >= 2)) return { ok: false, reason: 'nothing' };
  const own = kind.nodes === undefined ? null : sanitizeNodes(kind.nodes);
  if (own && nodesMatchPaths(own, kind.paths)) return { ok: true, nodes: own, fromPaths: false, stale: false };
  return { ok: true, nodes: nodesFromPaths(kind.paths), fromPaths: true, stale: kind.nodes !== undefined };
}

/** What to tell the user when `nodeAccess` refuses. */
export function nodeAccessMessage(reason: NodeAccessProblem): string {
  switch (reason) {
    case 'not-vector':
      return 'Only outlines have nodes: a picture does not. Trace it first to get outlines.';
    case 'has-recipe':
      return 'This is still text or a shape, so it keeps its size and font boxes. Press Convert to outlines to edit its nodes.';
    case 'too-many':
      return `It has more than ${MAX_NODES_PER_OBJECT.toLocaleString('en-NZ')} points, too many to edit as nodes. Simplify it first (Trace has a Simplify setting).`;
    case 'nothing':
      return 'There are no outlines to edit.';
  }
}

/**
 * The object's outlines with these nodes: `paths` is the flattened form, so the two always agree. Text and shapes are
 * refused (it throws), because their recipe would no longer match: use `convertToOutlines` first.
 */
export function kindWithNodes(kind: VectorObjectData, nodes: readonly NodePath[]): VectorObjectData {
  if (kind.source) throw new Error('Text and shapes keep their recipe: convert them to outlines before editing their nodes.');
  return { type: 'vector', paths: flattenNodes(nodes), nodes: nodes.map((p) => ({ closed: p.closed, nodes: p.nodes })) };
}

/**
 * Text or a shape as an ordinary outline with nodes: the recipe is dropped. An ellipse or a rectangle with rounded corners
 * becomes the few curve nodes a person would draw (lib/shapeNodes.ts), and its outline is those curves flattened, which is
 * within a few hundredths of a millimetre of what it was. Everything else keeps its outlines exactly and gets one corner node
 * for every point. An object with no recipe comes back with nodes added.
 */
export function convertToOutlines(kind: VectorObjectData): VectorObjectData {
  if (kind.source?.type === 'shape') {
    const curved = shapeNodes(kind.source, kind.paths);
    if (curved) return { type: 'vector', paths: flattenNodes([curved]), nodes: [curved] };
  }
  const access = nodeAccess({ type: 'vector', paths: kind.paths, ...(kind.nodes ? { nodes: kind.nodes } : {}) });
  const nodes = access.ok ? access.nodes : nodesFromPaths(kind.paths);
  return { type: 'vector', paths: kind.paths, nodes };
}

// ---- finding nodes and segments --------------------------------------------------------------------

/** The node nearest the point, if one is within `tolMm`. */
export function nodeAt(nodes: readonly NodePath[], x: number, y: number, tolMm: number): NodeRef | null {
  let best: NodeRef | null = null;
  let bestDistance = tolMm;
  nodes.forEach((np, path) => {
    np.nodes.forEach((n, node) => {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d <= bestDistance) {
        bestDistance = d;
        best = { path, node };
      }
    });
  });
  return best;
}

/** Every node inside the box, in outline then node order. */
export function nodesInBox(nodes: readonly NodePath[], box: { minX: number; maxX: number; minY: number; maxY: number }): NodeRef[] {
  const found: NodeRef[] = [];
  nodes.forEach((np, path) => {
    np.nodes.forEach((n, node) => {
      if (n.x >= box.minX && n.x <= box.maxX && n.y >= box.minY && n.y <= box.maxY) found.push({ path, node });
    });
  });
  return found;
}

export interface SegmentHit extends SegmentRef {
  /** How far along the segment: 0 at its first node, 1 at the next. For a curve this is the Bezier parameter. */
  t: number;
  /** How far the point is from the segment, in mm. */
  distance: number;
  /** The nearest point on the segment. */
  point: Point2;
}

const cubicAt = (s: SegmentControls, t: number): Point2 => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * s.p0.x + b * s.p1.x + c * s.p2.x + d * s.p3.x, y: a * s.p0.y + b * s.p1.y + c * s.p2.y + d * s.p3.y };
};

const CURVE_SAMPLES = 96;

function nearestOnSegment(s: SegmentControls, x: number, y: number): { t: number; distance: number; point: Point2 } {
  if (s.straight) {
    const dx = s.p3.x - s.p0.x;
    const dy = s.p3.y - s.p0.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 < 1e-18 ? 0 : Math.min(1, Math.max(0, ((x - s.p0.x) * dx + (y - s.p0.y) * dy) / len2));
    const point = { x: s.p0.x + t * dx, y: s.p0.y + t * dy };
    return { t, distance: Math.hypot(x - point.x, y - point.y), point };
  }
  // A curve: the nearest of evenly spaced samples, then narrowed down between its two neighbours.
  let bestT = 0;
  let bestD = Infinity;
  for (let k = 0; k <= CURVE_SAMPLES; k++) {
    const t = k / CURVE_SAMPLES;
    const p = cubicAt(s, t);
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  let lo = Math.max(0, bestT - 1 / CURVE_SAMPLES);
  let hi = Math.min(1, bestT + 1 / CURVE_SAMPLES);
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const p1 = cubicAt(s, m1);
    const p2 = cubicAt(s, m2);
    if (Math.hypot(x - p1.x, y - p1.y) < Math.hypot(x - p2.x, y - p2.y)) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  const point = cubicAt(s, t);
  return { t, distance: Math.hypot(x - point.x, y - point.y), point };
}

/** The segment nearest the point, if one is within `tolMm`. */
export function nearestSegment(nodes: readonly NodePath[], x: number, y: number, tolMm: number): SegmentHit | null {
  let best: SegmentHit | null = null;
  nodes.forEach((np, path) => {
    for (let segment = 0; segment < segmentCount(np); segment++) {
      const hit = nearestOnSegment(segmentControls(np, segment), x, y);
      if (hit.distance <= tolMm && (!best || hit.distance < best.distance)) best = { path, segment, ...hit };
    }
  });
  return best;
}

// ---- editing ---------------------------------------------------------------------------------------

/** Moves the chosen nodes by (dx, dy). Their handles go with them. Nothing to move, or a distance that is not a number, gives `nodes` back as it was. */
export function moveNodes(nodes: readonly NodePath[], refs: readonly NodeRef[], dx: number, dy: number): readonly NodePath[] {
  if (refs.length === 0 || !finite(dx) || !finite(dy) || (dx === 0 && dy === 0)) return nodes;
  const chosen = new Map<number, Set<number>>();
  for (const r of refs) {
    const set = chosen.get(r.path) ?? new Set<number>();
    set.add(r.node);
    chosen.set(r.path, set);
  }
  return nodes.map((np, pi) => {
    const set = chosen.get(pi);
    if (!set) return np;
    return { closed: np.closed, nodes: np.nodes.map((n, ni) => (set.has(ni) ? { ...n, x: round3(n.x + dx), y: round3(n.y + dy) } : n)) };
  });
}

/** Puts one node at an exact position (the X and Y boxes). A node that is not there, or a position that is not a number, gives `nodes` back as it was. */
export function setNodePosition(nodes: readonly NodePath[], ref: NodeRef, x: number, y: number): readonly NodePath[] {
  const node = nodes[ref.path]?.nodes[ref.node];
  if (!node || !finite(x) || !finite(y)) return nodes;
  return moveNodes(nodes, [ref], round3(x) - node.x, round3(y) - node.y);
}

export interface DeleteResult {
  nodes: NodePath[];
  /** Nodes taken out. */
  removed: number;
  /** Closed outlines left with only two nodes, which became open lines. */
  opened: number;
  /** Outlines that had too few nodes left and were taken out altogether. */
  gone: number;
}

/**
 * Takes the chosen nodes out. A closed outline left with two nodes becomes an open line; an outline left with fewer than
 * two disappears. With nothing chosen `nodes` is returned as it was.
 */
export function deleteNodes(nodes: readonly NodePath[], refs: readonly NodeRef[]): DeleteResult {
  const chosen = new Map<number, Set<number>>();
  for (const r of refs) {
    if (!nodes[r.path]?.nodes[r.node]) continue;
    const set = chosen.get(r.path) ?? new Set<number>();
    set.add(r.node);
    chosen.set(r.path, set);
  }
  const result: DeleteResult = { nodes: [...nodes], removed: 0, opened: 0, gone: 0 };
  if (chosen.size === 0) return result;
  result.nodes = [];
  nodes.forEach((np, pi) => {
    const set = chosen.get(pi);
    if (!set) {
      result.nodes.push(np);
      return;
    }
    const kept = np.nodes.filter((_, ni) => !set.has(ni));
    result.removed += np.nodes.length - kept.length;
    if (np.closed && kept.length >= 3) result.nodes.push({ closed: true, nodes: kept });
    else if (np.closed && kept.length === 2) {
      result.opened++;
      result.nodes.push({ closed: false, nodes: kept });
    } else if (!np.closed && kept.length >= 2) result.nodes.push({ closed: false, nodes: kept });
    else result.gone++;
  });
  return result;
}

const lerp = (a: Point2, b: Point2, t: number): Point2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const offsetOf = (from: Point2, to: Point2): NodeHandle => ({ x: round3(to.x - from.x), y: round3(to.y - from.y) });

/**
 * Puts a new node on a segment, `t` of the way along it (0 to 1). On a straight segment the new node is a plain corner on the
 * line. On a curve the curve is split exactly there (de Casteljau), so the shape does not change, and the new node is
 * smooth. Returns null when `t` is at an end (it would double a node) or the segment is not there.
 */
export function insertNode(nodes: readonly NodePath[], at: SegmentRef, t: number): { nodes: NodePath[]; ref: NodeRef } | null {
  const np = nodes[at.path];
  if (!np || !finite(t) || at.segment < 0 || at.segment >= segmentCount(np)) return null;
  if (t <= 1e-6 || t >= 1 - 1e-6) return null;
  const n = np.nodes.length;
  const s = segmentControls(np, at.segment);
  const first = np.nodes[at.segment] as PathNode;
  const second = np.nodes[(at.segment + 1) % n] as PathNode;
  let fresh: PathNode;
  let before = first;
  let after = second;
  if (s.straight) {
    const p = lerp(s.p0, s.p3, t);
    fresh = { x: round3(p.x), y: round3(p.y) };
  } else {
    const p01 = lerp(s.p0, s.p1, t);
    const p12 = lerp(s.p1, s.p2, t);
    const p23 = lerp(s.p2, s.p3, t);
    const p012 = lerp(p01, p12, t);
    const p123 = lerp(p12, p23, t);
    const split = lerp(p012, p123, t);
    fresh = { x: split.x, y: split.y, in: offsetOf(split, p012), out: offsetOf(split, p123), mode: 'smooth' };
    before = { ...first, out: offsetOf(s.p0, p01) };
    after = { ...second, in: offsetOf(s.p3, p23) };
  }
  const list = np.nodes.slice();
  list[at.segment] = before;
  const last = (at.segment + 1) % n;
  list[last] = after;
  list.splice(at.segment + 1, 0, fresh);
  const out = nodes.map((p, i) => (i === at.path ? { closed: p.closed, nodes: list } : p));
  return { nodes: out, ref: { path: at.path, node: at.segment + 1 } };
}
