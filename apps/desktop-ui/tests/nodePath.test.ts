import { describe, expect, it } from 'vitest';
import {
  FLATTEN_TOLERANCE_MM,
  MAX_NODES_PER_OBJECT,
  convertToOutlines,
  deleteNodes,
  flattenNodePath,
  flattenNodes,
  insertNode,
  kindWithNodes,
  moveNodes,
  nearestSegment,
  nodeAccess,
  nodeAccessMessage,
  nodeAt,
  nodeCount,
  nodesFromPaths,
  nodesInBox,
  nodesMatchPaths,
  refKey,
  sanitizeNodes,
  segmentCount,
  segmentControls,
  setNodePosition,
} from '@/lib/nodePath';
import type { NodePath, ObjectKind, Path2D, Point2, VectorObjectData } from '@/types/domain';

// ---- helpers ----------------------------------------------------------------------------------------

/** Freezes a value all the way down, so any edit made in place throws (the compiled tests run in strict mode). */
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v as object)) freeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}
const square = (s = 10, x = 0, y = 0): Path2D => ({
  closed: true,
  points: [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ],
});
const KAPPA = 0.5522847498307936;
/** An open curve from (r, 0) to (0, r): a quarter of a circle of radius r, as one cubic. */
const quarter = (r: number): NodePath => ({
  closed: false,
  nodes: [
    { x: r, y: 0, out: { x: 0, y: KAPPA * r } },
    { x: 0, y: r, in: { x: KAPPA * r, y: 0 } },
  ],
});
/** The true cubic, sampled densely with the Bernstein form (a different route from the subdivision the module uses). */
function dense(a: Point2, c1: Point2, c2: Point2, b: Point2, n = 4000): Point2[] {
  const out: Point2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push({
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    });
  }
  return out;
}
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
/** The most any point of `a` is from the line `b`, and the other way round. */
const hausdorff = (a: readonly Point2[], b: readonly Point2[]): number =>
  Math.max(...a.map((p) => distanceToPolyline(p, b)), ...b.map((p) => distanceToPolyline(p, a)));

// ---- flattening ------------------------------------------------------------------------------------

describe('nodes and outlines', () => {
  it('one corner node per point flattens back to exactly the same outlines', () => {
    const paths: Path2D[] = [
      square(10),
      { closed: false, points: [{ x: 1, y: 1 }, { x: 4, y: 9 }, { x: 7, y: 2 }] },
      // a closed outline that repeats its first point at the end is kept as it is
      { closed: true, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 0 }] },
    ];
    const nodes = nodesFromPaths(paths);
    expect(nodes).toHaveLength(3);
    expect(nodes[0]?.closed).toBe(true);
    expect(nodes[0]?.nodes).toHaveLength(4);
    expect(flattenNodes(nodes)).toEqual(paths);
    expect(nodesMatchPaths(nodes, paths)).toBe(true);
  });

  it('a segment is straight unless a handle reaches somewhere', () => {
    const np: NodePath = { closed: false, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10, in: { x: 0, y: 0 } }] };
    expect(segmentCount(np)).toBe(2);
    expect(segmentControls(np, 0).straight).toBe(true);
    // a handle of zero length is no handle
    expect(segmentControls(np, 1).straight).toBe(true);
    const curved: NodePath = { closed: false, nodes: [{ x: 0, y: 0, out: { x: 0, y: 5 } }, { x: 10, y: 0 }] };
    expect(segmentControls(curved, 0).straight).toBe(false);
    expect(segmentControls(curved, 0).p1).toEqual({ x: 0, y: 5 });
    const inOnly: NodePath = { closed: false, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0, in: { x: 0, y: 5 } }] };
    expect(segmentControls(inOnly, 0).straight).toBe(false);
    expect(segmentControls(inOnly, 0).p2).toEqual({ x: 10, y: 5 });
  });

  it('an open outline has one fewer segment than nodes, a closed one as many, and a lone node none', () => {
    expect(segmentCount({ closed: false, nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] })).toBe(2);
    expect(segmentCount({ closed: true, nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] })).toBe(3);
    expect(segmentCount({ closed: true, nodes: [{ x: 0, y: 0 }] })).toBe(0);
    expect(segmentCount({ closed: false, nodes: [] })).toBe(0);
  });

  it('flattens a curve to within the tolerance of the true curve, keeping both ends exactly', () => {
    for (const r of [5, 20, 50, 150]) {
      const np = quarter(r);
      const flat = flattenNodePath(np).points;
      expect(flat[0]).toEqual({ x: r, y: 0 });
      expect(flat[flat.length - 1]).toEqual({ x: 0, y: r });
      const truth = dense({ x: r, y: 0 }, { x: r, y: KAPPA * r }, { x: KAPPA * r, y: r }, { x: 0, y: r });
      expect(hausdorff(flat, truth)).toBeLessThanOrEqual(FLATTEN_TOLERANCE_MM);
    }
  });

  it('makes the same number of segments as the Rust flattener for a quarter circle', () => {
    // Counted with a direct port of bezier.rs: 16, 32, 48 and 64 segments at 0.02 mm.
    const segments = (r: number) => flattenNodePath(quarter(r)).points.length - 1;
    expect([5, 20, 50, 150].map(segments)).toEqual([16, 32, 48, 64]);
  });

  it('a curved closing segment is flattened after the last node, and the first point is not repeated', () => {
    const np: NodePath = {
      closed: true,
      nodes: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20, out: { x: -10, y: 15 } }],
    };
    const flat = flattenNodePath(np);
    expect(flat.closed).toBe(true);
    expect(flat.points.length).toBeGreaterThan(3);
    expect(flat.points.slice(0, 3)).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }]);
    expect(flat.points[flat.points.length - 1]).not.toEqual({ x: 0, y: 0 });
    const truth = dense({ x: 20, y: 20 }, { x: 10, y: 35 }, { x: 0, y: 0 }, { x: 0, y: 0 });
    for (const p of flat.points.slice(3)) expect(distanceToPolyline(p, truth)).toBeLessThanOrEqual(FLATTEN_TOLERANCE_MM);
  });

  it('a straight line with handles that lie on it stays a curve, and still ends where it should', () => {
    const np: NodePath = { closed: false, nodes: [{ x: 0, y: 0, out: { x: 3, y: 0 } }, { x: 10, y: 0, in: { x: -3, y: 0 } }] };
    const flat = flattenNodePath(np).points;
    expect(flat[0]).toEqual({ x: 0, y: 0 });
    expect(flat[flat.length - 1]).toEqual({ x: 10, y: 0 });
    for (const p of flat) expect(Math.abs(p.y)).toBeLessThanOrEqual(1e-9);
  });

  it('flattening does not change what it is given', () => {
    const nodes = freeze([quarter(20), { closed: true, nodes: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] }]);
    expect(flattenNodes(nodes)).toHaveLength(2);
  });
});

describe('do the nodes still match the outlines', () => {
  const paths = [square(10)];
  const nodes = nodesFromPaths(paths);
  it('yes for nodes made from them, and for curves flattened by the same function', () => {
    expect(nodesMatchPaths(nodes, paths)).toBe(true);
    const curved = [quarter(20)];
    expect(nodesMatchPaths(curved, flattenNodes(curved))).toBe(true);
  });
  it('no when a point has moved, a point is missing, an outline is missing or the closed flag differs', () => {
    expect(nodesMatchPaths(nodes, [{ closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10.001 }, { x: 0, y: 10 }] }])).toBe(false);
    expect(nodesMatchPaths(nodes, [{ closed: true, points: square(10).points.slice(0, 3) }])).toBe(false);
    expect(nodesMatchPaths(nodes, [])).toBe(false);
    expect(nodesMatchPaths(nodes, [{ ...square(10), closed: false }])).toBe(false);
  });
  it('allows a millionth of a millimetre of slack and no more', () => {
    const nudged = [{ closed: true, points: square(10).points.map((p) => ({ x: p.x + 5e-7, y: p.y })) }];
    expect(nodesMatchPaths(nodes, nudged)).toBe(true);
    const far = [{ closed: true, points: square(10).points.map((p) => ({ x: p.x + 5e-6, y: p.y })) }];
    expect(nodesMatchPaths(nodes, far)).toBe(false);
  });
});

// ---- a file that is not to be trusted --------------------------------------------------------------

describe('sanitizeNodes', () => {
  const good = [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 5, y: 0, in: { x: -1, y: 0 }, mode: 'smooth' }, { x: 5, y: 5, out: { x: 0, y: 1 } }] }];
  it('keeps good nodes, and leaves corner mode out', () => {
    expect(sanitizeNodes(good)).toEqual(good);
    expect(sanitizeNodes([{ closed: false, nodes: [{ x: 0, y: 0, mode: 'corner' }] }])).toEqual([{ closed: false, nodes: [{ x: 0, y: 0 }] }]);
    expect(sanitizeNodes([])).toEqual([]);
  });
  it('gives back a copy, never the same objects', () => {
    const out = sanitizeNodes(good) as NodePath[];
    expect(out[0]).not.toBe(good[0]);
  });
  it('refuses anything that is not right, and repairs nothing', () => {
    for (const bad of [
      null,
      undefined,
      'nodes',
      {},
      [null],
      [{ closed: 'yes', nodes: [] }],
      [{ closed: true }],
      [{ closed: true, nodes: [null] }],
      [{ closed: true, nodes: [{ x: 'a', y: 0 }] }],
      [{ closed: true, nodes: [{ x: NaN, y: 0 }] }],
      [{ closed: true, nodes: [{ x: Infinity, y: 0 }] }],
      [{ closed: true, nodes: [{ x: 0, y: 0, in: { x: 1 } }] }],
      [{ closed: true, nodes: [{ x: 0, y: 0, out: 'far' }] }],
      [{ closed: true, nodes: [{ x: 0, y: 0, mode: 'round' }] }],
    ]) {
      expect(sanitizeNodes(bad)).toBeNull();
    }
  });
  it('refuses more than the limit', () => {
    const many = [{ closed: false, nodes: Array.from({ length: 11 }, (_, i) => ({ x: i, y: 0 })) }];
    expect(sanitizeNodes(many, 10)).toBeNull();
    expect(sanitizeNodes(many, 11)).not.toBeNull();
  });
});

// ---- who can be edited -----------------------------------------------------------------------------

describe('nodeAccess', () => {
  const vector = (extra: Partial<VectorObjectData> = {}): ObjectKind => ({ type: 'vector', paths: [square(10)], ...extra });
  it('makes corner nodes from the outlines of an object that has none', () => {
    const r = nodeAccess(vector());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fromPaths).toBe(true);
      expect(r.stale).toBe(false);
      expect(r.nodes[0]?.nodes).toHaveLength(4);
    }
  });
  it('uses the nodes an object has when they still match', () => {
    const own = [quarter(20)];
    const r = nodeAccess({ type: 'vector', paths: flattenNodes(own), nodes: own });
    expect(r.ok && !r.fromPaths && !r.stale).toBe(true);
    if (r.ok) expect(r.nodes[0]?.nodes[0]?.out).toEqual({ x: 0, y: KAPPA * 20 });
  });
  it('rebuilds plain corners, and says so, when the nodes no longer match the outlines', () => {
    const r = nodeAccess({ type: 'vector', paths: [square(10)], nodes: [quarter(20)] });
    expect(r.ok && r.fromPaths && r.stale).toBe(true);
    if (r.ok) expect(r.nodes).toEqual(nodesFromPaths([square(10)]));
  });
  it('treats broken nodes from a file as stale', () => {
    const broken = [{ closed: true, nodes: [{ x: NaN, y: 0 }] }] as unknown as NodePath[];
    const r = nodeAccess({ type: 'vector', paths: [square(10)], nodes: broken });
    expect(r.ok && r.stale).toBe(true);
  });
  it('refuses pictures', () => {
    const picture: ObjectKind = { type: 'image', asset_id: 'a', format: 'png', source_path: null, width_px: 1, height_px: 1, dpi: 96 };
    expect(nodeAccess(picture)).toEqual({ ok: false, reason: 'not-vector' });
  });
  it('refuses text and shapes until they are converted', () => {
    const shape = vector({ source: { type: 'shape', shape: 'rectangle', width_mm: 10, height_mm: 10, corner_radius_mm: 0, sides: 5, inner_ratio: 0.5 } });
    const text = vector({ source: { type: 'text', text: 'Hi', font_family: 'Arial', bold: false, italic: false, cap_height_mm: 10, align: 'left', line_spacing: 1.2 } });
    expect(nodeAccess(shape)).toEqual({ ok: false, reason: 'has-recipe' });
    expect(nodeAccess(text)).toEqual({ ok: false, reason: 'has-recipe' });
  });
  it('refuses nothing to edit, and more than the limit', () => {
    expect(nodeAccess({ type: 'vector', paths: [] })).toEqual({ ok: false, reason: 'nothing' });
    expect(nodeAccess({ type: 'vector', paths: [{ closed: false, points: [{ x: 1, y: 1 }] }] })).toEqual({ ok: false, reason: 'nothing' });
    const huge: Path2D = { closed: false, points: Array.from({ length: MAX_NODES_PER_OBJECT + 1 }, (_, i) => ({ x: i, y: 0 })) };
    expect(nodeAccess({ type: 'vector', paths: [huge] })).toEqual({ ok: false, reason: 'too-many' });
    const exact: Path2D = { closed: false, points: huge.points.slice(0, MAX_NODES_PER_OBJECT) };
    expect(nodeAccess({ type: 'vector', paths: [exact] }).ok).toBe(true);
  });
  it('has something to say for every refusal', () => {
    for (const reason of ['not-vector', 'has-recipe', 'too-many', 'nothing'] as const) expect(nodeAccessMessage(reason).length).toBeGreaterThan(20);
    expect(nodeAccessMessage('has-recipe')).toContain('Convert to outlines');
  });
  it('does not change the object it is given', () => {
    const k = freeze(vector({ nodes: [quarter(5)] }));
    nodeAccess(k);
  });
});

describe('kindWithNodes and convertToOutlines', () => {
  const recipe = { type: 'shape', shape: 'rectangle', width_mm: 10, height_mm: 10, corner_radius_mm: 0, sides: 5, inner_ratio: 0.5 } as const;
  it('gives outlines that are the flattened nodes, so the two always agree', () => {
    const nodes = [quarter(20), nodesFromPaths([square(4)])[0] as NodePath];
    const kind = kindWithNodes({ type: 'vector', paths: [] }, nodes);
    expect(kind.type).toBe('vector');
    expect(kind.paths).toEqual(flattenNodes(nodes));
    expect(nodesMatchPaths(kind.nodes ?? [], kind.paths)).toBe(true);
    expect('source' in kind).toBe(false);
  });
  it('refuses text and shapes, which would no longer match their recipe', () => {
    expect(() => kindWithNodes({ type: 'vector', paths: [square(10)], source: recipe }, nodesFromPaths([square(10)]))).toThrow(/recipe/);
  });
  it('turns a shape into an ordinary outline with the same points', () => {
    const k = convertToOutlines({ type: 'vector', paths: [square(10)], source: recipe });
    expect('source' in k).toBe(false);
    expect(k.paths).toEqual([square(10)]);
    expect(k.nodes).toEqual(nodesFromPaths([square(10)]));
  });
  it('keeps the nodes an object already has, and adds them to one that has none', () => {
    const own = [quarter(20)];
    const withNodes = convertToOutlines({ type: 'vector', paths: flattenNodes(own), nodes: own });
    expect(withNodes.nodes).toEqual(own);
    expect(convertToOutlines({ type: 'vector', paths: [square(5)] }).nodes).toEqual(nodesFromPaths([square(5)]));
  });
  it('does not change what it is given', () => {
    convertToOutlines(freeze({ type: 'vector', paths: [square(10)], source: recipe }));
    kindWithNodes(freeze({ type: 'vector', paths: [] }), freeze(nodesFromPaths([square(3)])));
  });
});

// ---- finding ---------------------------------------------------------------------------------------

describe('finding nodes and segments', () => {
  const nodes = nodesFromPaths([square(10), square(4, 20, 20)]);
  it('finds the nearest node within the tolerance, and nothing beyond it', () => {
    expect(nodeAt(nodes, 10.2, 0.1, 0.5)).toEqual({ path: 0, node: 1 });
    expect(nodeAt(nodes, 22, 22, 0.5)).toBeNull();
    expect(nodeAt(nodes, 20.1, 24.1, 0.5)).toEqual({ path: 1, node: 3 });
    expect(nodeAt([], 0, 0, 5)).toBeNull();
  });
  it('picks the nearer of two nodes that are both within reach, whichever comes first', () => {
    const two = nodesFromPaths([{ closed: false, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }]);
    expect(nodeAt(two, 0.7, 0, 5)).toEqual({ path: 0, node: 1 });
    expect(nodeAt(two, 0.3, 0, 5)).toEqual({ path: 0, node: 0 });
  });
  it('finds the nodes in a box, edges included', () => {
    expect(nodesInBox(nodes, { minX: -1, maxX: 10, minY: -1, maxY: 1 })).toEqual([{ path: 0, node: 0 }, { path: 0, node: 1 }]);
    expect(nodesInBox(nodes, { minX: 100, maxX: 200, minY: 0, maxY: 1 })).toEqual([]);
    // a box that fits the square exactly has all four corners in it
    expect(nodesInBox(nodes, { minX: 0, maxX: 10, minY: 0, maxY: 10 })).toHaveLength(4);
  });
  it('finds the nearest straight segment, with how far along it and how far from it', () => {
    const hit = nearestSegment(nodes, 5, 0.3, 1);
    expect(hit?.path).toBe(0);
    expect(hit?.segment).toBe(0);
    expect(hit?.t).toBeCloseTo(0.5, 6);
    expect(hit?.distance).toBeCloseTo(0.3, 6);
    expect(hit?.point).toEqual({ x: 5, y: 0 });
    expect(nearestSegment(nodes, 5, 5, 1)).toBeNull();
  });
  it('knows the closing segment of a closed outline', () => {
    expect(nearestSegment(nodes, 0.2, 5, 1)?.segment).toBe(3);
  });
  it('finds the nearest point on a curve, and the parameter that goes with it', () => {
    const q = [quarter(20)];
    // The point on the circle at 45 degrees is on the curve (to within 0.006 mm).
    const on = { x: 20 * Math.cos(Math.PI / 4), y: 20 * Math.sin(Math.PI / 4) };
    const hit = nearestSegment(q, on.x + 0.3, on.y + 0.3, 2);
    expect(hit).not.toBeNull();
    expect(hit?.t).toBeCloseTo(0.5, 2);
    expect(Math.hypot((hit?.point.x ?? 0) - on.x, (hit?.point.y ?? 0) - on.y)).toBeLessThan(0.01);
    expect(nearestSegment(q, 0, 0, 5)).toBeNull();
  });
});

// ---- moving ----------------------------------------------------------------------------------------

describe('moveNodes', () => {
  const base: NodePath[] = [
    { closed: true, nodes: [{ x: 0, y: 0, out: { x: 2, y: 0 } }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
    { closed: false, nodes: [{ x: 50, y: 50 }, { x: 60, y: 50 }] },
  ];
  it('moves only the chosen nodes, and their handles go with them', () => {
    const out = moveNodes(freeze(base), [{ path: 0, node: 0 }, { path: 1, node: 1 }], 3, -2);
    expect(out[0]?.nodes[0]).toEqual({ x: 3, y: -2, out: { x: 2, y: 0 } });
    expect(out[0]?.nodes[1]).toEqual({ x: 10, y: 0 });
    expect(out[1]?.nodes[0]).toEqual({ x: 50, y: 50 });
    expect(out[1]?.nodes[1]).toEqual({ x: 63, y: 48 });
  });
  it('keeps everything it did not move, the same objects', () => {
    const out = moveNodes(base, [{ path: 0, node: 1 }], 1, 1);
    expect(out[1]).toBe(base[1]);
    expect(out[0]?.nodes[0]).toBe(base[0]?.nodes[0]);
    expect(out[0]).not.toBe(base[0]);
  });
  it('gives the same list back when there is nothing to do', () => {
    expect(moveNodes(base, [], 1, 1)).toBe(base);
    expect(moveNodes(base, [{ path: 0, node: 0 }], 0, 0)).toBe(base);
    expect(moveNodes(base, [{ path: 0, node: 0 }], NaN, 1)).toBe(base);
    expect(moveNodes(base, [{ path: 0, node: 0 }], 1, Infinity)).toBe(base);
  });
  it('ignores a node that is not there', () => {
    const out = moveNodes(base, [{ path: 5, node: 0 }, { path: 0, node: 9 }], 1, 1);
    expect(out).toEqual(base);
  });
  it('rounds to a thousandth of a millimetre', () => {
    const out = moveNodes(base, [{ path: 0, node: 1 }], 0.1 + 0.2, 0);
    expect(out[0]?.nodes[1]?.x).toBe(10.3);
  });
  it('puts a node at an exact position', () => {
    const out = setNodePosition(base, { path: 0, node: 2 }, 12.5, 7.25);
    expect(out[0]?.nodes[2]).toEqual({ x: 12.5, y: 7.25 });
    expect(setNodePosition(base, { path: 0, node: 2 }, NaN, 1)).toBe(base);
    expect(setNodePosition(base, { path: 3, node: 0 }, 1, 1)).toBe(base);
    expect(setNodePosition(base, { path: 0, node: 2 }, 10, 10)).toBe(base);
  });
  it('changes the outlines, and moves a curve with its handles', () => {
    const q = [quarter(20)];
    const moved = moveNodes(q, [{ path: 0, node: 0 }, { path: 0, node: 1 }], 5, 5);
    const a = flattenNodes(q)[0]?.points ?? [];
    const b = flattenNodes(moved)[0]?.points ?? [];
    expect(b).toHaveLength(a.length);
    a.forEach((p, i) => {
      expect(b[i]?.x).toBeCloseTo(p.x + 5, 3);
      expect(b[i]?.y).toBeCloseTo(p.y + 5, 3);
    });
  });
});

// ---- deleting --------------------------------------------------------------------------------------

describe('deleteNodes', () => {
  const closed = (n: number): NodePath => ({ closed: true, nodes: Array.from({ length: n }, (_, i) => ({ x: i, y: i * i })) });
  it('takes the chosen nodes out', () => {
    const r = deleteNodes(freeze([closed(5)]), [{ path: 0, node: 1 }, { path: 0, node: 3 }]);
    expect(r.removed).toBe(2);
    expect(r.nodes[0]?.nodes.map((n) => n.x)).toEqual([0, 2, 4]);
    expect(r.nodes[0]?.closed).toBe(true);
    expect(r.opened).toBe(0);
    expect(r.gone).toBe(0);
  });
  it('turns a closed outline left with two nodes into an open line', () => {
    const r = deleteNodes([closed(3)], [{ path: 0, node: 2 }]);
    expect(r.nodes[0]).toEqual({ closed: false, nodes: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
    expect(r.opened).toBe(1);
  });
  it('removes an outline left with fewer than two nodes', () => {
    const r = deleteNodes([closed(3), closed(4)], [{ path: 0, node: 0 }, { path: 0, node: 1 }]);
    expect(r.nodes).toHaveLength(1);
    expect(r.nodes[0]?.nodes).toHaveLength(4);
    expect(r.gone).toBe(1);
    const open: NodePath = { closed: false, nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
    expect(deleteNodes([open], [{ path: 0, node: 0 }]).nodes).toEqual([]);
  });
  it('keeps an open line of two or more nodes open', () => {
    const open: NodePath = { closed: false, nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] };
    expect(deleteNodes([open], [{ path: 0, node: 1 }]).nodes[0]).toEqual({ closed: false, nodes: [{ x: 0, y: 0 }, { x: 2, y: 0 }] });
  });
  it('leaves other outlines as the same objects', () => {
    const list = [closed(4), closed(5)];
    const r = deleteNodes(list, [{ path: 1, node: 0 }]);
    expect(r.nodes[0]).toBe(list[0]);
    expect(r.nodes[1]).not.toBe(list[1]);
  });
  it('does nothing for no choice, a node that is not there, or the same node twice', () => {
    const list = [closed(4)];
    expect(deleteNodes(list, []).nodes).toEqual(list);
    expect(deleteNodes(list, []).removed).toBe(0);
    expect(deleteNodes(list, [{ path: 9, node: 0 }, { path: 0, node: 9 }]).removed).toBe(0);
    expect(deleteNodes(list, [{ path: 0, node: 1 }, { path: 0, node: 1 }]).removed).toBe(1);
  });
});

// ---- inserting -------------------------------------------------------------------------------------

describe('insertNode', () => {
  it('puts a corner on a straight segment, at the right place and the right position in the list', () => {
    const nodes = nodesFromPaths([square(10)]);
    const r = insertNode(freeze(nodes), { path: 0, segment: 1 }, 0.25);
    expect(r?.ref).toEqual({ path: 0, node: 2 });
    expect(r?.nodes[0]?.nodes.map((n) => [n.x, n.y])).toEqual([[0, 0], [10, 0], [10, 2.5], [10, 10], [0, 10]]);
    expect(r?.nodes[0]?.nodes[2]).toEqual({ x: 10, y: 2.5 });
  });
  it('can split the closing segment, which puts the new node last', () => {
    const r = insertNode(nodesFromPaths([square(10)]), { path: 0, segment: 3 }, 0.5);
    expect(r?.ref).toEqual({ path: 0, node: 4 });
    expect(r?.nodes[0]?.nodes[4]).toEqual({ x: 0, y: 5 });
    expect(r?.nodes[0]?.nodes).toHaveLength(5);
  });
  it('does not change the outline of a straight segment', () => {
    const before = [square(10)];
    const r = insertNode(nodesFromPaths(before), { path: 0, segment: 0 }, 0.3);
    const after = flattenNodes(r?.nodes ?? []);
    expect(hausdorff(after[0]?.points ?? [], [...before[0]!.points, before[0]!.points[0]!])).toBeLessThan(1e-9);
  });
  it('splits a curve exactly, so its shape does not change, and the new node is smooth', () => {
    for (const t of [0.1, 0.5, 0.77]) {
      const q = [quarter(30)];
      const r = insertNode(freeze(q), { path: 0, segment: 0 }, t);
      expect(r).not.toBeNull();
      const np = r?.nodes[0] as NodePath;
      expect(np.nodes).toHaveLength(3);
      expect(np.nodes[1]?.mode).toBe('smooth');
      const before = flattenNodePath(q[0] as NodePath, 0.001).points;
      const after = flattenNodePath(np, 0.001).points;
      // within a few thousandths of a millimetre, which is the 3 decimals the handles are kept to
      expect(hausdorff(before, after)).toBeLessThan(0.01);
      // the new node lies on the old curve, and its two handles are in line
      const split = np.nodes[1] as NodePath['nodes'][number];
      expect(distanceToPolyline(split, before)).toBeLessThan(0.005);
      const cross = (split.in?.x ?? 0) * (split.out?.y ?? 0) - (split.in?.y ?? 0) * (split.out?.x ?? 0);
      expect(Math.abs(cross)).toBeLessThan(0.05);
    }
  });
  it('splits a curve in a closed outline, including the closing segment', () => {
    const np: NodePath = { closed: true, nodes: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20, out: { x: -10, y: 15 } }] };
    const r = insertNode([np], { path: 0, segment: 2 }, 0.4);
    expect(r?.ref).toEqual({ path: 0, node: 3 });
    const before = flattenNodePath(np, 0.001).points;
    const after = flattenNodePath(r?.nodes[0] as NodePath, 0.001).points;
    expect(hausdorff([...before, before[0] as Point2], [...after, after[0] as Point2])).toBeLessThan(0.01);
  });
  it('refuses the ends of a segment, a segment that is not there and a t that is not a number', () => {
    const nodes = nodesFromPaths([square(10)]);
    expect(insertNode(nodes, { path: 0, segment: 0 }, 0)).toBeNull();
    expect(insertNode(nodes, { path: 0, segment: 0 }, 1)).toBeNull();
    expect(insertNode(nodes, { path: 0, segment: 4 }, 0.5)).toBeNull();
    expect(insertNode(nodes, { path: 2, segment: 0 }, 0.5)).toBeNull();
    expect(insertNode(nodes, { path: 0, segment: -1 }, 0.5)).toBeNull();
    expect(insertNode(nodes, { path: 0, segment: 0 }, NaN)).toBeNull();
    const open = nodesFromPaths([{ closed: false, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }]);
    expect(insertNode(open, { path: 0, segment: 1 }, 0.5)).toBeNull();
  });
});

// ---- whole sequences of edits -------------------------------------------------------------------------

/** A small deterministic random number generator, so a failure can be repeated. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('long runs of edits', () => {
  it('never break the rules, never change their input, and keep the outlines in step with the nodes', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rand = rng(seed);
      let nodes: NodePath[] = [
        ...nodesFromPaths([square(20), { closed: false, points: [{ x: 40, y: 0 }, { x: 50, y: 10 }, { x: 60, y: 0 }] }]),
        quarter(15),
        { closed: true, nodes: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20, out: { x: -8, y: 10 } }] },
      ];
      for (let step = 0; step < 25; step++) {
        const total = nodeCount(nodes);
        const pick = () => {
          const path = Math.floor(rand() * nodes.length);
          const count = nodes[path]?.nodes.length ?? 0;
          return { path, node: Math.floor(rand() * Math.max(count, 1)) };
        };
        const frozen = freeze(JSON.parse(JSON.stringify(nodes)) as NodePath[]);
        const choice = rand();
        if (choice < 0.4 || total < 6) {
          const refs = [pick(), pick()];
          nodes = [...moveNodes(frozen, refs, (rand() - 0.5) * 20, (rand() - 0.5) * 20)];
        } else if (choice < 0.7) {
          const path = Math.floor(rand() * nodes.length);
          const segs = segmentCount(frozen[path] as NodePath);
          if (segs > 0) {
            const r = insertNode(frozen, { path, segment: Math.floor(rand() * segs) }, 0.1 + rand() * 0.8);
            if (r) nodes = r.nodes;
          }
        } else {
          nodes = deleteNodes(frozen, [pick()]).nodes;
        }
        // the rules
        for (const np of nodes) {
          expect(np.nodes.length).toBeGreaterThanOrEqual(2);
          if (np.closed) expect(np.nodes.length).toBeGreaterThanOrEqual(3);
          for (const n of np.nodes) {
            expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
            for (const h of [n.in, n.out]) if (h) expect(Number.isFinite(h.x) && Number.isFinite(h.y)).toBe(true);
          }
        }
        // the outlines are the flattened nodes
        const kind = kindWithNodes({ type: 'vector', paths: [] }, nodes);
        expect(kind.paths).toHaveLength(nodes.length);
        expect(nodesMatchPaths(kind.nodes ?? [], kind.paths)).toBe(true);
        // and nodeAccess takes them back as they are
        const access = nodeAccess(kind);
        expect(access.ok && !access.fromPaths && !access.stale).toBe(true);
      }
    }
  });
});

describe('references', () => {
  it('have a key that is the same for the same node', () => {
    expect(refKey({ path: 2, node: 7 })).toBe('2:7');
    expect(refKey({ path: 0, node: 0 })).not.toBe(refKey({ path: 0, node: 1 }));
  });
});

// ---- what the Rust side reads -----------------------------------------------------------------------

describe('the file format', () => {
  // The same text is in packages/common/src/objects.rs (the test golden_nodes_json_...): both sides must accept it.
  const GOLDEN =
    '{"type":"vector","paths":[{"closed":true,"points":[{"x":0,"y":10},{"x":10,"y":0},{"x":10,"y":10}]}],' +
    '"nodes":[{"closed":true,"nodes":[{"x":0,"y":10,"out":{"x":0,"y":-5.5}},{"x":10,"y":0,"in":{"x":-5.5,"y":0},"mode":"smooth"},{"x":10,"y":10}]}]}';
  it('reads the sample the Rust test reads', () => {
    const kind = JSON.parse(GOLDEN) as VectorObjectData;
    const nodes = sanitizeNodes(kind.nodes);
    expect(nodes).not.toBeNull();
    expect(nodes?.[0]?.closed).toBe(true);
    expect(nodes?.[0]?.nodes[0]?.out).toEqual({ x: 0, y: -5.5 });
    expect(nodes?.[0]?.nodes[1]?.in).toEqual({ x: -5.5, y: 0 });
    expect(nodes?.[0]?.nodes[1]?.mode).toBe('smooth');
    expect(nodes?.[0]?.nodes[2]).toEqual({ x: 10, y: 10 });
    // the sample's outlines are the three nodes only, so it is not the flattened curve: a file written that way is stale
    const access = nodeAccess(kind);
    expect(access.ok && access.stale).toBe(true);
  });
  it('writes handles under the names in, out and mode, and nothing for a corner', () => {
    const kind = kindWithNodes({ type: 'vector', paths: [] }, JSON.parse(GOLDEN).nodes as NodePath[]);
    const written = JSON.parse(JSON.stringify(kind)) as { nodes: Array<{ nodes: Array<Record<string, unknown>> }> };
    expect(Object.keys(written.nodes[0]?.nodes[0] ?? {}).sort()).toEqual(['out', 'x', 'y']);
    expect(Object.keys(written.nodes[0]?.nodes[1] ?? {}).sort()).toEqual(['in', 'mode', 'x', 'y']);
    expect(Object.keys(written.nodes[0]?.nodes[2] ?? {}).sort()).toEqual(['x', 'y']);
  });
});
