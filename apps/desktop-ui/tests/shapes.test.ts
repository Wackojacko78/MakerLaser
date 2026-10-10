import { describe, expect, it } from 'vitest';
import {
  CHORD_TOLERANCE_MM,
  INNER_MAX,
  INNER_MIN,
  SHAPE_KINDS,
  SHAPE_MAX_MM,
  SHAPE_MIN_MM,
  SIDES_MAX,
  SIDES_MIN,
  arcSegments,
  clampShape,
  defaultShape,
  ellipsePoints,
  ellipseSegments,
  polygonPoints,
  rectanglePoints,
  shapeName,
  shapePaths,
  starPoints,
} from '../src/lib/shapes';
import type { Point2, ShapeSource } from '../src/types/domain';

function box(points: readonly Point2[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

const shape = (patch: Partial<ShapeSource>): ShapeSource => ({ ...defaultShape('rectangle'), ...patch });

describe('rectangles', () => {
  it('have four sharp corners when the radius is 0', () => {
    expect(rectanglePoints(40, 20, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 0, y: 20 },
    ]);
  });

  it('keep the same overall size with rounded corners, and cut the corners off', () => {
    const points = rectanglePoints(40, 20, 5);
    const b = box(points);
    expect(b.minX).toBeCloseTo(0, 6);
    expect(b.maxX).toBeCloseTo(40, 6);
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxY).toBeCloseTo(20, 6);
    expect(points.some((p) => Math.abs(p.x) < 1e-6 && Math.abs(p.y) < 1e-6)).toBe(false);
    expect(points.length).toBeGreaterThan(16);
  });

  it('round every corner on a circle of the radius asked for', () => {
    const r = 5;
    const points = rectanglePoints(40, 20, r);
    const centres = [
      { x: 40 - r, y: r },
      { x: 40 - r, y: 20 - r },
      { x: r, y: 20 - r },
      { x: r, y: r },
    ];
    for (const c of centres) {
      const near = points.filter((p) => Math.hypot(p.x - c.x, p.y - c.y) < r + 1e-6 && Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r) < 1e-6);
      expect(near.length).toBeGreaterThan(3);
    }
  });

  it('limit the radius to half the short side, which makes a stadium', () => {
    const points = rectanglePoints(20, 10, 100);
    const b = box(points);
    expect(b.maxX - b.minX).toBeCloseTo(20, 6);
    expect(b.maxY - b.minY).toBeCloseTo(10, 6);
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i] as Point2;
      const q = points[(i + 1) % points.length] as Point2;
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(1e-6); // no repeated points
    }
  });

  it('use more segments for a bigger radius, within the tolerance', () => {
    expect(arcSegments(1)).toBeLessThan(arcSegments(20));
    const r = 10;
    const n = arcSegments(r);
    const sagitta = r * (1 - Math.cos(Math.PI / 2 / n / 2));
    expect(sagitta).toBeLessThanOrEqual(CHORD_TOLERANCE_MM + 1e-9);
    expect(arcSegments(0.001)).toBe(2);
  });
});

describe('ellipses', () => {
  it('fill the box exactly, with a multiple of four points', () => {
    const points = ellipsePoints(50, 30);
    const b = box(points);
    expect(b.minX).toBeCloseTo(0, 6);
    expect(b.maxX).toBeCloseTo(50, 6);
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxY).toBeCloseTo(30, 6);
    expect(points.length % 4).toBe(0);
  });

  it('start at the top', () => {
    const first = ellipsePoints(50, 30)[0] as Point2;
    expect(first.x).toBeCloseTo(25, 6);
    expect(first.y).toBeCloseTo(0, 6);
  });

  it('stay within the tolerance of a true circle', () => {
    const points = ellipsePoints(50, 50);
    const centre = { x: 25, y: 25 };
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i] as Point2;
      const q = points[(i + 1) % points.length] as Point2;
      const mid = Math.hypot((p.x + q.x) / 2 - centre.x, (p.y + q.y) / 2 - centre.y);
      expect(mid).toBeGreaterThanOrEqual(25 - CHORD_TOLERANCE_MM - 1e-6);
      expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeCloseTo(25, 6);
    }
  });

  it('use more points for a bigger one, within sensible limits', () => {
    expect(ellipseSegments(5)).toBeLessThan(ellipseSegments(100));
    expect(ellipseSegments(0.001)).toBe(16);
    expect(ellipseSegments(1e9)).toBeLessThanOrEqual(1024);
  });
});

describe('polygons', () => {
  it('have the number of sides asked for and fill the box', () => {
    for (let n = 3; n <= 12; n += 1) {
      const points = polygonPoints(30, 24, n);
      expect(points).toHaveLength(n);
      const b = box(points);
      expect(b.minX).toBeCloseTo(0, 6);
      expect(b.maxX).toBeCloseTo(30, 6);
      expect(b.minY).toBeCloseTo(0, 6);
      expect(b.maxY).toBeCloseTo(24, 6);
    }
  });

  it('make four sides an upright square', () => {
    const points = polygonPoints(20, 20, 4).map((p) => `${Math.round(p.x)},${Math.round(p.y)}`);
    expect(points.sort()).toEqual(['0,0', '0,20', '20,0', '20,20']);
  });

  it('point a triangle up, with a flat base', () => {
    const [a, b, c] = polygonPoints(30, 26, 3) as [Point2, Point2, Point2];
    expect(a.x).toBeCloseTo(15, 6);
    expect(a.y).toBeCloseTo(0, 6);
    expect(b.y).toBeCloseTo(26, 6);
    expect(c.y).toBeCloseTo(26, 6);
  });

  it('are symmetrical about the vertical middle', () => {
    for (const n of [3, 5, 6, 8]) {
      const points = polygonPoints(40, 40, n);
      for (const p of points) {
        const mirrored = points.some((q) => Math.abs(q.x - (40 - p.x)) < 1e-6 && Math.abs(q.y - p.y) < 1e-6);
        expect(mirrored).toBe(true);
      }
    }
  });
});

describe('stars', () => {
  it('have two points per tip, alternating outer and inner, and fill the box', () => {
    const points = starPoints(40, 40, 5, 0.5);
    expect(points).toHaveLength(10);
    const b = box(points);
    expect(b.minX).toBeCloseTo(0, 6);
    expect(b.maxX).toBeCloseTo(40, 6);
    expect(b.minY).toBeCloseTo(0, 6);
    expect(b.maxY).toBeCloseTo(40, 6);
  });

  it('point the first tip up', () => {
    const first = starPoints(40, 40, 5, 0.5)[0] as Point2;
    expect(first.x).toBeCloseTo(20, 6);
    expect(first.y).toBeCloseTo(0, 6);
  });

  it('get fatter as the inner size grows', () => {
    const area = (pts: Point2[]) => {
      let a = 0;
      for (let i = 0; i < pts.length; i += 1) {
        const p = pts[i] as Point2;
        const q = pts[(i + 1) % pts.length] as Point2;
        a += p.x * q.y - q.x * p.y;
      }
      return Math.abs(a / 2);
    };
    expect(area(starPoints(40, 40, 5, 0.3))).toBeLessThan(area(starPoints(40, 40, 5, 0.7)));
  });
});

describe('clampShape', () => {
  it('leaves sensible settings alone', () => {
    const s = shape({ width_mm: 40, height_mm: 20, corner_radius_mm: 3, sides: 6, inner_ratio: 0.4 });
    expect(clampShape(s)).toEqual(s);
  });

  it('keeps sizes within the limits', () => {
    expect(clampShape(shape({ width_mm: 0, height_mm: -5 })).width_mm).toBe(SHAPE_MIN_MM);
    expect(clampShape(shape({ width_mm: 0, height_mm: -5 })).height_mm).toBe(SHAPE_MIN_MM);
    expect(clampShape(shape({ width_mm: 1e9 })).width_mm).toBe(SHAPE_MAX_MM);
  });

  it('fits the corner radius inside the shape', () => {
    expect(clampShape(shape({ width_mm: 20, height_mm: 10, corner_radius_mm: 50 })).corner_radius_mm).toBe(5);
    expect(clampShape(shape({ corner_radius_mm: -3 })).corner_radius_mm).toBe(0);
  });

  it('rounds the sides to a whole number within the limits', () => {
    expect(clampShape(shape({ sides: 5.6 })).sides).toBe(6);
    expect(clampShape(shape({ sides: 1 })).sides).toBe(SIDES_MIN);
    expect(clampShape(shape({ sides: 500 })).sides).toBe(SIDES_MAX);
  });

  it('keeps the star inner size within the limits', () => {
    expect(clampShape(shape({ inner_ratio: 0 })).inner_ratio).toBe(INNER_MIN);
    expect(clampShape(shape({ inner_ratio: 5 })).inner_ratio).toBe(INNER_MAX);
  });

  it('turns not-a-number into a usable value instead of a broken shape', () => {
    const s = clampShape(shape({ width_mm: Number.NaN, height_mm: Number.POSITIVE_INFINITY, sides: Number.NaN }));
    expect(Number.isFinite(s.width_mm)).toBe(true);
    expect(Number.isFinite(s.height_mm)).toBe(true);
    expect(Number.isInteger(s.sides)).toBe(true);
  });
});

describe('shapePaths', () => {
  it('gives one closed outline for every kind, filling exactly the size asked for', () => {
    for (const kind of SHAPE_KINDS) {
      const s = { ...defaultShape(kind), width_mm: 37.5, height_mm: 21.25 };
      const paths = shapePaths(s);
      expect(paths).toHaveLength(1);
      expect(paths[0]?.closed).toBe(true);
      const b = box(paths[0]?.points ?? []);
      expect(b.minX).toBeCloseTo(0, 3);
      expect(b.minY).toBeCloseTo(0, 3);
      expect(b.maxX).toBeCloseTo(37.5, 3);
      expect(b.maxY).toBeCloseTo(21.25, 3);
    }
  });

  it('only ever gives finite numbers, rounded to a thousandth of a mm', () => {
    for (const kind of SHAPE_KINDS) {
      for (const p of shapePaths(defaultShape(kind))[0]?.points ?? []) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(Math.abs(p.x * 1000 - Math.round(p.x * 1000))).toBeLessThan(1e-6);
      }
    }
  });

  it('is the same every time it is built', () => {
    for (const kind of SHAPE_KINDS) expect(shapePaths(defaultShape(kind))).toEqual(shapePaths(defaultShape(kind)));
  });

  it('survives settings that are out of range', () => {
    const paths = shapePaths(shape({ shape: 'star', width_mm: -1, height_mm: Number.NaN, sides: 1000, inner_ratio: 9 }));
    expect(paths[0]?.points.length).toBe(SIDES_MAX * 2);
  });
});

describe('shapeName', () => {
  it('names each kind', () => {
    expect(shapeName(shape({ shape: 'rectangle', width_mm: 40, height_mm: 20 }))).toBe('Rectangle');
    expect(shapeName(shape({ shape: 'rectangle', width_mm: 20, height_mm: 20 }))).toBe('Square');
    expect(shapeName(shape({ shape: 'rectangle', width_mm: 40, height_mm: 20, corner_radius_mm: 4 }))).toBe('Rounded rectangle');
    expect(shapeName(shape({ shape: 'rectangle', width_mm: 20, height_mm: 20, corner_radius_mm: 4 }))).toBe('Rounded square');
    expect(shapeName(shape({ shape: 'ellipse', width_mm: 30, height_mm: 30 }))).toBe('Circle');
    expect(shapeName(shape({ shape: 'ellipse', width_mm: 30, height_mm: 20 }))).toBe('Ellipse');
    expect(shapeName(shape({ shape: 'polygon', sides: 8 }))).toBe('Polygon (8 sides)');
    expect(shapeName(shape({ shape: 'star', sides: 6 }))).toBe('Star (6 points)');
  });
});
