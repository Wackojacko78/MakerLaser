// Node editing, stage 3: fitting curves to an outline. Pure TypeScript (no React, Konva or Tauri imports), so it is unit-tested
// in plain Node (tests/curveFit.test.ts).
//
// An imported drawing, a trace, text and the result of a shape tool are all outlines made of very many short straight pieces. This
// turns each outline into the few curve nodes a person would have drawn: straight runs stay straight lines, bends become cubic
// Beziers, and real corners stay corners. The outline that results is those curves flattened (see kindWithNodes in lib/nodePath.ts),
// and it stays within the tolerance the user asked for of the outline it came from.
//
// The method is Philip Schneider's least-squares Bezier fitting (Graphics Gems, 1990): fit one cubic to a run of points, and if it
// misses by more than the allowed error, split the run where it missed most and fit each half, keeping the tangent the same on
// both sides of the split so the join is smooth. Around it:
//   * corners are found first, at the scale of a small window (a few times the tolerance) so that pixel steps in a traced picture are
//     not mistaken for corners, and every run between two corners is fitted on its own;
//   * long straight edges are given extra points first, so the fit cannot cut across a coarse outline between its points;
//   * a fitted piece whose handles lie on its chord is made a straight line, so a straight side costs two nodes and no handles.
import { FLATTEN_TOLERANCE_MM, insertNode, nodesFromPaths } from '@/lib/nodePath';
import type { NodeHandle, NodePath, ObjectKind, Path2D, PathNode, Point2 } from '@/types/domain';

/** What the Fit curves box starts at, and the least and most it will take (mm): how far the fitted outline may stray from the old one. */
export const FIT_DEFAULT_TOLERANCE_MM = 0.05;
export const FIT_MIN_TOLERANCE_MM = 0.025;
export const FIT_MAX_TOLERANCE_MM = 5;
/** More points than this in one object are not fitted (the time would be too long). */
export const MAX_FIT_POINTS = 1_000_000;
/** A bend sharper than this, seen over a small window, is a corner and stays one (degrees). */
export const CORNER_ANGLE_DEG = 25;

const EPS = 1e-12;
/** Fitted points are kept to a thousandth of a millimetre, like every other edit of a node. */
const round3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const finite = (v: number): boolean => Number.isFinite(v);

type V = Point2;
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k });
const dot = (a: V, b: V): number => a.x * b.x + a.y * b.y;
const len = (a: V): number => Math.hypot(a.x, a.y);
const dist = (a: V, b: V): number => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (a: V): V => {
  const l = len(a);
  return l > EPS ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
const lerp = (a: V, b: V, t: number): V => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * The error to fit to for a tolerance the user asked for. The flattened outline is allowed to differ from the fit by up to three
 * quarters of FLATTEN_TOLERANCE_MM, and a piece that is replaced by its chord by up to three eighths of the fit error, so the
 * total stays within the tolerance.
 */
export function fitErrorFor(toleranceMm: number): number {
  return Math.max((toleranceMm - 0.75 * FLATTEN_TOLERANCE_MM) / 1.375, 0.005);
}

/** The window (mm) corners and end tangents are measured over. */
export const windowFor = (fitError: number): number => Math.max(8 * fitError, 0.1);

// ---- a cubic Bezier ----------------------------------------------------------------------------------

/** One cubic piece: its two ends and its two control points. A straight line has each control point on its own end (the very same object). */
export interface Seg {
  p0: V;
  p1: V;
  p2: V;
  p3: V;
}

function at(s: Seg, t: number): V {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * s.p0.x + b * s.p1.x + c * s.p2.x + d * s.p3.x, y: a * s.p0.y + b * s.p1.y + c * s.p2.y + d * s.p3.y };
}
function d1(s: Seg, t: number): V {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  return {
    x: a * (s.p1.x - s.p0.x) + b * (s.p2.x - s.p1.x) + c * (s.p3.x - s.p2.x),
    y: a * (s.p1.y - s.p0.y) + b * (s.p2.y - s.p1.y) + c * (s.p3.y - s.p2.y),
  };
}
function d2(s: Seg, t: number): V {
  const u = 1 - t;
  return {
    x: 6 * u * (s.p2.x - 2 * s.p1.x + s.p0.x) + 6 * t * (s.p3.x - 2 * s.p2.x + s.p1.x),
    y: 6 * u * (s.p2.y - 2 * s.p1.y + s.p0.y) + 6 * t * (s.p3.y - 2 * s.p2.y + s.p1.y),
  };
}

/** Chord-length parameters for points first..last, 0 at the start and 1 at the end. */
function chordParams(pts: readonly V[], first: number, last: number): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push((u[u.length - 1] as number) + dist(pts[i] as V, pts[i - 1] as V));
  const total = u[u.length - 1] as number;
  if (total < EPS) return u.map((_, i) => i / Math.max(1, u.length - 1));
  return u.map((v) => v / total);
}

/** The least-squares cubic through points first..last with these end tangents (t2 points back from the end), as in the Graphics Gems code. */
function generateBezier(pts: readonly V[], first: number, last: number, u: readonly number[], t1: V, t2: V): Seg {
  const p0 = pts[first] as V;
  const p3 = pts[last] as V;
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i <= last - first; i++) {
    const ui = u[i] as number;
    const m = 1 - ui;
    const b0 = m * m * m;
    const b1 = 3 * ui * m * m;
    const b2 = 3 * ui * ui * m;
    const b3 = ui * ui * ui;
    const a1 = mul(t1, b1);
    const a2 = mul(t2, b2);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const tmp = sub(pts[first + i] as V, add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let alphaL = det === 0 ? 0 : (x0 * c11 - x1 * c01) / det;
  let alphaR = det === 0 ? 0 : (c00 * x1 - c01 * x0) / det;
  const seg = dist(p0, p3);
  const eps = 1e-6 * seg;
  // A handle longer than the piece it belongs to swings far outside the points it was fitted to, so fall back to a third of the chord and let the error check split the piece if that is not good enough.
  if (!finite(alphaL) || !finite(alphaR) || alphaL < eps || alphaR < eps || alphaL > seg || alphaR > seg) {
    alphaL = seg / 3;
    alphaR = seg / 3;
  }
  return { p0, p1: add(p0, mul(t1, alphaL)), p2: add(p3, mul(t2, alphaR)), p3 };
}

/** One Newton-Raphson step to move each parameter towards the nearest point of the curve. */
function reparameterize(s: Seg, pts: readonly V[], first: number, last: number, u: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = first; i <= last; i++) {
    const t = u[i - first] as number;
    const diff = sub(at(s, t), pts[i] as V);
    const q1 = d1(s, t);
    const q2 = d2(s, t);
    const den = dot(q1, q1) + dot(diff, q2);
    const next = Math.abs(den) < EPS ? t : t - dot(diff, q1) / den;
    out.push(Math.min(1, Math.max(0, finite(next) ? next : t)));
  }
  return out;
}

/** The biggest distance from the points to the curve at their parameters, and which point it is (an inner one). */
function maxError(s: Seg, pts: readonly V[], first: number, last: number, u: readonly number[]): { error: number; split: number } {
  let worst = 0;
  let split = Math.floor((first + last) / 2);
  for (let i = first + 1; i < last; i++) {
    const d = dist(at(s, u[i - first] as number), pts[i] as V);
    if (d >= worst) {
      worst = d;
      split = i;
    }
  }
  return { error: worst, split };
}

interface Task {
  first: number;
  last: number;
  t1: V;
  t2: V;
}

/** Fits cubics to a run of points. Iterative (an explicit stack), so a very long run cannot overflow the call stack. */
function fitRun(pts: readonly V[], error: number, tangentWindow: number): Seg[] {
  const n = pts.length;
  if (n < 2) return [];
  const forward = (from: number, step: 1 | -1): V => {
    const origin = pts[from] as V;
    let j = from + step;
    while (j > 0 && j < n - 1 && dist(pts[j] as V, origin) < tangentWindow) j += step;
    j = Math.min(n - 1, Math.max(0, j));
    return unit(sub(pts[j] as V, origin));
  };
  const chord = unit(sub(pts[n - 1] as V, pts[0] as V));
  let t1 = forward(0, 1);
  let t2 = forward(n - 1, -1);
  if (len(t1) < EPS) t1 = chord;
  if (len(t2) < EPS) t2 = mul(chord, -1);
  return fitWithTangents(pts, error, t1, t2);
}

/**
 * Fits a run, splitting where the fit is worst and, separately, splitting in the middle, and keeps whichever needed fewer pieces.
 * Splitting at the worst point suits a run with one odd bend; splitting in the middle gives even pieces, which is what a circle wants.
 */
function fitWithTangents(pts: readonly V[], error: number, t1: V, t2: V): Seg[] {
  const worst = fitSplitting(pts, error, t1, t2, false);
  if (worst.length <= 2) return worst;
  const middle = fitSplitting(pts, error, t1, t2, true);
  return middle.length < worst.length ? middle : worst;
}

function fitSplitting(pts: readonly V[], error: number, t1: V, t2: V, middle: boolean): Seg[] {
  const n = pts.length;
  if (n < 2) return [];
  const out: Seg[] = [];
  const stack: Task[] = [{ first: 0, last: n - 1, t1, t2 }];
  let budget = 8 * n + 64;
  while (stack.length > 0) {
    const task = stack.pop() as Task;
    const { first, last } = task;
    const p0 = pts[first] as V;
    const p3 = pts[last] as V;
    budget -= 1;
    if (last - first < 2 || budget < 0) {
      const d = dist(p0, p3) / 3;
      out.push({ p0, p1: add(p0, mul(task.t1, d)), p2: add(p3, mul(task.t2, d)), p3 });
      continue;
    }
    let u = chordParams(pts, first, last);
    let seg = generateBezier(pts, first, last, u, task.t1, task.t2);
    let { error: worst, split } = maxError(seg, pts, first, last, u);
    if (middle) split = (first + last) >> 1;
    if (worst < error) {
      out.push(seg);
      continue;
    }
    if (worst < 2 * error) {
      for (let k = 0; k < 4; k++) {
        u = reparameterize(seg, pts, first, last, u);
        seg = generateBezier(pts, first, last, u, task.t1, task.t2);
        const m = maxError(seg, pts, first, last, u);
        worst = m.error;
        if (!middle) split = m.split;
        if (worst < error) break;
      }
      if (worst < error) {
        out.push(seg);
        continue;
      }
    }
    // Split where the fit was worst, with one tangent for both sides so the join is smooth.
    let centre = unit(sub(pts[split - 1] as V, pts[split + 1] as V));
    if (len(centre) < EPS) centre = unit(sub(p0, p3));
    stack.push({ first: split, last, t1: mul(centre, -1), t2: task.t2 });
    stack.push({ first, last: split, t1: task.t1, t2: centre });
  }
  return out;
}

// ---- corners -------------------------------------------------------------------------------------------------

function dedupe(points: readonly Point2[], closed: boolean): Point2[] {
  const out: Point2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > 1e-9) out.push(p);
  }
  if (closed) while (out.length > 1 && dist(out[0] as V, out[out.length - 1] as V) <= 1e-9) out.pop();
  return out;
}

/** Distances along the outline to each point (a closed outline has one more entry: the whole length, back at the start). */
function arcLengths(pts: readonly V[], closed: boolean): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push((cum[i - 1] as number) + dist(pts[i] as V, pts[i - 1] as V));
  if (closed) cum.push((cum[pts.length - 1] as number) + dist(pts[pts.length - 1] as V, pts[0] as V));
  return cum;
}

/** The point `s` along the outline (it wraps round a closed one and stops at the ends of an open one). */
function pointAtArc(pts: readonly V[], cum: readonly number[], closed: boolean, s: number): V {
  const total = cum[cum.length - 1] as number;
  const n = pts.length;
  let d = s;
  if (closed) d = ((s % total) + total) % total;
  else d = Math.min(total, Math.max(0, s));
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((cum[mid] as number) <= d) lo = mid;
    else hi = mid;
  }
  const a = pts[lo] as V;
  const b = pts[(lo + 1) % n] as V;
  const span = (cum[lo + 1] as number) - (cum[lo] as number);
  return span < EPS ? a : lerp(a, b, (d - (cum[lo] as number)) / span);
}

/**
 * The points that are corners: where the outline turns by at least `angleDeg` over a window of `window` mm each side. Only the sharpest
 * point within a window of each other counts, so one corner is one node.
 */
export function findCorners(pts: readonly V[], closed: boolean, window: number, angleDeg: number = CORNER_ANGLE_DEG): number[] {
  const n = pts.length;
  const cum = arcLengths(pts, closed);
  const total = cum[cum.length - 1] as number;
  const threshold = (angleDeg * Math.PI) / 180;
  const candidates: Array<{ i: number; angle: number }> = [];
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
    const here = pts[i] as V;
    const s = cum[i] as number;
    const u = sub(here, pointAtArc(pts, cum, closed, s - window));
    const v = sub(pointAtArc(pts, cum, closed, s + window), here);
    const lu = len(u);
    const lv = len(v);
    if (lu < 0.5 * window || lv < 0.5 * window) continue;
    const angle = Math.acos(Math.min(1, Math.max(-1, dot(u, v) / (lu * lv))));
    if (angle >= threshold) candidates.push({ i, angle });
  }
  candidates.sort((a, b) => b.angle - a.angle || a.i - b.i);
  const accepted: number[] = [];
  const buckets = new Map<number, number[]>();
  const count = Math.max(1, Math.ceil(total / window));
  const key = (s: number): number => Math.floor(s / window);
  for (const c of candidates) {
    const s = cum[c.i] as number;
    const k = key(s);
    let clash = false;
    for (let dk = -1; dk <= 1 && !clash; dk++) {
      const bucket = closed ? (((k + dk) % count) + count) % count : k + dk;
      for (const other of buckets.get(bucket) ?? []) {
        const gap = Math.abs(s - (cum[other] as number));
        if ((closed ? Math.min(gap, total - gap) : gap) < window) {
          clash = true;
          break;
        }
      }
    }
    if (clash) continue;
    accepted.push(c.i);
    const own = closed ? ((k % count) + count) % count : k;
    const list = buckets.get(own) ?? [];
    list.push(c.i);
    buckets.set(own, list);
  }
  return accepted.sort((a, b) => a - b);
}

/** Extra points along edges longer than `gap`, so a fit cannot cut across a coarse outline between its points. */
function densify(pts: readonly V[], gap: number): V[] {
  const out: V[] = [pts[0] as V];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as V;
    const b = pts[i] as V;
    const d = dist(a, b);
    if (d > gap) {
      const k = Math.ceil(d / gap);
      for (let j = 1; j < k; j++) out.push(lerp(a, b, j / k));
    }
    out.push(b);
  }
  return out;
}

// ---- from curves to nodes --------------------------------------------------------------------------------------------

/** A piece whose control points lie within `flat` of its chord is a straight line: it loses its handles. */
function collapse(s: Seg, flat: number): Seg {
  const chord = sub(s.p3, s.p0);
  const l = len(chord);
  if (l < EPS) return s;
  const off = (p: V): number => Math.abs((p.x - s.p0.x) * chord.y - (p.y - s.p0.y) * chord.x) / l;
  return off(s.p1) <= flat && off(s.p2) <= flat ? { p0: s.p0, p1: s.p0, p2: s.p3, p3: s.p3 } : s;
}

const isLine = (s: Seg): boolean => s.p1 === s.p0 && s.p2 === s.p3;

/** How far a point is from the line through a and b (the distance to a when they are the same point). */
function offLine(p: V, a: V, b: V): number {
  const l = dist(a, b);
  return l < EPS ? dist(p, a) : Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / l;
}

/**
 * Straight pieces one after another that lie on one line become one piece. Every point that is dropped is checked against the
 * merged line, so merging can never add up to more than `flat`.
 */
export function mergeLines(segs: readonly Seg[], flat: number): Seg[] {
  const out: Seg[] = [];
  let group: V[] = [];
  const flush = (): void => {
    if (group.length >= 2) out.push({ p0: group[0] as V, p1: group[0] as V, p2: group[group.length - 1] as V, p3: group[group.length - 1] as V });
    group = [];
  };
  for (const s of segs) {
    if (!isLine(s)) {
      flush();
      out.push(s);
      continue;
    }
    if (group.length === 0) {
      group = [s.p0, s.p3];
      continue;
    }
    const first = group[0] as V;
    if (group.slice(1).every((p) => offLine(p, first, s.p3) <= flat)) group.push(s.p3);
    else {
      flush();
      group = [s.p0, s.p3];
    }
  }
  flush();
  return out;
}

const handleOf = (from: V, to: V): NodeHandle | undefined => {
  const h = { x: round3(to.x - from.x), y: round3(to.y - from.y) };
  return h.x === 0 && h.y === 0 ? undefined : h;
};

/** Nodes from a chain of pieces. `starts[i]` says piece i begins a run, which is a corner: the two sides of it are not tied together. */
function nodesFromSegments(segs: readonly Seg[], starts: readonly boolean[], closed: boolean): PathNode[] {
  const count = closed ? segs.length : segs.length + 1;
  const nodes: PathNode[] = [];
  for (let i = 0; i < count; i++) {
    const out = i < segs.length ? (segs[i] as Seg) : undefined;
    const into = i > 0 ? (segs[i - 1] as Seg) : closed ? (segs[segs.length - 1] as Seg) : undefined;
    const here = out ? out.p0 : (into as Seg).p3;
    const node: PathNode = { x: round3(here.x), y: round3(here.y) };
    const hin = into ? handleOf(into.p3, into.p2) : undefined;
    const hout = out ? handleOf(out.p0, out.p1) : undefined;
    if (hin) node.in = hin;
    if (hout) node.out = hout;
    if (hin && hout && !starts[i]) node.mode = 'smooth';
    nodes.push(node);
  }
  return nodes;
}

function cornerNodes(path: Path2D): NodePath {
  return nodesFromPaths([path])[0] as NodePath;
}

/**
 * One outline as curve nodes within `toleranceMm` of it. An outline too small to fit (or with a coordinate that is not a number), and
 * one the fit would not make smaller, come back as one corner node for every point, exactly as they were.
 */
export function fitPath(path: Path2D, toleranceMm: number = FIT_DEFAULT_TOLERANCE_MM, cornerAngleDeg: number = CORNER_ANGLE_DEG): NodePath {
  if (!path.points.every((p) => finite(p.x) && finite(p.y))) return cornerNodes(path);
  const closed = path.closed;
  const pts = dedupe(path.points, closed);
  if (pts.length < (closed ? 3 : 2)) return cornerNodes(path);
  const error = fitErrorFor(toleranceMm);
  const window = windowFor(error);
  const gap = Math.max(6 * error, window / 2);

  const segs: Seg[] = [];
  let starts: boolean[] = [];
  const addRun = (run: readonly V[], tangents?: { t1: V; t2: V }): void => {
    const dense = densify(run, gap);
    const made = tangents ? fitWithTangents(dense, error, tangents.t1, tangents.t2) : fitRun(dense, error, window);
    mergeLines(made.map((s) => collapse(s, 0.5 * error)), 0.5 * error).forEach((s, k) => {
      segs.push(s);
      starts.push(k === 0);
    });
  };

  const corners = findCorners(pts, closed, window, cornerAngleDeg);
  const n = pts.length;
  if (!closed) {
    const cuts = [0, ...corners, n - 1];
    for (let k = 0; k + 1 < cuts.length; k++) addRun(pts.slice(cuts[k] as number, (cuts[k + 1] as number) + 1));
  } else if (corners.length > 0) {
    for (let k = 0; k < corners.length; k++) {
      const from = corners[k] as number;
      const to = k + 1 < corners.length ? (corners[k + 1] as number) : (corners[0] as number) + n;
      const run: V[] = [];
      for (let i = from; i <= to; i++) run.push(pts[i % n] as V);
      addRun(run);
    }
  } else {
    // A smooth closed outline: cut it at its first point, and make the two ends meet with one tangent.
    const cum = arcLengths(pts, true);
    const tangent = unit(sub(pointAtArc(pts, cum, true, window), pointAtArc(pts, cum, true, -window)));
    const run: V[] = [...pts, pts[0] as V];
    addRun(run, len(tangent) > EPS ? { t1: tangent, t2: mul(tangent, -1) } : undefined);
    starts = starts.map(() => false);
    starts[0] = len(tangent) <= EPS;
  }
  if (segs.length === 0) return cornerNodes(path);

  let nodes: NodePath = { closed, nodes: nodesFromSegments(segs, starts, closed) };
  // A closed outline needs three nodes: split the longest piece until it has them.
  for (let guard = 0; closed && nodes.nodes.length < 3 && guard < 4; guard++) {
    const split = insertNode([nodes], { path: 0, segment: 0 }, 0.5);
    if (!split) return cornerNodes(path);
    nodes = split.nodes[0] as NodePath;
  }
  if (!nodes.nodes.every((p) => finite(p.x) && finite(p.y))) return cornerNodes(path);
  return nodes.nodes.length >= path.points.length ? cornerNodes(path) : nodes;
}

/** A tolerance the Fit curves box was given, made usable: between the least and the most, and the usual one for something that is not a number. */
export function fitToleranceFor(toleranceMm: number): number {
  if (!finite(toleranceMm)) return FIT_DEFAULT_TOLERANCE_MM;
  return Math.min(FIT_MAX_TOLERANCE_MM, Math.max(FIT_MIN_TOLERANCE_MM, toleranceMm));
}

export interface FitResult {
  nodes: NodePath[];
  /** Points in the outlines before. */
  before: number;
  /** Nodes after. */
  after: number;
}

/** Every outline of an object fitted, with how many points became how many nodes. */
export function fitOutlines(paths: readonly Path2D[], toleranceMm: number = FIT_DEFAULT_TOLERANCE_MM): FitResult {
  const tol = fitToleranceFor(toleranceMm);
  const nodes = paths.map((p) => fitPath(p, tol));
  return {
    nodes,
    before: paths.reduce((sum, p) => sum + p.points.length, 0),
    after: nodes.reduce((sum, p) => sum + p.nodes.length, 0),
  };
}

export type FitAccess = { ok: true; points: number } | { ok: false; message: string };

/** Whether an object can be fitted, and what to tell the user when it cannot. Text and shapes are refused until they are converted. */
export function fitAccess(kind: ObjectKind): FitAccess {
  if (kind.type !== 'vector') return { ok: false, message: 'Only outlines can be fitted: a picture cannot. Trace it first to get outlines.' };
  if (kind.source) return { ok: false, message: 'This is still text or a shape. Press Convert to outlines first, then fit curves.' };
  const points = kind.paths.reduce((sum, p) => sum + p.points.length, 0);
  if (!kind.paths.some((p) => p.points.length >= 2)) return { ok: false, message: 'There are no outlines to fit.' };
  if (points > MAX_FIT_POINTS) return { ok: false, message: `It has more than ${MAX_FIT_POINTS.toLocaleString('en-NZ')} points, too many to fit at once.` };
  return { ok: true, points };
}
