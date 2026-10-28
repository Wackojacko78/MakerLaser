// Node editing: snapping nodes together. Pure TypeScript (no React, Konva or Tauri imports), so it is unit-tested in plain Node
// (tests/nodeSnap.test.ts).
//
// While a node (or several) is dragged, it jumps onto a nearby node or corner so two outlines can meet exactly. The things it can
// land on, all in world millimetres:
//   * every other node of the outline being edited;
//   * the nodes of other objects that have nodes, and for objects that do not, their corners and the ends of their open lines
//     (a curve made of hundreds of short pieces has no corners worth snapping to, so only real turns count);
// and never the nodes that are being dragged. When several nodes are dragged together the whole group moves so that the one that
// is closest to a target lands on it, as in most drawing programs.
//
// How near is "nearby" is a number of screen pixels turned into millimetres at the current zoom, so it feels the same however far
// you are zoomed in. The targets are collected once when the drag starts, and found again quickly through a grid.
import { sanitizeNodes } from '@/lib/nodePath';
import type { NodeRef } from '@/lib/nodePath';
import type { NodeGesture } from '@/lib/nodeEdit';
import { applyToPoint } from '@/lib/transform';
import type { NodePath, ObjectKind, Path2D, Point2, Transform2D } from '@/types/domain';

/** How close (screen pixels) a dragged node has to come to something before it jumps onto it. */
export const SNAP_PX = 10;
/** A bend at least this sharp (degrees) in an outline that has no nodes is a corner that can be snapped to. */
export const SNAP_CORNER_DEG = 30;
/** More than this many targets from one other object, or in all, and that object is left out (it would make dragging slow). */
export const MAX_TARGETS_PER_OBJECT = 20_000;
export const MAX_TARGETS = 100_000;
const EPS = 1e-9;

// ---- the things a node can land on -------------------------------------------------------------------------

/** The points of a set of outlines that are real corners (a turn of at least `minDeg`) or the ends of an open line. */
export function cornerPoints(paths: readonly Path2D[], minDeg: number = SNAP_CORNER_DEG): Point2[] {
  const out: Point2[] = [];
  const cos = Math.cos((minDeg * Math.PI) / 180);
  for (const path of paths) {
    const pts = tidy(path.points, path.closed);
    const n = pts.length;
    if (n === 0) continue;
    if (n === 1) {
      out.push(pts[0] as Point2);
      continue;
    }
    for (let i = 0; i < n; i++) {
      const open = !path.closed;
      if (open && (i === 0 || i === n - 1)) {
        out.push(pts[i] as Point2);
        continue;
      }
      const a = pts[(i + n - 1) % n] as Point2;
      const b = pts[i] as Point2;
      const c = pts[(i + 1) % n] as Point2;
      const u = { x: b.x - a.x, y: b.y - a.y };
      const v = { x: c.x - b.x, y: c.y - b.y };
      const lu = Math.hypot(u.x, u.y);
      const lv = Math.hypot(v.x, v.y);
      if (lu < EPS || lv < EPS) continue;
      // The turn is the angle between the direction in and the direction out: it is at least `minDeg` when the cosine is at most cos(minDeg).
      if ((u.x * v.x + u.y * v.y) / (lu * lv) <= cos) out.push(b);
    }
  }
  return out;
}

/** The points of an outline without repeats (and without a last point that repeats the first). */
function tidy(points: readonly Point2[], closed: boolean): Point2[] {
  const out: Point2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > EPS) out.push(p);
  }
  if (closed) while (out.length > 1 && Math.hypot((out[0] as Point2).x - (out[out.length - 1] as Point2).x, (out[0] as Point2).y - (out[out.length - 1] as Point2).y) <= EPS) out.pop();
  return out;
}

/** The points of another object that a node can snap to, in world millimetres. Pictures give none. */
export function objectSnapPoints(kind: ObjectKind, transform: Transform2D): Point2[] {
  if (kind.type !== 'vector') return [];
  let local: Point2[];
  const own = kind.source || kind.nodes === undefined ? null : sanitizeNodes(kind.nodes);
  if (own && own.length === kind.paths.length) local = own.flatMap((p) => p.nodes.map((n) => ({ x: n.x, y: n.y })));
  else local = cornerPoints(kind.paths);
  return local.map((p) => applyToPoint(transform, p));
}

// ---- finding the nearest one quickly -------------------------------------------------------------------------

/** The points in a grid, so the nearest one is found by looking at a few cells instead of all of them. */
export interface SnapIndex {
  cell: number;
  points: Point2[];
  cells: Map<string, number[]>;
}

const cellKey = (cx: number, cy: number): string => `${cx},${cy}`;

export function buildSnapIndex(points: readonly Point2[], cell: number): SnapIndex {
  const size = Math.max(cell, 0.01);
  const cells = new Map<string, number[]>();
  const kept: Point2[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const key = cellKey(Math.floor(p.x / size), Math.floor(p.y / size));
    const list = cells.get(key);
    const index = kept.length;
    kept.push(p);
    if (list) list.push(index);
    else cells.set(key, [index]);
  }
  return { cell: size, points: kept, cells };
}

/** The point of the index nearest to `p` within `tolMm`, or null. The first of two equally near ones wins. */
export function nearestTarget(index: SnapIndex, p: Point2, tolMm: number): { point: Point2; distance: number } | null {
  if (!(tolMm > 0) || !Number.isFinite(p.x) || !Number.isFinite(p.y) || index.points.length === 0) return null;
  const reach = Math.ceil(tolMm / index.cell);
  const cx = Math.floor(p.x / index.cell);
  const cy = Math.floor(p.y / index.cell);
  let best: { point: Point2; distance: number; at: number } | null = null;
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      for (const i of index.cells.get(cellKey(cx + dx, cy + dy)) ?? []) {
        const t = index.points[i] as Point2;
        const d = Math.hypot(t.x - p.x, t.y - p.y);
        if (d <= tolMm && (!best || d < best.distance || (d === best.distance && i < best.at))) best = { point: t, distance: d, at: i };
      }
    }
  }
  return best ? { point: best.point, distance: best.distance } : null;
}

// ---- a drag --------------------------------------------------------------------------------------------------

/** What is known when a drag starts: where the dragged nodes are, and everything they could land on. */
export interface SnapContext {
  /** The dragged nodes where they were when the drag started (world mm). */
  starts: Point2[];
  index: SnapIndex;
}

export interface SnapObject {
  id: string;
  visible: boolean;
  kind: ObjectKind;
  transform: Transform2D;
}

/**
 * Collects what the dragged nodes can snap to. `worldNodes` are the nodes of the outline being edited in world millimetres,
 * `dragged` says which of them are moving (they are never targets). Other visible objects add their nodes or corners; one that
 * has more than MAX_TARGETS_PER_OBJECT is left out, and so is everything past MAX_TARGETS in all. `cellMm` is the size of the grid
 * (the snap distance at the zoom the drag starts at is a good one).
 */
export function buildSnapContext(
  objects: readonly SnapObject[],
  editingId: string,
  worldNodes: readonly NodePath[],
  dragged: readonly NodeRef[],
  cellMm: number,
): SnapContext {
  const moving = new Set(dragged.map((r) => `${r.path}:${r.node}`));
  const starts: Point2[] = [];
  const targets: Point2[] = [];
  worldNodes.forEach((np, path) =>
    np.nodes.forEach((n, node) => {
      if (moving.has(`${path}:${node}`)) starts.push({ x: n.x, y: n.y });
      else targets.push({ x: n.x, y: n.y });
    }),
  );
  for (const o of objects) {
    if (o.id === editingId || !o.visible) continue;
    if (targets.length >= MAX_TARGETS) break;
    const pts = objectSnapPoints(o.kind, o.transform);
    if (pts.length <= MAX_TARGETS_PER_OBJECT && targets.length + pts.length <= MAX_TARGETS) targets.push(...pts);
  }
  return { starts, index: buildSnapIndex(targets, cellMm) };
}

export interface SnapResult {
  /** The step to take instead of the one asked for. */
  delta: Point2;
  /** The point that was landed on, or null when nothing was near enough. */
  target: Point2 | null;
}

/**
 * The step (in world millimetres) that a drag of `delta` should take: the same step, unless one of the dragged nodes would end up within
 * `tolMm` of a target, in which case the step is changed so the nearest such node lands exactly on it.
 */
export function snapDelta(ctx: SnapContext, delta: Point2, tolMm: number): SnapResult {
  let best: { point: Point2; distance: number; start: Point2 } | null = null;
  for (const start of ctx.starts) {
    const t = nearestTarget(ctx.index, { x: start.x + delta.x, y: start.y + delta.y }, tolMm);
    if (t && (!best || t.distance < best.distance)) best = { ...t, start };
  }
  if (!best) return { delta, target: null };
  return { delta: { x: best.point.x - best.start.x, y: best.point.y - best.start.y }, target: best.point };
}

export interface SnapDrag {
  /** Where the pointer counts as being: the start of the drag plus the (snapped) step. Everything else treats this as the pointer. */
  point: Point2;
  target: Point2 | null;
}

/**
 * The pointer position to use for a drag of nodes: the real one, or the one that makes the nodes land on what they snapped to. Nothing
 * snaps before the drag has gone far enough to count, when snapping is off, when there is nothing to snap to, or for any other gesture.
 */
export function dragWithSnap(g: NodeGesture | null, p: Point2, ctx: SnapContext | null, enabled: boolean, tolMm: number): SnapDrag {
  if (!enabled || !ctx || !g || g.kind !== 'drag' || !g.moved) return { point: p, target: null };
  const r = snapDelta(ctx, { x: p.x - g.start.x, y: p.y - g.start.y }, tolMm);
  if (!r.target) return { point: p, target: null };
  return { point: { x: g.start.x + r.delta.x, y: g.start.y + r.delta.y }, target: r.target };
}
