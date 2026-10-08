import { describe, expect, it } from 'vitest';
import {
  PARALLEL_DEG,
  acuteAngleDeg,
  closestPointsOfSegments,
  directedAngleDeg,
  distance,
  formatAngle,
  formatLength,
  freePoint,
  itemsToMeasure,
  lineAngleDeg,
  measure,
  measurementLabel,
  measurementRows,
  nextPicks,
  pathLength,
  pointToLine,
  selectionStats,
  snapAt,
  type MeasureItem,
} from '@/lib/measure';
import { applyToPoint, chain, rotation, scaling, translation } from '@/lib/transform';
import type { Point2, Transform2D, WorkspaceObject } from '@/types/domain';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const P = (x: number, y: number): Point2 => ({ x, y });

function poly(id: string, pts: Array<[number, number]>, closed: boolean, transform: Transform2D = translation(0, 0), over: Partial<WorkspaceObject> = {}): WorkspaceObject {
  return {
    id,
    name: id,
    kind: { type: 'vector', paths: [{ closed, points: pts.map(([x, y]) => ({ x, y })) }] },
    transform,
    layer_id: null,
    visible: true,
    locked: false,
    z_index: 0,
    ...over,
  };
}
/** A square with its top-left corner at (x, y). */
const square = (id: string, x: number, y: number, s: number, over: Partial<WorkspaceObject> = {}) =>
  poly(id, [[x, y], [x + s, y], [x + s, y + s], [x, y + s]], true, translation(0, 0), over);

describe('basic geometry', () => {
  it('distance', () => {
    expect(distance(P(0, 0), P(3, 4))).toBe(5);
    expect(distance(P(2, 2), P(2, 2))).toBe(0);
  });
  it('directed angle is anticlockwise from the right, with up positive (the workspace Y points down)', () => {
    expect(directedAngleDeg(P(0, 0), P(10, 0))).toBe(0);
    expect(directedAngleDeg(P(0, 0), P(0, -10))).toBe(90);
    expect(directedAngleDeg(P(0, 0), P(-10, 0))).toBe(180);
    expect(directedAngleDeg(P(0, 0), P(0, 10))).toBe(270);
    expect(directedAngleDeg(P(0, 0), P(10, -10))).toBeCloseTo(45, 9);
    expect(directedAngleDeg(P(0, 0), P(10, 10))).toBeCloseTo(315, 9);
  });
  it('a line has no front: the angle is the same either way round and stays below 180', () => {
    expect(lineAngleDeg(P(0, 0), P(10, -10))).toBeCloseTo(45, 9);
    expect(lineAngleDeg(P(10, -10), P(0, 0))).toBeCloseTo(45, 9);
    expect(lineAngleDeg(P(0, 0), P(10, 0))).toBe(0);
    expect(lineAngleDeg(P(10, 0), P(0, 0))).toBe(0);
    expect(lineAngleDeg(P(0, 0), P(0, 10))).toBeCloseTo(90, 9);
  });
  it('the angle between two lines is the acute one whichever way they point', () => {
    expect(acuteAngleDeg(P(0, 0), P(10, 0), P(0, 0), P(0, 10))).toBeCloseTo(90, 9);
    expect(acuteAngleDeg(P(0, 0), P(10, 0), P(5, 0), P(0, 0))).toBeCloseTo(0, 9);
    expect(acuteAngleDeg(P(0, 0), P(10, 0), P(0, 0), P(10, 10))).toBeCloseTo(45, 9);
    expect(acuteAngleDeg(P(0, 0), P(10, 0), P(10, 10), P(0, 0))).toBeCloseTo(45, 9);
    expect(acuteAngleDeg(P(0, 0), P(10, 0), P(0, 0), P(-10, 10))).toBeCloseTo(45, 9);
  });
});

describe('pointToLine', () => {
  it('measures at right angles to the line and finds the foot', () => {
    const r = pointToLine(P(5, 5), P(0, 0), P(10, 0));
    expect(r.perpendicular).toBe(5);
    expect(r.foot).toEqual(P(5, 0));
    expect(r.footOnSegment).toBe(true);
    expect(r.nearestDistance).toBe(5);
  });
  it('says so when the foot is past an end, and gives the distance to the nearest end', () => {
    const r = pointToLine(P(15, 5), P(0, 0), P(10, 0));
    expect(r.perpendicular).toBe(5);
    expect(r.foot).toEqual(P(15, 0));
    expect(r.footOnSegment).toBe(false);
    expect(r.nearestDistance).toBeCloseTo(Math.hypot(5, 5), 9);
  });
  it('works for a slanted line', () => {
    const r = pointToLine(P(0, 10), P(0, 0), P(10, 10));
    expect(r.perpendicular).toBeCloseTo(Math.hypot(5, 5), 9);
    expect(r.foot.x).toBeCloseTo(5, 9);
    expect(r.foot.y).toBeCloseTo(5, 9);
  });
  it('a line of no length is treated as a point', () => {
    expect(pointToLine(P(3, 4), P(0, 0), P(0, 0)).perpendicular).toBe(5);
  });
});

describe('closestPointsOfSegments', () => {
  it('crossing segments are zero apart, at the crossing', () => {
    const r = closestPointsOfSegments(P(0, 0), P(10, 10), P(0, 10), P(10, 0));
    expect(r.distance).toBeCloseTo(0, 9);
    expect(r.p.x).toBeCloseTo(5, 9);
    expect(r.p.y).toBeCloseTo(5, 9);
  });
  it('parallel segments side by side', () => {
    expect(closestPointsOfSegments(P(0, 0), P(10, 0), P(0, 7), P(10, 7)).distance).toBeCloseTo(7, 9);
  });
  it('end to end, and collinear with a gap', () => {
    expect(closestPointsOfSegments(P(0, 0), P(10, 0), P(15, 0), P(25, 0)).distance).toBeCloseTo(5, 9);
    const r = closestPointsOfSegments(P(0, 0), P(10, 0), P(20, 5), P(20, 15));
    expect(r.distance).toBeCloseTo(Math.hypot(10, 5), 9);
    expect(r.p).toEqual(P(10, 0));
    expect(r.q).toEqual(P(20, 5));
  });
  it('copes with segments of no length', () => {
    expect(closestPointsOfSegments(P(3, 4), P(3, 4), P(0, 0), P(0, 0)).distance).toBe(5);
    expect(closestPointsOfSegments(P(0, 5), P(0, 5), P(-5, 0), P(5, 0)).distance).toBeCloseTo(5, 9);
    expect(closestPointsOfSegments(P(-5, 0), P(5, 0), P(0, 5), P(0, 5)).distance).toBeCloseTo(5, 9);
  });
  it('agrees with a brute-force search on random segments', () => {
    let seed = 20261008;
    const rnd = (lo: number, hi: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return lo + (seed / 4294967296) * (hi - lo);
    };
    const STEPS = 300;
    for (let i = 0; i < 150; i++) {
      const a = P(rnd(0, 10), rnd(0, 10));
      const b = P(rnd(0, 10), rnd(0, 10));
      const c = P(rnd(0, 10), rnd(0, 10));
      const d = P(rnd(0, 10), rnd(0, 10));
      const exact = closestPointsOfSegments(a, b, c, d).distance;
      let best = Infinity;
      for (let s = 0; s <= STEPS; s++) {
        const p = P(a.x + ((b.x - a.x) * s) / STEPS, a.y + ((b.y - a.y) * s) / STEPS);
        for (let t = 0; t <= STEPS; t++) {
          const q = P(c.x + ((d.x - c.x) * t) / STEPS, c.y + ((d.y - c.y) * t) / STEPS);
          best = Math.min(best, distance(p, q));
        }
      }
      expect(exact <= best + 1e-9).toBe(true); // nothing sampled can beat the exact answer
      expect(best - exact < 0.1).toBe(true); // and the sampling gets close to it
    }
  });
});

describe('measure', () => {
  const pt = (x: number, y: number): MeasureItem => ({ kind: 'point', p: P(x, y), snap: 'vertex' });
  const ln = (ax: number, ay: number, bx: number, by: number): MeasureItem => ({ kind: 'line', a: P(ax, ay), b: P(bx, by) });

  it('has nothing to say about no picks, or too many', () => {
    expect(measure([])).toBeNull();
    expect(measure([pt(0, 0), pt(1, 1), pt(2, 2)])).toBeNull();
  });
  it('one point is a position, one line is a length', () => {
    expect(measure([pt(12, 34)])).toMatchObject({ type: 'point', p: { x: 12, y: 34 }, guide: null });
    const m = measure([ln(0, 0, 30, -40)]);
    expect(m?.type).toBe('line');
    if (m?.type === 'line') {
      expect(m.length).toBe(50);
      expect(m.dx).toBe(30);
      expect(m.dy).toBe(-40);
      expect(m.angleDeg).toBeCloseTo(Math.atan2(40, 30) * (180 / Math.PI), 9);
    }
  });
  it('two points: distance, the two differences and the direction', () => {
    const m = measure([pt(2, 3), pt(5, 7)]);
    expect(m?.type).toBe('point-point');
    if (m?.type === 'point-point') {
      expect(m.distance).toBe(5);
      expect(m.dx).toBe(3);
      expect(m.dy).toBe(4);
      // 4 mm DOWN the screen and 3 across: 53.13 degrees below the right-hand horizontal
      expect(m.angleDeg).toBeCloseTo(360 - 53.130102354, 6);
    }
    const up = measure([pt(0, 0), pt(10, -10)]);
    expect(up?.type === 'point-point' && up.angleDeg).toBeCloseTo(45, 9);
  });
  it('a point and a line: the distance at right angles', () => {
    const m = measure([pt(5, 5), ln(0, 0, 10, 0)]);
    expect(m?.type).toBe('point-line');
    if (m?.type === 'point-line') {
      expect(m.perpendicular).toBe(5);
      expect(m.footOnSegment).toBe(true);
      expect(m.extension).toBeNull();
      expect(m.guide).toEqual([P(5, 5), P(5, 0)]);
    }
  });
  it('past the end of the line: the right-angle distance, the distance to the end, and a dashed extension', () => {
    const m = measure([pt(15, 5), ln(0, 0, 10, 0)]);
    if (m?.type !== 'point-line') throw new Error('expected point-line');
    expect(m.perpendicular).toBe(5);
    expect(m.footOnSegment).toBe(false);
    expect(m.nearestDistance).toBeCloseTo(Math.hypot(5, 5), 9);
    expect(m.extension).toEqual([P(10, 0), P(15, 0)]);
  });
  it('the order of the two picks does not matter when one is a point and one a line', () => {
    const a = measure([pt(5, 5), ln(0, 0, 10, 0)]);
    const b = measure([ln(0, 0, 10, 0), pt(5, 5)]);
    expect(b).toEqual(a);
  });
  it('two parallel lines: the gap between them', () => {
    const m = measure([ln(0, 0, 10, 0), ln(0, 7, 10, 7)]);
    if (m?.type !== 'line-line') throw new Error('expected line-line');
    expect(m.parallel).toBe(true);
    expect(m.perpendicular).toBeCloseTo(7, 9);
    expect(m.angleDeg).toBeLessThan(PARALLEL_DEG);
    expect(m.intersects).toBe(false);
    expect(m.guide).not.toBeNull();
  });
  it('parallel lines that do not overlap: the gap and, separately, the closest ends', () => {
    const m = measure([ln(0, 0, 10, 0), ln(20, 3, 30, 3)]);
    if (m?.type !== 'line-line') throw new Error('expected line-line');
    expect(m.perpendicular).toBeCloseTo(3, 9);
    expect(m.distance).toBeCloseTo(Math.hypot(10, 3), 9);
  });
  it('two lines that cross: the angle and where they cross', () => {
    const m = measure([ln(0, 0, 10, 10), ln(0, 10, 10, 0)]);
    if (m?.type !== 'line-line') throw new Error('expected line-line');
    expect(m.parallel).toBe(false);
    expect(m.angleDeg).toBeCloseTo(90, 9);
    expect(m.intersects).toBe(true);
    expect(m.intersection?.x).toBeCloseTo(5, 9);
    expect(m.intersection?.y).toBeCloseTo(5, 9);
    expect(m.guide).toBeNull();
    expect(m.distance).toBeCloseTo(0, 9);
  });
  it('two lines that do not meet: the angle and the shortest distance', () => {
    const m = measure([ln(0, 0, 10, 0), ln(20, 5, 20, 15)]);
    if (m?.type !== 'line-line') throw new Error('expected line-line');
    expect(m.intersects).toBe(false);
    expect(m.angleDeg).toBeCloseTo(90, 9);
    expect(m.distance).toBeCloseTo(Math.hypot(10, 5), 9);
    expect(m.guide).toEqual([P(10, 0), P(20, 5)]);
  });
  it('a line of no length is treated as the point it is', () => {
    expect(measure([ln(4, 4, 4, 4)])?.type).toBe('point');
    expect(measure([pt(0, 0), ln(3, 4, 3, 4)])?.type).toBe('point-point');
  });
  it('refuses to measure anything that is not a number', () => {
    expect(measure([pt(Number.NaN, 0)])).toBeNull();
    expect(measure([pt(0, 0), ln(0, 0, Number.POSITIVE_INFINITY, 1)])).toBeNull();
  });
});

describe('words', () => {
  it('formats lengths in millimetres and inches, never as -0.00 or NaN', () => {
    expect(formatLength(25.4)).toBe('25.40 mm');
    expect(formatLength(25.4, 'inch')).toBe('1.000 in');
    expect(formatLength(-0.001)).toBe('0.00 mm');
    expect(formatLength(Number.NaN)).toBe('\u2014');
    expect(formatLength(1234.5678)).toBe('1234.57 mm');
  });
  it('formats angles to one decimal and never shows 360', () => {
    expect(formatAngle(33.333)).toBe('33.3\u00b0');
    expect(formatAngle(359.96)).toBe('0.0\u00b0');
    expect(formatAngle(0)).toBe('0.0\u00b0');
    expect(formatAngle(Number.NaN)).toBe('\u2014');
  });
  it('rows and labels for every kind of measurement', () => {
    const pt = (x: number, y: number): MeasureItem => ({ kind: 'point', p: P(x, y), snap: 'free' });
    const ln = (ax: number, ay: number, bx: number, by: number): MeasureItem => ({ kind: 'line', a: P(ax, ay), b: P(bx, by) });
    const rows = (items: MeasureItem[], units: 'mm' | 'inch' = 'mm') => measurementRows(measure(items)!, units).map((r) => `${r.label}: ${r.value}`);
    expect(rows([pt(1, 2)])).toEqual(['X: 1.00 mm', 'Y: 2.00 mm']);
    expect(rows([ln(0, 0, 30, -40)])).toEqual(['Length: 50.00 mm', '\u0394X: 30.00 mm', '\u0394Y: -40.00 mm', 'Angle: 53.1\u00b0']);
    expect(rows([pt(0, 0), pt(3, 4)])[0]).toBe('Distance: 5.00 mm');
    expect(rows([pt(5, 5), ln(0, 0, 10, 0)])).toEqual(['Distance to the line: 5.00 mm']);
    expect(rows([pt(15, 5), ln(0, 0, 10, 0)])).toContain('Note: beyond the end of the line');
    expect(rows([ln(0, 0, 10, 0), ln(0, 7, 10, 7)])[0]).toBe('Gap between lines: 7.00 mm');
    expect(rows([ln(0, 0, 10, 10), ln(0, 10, 10, 0)])).toContain('Cross at X: 5.00 mm');
    expect(rows([ln(0, 0, 10, 0), ln(20, 5, 20, 15)])[0]).toBe('Shortest distance: 11.18 mm');
    expect(rows([pt(0, 0), pt(25.4, 0)], 'inch')[0]).toBe('Distance: 1.000 in');
    const label = (items: MeasureItem[]) => measurementLabel(measure(items)!);
    expect(label([pt(0, 0), pt(3, 4)])).toBe('5.00 mm');
    expect(label([ln(0, 0, 10, 0), ln(0, 7, 10, 7)])).toBe('7.00 mm');
    expect(label([ln(0, 0, 10, 10), ln(0, 10, 10, 0)])).toBe('\u2220 90.0\u00b0');
    expect(label([pt(1, 2)])).toBe('X 1.00 mm  Y 2.00 mm');
  });
});

describe('picking: how clicks build a measurement', () => {
  const a = freePoint(P(1, 1));
  const b = freePoint(P(2, 2));
  const c = freePoint(P(3, 3));
  it('two clicks make a measurement and a third starts again', () => {
    expect(nextPicks([], a)).toEqual([a]);
    expect(nextPicks([a], b)).toEqual([a, b]);
    expect(nextPicks([a, b], c)).toEqual([c]);
  });
  it('does not change the list it was given', () => {
    const before = [a];
    nextPicks(before, b);
    expect(before).toEqual([a]);
  });
  it('what is measured: the thing under the pointer until two are picked', () => {
    expect(itemsToMeasure([], null)).toEqual([]);
    expect(itemsToMeasure([], a)).toEqual([a]);
    expect(itemsToMeasure([a], null)).toEqual([a]);
    expect(itemsToMeasure([a], b)).toEqual([a, b]);
    expect(itemsToMeasure([a, b], c)).toEqual([a, b]);
  });
});

describe('snapAt', () => {
  const TOL = 2;
  const sq = square('sq', 10, 10, 40); // corners (10,10) (50,10) (50,50) (10,50); middle (30,30)
  const snap = (objs: WorkspaceObject[], x: number, y: number, extra: { bed?: { width: number; height: number } | null } = {}) =>
    snapAt(objs, P(x, y), { tolMm: TOL, ...extra });
  const asPoint = (i: MeasureItem) => {
    if (i.kind !== 'point') throw new Error(`expected a point, got ${i.kind}`);
    return i;
  };

  it('a corner wins', () => {
    const r = asPoint(snap([sq], 11, 11));
    expect(r.snap).toBe('vertex');
    expect(r.p).toEqual(P(10, 10));
  });
  it('the middle of a segment', () => {
    const r = asPoint(snap([sq], 30.5, 10.8));
    expect(r.snap).toBe('midpoint');
    expect(r.p).toEqual(P(30, 10));
  });
  it('the middle of an object', () => {
    const r = asPoint(snap([sq], 30.7, 29.4));
    expect(r.snap).toBe('centre');
    expect(r.p).toEqual(P(30, 30));
  });
  it('anywhere else along an edge picks that whole line', () => {
    const r = snap([sq], 20, 10.8);
    expect(r).toEqual({ kind: 'line', a: P(10, 10), b: P(50, 10) });
  });
  it('the closing edge of a closed shape is a line too, in the order it is drawn', () => {
    expect(snap([sq], 10.5, 20.5)).toEqual({ kind: 'line', a: P(10, 50), b: P(10, 10) });
  });
  it('an open path has no closing edge', () => {
    const open = poly('open', [[10, 10], [50, 10], [50, 50]], false);
    expect(snap([open], 30, 50).kind).toBe('point'); // nothing there: a free point
    expect(asPoint(snap([open], 30, 50)).snap).toBe('free');
  });
  it('further than the snap distance is a free point exactly where you clicked', () => {
    const r = asPoint(snap([sq], 20, 14));
    expect(r.snap).toBe('free');
    expect(r.p).toEqual(P(20, 14));
  });
  it('the snap distance is a real distance', () => {
    expect(asPoint(snap([sq], 12, 10)).snap).toBe('vertex'); // exactly 2 mm from the corner
    expect(snap([sq], 12.1, 10.1).kind).toBe('line'); // just outside the corner's reach, still on the edge
    expect(asPoint(snap([sq], 14, 14)).snap).toBe('free'); // a corner is 5.66 mm away
  });
  it('a corner beats the edge that leads to it', () => {
    expect(asPoint(snap([sq], 10.4, 10.4)).snap).toBe('vertex');
  });
  it('a short segment gets no midpoint (it would clutter the corners), but is still a line', () => {
    // the third point keeps the object's centre well away, so only the segment itself is in play
    const small = poly('small', [[100, 100], [104, 100], [100, 140]], false); // first segment 4 mm: under 3 snap radii
    expect(snap([small], 102, 100.3)).toEqual({ kind: 'line', a: P(100, 100), b: P(104, 100) });
    const long = poly('long', [[100, 100], [112, 100], [100, 140]], false); // first segment 12 mm: long enough
    expect(asPoint(snap([long], 106, 100.3)).snap).toBe('midpoint');
  });
  it('hidden objects are ignored, locked ones are not', () => {
    expect(asPoint(snap([{ ...sq, visible: false }], 11, 11)).snap).toBe('free');
    expect(asPoint(snap([{ ...sq, locked: true }], 11, 11)).snap).toBe('vertex');
  });
  it('follows the object transform: position, scale and rotation', () => {
    const moved = { ...sq, transform: chain(scaling(2, 2), translation(100, 0)) }; // corner (10,10) -> (120,20)
    expect(asPoint(snap([moved], 120.5, 20.5)).p).toEqual(P(120, 20));
    const turned = { ...sq, transform: chain(rotation(90), translation(200, 0)) };
    const where = applyToPoint(turned.transform, P(50, 10));
    const r = asPoint(snap([turned], where.x + 0.3, where.y - 0.3));
    expect(r.snap).toBe('vertex');
    expect(near(r.p.x, where.x)).toBe(true);
    expect(near(r.p.y, where.y)).toBe(true);
  });
  it('an image has corners, edges and a middle', () => {
    const image: WorkspaceObject = {
      ...sq,
      id: 'img',
      kind: { type: 'image', asset_id: 'a', format: 'png', source_path: null, width_px: 254, height_px: 127, dpi: 254 }, // 25.4 x 12.7 mm
      transform: translation(100, 100),
    };
    expect(asPoint(snap([image], 100.5, 100.5)).p).toEqual(P(100, 100));
    expect(asPoint(snap([image], 125, 112.9)).p).toEqual(P(125.4, 112.7));
    expect(asPoint(snap([image], 112.9, 106.5)).snap).toBe('centre');
    expect(snap([image], 108, 100.4).kind).toBe('line');
  });
  it('the bed: its corners, the middle of its edges, its centre, and its edges as lines', () => {
    const bed = { width: 300, height: 200 };
    expect(asPoint(snap([], 0.5, 0.5, { bed })).p).toEqual(P(0, 0));
    expect(asPoint(snap([], 150.4, 0.6, { bed })).p).toEqual(P(150, 0));
    expect(asPoint(snap([], 151, 99, { bed })).p).toEqual(P(150, 100));
    expect(snap([], 100, 0.8, { bed })).toEqual({ kind: 'line', a: P(0, 0), b: P(300, 0) });
    expect(asPoint(snap([], 0.5, 0.5)).snap).toBe('free'); // no bed given
    expect(asPoint(snap([], 0.5, 0.5, { bed: null })).snap).toBe('free');
  });
  it('an object edge and the bed edge: the nearer one', () => {
    const bed = { width: 300, height: 200 };
    const r = snap([poly('l', [[10, 100], [200, 100]], false)], 100, 100.4, { bed });
    expect(r).toEqual({ kind: 'line', a: P(10, 100), b: P(200, 100) });
  });
  it('never fails on odd input', () => {
    expect(snapAt([sq], P(Number.NaN, 0), { tolMm: 2 }).kind).toBe('point');
    expect(asPoint(snapAt([sq], P(11, 11), { tolMm: 0 })).snap).toBe('free');
    expect(asPoint(snapAt([sq], P(11, 11), { tolMm: Number.NaN })).snap).toBe('free');
    expect(asPoint(snapAt([], P(5, 5), { tolMm: 2 })).snap).toBe('free');
    // a bad point in the middle of a path is ignored and the good ones still snap
    const broken = poly('broken', [[100, 100], [Number.NaN, 0], [10, 10]], false);
    const r = asPoint(snapAt([broken], P(10.2, 10.2), { tolMm: 2 }));
    expect(r.snap).toBe('vertex');
    expect(r.p).toEqual(P(10, 10));
    // a bad FIRST point makes the object's box meaningless, so the object is skipped: still no NaN anywhere
    const worse = poly('worse', [[Number.NaN, 0], [10, 10], [20, 20]], false);
    const free = asPoint(snapAt([worse], P(10.2, 10.2), { tolMm: 2 }));
    expect(free.snap).toBe('free');
    expect(free.p).toEqual(P(10.2, 10.2));
  });
  it('agrees with a plain brute-force search on random drawings', () => {
    let seed = 7;
    const rnd = (lo: number, hi: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return lo + (seed / 4294967296) * (hi - lo);
    };
    // The reference: build every world point and segment, then apply the same rules the simple way.
    const reference = (objs: WorkspaceObject[], c: Point2, tol: number): MeasureItem => {
      const vertices: Point2[] = [];
      const mids: Point2[] = [];
      const centres: Point2[] = [];
      const segs: Array<[Point2, Point2]> = [];
      for (const o of objs) {
        if (o.kind.type !== 'vector') continue;
        const all: Point2[] = [];
        for (const path of o.kind.paths) {
          const w = path.points.map((p) => applyToPoint(o.transform, p));
          all.push(...w);
          vertices.push(...w);
          for (let i = 1; i < w.length; i++) segs.push([w[i - 1] as Point2, w[i] as Point2]);
          if (path.closed && w.length > 1) segs.push([w[w.length - 1] as Point2, w[0] as Point2]);
        }
        const xs = o.kind.paths.flatMap((p) => p.points.map((q) => q.x));
        const ys = o.kind.paths.flatMap((p) => p.points.map((q) => q.y));
        centres.push(applyToPoint(o.transform, P((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2)));
      }
      for (const [a, b] of segs) if (distance(a, b) >= 3 * tol) mids.push(P((a.x + b.x) / 2, (a.y + b.y) / 2));
      const nearest = (list: Point2[]) => list.filter((p) => distance(p, c) <= tol).sort((p, q) => distance(p, c) - distance(q, c))[0];
      const v = nearest(vertices);
      if (v) return { kind: 'point', p: v, snap: 'vertex' };
      const m = nearest(mids);
      if (m) return { kind: 'point', p: m, snap: 'midpoint' };
      const ce = nearest(centres);
      if (ce) return { kind: 'point', p: ce, snap: 'centre' };
      let best: [Point2, Point2] | null = null;
      let bestD = Infinity;
      for (const [a, b] of segs) {
        if (distance(a, b) < 1e-6) continue;
        const d = pointToLine(c, a, b).nearestDistance;
        if (d <= tol && d < bestD) {
          bestD = d;
          best = [a, b];
        }
      }
      return best ? { kind: 'line', a: best[0], b: best[1] } : freePoint(c);
    };
    const same = (x: MeasureItem, y: MeasureItem) => {
      if (x.kind !== y.kind) return false;
      if (x.kind === 'point' && y.kind === 'point') return x.snap === y.snap && near(x.p.x, y.p.x, 1e-6) && near(x.p.y, y.p.y, 1e-6);
      if (x.kind === 'line' && y.kind === 'line') return near(x.a.x, y.a.x, 1e-6) && near(x.a.y, y.a.y, 1e-6) && near(x.b.x, y.b.x, 1e-6) && near(x.b.y, y.b.y, 1e-6);
      return false;
    };
    let hits = 0;
    for (let round = 0; round < 60; round++) {
      const objs: WorkspaceObject[] = [];
      for (let k = 0; k < 4; k++) {
        const pts: Array<[number, number]> = [];
        const n = 3 + Math.floor(rnd(0, 5));
        for (let i = 0; i < n; i++) pts.push([rnd(0, 30), rnd(0, 30)]);
        objs.push(poly(`o${k}`, pts, rnd(0, 1) > 0.5, chain(chain(scaling(rnd(0.5, 2), rnd(0.5, 2)), rotation(rnd(0, 360))), translation(rnd(0, 80), rnd(0, 80)))));
      }
      for (let q = 0; q < 40; q++) {
        const c = P(rnd(-10, 130), rnd(-10, 130));
        const tol = rnd(0.5, 6);
        const got = snapAt(objs, c, { tolMm: tol });
        const want = reference(objs, c, tol);
        if (got.kind !== 'point' || got.snap !== 'free') hits++;
        expect(same(got, want)).toBe(true);
      }
    }
    expect(hits).toBeGreaterThan(100); // the test really did exercise snapping
  });
});

describe('pathLength and selectionStats', () => {
  it('a closed square has four sides, an open one three', () => {
    const sq = square('s', 0, 0, 10);
    if (sq.kind.type !== 'vector') throw new Error('vector expected');
    const path = sq.kind.paths[0]!;
    expect(pathLength(path, translation(0, 0))).toBe(40);
    expect(pathLength({ ...path, closed: false }, translation(0, 0))).toBe(30);
  });
  it('a closed path that repeats its first point is not counted twice', () => {
    expect(pathLength({ closed: true, points: [P(0, 0), P(10, 0), P(10, 10), P(0, 10), P(0, 0)] }, translation(0, 0))).toBe(40);
  });
  it('length is measured after the transform, scale and rotation included', () => {
    const path = { closed: true, points: [P(0, 0), P(10, 0), P(10, 10), P(0, 10)] };
    expect(pathLength(path, scaling(2, 3))).toBe(2 * (20 + 30));
    expect(pathLength(path, rotation(37))).toBeCloseTo(40, 9);
  });
  it('a path of no length', () => {
    expect(pathLength({ closed: true, points: [] }, translation(0, 0))).toBe(0);
    expect(pathLength({ closed: true, points: [P(1, 1)] }, translation(0, 0))).toBe(0);
  });
  it('size and outline length of a selection', () => {
    const s = selectionStats([square('a', 10, 20, 30), square('b', 100, 20, 10)]);
    expect(s.count).toBe(2);
    expect(s.vectorCount).toBe(2);
    expect(s.imageCount).toBe(0);
    expect(s.width).toBe(100);
    expect(s.height).toBe(30);
    expect(s.diagonal).toBeCloseTo(Math.hypot(100, 30), 9);
    expect(s.outlineLength).toBe(120 + 40);
  });
  it('images have a size but no outline length', () => {
    const image: WorkspaceObject = {
      ...square('i', 0, 0, 1),
      kind: { type: 'image', asset_id: 'a', format: 'png', source_path: null, width_px: 254, height_px: 127, dpi: 254 },
    };
    const only = selectionStats([image]);
    expect(only.outlineLength).toBeNull();
    expect(only.width).toBeCloseTo(25.4, 9);
    expect(only.height).toBeCloseTo(12.7, 9);
    const mixed = selectionStats([image, square('a', 0, 0, 10)]);
    expect(mixed.imageCount).toBe(1);
    expect(mixed.outlineLength).toBe(40);
  });
  it('nothing selected', () => {
    const s = selectionStats([]);
    expect(s.count).toBe(0);
    expect(s.bounds).toBeNull();
    expect(s.diagonal).toBe(0);
    expect(s.outlineLength).toBeNull();
  });
  it('a rotated shape: the diagonal is of its bounding box, the length is of the shape', () => {
    const turned = { ...square('t', 0, 0, 10), transform: rotation(45) };
    const s = selectionStats([turned]);
    expect(s.width).toBeCloseTo(10 * Math.SQRT2, 9);
    expect(s.outlineLength).toBeCloseTo(40, 9);
  });
});
