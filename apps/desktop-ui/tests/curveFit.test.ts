import { describe, expect, it } from 'vitest';
import {
  CORNER_ANGLE_DEG,
  FIT_DEFAULT_TOLERANCE_MM,
  FIT_MAX_TOLERANCE_MM,
  FIT_MIN_TOLERANCE_MM,
  MAX_FIT_POINTS,
  findCorners,
  fitAccess,
  fitErrorFor,
  fitOutlines,
  fitPath,
  mergeLines,
  windowFor,
  type Seg,
} from '@/lib/curveFit';
import { flattenNodePath, kindWithNodes, nodeAccess, nodesFromPaths, nodesMatchPaths, segmentCount, segmentControls } from '@/lib/nodePath';
import { defaultShape, shapePaths } from '@/lib/shapes';
import type { NodePath, ObjectKind, Path2D, Point2 } from '@/types/domain';

// ---- helpers ------------------------------------------------------------------------------------------

function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v as object)) freeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const circle = (r: number, n: number, cx = r, cy = r): Path2D => ({
  closed: true,
  points: Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / n), y: cy + r * Math.sin((2 * Math.PI * i) / n) })),
});
const ellipse = (rx: number, ry: number, n: number): Path2D => ({
  closed: true,
  points: Array.from({ length: n }, (_, i) => ({ x: rx + rx * Math.cos((2 * Math.PI * i) / n), y: ry + ry * Math.sin((2 * Math.PI * i) / n) })),
});
/** A square of side s with `per` points on each side, going clockwise from the top left. */
function square(s: number, per: number): Path2D {
  const c = [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }];
  const points: Point2[] = [];
  for (let k = 0; k < 4; k++) {
    const a = c[k] as Point2;
    const b = c[(k + 1) % 4] as Point2;
    for (let i = 0; i < per; i++) points.push({ x: a.x + ((b.x - a.x) * i) / per, y: a.y + ((b.y - a.y) * i) / per });
  }
  return { closed: true, points };
}
const sine = (n: number): Path2D => ({
  closed: false,
  points: Array.from({ length: n }, (_, i) => ({ x: (i * 60) / (n - 1), y: 8 * Math.sin((i * 4 * Math.PI) / (n - 1)) })),
});
/** A circle drawn in square pixels of `px` mm and followed round the edge of the pixels: a traced picture. */
function staircase(r: number, px: number): Path2D {
  const pts: Point2[] = [];
  const steps = Math.round(((2 * Math.PI * r) / px) * 1.4);
  let last: Point2 | null = null;
  for (let k = 0; k < steps; k++) {
    const a = (2 * Math.PI * k) / steps;
    const x = Math.round((r + r * Math.cos(a)) / px) * px;
    const y = Math.round((r + r * Math.sin(a)) / px) * px;
    if (!last || last.x !== x || last.y !== y) {
      if (last && last.x !== x && last.y !== y) pts.push({ x, y: last.y });
      pts.push({ x, y });
      last = { x, y };
    }
  }
  return { closed: true, points: pts };
}
/** A lens: two circular arcs of radius `r` over a chord of 2 * `half` mm, meeting at two sharp tips at (0, 0) and (2 * half, 0). */
function lens(r: number, half: number, per: number): Path2D {
  const d = Math.sqrt(r * r - half * half);
  const a0 = Math.atan2(d, -half);
  const a1 = Math.atan2(d, half);
  const points: Point2[] = [];
  for (let i = 0; i <= per; i++) {
    const a = a0 + ((a1 - a0) * i) / per;
    points.push({ x: half + r * Math.cos(a), y: -d + r * Math.sin(a) });
  }
  for (let i = 1; i < per; i++) {
    const a = a1 + ((a0 - a1) * i) / per;
    points.push({ x: half + r * Math.cos(a), y: d - r * Math.sin(a) });
  }
  return { closed: true, points };
}
const roundedRect = (w: number, h: number, r: number): Path2D => shapePaths({ ...defaultShape('rectangle'), width_mm: w, height_mm: h, corner_radius_mm: r })[0] as Path2D;
const star = (): Path2D => shapePaths({ ...defaultShape('star'), width_mm: 40, height_mm: 40, sides: 5 })[0] as Path2D;
const rotate = (p: Path2D, deg: number): Path2D => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return { closed: p.closed, points: p.points.map((q) => ({ x: q.x * c - q.y * s + 30, y: q.x * s + q.y * c - 20 })) };
};

function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function distanceToLine(p: Point2, pts: readonly Point2[], closed: boolean): number {
  let best = Infinity;
  const n = pts.length;
  for (let i = 0; i + 1 < n; i++) best = Math.min(best, distanceToSegment(p, pts[i] as Point2, pts[i + 1] as Point2));
  if (closed) best = Math.min(best, distanceToSegment(p, pts[n - 1] as Point2, pts[0] as Point2));
  return best;
}
function sampled(pts: readonly Point2[], closed: boolean, step: number): Point2[] {
  const out: Point2[] = [];
  const n = pts.length;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i] as Point2;
    const b = pts[(i + 1) % n] as Point2;
    const k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 0; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  }
  if (!closed) out.push(pts[n - 1] as Point2);
  return out;
}
/** How far apart two outlines are at worst, looking both ways (the Hausdorff distance), with every point of both checked every 0.05 mm. */
function hausdorff(a: readonly Point2[], b: readonly Point2[], closed: boolean): number {
  let worst = 0;
  for (const p of sampled(a, closed, 0.05)) worst = Math.max(worst, distanceToLine(p, b, closed));
  for (const p of sampled(b, closed, 0.05)) worst = Math.max(worst, distanceToLine(p, a, closed));
  return worst;
}
const flatOf = (np: NodePath): Point2[] => flattenNodePath(np).points;
const isStraight = (np: NodePath, segment: number): boolean => segmentControls(np, segment).straight;
const handleCount = (np: NodePath): number => np.nodes.filter((n) => n.in || n.out).length;

// ---- the settings --------------------------------------------------------------------------------------

describe('what to fit to', () => {
  it('has sensible limits and starts inside them', () => {
    expect(FIT_MIN_TOLERANCE_MM).toBeLessThan(FIT_DEFAULT_TOLERANCE_MM);
    expect(FIT_DEFAULT_TOLERANCE_MM).toBeLessThan(FIT_MAX_TOLERANCE_MM);
    expect(CORNER_ANGLE_DEG).toBeGreaterThan(10);
    expect(CORNER_ANGLE_DEG).toBeLessThan(60);
  });
  it('fits to less than the tolerance asked for, which leaves room for flattening, and never to less than 5 micrometres', () => {
    expect(fitErrorFor(0.05)).toBeLessThan(0.05);
    expect(fitErrorFor(0.05)).toBeGreaterThan(0.02);
    expect(fitErrorFor(0.1)).toBeGreaterThan(fitErrorFor(0.05));
    expect(fitErrorFor(FIT_MIN_TOLERANCE_MM)).toBeGreaterThanOrEqual(0.005);
    expect(fitErrorFor(0.001)).toBe(0.005);
    expect(fitErrorFor(2)).toBeCloseTo((2 - 0.015) / 1.375, 6);
  });
  it('looks over a window that grows with the tolerance but is never tiny', () => {
    expect(windowFor(0.001)).toBe(0.1);
    expect(windowFor(0.1)).toBeCloseTo(0.8, 9);
    expect(windowFor(0.2)).toBeGreaterThan(windowFor(0.1));
  });
});

// ---- corners ----------------------------------------------------------------------------------------------

describe('findCorners', () => {
  it('a square with many points on each side has exactly its four corners', () => {
    const sq = square(40, 100);
    expect(findCorners(sq.points, true, 0.2)).toEqual([0, 100, 200, 300]);
  });
  it('a circle has none, however small the steps or big the circle', () => {
    expect(findCorners(circle(20, 400).points, true, 0.2)).toEqual([]);
    expect(findCorners(circle(100, 5000).points, true, 0.4)).toEqual([]);
  });
  it('a star has all ten of its points and dents', () => {
    expect(findCorners(star().points, true, 0.2)).toHaveLength(10);
  });
  it('an open line with one bend has one corner, and its end points are never corners', () => {
    const l: Point2[] = [];
    for (let i = 0; i <= 50; i++) l.push({ x: i, y: 0 });
    for (let i = 1; i <= 50; i++) l.push({ x: 50, y: i });
    expect(findCorners(l, false, 0.5)).toEqual([50]);
    expect(findCorners([{ x: 0, y: 0 }, { x: 10, y: 0 }], false, 0.5)).toEqual([]);
  });
  it('steps smaller than the window are not corners, so a pixelated line does not fall to pieces', () => {
    const stairs: Point2[] = [];
    for (let i = 0; i < 60; i++) {
      stairs.push({ x: i * 0.2, y: Math.floor(i / 2) * 0.1 });
      stairs.push({ x: (i + 1) * 0.2, y: Math.floor(i / 2) * 0.1 });
    }
    expect(findCorners(stairs, false, 1)).toEqual([]);
    expect(findCorners(stairs, false, 0.12).length).toBeGreaterThan(0);
  });
  it('of two sharp points closer together than the window, only the sharper one counts', () => {
    const pts: Point2[] = [];
    for (let i = 0; i <= 40; i++) pts.push({ x: i * 0.25, y: 0 });
    pts.push({ x: 10.2, y: 0.9 });
    for (let i = 1; i <= 40; i++) pts.push({ x: 10.2 + i * 0.25, y: 1 });
    expect(findCorners(pts, false, 3).length).toBeLessThanOrEqual(1);
    expect(findCorners(pts, false, 0.2).length).toBeGreaterThanOrEqual(2);
  });
  it('the angle that makes a corner can be changed', () => {
    const hex = circle(10, 12).points;
    expect(findCorners(hex, true, 0.2, 25)).toHaveLength(12);
    expect(findCorners(hex, true, 0.2, 45)).toHaveLength(0);
  });
  it('wraps round the start of a closed outline', () => {
    const sq = square(40, 100);
    const shifted = [...sq.points.slice(37), ...sq.points.slice(0, 37)];
    expect(findCorners(shifted, true, 0.2)).toEqual([63, 163, 263, 363]);
  });
  it('does not change what it is given', () => {
    findCorners(freeze(square(10, 20).points), true, 0.2);
  });
});

// ---- fitting one outline -----------------------------------------------------------------------------------

describe('fitPath on smooth outlines', () => {
  it('a circle of 400 points becomes a handful of smooth curve nodes that stay within the tolerance', () => {
    const c = circle(20, 400);
    const np = fitPath(freeze(c), 0.05);
    expect(np.closed).toBe(true);
    expect(np.nodes.length).toBeGreaterThanOrEqual(3);
    expect(np.nodes.length).toBeLessThanOrEqual(8);
    expect(np.nodes.every((n) => n.in && n.out && n.mode === 'smooth')).toBe(true);
    expect(hausdorff(c.points, flatOf(np), true)).toBeLessThanOrEqual(0.05);
  });
  it('a looser tolerance never needs more nodes, and a bigger circle at the same tolerance needs only a few more', () => {
    const c = circle(20, 400);
    const counts = [0.025, 0.05, 0.1, 0.3, 1].map((t) => fitPath(c, t).nodes.length);
    for (let i = 1; i < counts.length; i++) expect(counts[i] as number).toBeLessThanOrEqual(counts[i - 1] as number);
    expect(counts[counts.length - 1]).toBeLessThanOrEqual(4);
    expect(fitPath(circle(100, 2000), 0.05).nodes.length).toBeLessThanOrEqual(20);
  });
  it('an ellipse and a sine wave stay within the tolerance, however tight or loose it is', () => {
    for (const path of [ellipse(30, 8, 500), sine(600)]) {
      for (const tol of [0.025, 0.1, 0.3, 1]) {
        const np = fitPath(path, tol);
        expect(np.closed).toBe(path.closed);
        expect(hausdorff(path.points, flatOf(np), path.closed)).toBeLessThanOrEqual(tol);
        expect(np.nodes.length).toBeLessThan(path.points.length / 4);
      }
    }
  });
  it('an open outline keeps its two end points exactly', () => {
    const s = sine(600);
    const np = fitPath(s, 0.05);
    expect(np.closed).toBe(false);
    expect(np.nodes[0]).toMatchObject({ x: s.points[0]?.x, y: s.points[0]?.y });
    const last = np.nodes[np.nodes.length - 1];
    expect(last?.x).toBeCloseTo(60, 3);
    expect(last?.y).toBeCloseTo(s.points[599]?.y ?? NaN, 3);
    expect(np.nodes[0]?.in).toBeUndefined();
    expect(last?.out).toBeUndefined();
  });
  it('noise far smaller than the tolerance does not make more nodes', () => {
    const rand = rng(7);
    const c = circle(20, 400);
    const noisy: Path2D = { closed: true, points: c.points.map((p) => ({ x: p.x + (rand() - 0.5) * 0.008, y: p.y + (rand() - 0.5) * 0.008 })) };
    expect(fitPath(noisy, 0.05).nodes.length).toBeLessThanOrEqual(12);
    expect(hausdorff(noisy.points, flatOf(fitPath(noisy, 0.05)), true)).toBeLessThanOrEqual(0.05);
  });
  it('the same shape anywhere on the bed, and turned any way, gives about the same result', () => {
    const base = fitPath(circle(20, 400), 0.05).nodes.length;
    for (const [dx, dy] of [[1000, -500], [-300, 4000]] as const) {
      const moved: Path2D = { closed: true, points: circle(20, 400).points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
      expect(Math.abs(fitPath(moved, 0.05).nodes.length - base)).toBeLessThanOrEqual(2);
    }
    for (const deg of [17, 37, 90, 133]) {
      const e = rotate(ellipse(30, 8, 500), deg);
      const np = fitPath(e, 0.05);
      expect(hausdorff(e.points, flatOf(np), true)).toBeLessThanOrEqual(0.05);
      expect(np.nodes.length).toBeLessThan(40);
    }
  });
  it('fits a circle of 100,000 points to a few nodes', () => {
    const np = fitPath(circle(100, 100000), 0.05);
    expect(np.nodes.length).toBeLessThanOrEqual(24);
    expect(np.nodes.length).toBeGreaterThanOrEqual(4);
  });
  it('fitting the fitted outline again does not make it much worse or much bigger', () => {
    const c = circle(20, 400);
    const first = fitPath(c, 0.05);
    const again = fitPath({ closed: true, points: flatOf(first) }, 0.05);
    expect(again.nodes.length).toBeLessThanOrEqual(first.nodes.length * 2);
    expect(hausdorff(c.points, flatOf(again), true)).toBeLessThanOrEqual(0.1);
  });
});

describe('fitPath on outlines with corners', () => {
  it('a square with 400 points is four corner nodes with no handles, exactly at the corners', () => {
    const np = fitPath(square(40, 100), 0.05);
    expect(np.nodes).toEqual([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }]);
  });
  it('a star keeps its ten points as they were: there is nothing to gain, so nothing is changed', () => {
    const s = star();
    expect(fitPath(s, 0.05)).toEqual(nodesFromPaths([s])[0]);
  });
  it('a polygon with few points keeps every one, even when its turns are modest, because it is only kept within the tolerance', () => {
    for (const n of [3, 4, 5, 6, 8, 12]) {
      const c = circle(10, n);
      const np = fitPath(c, 0.05);
      expect(hausdorff(c.points, flatOf(np), true)).toBeLessThanOrEqual(0.05);
      expect(np.nodes.length).toBeGreaterThanOrEqual(Math.min(n, 3));
    }
    expect(fitPath(circle(10, 6), 0.05).nodes).toHaveLength(6);
  });
  it('a rounded rectangle keeps straight sides straight and its corners curved, all within the tolerance', () => {
    for (const [w, h, r] of [[40, 20, 5], [100, 60, 12]] as const) {
      const rr = roundedRect(w, h, r);
      const np = fitPath(rr, 0.05);
      let straight = 0;
      for (let i = 0; i < segmentCount(np); i++) if (isStraight(np, i)) straight++;
      expect(straight).toBeGreaterThanOrEqual(4);
      expect(np.nodes.length).toBeLessThan(rr.points.length);
      expect(hausdorff(rr.points, flatOf(np), true)).toBeLessThanOrEqual(0.05);
    }
  });
  it('a straight run of many points is two nodes and no handles', () => {
    const line: Path2D = { closed: false, points: Array.from({ length: 100 }, (_, i) => ({ x: i * 0.5, y: i * 0.25 })) };
    const np = fitPath(line, 0.05);
    expect(np.nodes).toHaveLength(2);
    expect(handleCount(np)).toBe(0);
  });
  it('an open line with one bend is three nodes, the bend a corner', () => {
    const pts: Point2[] = [];
    for (let i = 0; i <= 50; i++) pts.push({ x: i, y: 0 });
    for (let i = 1; i <= 50; i++) pts.push({ x: 50, y: i });
    const np = fitPath({ closed: false, points: pts }, 0.05);
    expect(np.nodes).toEqual([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }]);
  });
  it('a straight edge followed by an arc is one straight piece and a few curves, all within the tolerance', () => {
    const pts: Point2[] = [];
    for (let i = 0; i <= 40; i++) pts.push({ x: i * 0.5, y: 0 });
    // then a quarter of a circle of radius 10 centred at (20, 10): it leaves the line smoothly at (20, 0)
    for (let i = 1; i <= 90; i++) {
      const theta = (i * Math.PI) / 2 / 90;
      pts.push({ x: 20 + 10 * Math.sin(theta), y: 10 - 10 * Math.cos(theta) });
    }
    const np = fitPath({ closed: false, points: pts }, 0.05);
    expect(np.nodes.length).toBeLessThanOrEqual(6);
    expect(isStraight(np, 0)).toBe(true);
    expect(np.nodes[0]).toEqual({ x: 0, y: 0 });
    expect(np.nodes[1]?.x).toBeGreaterThan(15);
    expect(np.nodes[1]?.x).toBeLessThanOrEqual(20.5);
    expect(hausdorff(pts, flatOf(np), false)).toBeLessThanOrEqual(0.05);
  });
  it('straight pieces one after another on one line are merged, and ones that bend are not', () => {
    const line: Path2D = { closed: false, points: Array.from({ length: 200 }, (_, i) => ({ x: i * 0.3, y: 0 })) };
    expect(fitPath(line, 0.05).nodes).toHaveLength(2);
    const wobble: Path2D = { closed: false, points: Array.from({ length: 200 }, (_, i) => ({ x: i * 0.3, y: i < 100 ? 0 : (i - 100) * 0.05 })) };
    const np = fitPath(wobble, 0.05);
    expect(np.nodes.length).toBeGreaterThanOrEqual(3);
    expect(hausdorff(wobble.points, flatOf(np), false)).toBeLessThanOrEqual(0.05);
  });
});

describe('fitPath: the nodes it makes follow the rules', () => {
  const cases: Array<[string, Path2D]> = [
    ['circle', circle(20, 400)],
    ['ellipse', ellipse(30, 8, 500)],
    ['sine', sine(600)],
    ['rounded rectangle', roundedRect(40, 20, 5)],
    ['square', square(40, 50)],
    ['star', star()],
  ];
  it('closed outlines have at least three nodes, open ones at least two, and the closed flag is kept', () => {
    for (const [, p] of cases) {
      const np = fitPath(p, 0.05);
      expect(np.closed).toBe(p.closed);
      expect(np.nodes.length).toBeGreaterThanOrEqual(p.closed ? 3 : 2);
    }
  });
  it('every number is finite and kept to a thousandth of a millimetre', () => {
    const thousandth = (v: number) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6;
    for (const [, p] of cases) {
      for (const n of fitPath(p, 0.05).nodes) {
        expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
        expect(thousandth(n.x) && thousandth(n.y)).toBe(true);
        for (const h of [n.in, n.out]) if (h) expect(Number.isFinite(h.x) && Number.isFinite(h.y) && thousandth(h.x) && thousandth(h.y)).toBe(true);
      }
    }
  });
  it('a node is smooth only when it has two handles on one line pointing opposite ways, and no handle is empty', () => {
    for (const [, p] of cases) {
      for (const n of fitPath(p, 0.05).nodes) {
        for (const h of [n.in, n.out]) if (h) expect(Math.hypot(h.x, h.y)).toBeGreaterThan(0);
        if (n.mode === 'smooth') {
          expect(n.in && n.out).toBeTruthy();
          const a = n.in as { x: number; y: number };
          const b = n.out as { x: number; y: number };
          expect(a.x * b.x + a.y * b.y).toBeLessThan(0);
          expect(Math.abs(a.x * b.y - a.y * b.x)).toBeLessThanOrEqual(0.02 * Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) + 0.002);
        }
      }
    }
  });
  it('no handle is longer than the piece it belongs to, so nothing swings out', () => {
    for (const [, p] of cases) {
      const np = fitPath(p, 0.05);
      for (let i = 0; i < segmentCount(np); i++) {
        const s = segmentControls(np, i);
        const chord = Math.hypot(s.p3.x - s.p0.x, s.p3.y - s.p0.y);
        expect(Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y)).toBeLessThanOrEqual(chord * 1.5 + 0.01);
        expect(Math.hypot(s.p2.x - s.p3.x, s.p2.y - s.p3.y)).toBeLessThanOrEqual(chord * 1.5 + 0.01);
      }
    }
  });
  it('the outline made from the nodes is what flattening them gives, and the object takes it back as it is', () => {
    for (const [, p] of cases) {
      const np = fitPath(p, 0.05);
      const kind = kindWithNodes({ type: 'vector', paths: [] }, [np]);
      expect(nodesMatchPaths(kind.nodes ?? [], kind.paths)).toBe(true);
      const access = nodeAccess(kind);
      expect(access.ok && !access.stale && !access.fromPaths).toBe(true);
    }
  });
  it('does not change what it is given', () => {
    for (const [, p] of cases) fitPath(freeze(JSON.parse(JSON.stringify(p)) as Path2D), 0.05);
  });
});

describe('fitPath: awkward input', () => {
  it('points that repeat, and a closed outline that ends where it began, are tidied', () => {
    const c = circle(20, 400);
    const messy: Path2D = { closed: true, points: [...c.points.flatMap((p) => [p, p]), c.points[0] as Point2] };
    const np = fitPath(messy, 0.05);
    expect(np.nodes.length).toBeLessThanOrEqual(8);
    expect(hausdorff(c.points, flatOf(np), true)).toBeLessThanOrEqual(0.05);
  });
  it('anything too small to fit comes back as it was, one corner node for each point', () => {
    const tiny: Path2D[] = [
      { closed: true, points: [] },
      { closed: true, points: [{ x: 1, y: 1 }] },
      { closed: true, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
      { closed: false, points: [{ x: 1, y: 1 }] },
      { closed: true, points: [{ x: 3, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 3 }] },
    ];
    for (const p of tiny) expect(fitPath(p, 0.05)).toEqual(nodesFromPaths([p])[0]);
  });
  it('a coordinate that is not a number leaves the outline as it was', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = circle(10, 100);
      p.points[40] = { x: bad, y: 3 };
      expect(fitPath(p, 0.05)).toEqual(nodesFromPaths([p])[0]);
    }
  });
  it('a closed outline that fits in two pieces is given a third node, and its two sharp tips stay corners', () => {
    // two shallow arcs: each is one cubic, so the fit is only two pieces, but a closed outline needs three nodes
    const l = lens(30, 10, 120);
    const np = fitPath(l, 0.05);
    expect(np.nodes).toHaveLength(3);
    expect(hausdorff(l.points, flatOf(np), true)).toBeLessThanOrEqual(0.05);
    const tips = np.nodes.filter((n) => (Math.abs(n.x) < 0.01 || Math.abs(n.x - 20) < 0.01) && Math.abs(n.y) < 0.01);
    expect(tips).toHaveLength(2);
    for (const t of tips) expect(t.mode).toBeUndefined();
  });
  it('a lens with deeper arcs keeps its two tips as corners with a handle on each side', () => {
    const l = lens(15, 10, 80);
    const np = fitPath(l, 0.05);
    expect(np.nodes.length).toBeGreaterThanOrEqual(3);
    expect(hausdorff(l.points, flatOf(np), true)).toBeLessThanOrEqual(0.05);
    const tips = np.nodes.filter((n) => (Math.abs(n.x) < 0.01 || Math.abs(n.x - 20) < 0.01) && Math.abs(n.y) < 0.01);
    expect(tips).toHaveLength(2);
    for (const t of tips) {
      expect(t.mode).toBeUndefined();
      expect(t.in && t.out).toBeTruthy();
    }
  });
  it('a fit that would not make the outline smaller leaves it exactly as it was', () => {
    const sparse: Path2D = { closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 25, y: 3 }, { x: 31, y: 20 }] };
    expect(fitPath(sparse, 0.05)).toEqual(nodesFromPaths([sparse])[0]);
    // This five-point zigzag would come out as seven nodes if the fit were kept: more than it started with.
    const zigzag: Path2D = { closed: false, points: [{ x: 8, y: 18.5 }, { x: 15, y: 3 }, { x: 13.5, y: 7 }, { x: 7, y: 16 }, { x: 16, y: 3.5 }] };
    expect(fitPath(zigzag, 0.05)).toEqual(nodesFromPaths([zigzag])[0]);
  });
  it('repeated points, and a closing point that repeats the first, give exactly the same result as without them', () => {
    const c = circle(20, 400);
    const clean = fitPath(c, 0.05);
    const closing: Path2D = { closed: true, points: [...c.points, c.points[0] as Point2] };
    expect(fitPath(closing, 0.05)).toEqual(clean);
    const repeats: Path2D = { closed: true, points: c.points.flatMap((p, i) => (i === 7 || i === 150 || i === 399 ? [p, p, p] : [p])) };
    expect(fitPath(repeats, 0.05)).toEqual(clean);
    // a closed triangle written with its first point again at the end is three nodes, not four
    const tri: Path2D = { closed: true, points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 15, y: 20 }, { x: 0, y: 0 }] };
    expect(fitPath(tri, 0.05).nodes).toHaveLength(3);
    const s = sine(600);
    const openRepeats: Path2D = { closed: false, points: s.points.flatMap((p, i) => (i === 0 || i === 300 || i === 599 ? [p, p] : [p])) };
    expect(fitPath(openRepeats, 0.05)).toEqual(fitPath(s, 0.05));
  });
});

describe('fitPath on a traced picture (an outline made of pixel steps)', () => {
  it('stays within the tolerance however it is fitted, so no handle swings out between the steps', () => {
    for (const tol of [0.05, 0.1, 0.2, 0.3, 1]) {
      const st = staircase(10, 0.1);
      const np = fitPath(st, tol);
      expect(hausdorff(st.points, flatOf(np), true)).toBeLessThanOrEqual(tol);
    }
  });
  it('needs a distance bigger than the pixels to smooth, and then gives a few nodes', () => {
    const st = staircase(10, 0.1);
    expect(fitPath(st, 0.3).nodes.length).toBeLessThanOrEqual(10);
    expect(fitPath(st, 0.05).nodes.length).toBeGreaterThan(fitPath(st, 0.3).nodes.length * 5);
  });
});

describe('mergeLines', () => {
  const line = (a: Point2, b: Point2): Seg => ({ p0: a, p1: a, p2: b, p3: b });
  const curve = (a: Point2, b: Point2): Seg => ({ p0: a, p1: { x: a.x + 1, y: a.y + 5 }, p2: { x: b.x - 1, y: b.y + 5 }, p3: b });
  const P = (x: number, y: number): Point2 => ({ x, y });
  it('joins straight pieces that lie on one line into one', () => {
    const a = P(0, 0);
    const b = P(10, 0);
    const c = P(20, 0.01);
    const d = P(30, 0);
    const out = mergeLines([line(a, b), line(b, c), line(c, d)], 0.05);
    expect(out).toHaveLength(1);
    expect(out[0]?.p0).toBe(a);
    expect(out[0]?.p3).toBe(d);
    expect(out[0]?.p1).toBe(a);
    expect(out[0]?.p2).toBe(d);
  });
  it('does not join pieces that bend by more than the allowance', () => {
    const out = mergeLines([line(P(0, 0), P(10, 0)), line(P(10, 0), P(20, 0.5))], 0.05);
    expect(out).toHaveLength(2);
  });
  it('checks every point it drops against the merged line, so small drifts cannot add up', () => {
    // each step leaves the line by 0.04 (inside 0.05), but together they wander 0.4 away
    const segs: Seg[] = [];
    for (let i = 0; i < 10; i++) segs.push(line(P(i * 10, i * 0.04 * i * 0.5), P((i + 1) * 10, (i + 1) * 0.04 * (i + 1) * 0.5)));
    const out = mergeLines(segs, 0.05);
    expect(out.length).toBeGreaterThan(1);
    for (const m of out) expect(m.p0.x).toBeLessThan(m.p3.x);
  });
  it('leaves curves where they are, and does not join lines across one', () => {
    const a = P(0, 0);
    const b = P(10, 0);
    const c = P(20, 0);
    const d = P(30, 0);
    const e = P(40, 0);
    const mid = curve(c, d);
    const out = mergeLines([line(a, b), line(b, c), mid, line(d, e)], 0.05);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe(mid);
    expect(out[0]?.p3).toBe(c);
  });
  it('is nothing for nothing, and a single piece for a single piece', () => {
    expect(mergeLines([], 0.05)).toEqual([]);
    const only = line(P(0, 0), P(5, 5));
    expect(mergeLines([only], 0.05)).toEqual([only]);
  });
});

// ---- a whole object ------------------------------------------------------------------------------------------------

describe('fitOutlines', () => {
  it('fits every outline and says how many points became how many nodes', () => {
    const paths = [circle(20, 400), square(40, 100), sine(300)];
    const r = fitOutlines(freeze(paths), 0.05);
    expect(r.nodes).toHaveLength(3);
    expect(r.before).toBe(400 + 400 + 300);
    expect(r.after).toBe(r.nodes.reduce((n, p) => n + p.nodes.length, 0));
    expect(r.after).toBeLessThan(40);
    expect(r.nodes[1]?.nodes).toHaveLength(4);
  });
  it('an object of nothing is nothing', () => {
    expect(fitOutlines([], 0.05)).toEqual({ nodes: [], before: 0, after: 0 });
  });
  it('keeps the tolerance between its smallest and largest, and uses the usual one for something that is not a number', () => {
    const c = [circle(20, 400)];
    expect(fitOutlines(c, 0.0001).nodes).toEqual(fitOutlines(c, FIT_MIN_TOLERANCE_MM).nodes);
    expect(fitOutlines(c, 9999).nodes).toEqual(fitOutlines(c, FIT_MAX_TOLERANCE_MM).nodes);
    expect(fitOutlines(c, Number.NaN).nodes).toEqual(fitOutlines(c, FIT_DEFAULT_TOLERANCE_MM).nodes);
    expect(fitOutlines(c, -3).nodes).toEqual(fitOutlines(c, FIT_MIN_TOLERANCE_MM).nodes);
  });
});

describe('fitAccess', () => {
  const vec = (extra: Record<string, unknown> = {}): ObjectKind => ({ type: 'vector', paths: [circle(5, 50)], ...extra }) as ObjectKind;
  it('allows an outline, and says how many points it has', () => {
    expect(fitAccess(vec())).toEqual({ ok: true, points: 50 });
  });
  it('refuses a picture, text and shapes, an empty object and one that is too big, each in words', () => {
    const picture: ObjectKind = { type: 'image', asset_id: 'a', format: 'png', source_path: null, width_px: 1, height_px: 1, dpi: 96 };
    const refused = [
      fitAccess(picture),
      fitAccess(vec({ source: { type: 'shape' } })),
      fitAccess({ type: 'vector', paths: [] }),
      fitAccess({ type: 'vector', paths: [{ closed: false, points: [{ x: 1, y: 1 }] }] }),
      fitAccess({ type: 'vector', paths: [{ closed: false, points: Array.from({ length: MAX_FIT_POINTS + 1 }, (_, i) => ({ x: i, y: 0 })) }] }),
    ];
    for (const r of refused) expect(!r.ok && r.message.length).toBeGreaterThan(15);
    expect(!refused[0]?.ok && (refused[0] as { message: string }).message).toContain('Trace');
    expect((refused[1] as { message: string }).message).toContain('Convert to outlines');
  });
});
