// Node editing, stage 2: handles, modes and curves. Pure TypeScript (no React, Konva or Tauri imports), so it is unit-tested
// in plain Node (tests/nodeCurves.test.ts). It works on the same node lists as lib/nodePath.ts and, like it, never changes
// what it is given: every function returns new values, and the very same list when there was nothing to do (so an edit that
// changes nothing is not an undo step).
//
// A segment is straight until one of its two ends has a handle. A node's two handles are tied together by its mode:
//   corner     the handles are free (either may be missing, so a line can meet a curve at a corner)
//   smooth     the handles lie on one line, pointing opposite ways, each keeping its own length
//   symmetric  the same, and the two are the same length
// All handles are offsets from their node in millimetres, in the object's own coordinates, rounded to a thousandth.
import { segmentControls, segmentCount, type NodeRef, type SegmentRef } from '@/lib/nodePath';
import type { NodeHandle, NodeMode, NodePath, PathNode } from '@/types/domain';

export type HandleSide = 'in' | 'out';

const EPS = 1e-9;
const round3 = (v: number): number => Math.round(v * 1000) / 1000 + 0; // + 0 turns -0 into 0
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const len = (v: { x: number; y: number }): number => Math.hypot(v.x, v.y);
const live = (h: NodeHandle | undefined): h is NodeHandle => h !== undefined && len(h) > EPS;
const rounded = (v: { x: number; y: number }): NodeHandle => ({ x: round3(v.x), y: round3(v.y) });

function unit(v: { x: number; y: number }): { x: number; y: number } {
  const l = len(v);
  return l > EPS ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
}

/** The handle of a node on one side, or undefined when it has none that reaches anywhere. */
export function handleOf(node: PathNode, side: HandleSide): NodeHandle | undefined {
  const h = side === 'in' ? node.in : node.out;
  return live(h) ? h : undefined;
}

interface NodePatch {
  /** A handle to set, null to take it away, undefined to leave it as it is. */
  in?: NodeHandle | null;
  out?: NodeHandle | null;
  mode?: NodeMode | null;
}

/** A copy of the node with the patch applied. A corner is a node with no mode, so it is saved as just what it has. */
function patched(n: PathNode, patch: NodePatch): PathNode {
  const into = patch.in === undefined ? n.in : (patch.in ?? undefined);
  const away = patch.out === undefined ? n.out : (patch.out ?? undefined);
  const mode = patch.mode === undefined ? n.mode : (patch.mode ?? undefined);
  const node: PathNode = { x: n.x, y: n.y };
  if (into) node.in = into;
  if (away) node.out = away;
  if (mode && mode !== 'corner') node.mode = mode;
  return node;
}

const sameHandle = (a: NodeHandle | undefined, b: NodeHandle | undefined): boolean =>
  a === undefined || b === undefined ? a === b : a.x === b.x && a.y === b.y;
const sameNode = (a: PathNode, b: PathNode): boolean =>
  a.x === b.x && a.y === b.y && sameHandle(a.in, b.in) && sameHandle(a.out, b.out) && (a.mode ?? 'corner') === (b.mode ?? 'corner');

/** The node on this side of node `i` (its neighbour in the outline), or null at the end of an open outline. */
function neighbour(np: NodePath, i: number, step: -1 | 1): PathNode | null {
  const n = np.nodes.length;
  const j = i + step;
  if (j >= 0 && j < n) return np.nodes[j] as PathNode;
  return np.closed && n >= 3 ? (np.nodes[(j + n) % n] as PathNode) : null;
}

function groupByPath(refs: readonly NodeRef[]): Map<number, Set<number>> {
  const by = new Map<number, Set<number>>();
  for (const r of refs) {
    const set = by.get(r.path) ?? new Set<number>();
    set.add(r.node);
    by.set(r.path, set);
  }
  return by;
}

// ---- modes -------------------------------------------------------------------------------------------

/**
 * Node `i` of the outline with a new mode. Smooth and symmetric put the two handles on one line (so the curve has no kink
 * there) and make a handle where there is none but a neighbour to reach towards, a third of the way to it. A corner keeps
 * the handles as they are and only says they are free.
 */
function withMode(np: NodePath, i: number, mode: NodeMode): PathNode {
  const n = np.nodes[i] as PathNode;
  if (mode === 'corner') return patched(n, { mode: null });
  const prev = neighbour(np, i, -1);
  const next = neighbour(np, i, 1);
  const dPrev = prev ? Math.hypot(prev.x - n.x, prev.y - n.y) : 0;
  const dNext = next ? Math.hypot(next.x - n.x, next.y - n.y) : 0;
  const hin = handleOf(n, 'in');
  const hout = handleOf(n, 'out');
  let into: NodeHandle | undefined;
  let away: NodeHandle | undefined;
  if (hin && hout) {
    // The tangent is the middle of the two directions, so neither handle swings far.
    const a = unit(hout);
    const b = unit({ x: -hin.x, y: -hin.y });
    const sum = { x: a.x + b.x, y: a.y + b.y };
    const t = len(sum) > EPS ? unit(sum) : a;
    const lo = mode === 'symmetric' ? (len(hout) + len(hin)) / 2 : len(hout);
    const li = mode === 'symmetric' ? lo : len(hin);
    away = rounded({ x: t.x * lo, y: t.y * lo });
    into = rounded({ x: -t.x * li, y: -t.y * li });
  } else if (hout) {
    const t = unit(hout);
    const li = mode === 'symmetric' ? len(hout) : dPrev / 3;
    away = hout;
    if (prev && li > EPS) into = rounded({ x: -t.x * li, y: -t.y * li });
  } else if (hin) {
    const t = unit({ x: -hin.x, y: -hin.y });
    const lo = mode === 'symmetric' ? len(hin) : dNext / 3;
    into = hin;
    if (next && lo > EPS) away = rounded({ x: t.x * lo, y: t.y * lo });
  } else if (prev && next) {
    const across = { x: next.x - prev.x, y: next.y - prev.y };
    if (len(across) > EPS) {
      const t = unit(across);
      const lo = dNext / 3;
      const li = dPrev / 3;
      const both = (lo + li) / 2;
      away = rounded({ x: t.x * (mode === 'symmetric' ? both : lo), y: t.y * (mode === 'symmetric' ? both : lo) });
      into = rounded({ x: -t.x * (mode === 'symmetric' ? both : li), y: -t.y * (mode === 'symmetric' ? both : li) });
    }
  }
  return patched(n, { in: into ?? null, out: away ?? null, mode });
}

/** Gives the picked nodes a mode. The same list comes back when nothing changes. */
export function setNodeMode(nodes: readonly NodePath[], refs: readonly NodeRef[], mode: NodeMode): readonly NodePath[] {
  const by = groupByPath(refs);
  let changed = false;
  const out = nodes.map((np, pi) => {
    const set = by.get(pi);
    if (!set) return np;
    let pathChanged = false;
    const list = np.nodes.map((n, ni) => {
      if (!set.has(ni)) return n;
      const next = withMode(np, ni, mode);
      if (sameNode(next, n)) return n;
      pathChanged = true;
      return next;
    });
    if (!pathChanged) return np;
    changed = true;
    return { closed: np.closed, nodes: list };
  });
  return changed ? out : nodes;
}

/** The mode all the picked nodes have, 'mixed' when they differ, or null when none is picked. A node with no mode is a corner. */
export function pickedMode(nodes: readonly NodePath[], refs: readonly NodeRef[]): NodeMode | 'mixed' | null {
  let found: NodeMode | null = null;
  for (const r of refs) {
    const n = nodes[r.path]?.nodes[r.node];
    if (!n) continue;
    const mode = n.mode ?? 'corner';
    if (found === null) found = mode;
    else if (found !== mode) return 'mixed';
  }
  return found;
}

// ---- moving a handle ---------------------------------------------------------------------------------------

/**
 * Puts one handle of a node at an offset (mm, from the node). The other handle follows the node's mode: on a smooth node it
 * swings to the opposite direction and keeps its length, on a symmetric one it becomes the mirror image, on a corner it is
 * left alone. An offset of nothing takes the handle away. The same list comes back when nothing changes.
 */
export function moveHandle(nodes: readonly NodePath[], ref: NodeRef, side: HandleSide, offset: { x: number; y: number }): readonly NodePath[] {
  const np = nodes[ref.path];
  const node = np?.nodes[ref.node];
  if (!np || !node || !finite(offset.x) || !finite(offset.y)) return nodes;
  const target = rounded(offset);
  const removed = len(target) <= EPS;
  const other = handleOf(node, side === 'out' ? 'in' : 'out');
  let followed: NodeHandle | null | undefined;
  if (!removed && other && node.mode === 'symmetric') followed = rounded({ x: -target.x, y: -target.y });
  else if (!removed && other && node.mode === 'smooth') {
    const u = unit(target);
    followed = rounded({ x: -u.x * len(other), y: -u.y * len(other) });
  }
  const patch: NodePatch = side === 'out' ? { out: removed ? null : target } : { in: removed ? null : target };
  if (followed !== undefined) {
    if (side === 'out') patch.in = followed;
    else patch.out = followed;
  }
  const next = patched(node, patch);
  if (sameNode(next, node)) return nodes;
  const list = np.nodes.slice();
  list[ref.node] = next;
  return nodes.map((p, i) => (i === ref.path ? { closed: p.closed, nodes: list } : p));
}

// ---- lines and curves ----------------------------------------------------------------------------------------

/**
 * The segments the picked nodes stand for: every segment with both its ends picked, and, when there is none and exactly one
 * node is picked, the segments on either side of it. `curves` and `lines` count how many of them are of each kind.
 */
export function segmentsOfPick(nodes: readonly NodePath[], refs: readonly NodeRef[]): { segments: SegmentRef[]; curves: number; lines: number } {
  const by = groupByPath(refs);
  const segments: SegmentRef[] = [];
  nodes.forEach((np, path) => {
    const set = by.get(path);
    if (!set) return;
    const n = np.nodes.length;
    for (let s = 0; s < segmentCount(np); s++) {
      if (set.has(s) && set.has((s + 1) % n)) segments.push({ path, segment: s });
    }
  });
  if (segments.length === 0 && refs.length === 1) {
    const only = refs[0] as NodeRef;
    const np = nodes[only.path];
    if (np) {
      const n = np.nodes.length;
      const count = segmentCount(np);
      const before = np.closed ? (only.node + n - 1) % n : only.node - 1;
      if (before >= 0 && before < count) segments.push({ path: only.path, segment: before });
      if (only.node < count) segments.push({ path: only.path, segment: only.node });
    }
  }
  let curves = 0;
  let lines = 0;
  for (const s of segments) {
    const np = nodes[s.path] as NodePath;
    if (segmentControls(np, s.segment).straight) lines++;
    else curves++;
  }
  return { segments, curves, lines };
}

/** True when two handles lie on one line pointing opposite ways. */
function opposite(a: NodeHandle, b: NodeHandle): boolean {
  const cross = a.x * b.y - a.y * b.x;
  const dot = a.x * b.x + a.y * b.y;
  return dot < 0 && Math.abs(cross) <= 1e-6 * len(a) * len(b);
}

/**
 * Makes straight segments into curves. Each gets handles a third of the way along it at both ends, which lie on the line, so
 * the shape does not change yet: pull a handle to bend it. A node that was smooth or symmetric and whose other handle no
 * longer lines up with the new one becomes a corner. Segments that are curves already are left alone.
 */
export function makeCurves(nodes: readonly NodePath[], segments: readonly SegmentRef[]): readonly NodePath[] {
  const work = new Map<number, PathNode[]>();
  let changed = false;
  for (const seg of segments) {
    const np = nodes[seg.path];
    if (!np || seg.segment < 0 || seg.segment >= segmentCount(np)) continue;
    const list = work.get(seg.path) ?? np.nodes.slice();
    const n = list.length;
    const a = list[seg.segment] as PathNode;
    const b = list[(seg.segment + 1) % n] as PathNode;
    if (live(a.out) || live(b.in)) continue;
    const d = { x: b.x - a.x, y: b.y - a.y };
    if (len(d) <= EPS) continue;
    const out = rounded({ x: d.x / 3, y: d.y / 3 });
    const into = rounded({ x: -d.x / 3, y: -d.y / 3 });
    const aKeeps = !a.mode || a.mode === 'corner' || !live(a.in) || opposite(a.in as NodeHandle, out);
    const bKeeps = !b.mode || b.mode === 'corner' || !live(b.out) || opposite(b.out as NodeHandle, into);
    list[seg.segment] = patched(a, aKeeps ? { out } : { out, mode: null });
    list[(seg.segment + 1) % n] = patched(b, bKeeps ? { in: into } : { in: into, mode: null });
    work.set(seg.path, list);
    changed = true;
  }
  if (!changed) return nodes;
  return nodes.map((np, i) => {
    const list = work.get(i);
    return list ? { closed: np.closed, nodes: list } : np;
  });
}

/** Makes curves straight again by taking away the handles on both ends of each. Segments that are lines already are left alone. */
export function makeStraight(nodes: readonly NodePath[], segments: readonly SegmentRef[]): readonly NodePath[] {
  const work = new Map<number, PathNode[]>();
  let changed = false;
  for (const seg of segments) {
    const np = nodes[seg.path];
    if (!np || seg.segment < 0 || seg.segment >= segmentCount(np)) continue;
    const list = work.get(seg.path) ?? np.nodes.slice();
    const n = list.length;
    const a = list[seg.segment] as PathNode;
    const b = list[(seg.segment + 1) % n] as PathNode;
    if (!a.out && !b.in) continue;
    list[seg.segment] = patched(a, { out: null });
    list[(seg.segment + 1) % n] = patched(b, { in: null });
    work.set(seg.path, list);
    changed = true;
  }
  if (!changed) return nodes;
  return nodes.map((np, i) => {
    const list = work.get(i);
    return list ? { closed: np.closed, nodes: list } : np;
  });
}
