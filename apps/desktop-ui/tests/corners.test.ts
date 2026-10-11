import { describe, expect, it } from 'vitest';
import {
  CORNER_WHICH,
  CORNER_WHICH_LABELS,
  DEFAULT_MIN_TURN_DEG,
  MAX_CORNER_MM,
  MAX_CORNER_PATHS,
  cornersHint,
  cornersName,
  cornersSummary,
  findCorners,
  nestingDepths,
  noCornersMessage,
  planCorners,
  roundCorners,
  validateCornerOptions,
  type CornerOptions,
} from '@/lib/corners';
import { defaultShape, shapePaths } from '@/lib/shapes';
import type { Path2D, Point2, WorkspaceObject } from '@/types/domain';

// ---- helpers: small shapes with a known answer ------------------------------------------------------

const P = (pts: Array<[number, number]>, closed = true): Path2D => ({ points: pts.map(([x, y]) => ({ x, y })), closed });
const square = (x: number, y: number, s: number): Path2D =>
  P([
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ]);
const rect = (w: number, h: number): Path2D =>
  P([
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]);
const reversed = (p: Path2D): Path2D => ({ ...p, points: [...p.points].reverse() });
const lShape = (): Path2D =>
  P([
    [0, 0],
    [40, 0],
    [40, 20],
    [20, 20],
    [20, 40],
    [0, 40],
  ]);

const opts = (over: Partial<CornerOptions> = {}): CornerOptions => ({ style: 'round', sizeMm: 3, minTurnDeg: 30, which: 'all', ...over });
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
const signedArea = (pts: readonly Point2[]): number => {
  let sum = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    sum += p.x * q.y - q.x * p.y;
  });
  return sum / 2;
};
/** Outlines add, holes take away, islands add again. */
const netArea = (paths: readonly Path2D[]): number => {
  const depths = nestingDepths(paths.map((p) => p.points));
  return paths.reduce((sum, p, i) => sum + (depths[i]! % 2 === 0 ? 1 : -1) * Math.abs(signedArea(p.points)), 0);
};
const boundsOf = (pts: readonly Point2[]) => ({
  minX: Math.min(...pts.map((p) => p.x)),
  maxX: Math.max(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxY: Math.max(...pts.map((p) => p.y)),
});
const has = (pts: readonly Point2[], x: number, y: number, tol = 1e-6): boolean => pts.some((p) => near(p.x, x, tol) && near(p.y, y, tol));
/** The sum of how much the outline turns at each point, counting left turns plus and right turns minus (radians). */
const totalTurn = (pts: readonly Point2[]): number => {
  let sum = 0;
  pts.forEach((cur, i) => {
    const prev = pts[(i + pts.length - 1) % pts.length]!;
    const next = pts[(i + 1) % pts.length]!;
    const ax = cur.x - prev.x;
    const ay = cur.y - prev.y;
    const bx = next.x - cur.x;
    const by = next.y - cur.y;
    sum += Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  });
  return sum;
};
const vec = (id: string, paths: Path2D[], over: Partial<WorkspaceObject> = {}): WorkspaceObject => ({
  id,
  name: id,
  kind: { type: 'vector', paths },
  transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  layer_id: 'L1',
  visible: true,
  locked: false,
  z_index: 0,
  ...over,
});
const picture = (id: string): WorkspaceObject => ({
  id,
  name: id,
  kind: { type: 'image', asset_id: 'a', format: 'png', source_path: null, width_px: 10, height_px: 10, dpi: 254 },
  transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  layer_id: 'L2',
  visible: true,
  locked: false,
  z_index: 0,
});

describe('validateCornerOptions', () => {
  it('accepts sensible settings and the edges of the ranges', () => {
    expect(validateCornerOptions({ sizeMm: 3, minTurnDeg: 30 })).toEqual([]);
    expect(validateCornerOptions({ sizeMm: 0.01, minTurnDeg: 1 })).toEqual([]);
    expect(validateCornerOptions({ sizeMm: MAX_CORNER_MM, minTurnDeg: 179 })).toEqual([]);
  });
  it('says what is wrong', () => {
    expect(validateCornerOptions({ sizeMm: 0, minTurnDeg: 30 })[0]).toContain('more than 0');
    expect(validateCornerOptions({ sizeMm: -1, minTurnDeg: 30 })).toHaveLength(1);
    expect(validateCornerOptions({ sizeMm: Number.NaN, minTurnDeg: 30 })).toHaveLength(1);
    expect(validateCornerOptions({ sizeMm: MAX_CORNER_MM + 1, minTurnDeg: 30 })[0]).toContain('at most 500');
    expect(validateCornerOptions({ sizeMm: 3, minTurnDeg: 0.5 })[0]).toContain('1 to 179');
    expect(validateCornerOptions({ sizeMm: 3, minTurnDeg: 180 })).toHaveLength(1);
    expect(validateCornerOptions({ sizeMm: 3, minTurnDeg: Number.NaN })).toHaveLength(1);
    expect(validateCornerOptions({ sizeMm: -3, minTurnDeg: 500 })).toHaveLength(2);
  });
  it('has a name for every kind of corner', () => {
    expect(CORNER_WHICH).toEqual(['all', 'outside', 'inside']);
    for (const w of CORNER_WHICH) expect(CORNER_WHICH_LABELS[w].length).toBeGreaterThan(5);
  });
});

describe('nestingDepths', () => {
  it('counts how many outlines each one is inside', () => {
    const rings = [square(0, 0, 100), square(10, 10, 50), square(20, 20, 10), square(200, 0, 5)].map((p) => p.points);
    expect(nestingDepths(rings)).toEqual([0, 1, 2, 0]);
  });
  it('does not mind which way round an outline goes, or an outline that is large but not around the other', () => {
    const rings = [square(0, 0, 60), reversed(square(15, 15, 30))].map((p) => p.points);
    expect(nestingDepths(rings)).toEqual([0, 1]);
    // The middle of the big square is inside the small one, but the big square is not.
    expect(nestingDepths([square(0, 0, 60).points, square(15, 15, 30).points])[0]).toBe(0);
  });
  it('is empty for nothing', () => {
    expect(nestingDepths([])).toEqual([]);
  });
});

describe('fillet of a square', () => {
  const r = 5;
  const result = roundCorners([square(0, 0, 40)], opts({ sizeMm: r }));
  it('rounds the four corners and says so', () => {
    expect(result.paths).toHaveLength(1);
    expect(result).toMatchObject({ found: 4, changed: 4, reduced: 0, skipped: 0 });
    expect(result.paths[0]!.closed).toBe(true);
  });
  it('takes the right area off: a square minus four corner pieces of r squared times (1 - pi/4)', () => {
    const exact = 1600 - (4 - Math.PI) * r * r;
    expect(near(netArea(result.paths), exact, 0.45)).toBe(true);
    // The flat segments lie just inside the true arc (by at most the 0.02 mm tolerance), so it is never bigger.
    expect(netArea(result.paths)).toBeLessThanOrEqual(exact + 1e-9);
  });
  it('keeps the overall size and starts each arc exactly on the old edge', () => {
    const b = boundsOf(result.paths[0]!.points);
    expect(b).toEqual({ minX: 0, maxX: 40, minY: 0, maxY: 40 });
    for (const [x, y] of [
      [r, 0],
      [40 - r, 0],
      [40, r],
      [40, 40 - r],
      [40 - r, 40],
      [r, 40],
      [0, 40 - r],
      [0, r],
    ] as const) {
      expect(has(result.paths[0]!.points, x, y)).toBe(true);
    }
  });
  it('is a circle of the radius asked for round the middle of each corner', () => {
    const pts = result.paths[0]!.points;
    for (const [cx, cy, inX, inY] of [
      [r, r, (x: number) => x < r, (y: number) => y < r],
      [40 - r, r, (x: number) => x > 40 - r, (y: number) => y < r],
      [40 - r, 40 - r, (x: number) => x > 40 - r, (y: number) => y > 40 - r],
      [r, 40 - r, (x: number) => x < r, (y: number) => y > 40 - r],
    ] as const) {
      const arc = pts.filter((p) => inX(p.x) && inY(p.y));
      expect(arc.length).toBeGreaterThan(4);
      for (const p of arc) expect(near(Math.hypot(p.x - cx, p.y - cy), r, 1e-9)).toBe(true);
    }
  });
  it('uses more points for a bigger radius, and no point is repeated', () => {
    const big = roundCorners([square(0, 0, 400)], opts({ sizeMm: 100 })).paths[0]!.points;
    expect(big.length).toBeGreaterThan(result.paths[0]!.points.length);
    for (const pts of [big, result.paths[0]!.points]) {
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % pts.length]!;
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(1e-9);
      });
    }
  });
  it('gives the same shape whichever way round the square was drawn, or however it is turned', () => {
    const backwards = roundCorners([reversed(square(0, 0, 40))], opts({ sizeMm: r }));
    expect(backwards.changed).toBe(4);
    expect(near(netArea(backwards.paths), netArea(result.paths), 1e-9)).toBe(true);
    const c = Math.SQRT1_2;
    const diamond = P([
      [20, 20 - 40 * c],
      [20 + 40 * c, 20],
      [20, 20 + 40 * c],
      [20 - 40 * c, 20],
    ]);
    const turned = roundCorners([diamond], opts({ sizeMm: r }));
    expect(turned.changed).toBe(4);
    expect(near(netArea(turned.paths), 2 * 40 * 40 * c * c - (4 - Math.PI) * r * r, 0.45)).toBe(true);
  });
  it('turns the outline by a full turn, as before', () => {
    expect(near(totalTurn(result.paths[0]!.points), totalTurn(square(0, 0, 40).points), 1e-9)).toBe(true);
  });
});

describe('fillet at angles other than a right angle', () => {
  // A corner that turns the outline by t takes r * r * (tan(t / 2) - t / 2) off the area, for a fillet of radius r.
  const removed = (r: number, turn: number): number => r * r * (Math.tan(turn / 2) - turn / 2);
  const turnAt = (pts: readonly Point2[], i: number): number => {
    const prev = pts[(i + pts.length - 1) % pts.length]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % pts.length]!;
    const ax = cur.x - prev.x;
    const ay = cur.y - prev.y;
    const bx = next.x - cur.x;
    const by = next.y - cur.y;
    return Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by);
  };
  it('a triangle with three different angles loses the right area at each corner', () => {
    const tri = P([
      [0, 0],
      [60, 0],
      [30, 50],
    ]);
    const r = 4;
    const res = roundCorners([tri], opts({ sizeMm: r }));
    expect(res).toMatchObject({ found: 3, changed: 3, reduced: 0 });
    const expected = Math.abs(signedArea(tri.points)) - [0, 1, 2].reduce((sum, i) => sum + removed(r, turnAt(tri.points, i)), 0);
    // Each arc is flat segments that sit up to 0.02 mm inside the true arc: together about 0.4 mm2 here.
    expect(near(netArea(res.paths), expected, 0.5)).toBe(true);
    expect(netArea(res.paths)).toBeLessThan(expected);
  });
  it('a hexagon loses the same piece at all six corners', () => {
    const hexagon = P([0, 1, 2, 3, 4, 5].map((k) => [30 * Math.cos((k * Math.PI) / 3), 30 * Math.sin((k * Math.PI) / 3)] as [number, number]));
    const r = 5;
    const res = roundCorners([hexagon], opts({ sizeMm: r }));
    expect(res.changed).toBe(6);
    const expected = Math.abs(signedArea(hexagon.points)) - 6 * removed(r, Math.PI / 3);
    expect(near(netArea(res.paths), expected, 0.5)).toBe(true);
    expect(netArea(res.paths)).toBeLessThan(expected);
  });
  it('the arc is tangent to both edges: the cut-back points are a tangent length from the corner', () => {
    const tri = P([
      [0, 0],
      [60, 0],
      [30, 50],
    ]);
    const r = 4;
    const res = roundCorners([tri], opts({ sizeMm: r }));
    // At the corner (0, 0) the outline turns by 180 minus the interior angle; the tangent length is r tan(turn / 2).
    const t = r * Math.tan(turnAt(tri.points, 0) / 2);
    expect(has(res.paths[0]!.points, t, 0)).toBe(true);
  });
});

describe('chamfer', () => {
  it('cuts each corner off along both edges: eight points and a square minus four small triangles', () => {
    const d = 4;
    const r = roundCorners([square(0, 0, 40)], opts({ style: 'chamfer', sizeMm: d }));
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0]!.points).toHaveLength(8);
    expect(r).toMatchObject({ found: 4, changed: 4, reduced: 0, skipped: 0 });
    expect(near(netArea(r.paths), 1600 - 2 * d * d, 1e-9)).toBe(true);
    for (const [x, y] of [
      [d, 0],
      [0, d],
      [40 - d, 0],
      [40, d],
      [40, 40 - d],
      [40 - d, 40],
      [d, 40],
      [0, 40 - d],
    ] as const) {
      expect(has(r.paths[0]!.points, x, y)).toBe(true);
    }
  });
  it('is a straight cut: the same distance from the corner along both edges, whatever the angle', () => {
    const triangle = P([
      [0, 0],
      [60, 0],
      [30, 50],
    ]);
    const r = roundCorners([triangle], opts({ style: 'chamfer', sizeMm: 5 }));
    expect(r.changed).toBe(3);
    const pts = r.paths[0]!.points;
    expect(pts).toHaveLength(6);
    // Every cut point is 5 mm from its corner.
    for (const [cx, cy] of [
      [0, 0],
      [60, 0],
      [30, 50],
    ] as const) {
      const close = pts.filter((p) => near(Math.hypot(p.x - cx, p.y - cy), 5, 1e-9));
      expect(close).toHaveLength(2);
    }
  });
  it('turns the outline by a full turn, as before', () => {
    const r = roundCorners([lShape()], opts({ style: 'chamfer', sizeMm: 3 }));
    expect(near(totalTurn(r.paths[0]!.points), totalTurn(lShape().points), 1e-9)).toBe(true);
  });
});

describe('a size that is too big for the edges', () => {
  it('makes a fillet no bigger than half the edge, so a 10 mm square with a 20 mm radius becomes a circle of radius 5', () => {
    const r = roundCorners([square(0, 0, 10)], opts({ sizeMm: 20 }));
    expect(r).toMatchObject({ found: 4, changed: 4, reduced: 4, skipped: 0 });
    for (const [x, y] of [
      [5, 0],
      [10, 5],
      [5, 10],
      [0, 5],
    ] as const) {
      expect(has(r.paths[0]!.points, x, y)).toBe(true);
    }
    // 36 straight segments inside a circle of radius 5 miss it by about 0.4 mm2 (at most 0.02 mm anywhere).
    expect(near(netArea(r.paths), Math.PI * 25, 0.45)).toBe(true);
    expect(netArea(r.paths)).toBeLessThan(Math.PI * 25);
    const c = r.paths[0]!.points.filter((p) => !has([{ x: 5, y: 5 }], p.x, p.y));
    for (const p of c) expect(near(Math.hypot(p.x - 5, p.y - 5), 5, 1e-9)).toBe(true);
  });
  it('shares a short edge between its two corners: a 10 by 4 rectangle with a 5 mm radius ends up with 2 mm ends', () => {
    const r = roundCorners([rect(10, 4)], opts({ sizeMm: 5 }));
    expect(r.reduced).toBe(4);
    expect(near(netArea(r.paths), 40 - (4 - Math.PI) * 4, 0.2)).toBe(true);
    expect(has(r.paths[0]!.points, 2, 0)).toBe(true);
    expect(has(r.paths[0]!.points, 10, 2)).toBe(true);
  });
  it('does the same for a chamfer', () => {
    const r = roundCorners([rect(10, 4)], opts({ style: 'chamfer', sizeMm: 3 }));
    expect(r).toMatchObject({ changed: 4, reduced: 4 });
    expect(near(netArea(r.paths), 40 - 4 * 2, 1e-9)).toBe(true);
  });
  it('lets a corner use the whole edge when the corner at the other end is not being changed', () => {
    // The notch of the L-shape at (20, 20) has a 20 mm edge on each side, and the corners at the far ends
    // of those edges are not being changed (they stick out). A huge radius is cut down to what fits: 20 mm.
    const r = roundCorners([lShape()], opts({ sizeMm: 100, which: 'inside' }));
    expect(r).toMatchObject({ found: 1, changed: 1, reduced: 1, skipped: 0 });
    // A quarter circle of radius 20 centred on (40, 40) fills the notch: it adds r squared times (1 - pi/4).
    expect(near(netArea(r.paths), 1200 + 400 * (1 - Math.PI / 4), 0.6)).toBe(true);
    expect(has(r.paths[0]!.points, 40, 20)).toBe(true);
    expect(has(r.paths[0]!.points, 20, 40)).toBe(true);
    const arc = r.paths[0]!.points.filter((p) => p.x > 20 + 1e-9 && p.y > 20 + 1e-9 && p.x < 40 - 1e-9 && p.y < 40 - 1e-9);
    expect(arc.length).toBeGreaterThan(5);
    for (const p of arc) expect(near(Math.hypot(p.x - 40, p.y - 40), 20, 1e-9)).toBe(true);
  });
  it('leaves a corner alone, and says so, when it is too close to the next one to change', () => {
    const shape = P([
      [0, 0],
      [9.9999, 0],
      [10, 0.0001],
      [10, 10],
      [0, 10],
    ]);
    const r = roundCorners([shape], opts({ sizeMm: 3 }));
    expect(r.skipped).toBe(2);
    expect(r.changed).toBe(3);
    expect(has(r.paths[0]!.points, 9.9999, 0, 1e-9)).toBe(true);
    expect(has(r.paths[0]!.points, 10, 0.0001, 1e-9)).toBe(true);
  });
});

describe('which corners', () => {
  const area = (r: number, outside: number, inside: number) => 1200 - (outside - inside) * (1 - Math.PI / 4) * r * r;
  it('an L-shape has five corners sticking out and one notch', () => {
    expect(findCorners([lShape()], { minTurnDeg: 30, which: 'all' })).toBe(6);
    expect(findCorners([lShape()], { minTurnDeg: 30, which: 'outside' })).toBe(5);
    expect(findCorners([lShape()], { minTurnDeg: 30, which: 'inside' })).toBe(1);
  });
  it('rounds only the ones asked for, and an inside corner fills in instead of cutting away', () => {
    const r = 2;
    const out = roundCorners([lShape()], opts({ sizeMm: r, which: 'outside' }));
    expect(out).toMatchObject({ found: 5, changed: 5 });
    expect(near(netArea(out.paths), area(r, 5, 0), 0.3)).toBe(true);
    const inside = roundCorners([lShape()], opts({ sizeMm: r, which: 'inside' }));
    expect(inside).toMatchObject({ found: 1, changed: 1 });
    expect(near(netArea(inside.paths), area(r, 0, 1), 0.3)).toBe(true);
    // The notch is at (20, 20): after rounding, that point is no longer on the outline.
    expect(has(inside.paths[0]!.points, 20, 20)).toBe(false);
    expect(has(out.paths[0]!.points, 20, 20)).toBe(true);
    const all = roundCorners([lShape()], opts({ sizeMm: r, which: 'all' }));
    expect(near(netArea(all.paths), area(r, 5, 1), 0.3)).toBe(true);
  });
  it('gives the same answer whichever way the outline was drawn', () => {
    for (const which of CORNER_WHICH) {
      const a = roundCorners([lShape()], opts({ which }));
      const b = roundCorners([reversed(lShape())], opts({ which }));
      expect(b.found).toBe(a.found);
      expect(near(netArea(b.paths), netArea(a.paths), 1e-9)).toBe(true);
    }
  });
  it('works out hole corners from the nesting, so a hole drawn the same way round as its outline is still a hole', () => {
    for (const hole of [square(15, 15, 30), reversed(square(15, 15, 30))]) {
      const ring = [square(0, 0, 60), hole];
      // The hole's corners are inside corners of the material (notches), the outer corners stick out.
      expect(findCorners(ring, { minTurnDeg: 30, which: 'outside' })).toBe(4);
      expect(findCorners(ring, { minTurnDeg: 30, which: 'inside' })).toBe(4);
      const outer = roundCorners(ring, opts({ sizeMm: 4, which: 'outside' }));
      expect(outer.paths).toHaveLength(2);
      const sorted = [...outer.paths].sort((p, q) => q.points.length - p.points.length);
      expect(sorted[0]!.points.length).toBeGreaterThan(8); // the outline is rounded
      expect(sorted[1]!.points).toHaveLength(4); // the hole is not
      const inner = roundCorners(ring, opts({ sizeMm: 4, which: 'inside' }));
      const sortedInner = [...inner.paths].sort((p, q) => q.points.length - p.points.length);
      expect(sortedInner[0]!.points.length).toBeGreaterThan(8); // the hole is rounded (most points)
      expect(sortedInner[1]!.points).toHaveLength(4); // the outline is not
    }
  });
  it('rounds the outside and the inside of a ring together and loses no material overall', () => {
    const ring = [square(0, 0, 60), square(15, 15, 30)];
    const all = roundCorners(ring, opts({ sizeMm: 4, which: 'all' }));
    expect(all.found).toBe(8);
    expect(near(netArea(all.paths), 3600 - 900, 1e-6)).toBe(true);
  });
  it('treats an island inside a hole as sticking out again', () => {
    const rings = [square(0, 0, 100), square(15, 15, 70), square(35, 35, 30)];
    expect(findCorners(rings, { minTurnDeg: 30, which: 'outside' })).toBe(8);
    expect(findCorners(rings, { minTurnDeg: 30, which: 'inside' })).toBe(4);
  });
});

describe('how much a corner turns', () => {
  const hexagon = P([0, 1, 2, 3, 4, 5].map((k) => [30 * Math.cos((k * Math.PI) / 3), 30 * Math.sin((k * Math.PI) / 3)] as [number, number]));
  it('only changes corners that turn the outline by at least the minimum', () => {
    expect(findCorners([hexagon], { minTurnDeg: 59, which: 'all' })).toBe(6);
    expect(findCorners([hexagon], { minTurnDeg: 61, which: 'all' })).toBe(0);
    expect(findCorners([square(0, 0, 10)], { minTurnDeg: 89, which: 'all' })).toBe(4);
    expect(findCorners([square(0, 0, 10)], { minTurnDeg: 91, which: 'all' })).toBe(0);
  });
  it('leaves a smooth curve alone with the usual minimum, but not with a tiny one', () => {
    const circle = shapePaths({ ...defaultShape('ellipse'), width_mm: 30, height_mm: 30 });
    expect(findCorners(circle, { minTurnDeg: DEFAULT_MIN_TURN_DEG, which: 'all' })).toBe(0);
    expect(findCorners(circle, { minTurnDeg: 1, which: 'all' })).toBe(circle[0]!.points.length);
    const stadium = shapePaths({ ...defaultShape('rectangle'), width_mm: 40, height_mm: 20, corner_radius_mm: 5 });
    expect(findCorners(stadium, { minTurnDeg: DEFAULT_MIN_TURN_DEG, which: 'all' })).toBe(0);
  });
  it('treats a spike that doubles back on itself as no corner', () => {
    const spike = P([
      [0, 0],
      [100, 0],
      [0, 0.01],
    ]);
    expect(findCorners([spike], { minTurnDeg: 30, which: 'all' })).toBe(2);
    expect(findCorners([spike], { minTurnDeg: 179, which: 'all' })).toBe(0);
  });
  it('finds the corners of the shapes the program makes: a star has five tips and five notches', () => {
    const star = shapePaths(defaultShape('star'));
    expect(findCorners(star, { minTurnDeg: 30, which: 'outside' })).toBe(5);
    expect(findCorners(star, { minTurnDeg: 30, which: 'inside' })).toBe(5);
    expect(findCorners(star, { minTurnDeg: 30, which: 'all' })).toBe(10);
    expect(roundCorners(star, opts({ sizeMm: 1, which: 'outside' })).changed).toBe(5);
  });
  it('a stretched fillet still lands on the corner: a long thin rectangle', () => {
    const r = roundCorners([rect(200, 2)], opts({ sizeMm: 1 }));
    expect(r).toMatchObject({ changed: 4, reduced: 0 });
    expect(near(netArea(r.paths), 400 - (4 - Math.PI), 0.1)).toBe(true);
  });
});

describe('input that is not clean', () => {
  it('ignores repeated points, a last point that repeats the first, and points in the middle of a straight edge', () => {
    const messy = P([
      [0, 0],
      [0, 0],
      [20, 0],
      [40, 0],
      [40, 40],
      [40, 40],
      [0, 40],
      [0, 0],
    ]);
    const a = roundCorners([messy], opts({ sizeMm: 5 }));
    const b = roundCorners([square(0, 0, 40)], opts({ sizeMm: 5 }));
    expect(a.changed).toBe(4);
    expect(near(netArea(a.paths), netArea(b.paths), 1e-9)).toBe(true);
    // The point in the middle of the bottom edge turns nothing, so it stays.
    expect(has(a.paths[0]!.points, 20, 0)).toBe(true);
  });
  it('leaves out open lines, outlines of fewer than three points, outlines with no area and numbers that are not numbers', () => {
    const open = P(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      false,
    );
    const two = P([
      [0, 0],
      [5, 5],
    ]);
    const flat = P([
      [0, 0],
      [5, 0],
      [10, 0],
    ]);
    const broken = P([
      [0, 0],
      [Number.NaN, 0],
      [10, 10],
    ]);
    const r = roundCorners([open, two, flat, broken, square(0, 0, 10)], opts({ sizeMm: 1 }));
    expect(r.paths).toHaveLength(1);
    expect(r.changed).toBe(4);
    expect(roundCorners([], opts())).toEqual({ paths: [], found: 0, changed: 0, reduced: 0, skipped: 0 });
  });
  it('does nothing, rather than failing, when the size is not usable', () => {
    for (const sizeMm of [0, -2, Number.NaN]) {
      const r = roundCorners([square(0, 0, 10)], opts({ sizeMm }));
      expect(r.changed).toBe(0);
      expect(r.paths[0]!.points).toHaveLength(4);
    }
  });
  it('never changes what it is given and gives the same answer every time', () => {
    const input = [square(0, 0, 40), square(10, 10, 20)];
    const before = JSON.stringify(input);
    const a = roundCorners(input, opts({ sizeMm: 3 }));
    expect(JSON.stringify(input)).toBe(before);
    expect(roundCorners(input, opts({ sizeMm: 3 }))).toEqual(a);
  });
  it('copes with a minimum turn that is not a number by using the usual one', () => {
    expect(findCorners([square(0, 0, 10)], { minTurnDeg: Number.NaN, which: 'all' })).toBe(4);
  });
});

describe('random shapes', () => {
  it('always give closed outlines of finite numbers, keep the total turn, and never leave the box by more than the size', () => {
    let seed = 20261011;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let round = 0; round < 25; round++) {
      // A star-shaped polygon: points at random distances round a centre, in order of angle.
      const n = 5 + Math.floor(rnd() * 12);
      const pts: Array<[number, number]> = [];
      for (let k = 0; k < n; k++) {
        const angle = (2 * Math.PI * k) / n;
        const radius = 10 + rnd() * 40;
        pts.push([100 + radius * Math.cos(angle), 100 + radius * Math.sin(angle)]);
      }
      const shape = P(pts);
      for (const style of ['round', 'chamfer'] as const) {
        for (const which of CORNER_WHICH) {
          const o = opts({ style, which, sizeMm: 0.5 + rnd() * 20, minTurnDeg: 10 + rnd() * 60 });
          const r = roundCorners([shape], o);
          expect(r.paths).toHaveLength(1);
          const out = r.paths[0]!.points;
          expect(out.length).toBeGreaterThanOrEqual(3);
          expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
          expect(near(totalTurn(out), totalTurn(shape.points), 1e-6)).toBe(true);
          expect(r.changed + r.skipped).toBeLessThanOrEqual(r.found);
          const b = boundsOf(shape.points);
          const ob = boundsOf(out);
          expect(ob.minX).toBeGreaterThanOrEqual(b.minX - 1e-9);
          expect(ob.maxX).toBeLessThanOrEqual(b.maxX + 1e-9);
          expect(ob.minY).toBeGreaterThanOrEqual(b.minY - 1e-9);
          expect(ob.maxY).toBeLessThanOrEqual(b.maxY + 1e-9);
        }
      }
    }
  });
});

describe('speed', () => {
  it('rounds every corner of a 100,000-point outline in a couple of seconds', () => {
    // A zigzag round a circle: every one of the 100,000 points is a real corner (about 77 degrees).
    const n = 100_000;
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < n; k++) {
      const radius = 400 + (k % 2 === 0 ? 0.01 : -0.01);
      pts.push([500 + radius * Math.cos((2 * Math.PI * k) / n), 500 + radius * Math.sin((2 * Math.PI * k) / n)]);
    }
    const start = Date.now();
    const r = roundCorners([P(pts)], opts({ sizeMm: 0.001, which: 'all' }));
    const ms = Date.now() - start;
    expect(r.found).toBe(n);
    expect(r.changed).toBe(n);
    expect(r.paths[0]!.points.length).toBeGreaterThan(n);
    expect(ms).toBeLessThan(3000);
  });
  it('tells outside from inside corners of a 50,000-point outline with a hole in a couple of seconds', () => {
    const n = 25_000;
    // Points 0.1 mm apart and 0.12 mm up and down: every one of them turns the outline by about 100 degrees.
    const ring = (cx: number, radius: number): Array<[number, number]> =>
      Array.from({ length: n }, (_, k) => [cx + (radius + (k % 2 === 0 ? 0.06 : -0.06)) * Math.cos((2 * Math.PI * k) / n), 500 + (radius + (k % 2 === 0 ? 0.06 : -0.06)) * Math.sin((2 * Math.PI * k) / n)]);
    const start = Date.now();
    const r = roundCorners([P(ring(500, 400)), P(ring(500, 200))], opts({ sizeMm: 0.001, which: 'inside' }));
    const ms = Date.now() - start;
    // Half the points of each ring are notches (the other half stick out).
    expect(r.found).toBe(n);
    expect(ms).toBeLessThan(3000);
  });
});

describe('planCorners', () => {
  const a = vec('A', [square(0, 0, 10)], { layer_id: 'LA' });
  it('lists the closed shapes selected, with their layer, and what was left out', () => {
    const line = vec('Line', [P([[0, 0], [5, 5], [9, 1]], false)]);
    const plan = planCorners([a, line, picture('P')], ['A', 'Line', 'P']);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.items.map((i) => i.id)).toEqual(['A']);
    expect(plan.items[0]).toMatchObject({ name: 'A', layerId: 'LA', hasLoose: false, locked: false });
    expect(plan.skipped).toEqual(['Line', 'P']);
    expect(plan.tooDetailed).toEqual([]);
  });
  it('uses world positions: a moved, stretched shape is rounded where it really is', () => {
    const moved = { ...vec('M', [square(0, 0, 10)]), transform: { a: 2, b: 0, c: 0, d: 1, e: 100, f: 50 } };
    const plan = planCorners([moved], ['M']);
    expect(plan.ok && plan.items[0]!.paths[0]!.points[1]).toEqual({ x: 120, y: 50 });
  });
  it('keeps the closed paths of an object that also has open lines, and says so', () => {
    const mixed = vec('Mix', [square(0, 0, 10), P([[20, 20], [30, 30], [40, 20]], false)], { locked: true });
    const plan = planCorners([mixed], ['Mix']);
    expect(plan.ok && plan.items[0]).toMatchObject({ hasLoose: true, locked: true });
    expect(plan.ok && plan.items[0]!.paths).toHaveLength(1);
  });
  it('asks for a shape, and names what is not one', () => {
    const none = planCorners([a], []);
    expect(none.ok === false && none.message).toBe('Select a shape to round or chamfer.');
    const one = planCorners([picture('P')], ['P']);
    expect(one.ok === false && one.message).toBe('"P" is not a closed shape, so there are no corners to change.');
    const two = planCorners([picture('P'), picture('Q')], ['P', 'Q']);
    expect(two.ok === false && two.message).toBe('"P", "Q" are not a closed shape, so there are no corners to change.');
  });
  it('refuses a shape with too many outlines to search, and carries on with the rest', () => {
    const many = vec('Many', Array.from({ length: MAX_CORNER_PATHS + 1 }, (_, i) => square(i * 3, 0, 2)));
    const both = planCorners([a, many], ['A', 'Many']);
    expect(both.ok && both.tooDetailed).toEqual(['Many']);
    expect(both.ok && both.items.map((i) => i.id)).toEqual(['A']);
    const alone = planCorners([many], ['Many']);
    expect(alone.ok === false && alone.message).toContain('too much detail');
  });
});

describe('words', () => {
  it('names the result', () => {
    expect(cornersName('Square', 'round', 3)).toBe('Square (rounded 3 mm)');
    expect(cornersName('Square', 'chamfer', 2.5)).toBe('Square (chamfered 2.5 mm)');
    expect(cornersName('Square', 'round', 1.23456)).toBe('Square (rounded 1.235 mm)');
  });
  it('sums up what was done', () => {
    expect(cornersSummary('round', { shapes: 2, changed: 8, reduced: 0, skipped: 0 })).toBe('Rounded 8 corners on 2 shapes.');
    expect(cornersSummary('chamfer', { shapes: 1, changed: 1, reduced: 0, skipped: 0 })).toBe('Chamfered 1 corner on 1 shape.');
    expect(cornersSummary('round', { shapes: 1, changed: 4, reduced: 4, skipped: 0 })).toBe(
      'Rounded 4 corners on 1 shape. 4 were made smaller because the edges next to them are short.',
    );
    expect(cornersSummary('round', { shapes: 1, changed: 3, reduced: 1, skipped: 2 })).toBe(
      'Rounded 3 corners on 1 shape. 1 was made smaller because the edges next to it are short. 2 were too close to the next corner to change.',
    );
  });
  it('says what to do when no corner matched', () => {
    expect(noCornersMessage({ minTurnDeg: 30, which: 'all' })).toBe(
      'No corner turns the outline by 30 degrees or more. Lower "Skip bends gentler than", or choose another kind under "Which corners".',
    );
    expect(noCornersMessage({ minTurnDeg: 45.5, which: 'inside' })).toContain('No inside corner turns the outline by 45.5 degrees');
    expect(noCornersMessage({ minTurnDeg: 30, which: 'outside' })).toContain('No outside corner');
  });
  it('gives the line under the settings', () => {
    const plan = planCorners([vec('A', [square(0, 0, 10)])], ['A']);
    const f = { minTurnDeg: 30, which: 'all' as const };
    expect(cornersHint(plan, 4, 1, f)).toBe('4 corners on 1 shape can be changed.');
    expect(cornersHint(plan, 1, 1, f)).toBe('1 corner on 1 shape can be changed.');
    expect(cornersHint(plan, 12, 3, f)).toBe('12 corners on 3 shapes can be changed.');
    expect(cornersHint(plan, 0, 0, f)).toContain('No corner turns');
    expect(cornersHint({ ok: false, message: 'Select a shape to round or chamfer.' }, 0, 0, f)).toBe('Select a shape to round or chamfer.');
  });
});
