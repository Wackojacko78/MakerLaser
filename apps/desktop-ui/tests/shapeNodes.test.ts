import { describe, expect, it } from 'vitest';
import { convertToOutlines, flattenNodePath, flattenNodes, nodeAccess, nodesMatchPaths } from '@/lib/nodePath';
import { EIGHT_NODE_RADIUS_MM, arcHandle, ellipseNodes, roundedRectangleNodes, shapeNodes } from '@/lib/shapeNodes';
import { defaultShape, shapePaths } from '@/lib/shapes';
import type { NodePath, Path2D, Point2, ShapeSource } from '@/types/domain';

function distanceToPolyline(p: Point2, line: readonly Point2[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as Point2;
    const b = line[i + 1] as Point2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}
const closeLoop = (points: readonly Point2[]): Point2[] => [...points, points[0] as Point2];
/** The most any point of one closed outline is from the other, and the other way round. */
function hausdorff(a: readonly Point2[], b: readonly Point2[]): number {
  const la = closeLoop(a);
  const lb = closeLoop(b);
  return Math.max(...a.map((p) => distanceToPolyline(p, lb)), ...b.map((p) => distanceToPolyline(p, la)));
}
/** A true ellipse in the box 0..w x 0..h, finely sampled (a different route from the Bezier nodes). */
function trueEllipse(w: number, h: number, n = 8000): Point2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: w / 2 + (w / 2) * Math.cos(a), y: h / 2 + (h / 2) * Math.sin(a) };
  });
}
const shape = (kind: ShapeSource['shape'], patch: Partial<ShapeSource> = {}): ShapeSource => ({ ...defaultShape(kind), ...patch });
const len = (h: { x: number; y: number } | undefined) => Math.hypot(h?.x ?? NaN, h?.y ?? NaN);

describe('the handle length of a circular arc', () => {
  it('is 0.5523 of the radius for a quarter turn and 0.2652 for an eighth', () => {
    expect(arcHandle(Math.PI / 2)).toBeCloseTo(0.5522847498307936, 12);
    expect(arcHandle(Math.PI / 4)).toBeCloseTo(0.26521648983954, 9);
  });
});

describe('an ellipse as nodes', () => {
  it('a circle of 20 mm is four smooth nodes: top, right, bottom, left, clockwise, with the usual handles', () => {
    const e = ellipseNodes(20, 20);
    expect(e.closed).toBe(true);
    expect(e.nodes).toEqual([
      { x: 10, y: 0, in: { x: -5.523, y: 0 }, out: { x: 5.523, y: 0 }, mode: 'smooth' },
      { x: 20, y: 10, in: { x: 0, y: -5.523 }, out: { x: 0, y: 5.523 }, mode: 'smooth' },
      { x: 10, y: 20, in: { x: 5.523, y: 0 }, out: { x: -5.523, y: 0 }, mode: 'smooth' },
      { x: 0, y: 10, in: { x: 0, y: 5.523 }, out: { x: 0, y: -5.523 }, mode: 'smooth' },
    ]);
  });
  it('an ellipse has handles as long as its own radii allow', () => {
    const e = ellipseNodes(40, 20);
    expect(e.nodes[0]).toMatchObject({ x: 20, y: 0, out: { x: 11.046, y: 0 } });
    expect(e.nodes[1]).toMatchObject({ x: 40, y: 10, out: { x: 0, y: 5.523 } });
  });
  it('has 4 nodes up to a radius of 36 mm and 8 above it', () => {
    expect(EIGHT_NODE_RADIUS_MM).toBe(36);
    expect(ellipseNodes(72, 72).nodes).toHaveLength(4);
    expect(ellipseNodes(72.2, 20).nodes).toHaveLength(8);
    expect(ellipseNodes(20, 72.2).nodes).toHaveLength(8);
    expect(ellipseNodes(0.5, 0.5).nodes).toHaveLength(4);
  });
  it('eight nodes sit every 45 degrees and have shorter handles', () => {
    const e = ellipseNodes(100, 100);
    expect(e.nodes).toHaveLength(8);
    expect(e.nodes[1]).toMatchObject({ x: 85.355, y: 14.645 });
    expect(len(e.nodes[1]?.out)).toBeCloseTo(0.26521649 * 50, 2);
    // the tangent at 45 degrees up and to the right runs down and to the right on a clockwise outline
    expect(e.nodes[1]?.out?.x).toBeCloseTo(e.nodes[1]?.out?.y ?? NaN, 2);
    expect(e.nodes[1]?.out?.x).toBeGreaterThan(0);
  });
  it('every node is smooth with equal handles pointing opposite ways', () => {
    for (const size of [[20, 20], [60, 30], [150, 90]] as const) {
      for (const n of ellipseNodes(size[0], size[1]).nodes) {
        expect(n.mode).toBe('smooth');
        expect(n.in?.x).toBeCloseTo(-(n.out?.x ?? NaN), 3);
        expect(n.in?.y).toBeCloseTo(-(n.out?.y ?? NaN), 3);
      }
    }
  });
  it('stays within three hundredths of a millimetre of a true ellipse, at every size', () => {
    for (const [w, h] of [[0.4, 0.4], [10, 10], [36, 20], [72, 72], [73, 73], [150, 80], [300, 300], [300, 40]] as const) {
      const np = ellipseNodes(w, h);
      const flat = flattenNodePath(np).points;
      const truth = trueEllipse(w, h);
      expect(hausdorff(flat, truth)).toBeLessThan(0.03);
    }
  });
});

describe('a rounded rectangle as nodes', () => {
  it('has a node at each end of each corner arc, clockwise from the top, with the arcs as curves and the sides as lines', () => {
    const r = roundedRectangleNodes(40, 20, 5) as NodePath;
    expect(r.closed).toBe(true);
    expect(r.nodes).toEqual([
      { x: 35, y: 0, out: { x: 2.761, y: 0 } },
      { x: 40, y: 5, in: { x: 0, y: -2.761 } },
      { x: 40, y: 15, out: { x: 0, y: 2.761 } },
      { x: 35, y: 20, in: { x: 2.761, y: 0 } },
      { x: 5, y: 20, out: { x: -2.761, y: 0 } },
      { x: 0, y: 15, in: { x: 0, y: 2.761 } },
      { x: 0, y: 5, out: { x: 0, y: -2.761 } },
      { x: 5, y: 0, in: { x: -2.761, y: 0 } },
    ]);
  });
  it('merges nodes that would sit on top of each other when a side is as long as the corner radius', () => {
    // 40 x 20 with r = 10: the left and right sides have no straight part
    const a = roundedRectangleNodes(40, 20, 10) as NodePath;
    expect(a.nodes).toHaveLength(6);
    expect(a.nodes.find((n) => n.x === 40 && n.y === 10)).toEqual({ x: 40, y: 10, in: { x: 0, y: -5.523 }, out: { x: 0, y: 5.523 }, mode: 'smooth' });
    // a square with r = half its side is a circle: four nodes
    const c = roundedRectangleNodes(20, 20, 10) as NodePath;
    expect(c.nodes).toHaveLength(4);
    expect(c.nodes.every((n) => n.mode === 'smooth' && n.in && n.out)).toBe(true);
  });
  it('a corner radius bigger than half the shorter side is brought down to it', () => {
    expect(roundedRectangleNodes(40, 20, 99)?.nodes).toHaveLength(6);
  });
  it('is nothing at all for sharp corners', () => {
    expect(roundedRectangleNodes(40, 20, 0)).toBeNull();
    expect(roundedRectangleNodes(40, 20, -3)).toBeNull();
  });
  it('stays within five hundredths of a millimetre of the outline the shape tool draws', () => {
    for (const [w, h, r] of [[40, 20, 5], [40, 20, 10], [100, 60, 12.5], [20, 20, 10], [300, 200, 40], [8, 6, 1]] as const) {
      const src = shape('rectangle', { width_mm: w, height_mm: h, corner_radius_mm: r });
      const old = (shapePaths(src)[0] as Path2D).points;
      const np = roundedRectangleNodes(w, h, r) as NodePath;
      expect(hausdorff(flattenNodePath(np).points, old)).toBeLessThan(0.05);
    }
  });
});

describe('shapeNodes: which shapes have curves', () => {
  it('an ellipse and a rounded rectangle do, with the recipe and the outline agreeing', () => {
    const e = shape('ellipse', { width_mm: 30, height_mm: 30 });
    expect(shapeNodes(e, shapePaths(e))?.nodes).toHaveLength(4);
    const r = shape('rectangle', { width_mm: 40, height_mm: 20, corner_radius_mm: 4 });
    expect(shapeNodes(r, shapePaths(r))?.nodes).toHaveLength(8);
  });
  it('a sharp rectangle, a polygon and a star do not', () => {
    for (const kind of ['rectangle', 'polygon', 'star'] as const) {
      const s = shape(kind);
      expect(shapeNodes(s, shapePaths(s))).toBeNull();
    }
  });
  it('a recipe that does not describe the outline it came with is not trusted', () => {
    const e = shape('ellipse', { width_mm: 30, height_mm: 30 });
    const other = shapePaths(shape('ellipse', { width_mm: 50, height_mm: 30 }));
    expect(shapeNodes(e, other)).toBeNull();
    expect(shapeNodes(e, [])).toBeNull();
    const two = [...shapePaths(e), ...shapePaths(e)];
    expect(shapeNodes(e, two)).toBeNull();
  });
  it('uses the recipe made safe, as the shape tool does', () => {
    const wild = shape('ellipse', { width_mm: 30, height_mm: 30 });
    expect(shapeNodes({ ...wild, width_mm: Number.NaN }, shapePaths(wild))).toBeNull();
  });
});

describe('Convert to outlines for shapes', () => {
  it('turns a circle into four curve nodes whose outline is within a few hundredths of what it was', () => {
    const e = shape('ellipse', { width_mm: 30, height_mm: 30 });
    const kind = { type: 'vector' as const, paths: shapePaths(e), source: e };
    const out = convertToOutlines(kind);
    expect('source' in out).toBe(false);
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes?.[0]?.nodes).toHaveLength(4);
    expect(out.paths).toEqual(flattenNodes(out.nodes ?? []));
    expect(hausdorff((out.paths[0] as Path2D).points, (kind.paths[0] as Path2D).points)).toBeLessThan(0.05);
    const access = nodeAccess(out);
    expect(access.ok && !access.stale && !access.fromPaths).toBe(true);
    expect(nodesMatchPaths(out.nodes ?? [], out.paths)).toBe(true);
  });
  it('turns rounded corners into curves', () => {
    const r = shape('rectangle', { width_mm: 50, height_mm: 30, corner_radius_mm: 6 });
    const out = convertToOutlines({ type: 'vector', paths: shapePaths(r), source: r });
    expect(out.nodes?.[0]?.nodes).toHaveLength(8);
    expect(out.nodes?.[0]?.nodes[0]?.out).toEqual({ x: 3.314, y: 0 });
  });
  it('leaves a polygon, a star and a sharp rectangle as one corner node for each point, outline exactly as it was', () => {
    for (const kind of ['rectangle', 'polygon', 'star'] as const) {
      const s = shape(kind);
      const paths = shapePaths(s);
      const out = convertToOutlines({ type: 'vector', paths, source: s });
      expect(out.paths).toEqual(paths);
      expect(out.nodes?.[0]?.nodes).toHaveLength((paths[0] as Path2D).points.length);
    }
  });
  it('leaves text exactly as it was', () => {
    const paths: Path2D[] = [{ closed: true, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] }];
    const text = { type: 'text' as const, text: 'A', font_family: 'Arial', bold: false, italic: false, cap_height_mm: 10, align: 'left' as const, line_spacing: 1.2 };
    const out = convertToOutlines({ type: 'vector', paths, source: text });
    expect(out.paths).toEqual(paths);
    expect(out.nodes).toEqual([{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] }]);
  });
  it('does not change what it is given', () => {
    const e = shape('ellipse', { width_mm: 30, height_mm: 20 });
    const kind = JSON.parse(JSON.stringify({ type: 'vector', paths: shapePaths(e), source: e }));
    const frozen = JSON.stringify(kind);
    convertToOutlines(kind);
    expect(JSON.stringify(kind)).toBe(frozen);
  });
});
