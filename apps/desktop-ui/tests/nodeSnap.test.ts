import { describe, expect, it } from 'vitest';
import { moveGesture, pressAt, toWorldNodes, type NodeGesture } from '@/lib/nodeEdit';
import { nodesFromPaths, type NodeRef } from '@/lib/nodePath';
import {
  MAX_TARGETS,
  MAX_TARGETS_PER_OBJECT,
  SNAP_CORNER_DEG,
  SNAP_PX,
  buildSnapContext,
  buildSnapIndex,
  cornerPoints,
  dragWithSnap,
  nearestTarget,
  objectSnapPoints,
  snapDelta,
  type SnapObject,
} from '@/lib/nodeSnap';
import { compose } from '@/lib/transform';
import type { NodePath, ObjectKind, Path2D, Point2, Transform2D } from '@/types/domain';

const IDENTITY: Transform2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const at = (path: number, node: number): NodeRef => ({ path, node });
const square = (s = 10, x = 0, y = 0): Path2D => ({ closed: true, points: [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }] });
const circle = (r: number, n: number, cx = 0, cy = 0): Path2D => ({
  closed: true,
  points: Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / n), y: cy + r * Math.sin((2 * Math.PI * i) / n) })),
});
const vec = (paths: Path2D[], extra: Record<string, unknown> = {}): ObjectKind => ({ type: 'vector', paths, ...extra }) as ObjectKind;
const obj = (id: string, kind: ObjectKind, over: Partial<SnapObject> = {}): SnapObject => ({ id, visible: true, kind, transform: IDENTITY, ...over });
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v as object)) freeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}
const same = (a: Point2[], b: Point2[]) => expect([...a].sort((p, q) => p.x - q.x || p.y - q.y)).toEqual([...b].sort((p, q) => p.x - q.x || p.y - q.y));
const near = (a: Point2 | null, b: Point2, eps = 1e-9) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a?.x ?? NaN) - b.x)).toBeLessThan(eps);
  expect(Math.abs((a?.y ?? NaN) - b.y)).toBeLessThan(eps);
};

describe('the settings', () => {
  it('have a sensible reach in pixels and a corner angle that is neither tiny nor a right angle', () => {
    expect(SNAP_PX).toBeGreaterThan(4);
    expect(SNAP_PX).toBeLessThan(25);
    expect(SNAP_CORNER_DEG).toBeGreaterThan(10);
    expect(SNAP_CORNER_DEG).toBeLessThan(80);
    expect(MAX_TARGETS_PER_OBJECT).toBeLessThanOrEqual(MAX_TARGETS);
  });
});

describe('cornerPoints', () => {
  it('a square has its four corners', () => {
    same(cornerPoints([square(10)]), square(10).points);
  });
  it('a circle of many points has none: its turns are tiny', () => {
    expect(cornerPoints([circle(20, 400)])).toEqual([]);
    expect(cornerPoints([circle(50, 90)])).toEqual([]);
  });
  it('a polygon with sharp turns has them all, and one with gentle turns has none', () => {
    expect(cornerPoints([circle(10, 6)])).toHaveLength(6);
    // each turn of a 16-sided polygon is 22.5 degrees, which is under the 30 that makes a corner; a 12-sided one turns exactly 30
    expect(cornerPoints([circle(10, 16)])).toHaveLength(0);
    expect(cornerPoints([circle(10, 16)], 20)).toHaveLength(16);
    expect(cornerPoints([circle(10, 12)], 25)).toHaveLength(12);
  });
  it('an open line gives its two ends and any bend, never the points in a straight stretch', () => {
    const line: Path2D = { closed: false, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] };
    same(cornerPoints([line]), [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  });
  it('the ends of an open line are included even when joining them up would make no turn at all', () => {
    // seen as a closed loop the first point here would run straight on from the last, so only the rule for ends can find it
    const c: Path2D = { closed: false, points: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }] };
    same(cornerPoints([c]), [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }]);
    expect(cornerPoints([c])).toContainEqual({ x: 10, y: 0 });
  });
  it('a straight-through point of a closed outline is not a corner, and a turn of 30 degrees or more is', () => {
    const flat: Path2D = { closed: true, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] };
    expect(cornerPoints([flat])).not.toContainEqual({ x: 5, y: 0 });
    expect(cornerPoints([flat])).toHaveLength(4);
    const gentle: Path2D = { closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 3 }, { x: 30, y: 3 }] };
    expect(cornerPoints([gentle])).toHaveLength(2);
    const sharp: Path2D = { closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 7 }, { x: 30, y: 7 }] };
    expect(cornerPoints([sharp]).length).toBeGreaterThan(2);
  });
  it('repeated points, and a closing point that repeats the first, are not counted twice', () => {
    const messy: Path2D = { closed: true, points: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }] };
    expect(cornerPoints([messy])).toHaveLength(4);
  });
  it('a path of one point is that point, and of nothing is nothing', () => {
    expect(cornerPoints([{ closed: false, points: [{ x: 3, y: 4 }] }])).toEqual([{ x: 3, y: 4 }]);
    expect(cornerPoints([{ closed: true, points: [] }])).toEqual([]);
    expect(cornerPoints([])).toEqual([]);
  });
  it('a line that turns straight back on itself has a corner there', () => {
    const back: Path2D = { closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0.001 }] };
    expect(cornerPoints([back])).toContainEqual({ x: 10, y: 0 });
  });
  it('does not change what it is given', () => {
    cornerPoints(freeze([square(10), circle(5, 30)]));
  });
});

describe('objectSnapPoints', () => {
  it('uses the corners of an outline that has no nodes, moved to where the object is', () => {
    const t = compose({ x: 100, y: 50, rotationDeg: 90, scaleX: 2, scaleY: 2 });
    const pts = objectSnapPoints(vec([square(10)]), t);
    expect(pts).toHaveLength(4);
    near(pts[1] as Point2, { x: 100, y: 70 }, 1e-9);
  });
  it('uses the nodes of an outline that has them, and not the points between', () => {
    const nodes: NodePath[] = [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 20, y: 0, out: { x: 5, y: 5 } }, { x: 20, y: 20 }] }];
    const kind = vec([circle(20, 300)], { nodes });
    expect(objectSnapPoints(kind, IDENTITY)).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }]);
  });
  it('falls back to corners when the nodes do not belong to the outlines (a different count)', () => {
    const nodes: NodePath[] = [{ closed: true, nodes: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }] }];
    expect(objectSnapPoints(vec([square(10), square(5)], { nodes }), IDENTITY)).toHaveLength(8);
  });
  it('falls back to corners when the nodes are broken', () => {
    const broken = [{ closed: true, nodes: [{ x: Number.NaN, y: 0 }] }] as unknown as NodePath[];
    expect(objectSnapPoints(vec([square(10)], { nodes: broken }), IDENTITY)).toHaveLength(4);
  });
  it('text and shapes give their corners, an ellipse gives none, and a picture gives none', () => {
    const shape = { type: 'shape', shape: 'rectangle', width_mm: 10, height_mm: 10, corner_radius_mm: 0, sides: 5, inner_ratio: 0.5 };
    expect(objectSnapPoints(vec([square(10)], { source: shape }), IDENTITY)).toHaveLength(4);
    expect(objectSnapPoints(vec([circle(15, 200)], { source: { ...shape, shape: 'ellipse' } }), IDENTITY)).toEqual([]);
    const picture: ObjectKind = { type: 'image', asset_id: 'a', format: 'png', source_path: null, width_px: 1, height_px: 1, dpi: 96 };
    expect(objectSnapPoints(picture, IDENTITY)).toEqual([]);
  });
});

describe('the index', () => {
  const pts: Point2[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10.4, y: 0.3 }, { x: -50, y: 80 }, { x: 1000, y: -1000 }];
  const index = buildSnapIndex(pts, 1);
  it('finds the nearest point within reach, and nothing beyond it', () => {
    near(nearestTarget(index, { x: 0.3, y: 0.2 }, 1)?.point ?? null, { x: 0, y: 0 });
    expect(nearestTarget(index, { x: 5, y: 5 }, 1)).toBeNull();
    near(nearestTarget(index, { x: -50.5, y: 80 }, 1)?.point ?? null, { x: -50, y: 80 });
    near(nearestTarget(index, { x: 1000.2, y: -999.9 }, 1)?.point ?? null, { x: 1000, y: -1000 });
  });
  it('picks the nearer of two that are both within reach, and the first of two equally near', () => {
    near(nearestTarget(index, { x: 10.3, y: 0.2 }, 2)?.point ?? null, { x: 10.4, y: 0.3 });
    near(nearestTarget(index, { x: 10.1, y: 0 }, 2)?.point ?? null, { x: 10, y: 0 });
    const twins = buildSnapIndex([{ x: -1, y: 0 }, { x: 1, y: 0 }], 1);
    near(nearestTarget(twins, { x: 0, y: 0 }, 2)?.point ?? null, { x: -1, y: 0 });
  });
  it('reaches further than one cell when the reach is bigger than the cell', () => {
    const fine = buildSnapIndex([{ x: 5, y: 5 }], 0.5);
    near(nearestTarget(fine, { x: 7.8, y: 5 }, 3)?.point ?? null, { x: 5, y: 5 });
    expect(nearestTarget(fine, { x: 8.5, y: 5 }, 3)).toBeNull();
  });
  it('agrees with a plain search over every point, at any distance', () => {
    let s = 7;
    const rand = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const cloud = Array.from({ length: 400 }, () => ({ x: (rand() - 0.5) * 200, y: (rand() - 0.5) * 200 }));
    const idx = buildSnapIndex(cloud, 2);
    for (let i = 0; i < 300; i++) {
      const p = { x: (rand() - 0.5) * 200, y: (rand() - 0.5) * 200 };
      const tol = 0.5 + rand() * 9;
      let best: Point2 | null = null;
      let bestD = Infinity;
      for (const c of cloud) {
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d <= tol && d < bestD) {
          bestD = d;
          best = c;
        }
      }
      const got = nearestTarget(idx, p, tol);
      if (best === null) expect(got).toBeNull();
      else near(got?.point ?? null, best);
    }
  });
  it('leaves out points that are not numbers, and finds nothing for a position or reach that is not a number', () => {
    const odd = buildSnapIndex([{ x: Number.NaN, y: 0 }, { x: 1, y: 1 }, { x: Number.POSITIVE_INFINITY, y: 2 }], 1);
    expect(odd.points).toEqual([{ x: 1, y: 1 }]);
    expect(nearestTarget(index, { x: Number.NaN, y: 0 }, 1)).toBeNull();
    expect(nearestTarget(index, { x: 0, y: 0 }, Number.NaN)).toBeNull();
    expect(nearestTarget(index, { x: 0, y: 0 }, 0)).toBeNull();
    expect(nearestTarget(index, { x: 0, y: 0 }, -1)).toBeNull();
    expect(nearestTarget(buildSnapIndex([], 1), { x: 0, y: 0 }, 5)).toBeNull();
  });
  it('a cell size that is nothing or less is made usable', () => {
    expect(nearestTarget(buildSnapIndex([{ x: 1, y: 1 }], 0), { x: 1, y: 1 }, 0.5)?.distance).toBe(0);
    expect(nearestTarget(buildSnapIndex([{ x: 1, y: 1 }], -3), { x: 1, y: 1 }, 0.5)?.distance).toBe(0);
  });
});

describe('buildSnapContext', () => {
  const edited = nodesFromPaths([square(10)]);
  it('the dragged nodes are where it starts from and never a target; every other node of the outline is a target', () => {
    const ctx = buildSnapContext([], 'a', toWorldNodes(freeze(edited), IDENTITY), [at(0, 2)], 1);
    expect(ctx.starts).toEqual([{ x: 10, y: 10 }]);
    expect(ctx.index.points).toHaveLength(3);
    expect(ctx.index.points).not.toContainEqual({ x: 10, y: 10 });
  });
  it('adds the corners of other visible objects, but not the object being edited, hidden ones or pictures', () => {
    const others = [
      obj('a', vec([square(10, 500, 500)])),
      obj('b', vec([square(10, 100, 0)])),
      obj('hidden', vec([square(10, 200, 0)]), { visible: false }),
      obj('pic', { type: 'image', asset_id: 'x', format: 'png', source_path: null, width_px: 1, height_px: 1, dpi: 96 }),
    ];
    const ctx = buildSnapContext(others, 'a', toWorldNodes(edited, IDENTITY), [at(0, 0)], 1);
    expect(ctx.index.points).toHaveLength(3 + 4);
    expect(ctx.index.points.some((p) => p.x >= 500)).toBe(false);
    expect(ctx.index.points.some((p) => p.x >= 200 && p.x < 300)).toBe(false);
    expect(ctx.index.points.some((p) => p.x === 100)).toBe(true);
  });
  it('several dragged nodes are all starts, and none is a target', () => {
    const ctx = buildSnapContext([], 'a', toWorldNodes(edited, IDENTITY), [at(0, 0), at(0, 1)], 1);
    expect(ctx.starts).toHaveLength(2);
    expect(ctx.index.points).toHaveLength(2);
  });
  it('the nodes of other objects are in world millimetres, wherever and however the object is', () => {
    const t = compose({ x: 40, y: 40, rotationDeg: 45, scaleX: 1, scaleY: 1 });
    const ctx = buildSnapContext([obj('b', vec([square(10)]), { transform: t })], 'a', [], [], 1);
    expect(ctx.index.points).toHaveLength(4);
    near(ctx.index.points[1] as Point2, { x: 40 + 10 * Math.cos(Math.PI / 4), y: 40 + 10 * Math.sin(Math.PI / 4) }, 1e-9);
  });
  it('an object with too many corners is left out and the rest are kept', () => {
    const stairs: Path2D = { closed: true, points: [] };
    for (let i = 0; i < MAX_TARGETS_PER_OBJECT / 2 + 5; i++) stairs.points.push({ x: i * 2, y: 0 }, { x: i * 2 + 1, y: 1 }, { x: i * 2 + 2, y: 0 }, { x: i * 2 + 1, y: -1 });
    const ctx = buildSnapContext([obj('big', vec([stairs])), obj('b', vec([square(10, 100, 100)]))], 'a', [], [], 1);
    expect(ctx.index.points).toHaveLength(4);
  });
  it('does not change what it is given', () => {
    buildSnapContext(freeze([obj('b', vec([square(10)]))]), 'a', freeze(toWorldNodes(edited, IDENTITY)), freeze([at(0, 1)]), 1);
  });
});

describe('snapDelta', () => {
  const edited = nodesFromPaths([square(10)]);
  const world = toWorldNodes(edited, IDENTITY);
  const other = [obj('b', vec([square(10, 30, 0)]))];
  const ctx = buildSnapContext(other, 'a', world, [at(0, 1)], 1); // the top right corner (10, 0) is dragged
  it('the step is the same when nothing is near', () => {
    expect(snapDelta(ctx, { x: 5, y: 7 }, 1)).toEqual({ delta: { x: 5, y: 7 }, target: null });
  });
  it('lands the dragged node exactly on a corner that is within reach, changing the step to match', () => {
    const r = snapDelta(ctx, { x: 19.6, y: 0.4 }, 1);
    expect(r.target).toEqual({ x: 30, y: 0 });
    expect(r.delta).toEqual({ x: 20, y: 0 });
  });
  it('does not snap to something just out of reach', () => {
    expect(snapDelta(ctx, { x: 18.5, y: 0 }, 1).target).toBeNull();
    expect(snapDelta(ctx, { x: 18.5, y: 0 }, 2).target).toEqual({ x: 30, y: 0 });
  });
  it('snaps to a node of its own outline: a corner can be pulled onto its neighbour', () => {
    const r = snapDelta(ctx, { x: -9.7, y: 0.2 }, 1);
    expect(r.target).toEqual({ x: 0, y: 0 });
    expect(r.delta).toEqual({ x: -10, y: 0 });
  });
  it('a group moves as one: the node nearest a target lands on it and the others keep their distance', () => {
    const lone = [obj('b', vec([{ closed: false, points: [{ x: 30, y: 0 }, { x: 60, y: 0 }] }]))];
    const both = buildSnapContext(lone, 'a', world, [at(0, 1), at(0, 2)], 1);
    // the corner (10, 0) is within reach of the end of the line at (30, 0); the other dragged corner, (10, 10), is nowhere near anything
    const r = snapDelta(both, { x: 19.7, y: 0.2 }, 1);
    expect(r.target).toEqual({ x: 30, y: 0 });
    expect(r.delta).toEqual({ x: 20, y: 0 });
    // so the other corner goes the same 20 mm, to (30, 10)
  });
  it('of two dragged nodes that are each near a target, the nearer pair wins', () => {
    const t = [obj('b', vec([{ closed: false, points: [{ x: 30.6, y: 0 }, { x: 30.2, y: 10 }] }]))];
    const c2 = buildSnapContext(t, 'a', world, [at(0, 1), at(0, 2)], 1);
    // asked for a step of (20, 0): (10, 0) would land 0.6 from (30.6, 0) and (10, 10) would land 0.2 from (30.2, 10): the nearer wins
    const r = snapDelta(c2, { x: 20, y: 0 }, 2);
    expect(r.target).toEqual({ x: 30.2, y: 10 });
    expect(r.delta).toEqual({ x: 20.2, y: 0 });
  });
  it('a drag with nothing dragged, or no targets, is left alone', () => {
    expect(snapDelta({ starts: [], index: buildSnapIndex([{ x: 1, y: 1 }], 1) }, { x: 1, y: 1 }, 5).target).toBeNull();
    expect(snapDelta({ starts: [{ x: 0, y: 0 }], index: buildSnapIndex([], 1) }, { x: 1, y: 1 }, 5).target).toBeNull();
  });
  it('is the same at any zoom: the reach is in millimetres, so a smaller reach (zoomed in) snaps to less', () => {
    expect(snapDelta(ctx, { x: 19.2, y: 0 }, 1).target).not.toBeNull();
    expect(snapDelta(ctx, { x: 19.2, y: 0 }, 0.25).target).toBeNull();
  });
});

describe('dragWithSnap', () => {
  const edited = nodesFromPaths([square(10)]);
  const world = toWorldNodes(edited, IDENTITY);
  const ctx = buildSnapContext([obj('b', vec([square(10, 30, 0)]))], 'a', world, [at(0, 1)], 1);
  const press = (): NodeGesture => pressAt(world, [], { x: 10, y: 0 }, 1, false).gesture as NodeGesture;
  const moved = (p: Point2): NodeGesture => moveGesture(press(), p, 0.5);
  it('gives the pointer back as it was when nothing is near', () => {
    expect(dragWithSnap(moved({ x: 15, y: 6 }), { x: 15, y: 6 }, ctx, true, 1)).toEqual({ point: { x: 15, y: 6 }, target: null });
  });
  it('gives the point that makes the node land on the target, from where the press was, and says what it landed on', () => {
    const r = dragWithSnap(moved({ x: 29.7, y: 0.4 }), { x: 29.7, y: 0.4 }, ctx, true, 1);
    expect(r.target).toEqual({ x: 30, y: 0 });
    expect(r.point).toEqual({ x: 30, y: 0 });
  });
  it('works from the start of the press, not from where the node is, so a drag can begin a little off the node', () => {
    const g = pressAt(world, [], { x: 10.4, y: 0.3 }, 1, false).gesture as NodeGesture;
    const gm = moveGesture(g, { x: 30.4, y: 0.4 }, 0.5);
    const r = dragWithSnap(gm, { x: 30.4, y: 0.4 }, ctx, true, 1);
    expect(r.target).toEqual({ x: 30, y: 0 });
    expect(r.point.x).toBeCloseTo(30.4, 9);
    expect(r.point.y).toBeCloseTo(0.3, 9);
  });
  it('a press that has not gone far enough to count is not snapped, even right next to a target', () => {
    const next = buildSnapContext([obj('b', vec([{ closed: false, points: [{ x: 10.5, y: 0 }, { x: 40, y: 40 }] }]))], 'a', world, [at(0, 1)], 1);
    const g = press();
    expect(g.kind === 'drag' && g.moved).toBe(false);
    expect(dragWithSnap(g, { x: 10.1, y: 0 }, next, true, 1)).toEqual({ point: { x: 10.1, y: 0 }, target: null });
    expect(dragWithSnap(moveGesture(g, { x: 10.2, y: 0 }, 0.5), { x: 10.2, y: 0 }, next, true, 1).target).toBeNull();
    expect(dragWithSnap(moveGesture(g, { x: 11, y: 0 }, 0.5), { x: 11, y: 0 }, next, true, 1).target).toEqual({ x: 10.5, y: 0 });
  });
  it('does nothing when snapping is off, there is no context, or the drag has not gone far enough to count', () => {
    const g = moved({ x: 29.7, y: 0.4 });
    expect(dragWithSnap(g, { x: 29.7, y: 0.4 }, ctx, false, 1).target).toBeNull();
    expect(dragWithSnap(g, { x: 29.7, y: 0.4 }, null, true, 1).target).toBeNull();
    expect(dragWithSnap(press(), { x: 10.1, y: 0 }, ctx, true, 1).target).toBeNull();
    expect(dragWithSnap(null, { x: 29.7, y: 0.4 }, ctx, true, 1).target).toBeNull();
  });
  it('never snaps a box or a handle', () => {
    const band: NodeGesture = { kind: 'band', start: { x: 0, y: 0 }, current: { x: 29.7, y: 0.4 }, additive: false, base: [] };
    const handle: NodeGesture = { kind: 'handle', start: { x: 10, y: 0 }, ref: at(0, 1), side: 'out', moved: true };
    expect(dragWithSnap(band, { x: 29.7, y: 0.4 }, ctx, true, 1).target).toBeNull();
    expect(dragWithSnap(handle, { x: 29.7, y: 0.4 }, ctx, true, 1).target).toBeNull();
  });
});
