import { describe, expect, it } from 'vitest';
import {
  dragDraft,
  handleAt,
  handleTips,
  moveGesture,
  moveHandleWorld,
  nodeWorldPosition,
  pressAt,
  pressOnCanvas,
  releaseAt,
  toWorldNodes,
  type NodeGesture,
} from '@/lib/nodeEdit';
import { flattenNodes, type NodeRef } from '@/lib/nodePath';
import { applyToPoint, compose } from '@/lib/transform';
import type { NodePath, Point2, Transform2D } from '@/types/domain';

const IDENTITY: Transform2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const AWKWARD = compose({ x: 30, y: 40, rotationDeg: 30, scaleX: 2, scaleY: 0.5 });
const MIRRORED = compose({ x: 5, y: 5, rotationDeg: 0, scaleX: 1, scaleY: -1 });
const at = (path: number, node: number): NodeRef => ({ path, node });
const near = (a: Point2 | null, b: Point2, eps = 0.01) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a?.x ?? NaN) - b.x)).toBeLessThan(eps);
  expect(Math.abs((a?.y ?? NaN) - b.y)).toBeLessThan(eps);
};
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v as object)) freeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}
/** An open outline A (0,0) - B (20,0) - C (40,0), with handles on B: in (-5, 0) and out (5, 8). */
const base = (): NodePath[] => [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 20, y: 0, in: { x: -5, y: 0 }, out: { x: 5, y: 8 } }, { x: 40, y: 0 }] }];
const TOL = 1;
const THRESH = 0.5;

describe('handleTips', () => {
  it('lists the handles of the picked nodes that reach somewhere, as points in world millimetres', () => {
    const tips = handleTips(base(), [at(0, 1)]);
    expect(tips).toEqual([
      { ref: at(0, 1), side: 'in', nodeX: 20, nodeY: 0, x: 15, y: 0 },
      { ref: at(0, 1), side: 'out', nodeX: 20, nodeY: 0, x: 25, y: 8 },
    ]);
  });
  it('ignores nodes that are not picked, nodes with no handles, handles of no length and nodes that are not there', () => {
    expect(handleTips(base(), [at(0, 0)])).toEqual([]);
    expect(handleTips(base(), [])).toEqual([]);
    expect(handleTips(base(), [at(4, 4), at(0, 9)])).toEqual([]);
    const flat: NodePath[] = [{ closed: false, nodes: [{ x: 0, y: 0, out: { x: 0, y: 0 } }, { x: 5, y: 5 }] }];
    expect(handleTips(flat, [at(0, 0)])).toEqual([]);
  });
  it('shows the handles of no more than the limit of nodes', () => {
    const many: NodePath[] = [{ closed: false, nodes: Array.from({ length: 10 }, (_, i) => ({ x: i * 10, y: 0, out: { x: 1, y: 1 } })) }];
    const picked = many[0]?.nodes.map((_, i) => at(0, i)) ?? [];
    expect(handleTips(many, picked, 4)).toHaveLength(4);
    expect(handleTips(many, picked)).toHaveLength(10);
  });
});

describe('handleAt', () => {
  const world = base();
  it('finds the tip nearest the point within reach, and says how far', () => {
    const h = handleAt(world, [at(0, 1)], { x: 25.2, y: 8.1 }, TOL);
    expect(h).toMatchObject({ ref: at(0, 1), side: 'out' });
    expect(h?.distance).toBeCloseTo(Math.hypot(0.2, 0.1), 6);
    expect(handleAt(world, [at(0, 1)], { x: 15, y: 0.4 }, TOL)).toMatchObject({ side: 'in' });
  });
  it('finds nothing out of reach, or for a node that is not picked', () => {
    expect(handleAt(world, [at(0, 1)], { x: 30, y: 8 }, TOL)).toBeNull();
    expect(handleAt(world, [at(0, 0)], { x: 25, y: 8 }, TOL)).toBeNull();
  });
});

describe('pressOnCanvas', () => {
  const world = base();
  it('a press on a handle of a picked node starts dragging that handle and leaves the pick as it was', () => {
    const r = pressOnCanvas(world, [at(0, 1)], { x: 25.3, y: 7.8 }, TOL, false);
    expect(r.gesture).toEqual({ kind: 'handle', start: { x: 25.3, y: 7.8 }, ref: at(0, 1), side: 'out', moved: false });
    expect(r.selection).toEqual([at(0, 1)]);
  });
  it('a press on the node itself drags the node, not a handle', () => {
    const r = pressOnCanvas(world, [at(0, 1)], { x: 20.1, y: 0.1 }, TOL, false);
    expect(r.gesture?.kind).toBe('drag');
  });
  it('when a handle is so short that its tip is on the node, the nearer of the two wins', () => {
    const short: NodePath[] = [{ closed: false, nodes: [{ x: 0, y: 0, out: { x: 1, y: 0 } }, { x: 30, y: 0 }] }];
    expect(pressOnCanvas(short, [at(0, 0)], { x: 0.9, y: 0 }, TOL, false).gesture?.kind).toBe('handle');
    expect(pressOnCanvas(short, [at(0, 0)], { x: 0.1, y: 0 }, TOL, false).gesture?.kind).toBe('drag');
  });
  it('the handles of nodes that are not picked cannot be grabbed (it is an ordinary press, here a box)', () => {
    const r = pressOnCanvas(world, [at(0, 0)], { x: 25, y: 8 }, TOL, false);
    expect(r.gesture?.kind).toBe('band');
  });
  it('Shift and Ctrl never grab a handle, so they can add the node under one', () => {
    const r = pressOnCanvas(world, [at(0, 1)], { x: 25, y: 8 }, TOL, true);
    expect(r.gesture?.kind).toBe('band');
    expect(r.selection).toEqual([at(0, 1)]);
  });
  it('is just pressAt everywhere else', () => {
    for (const p of [{ x: 0.2, y: 0.1 }, { x: 40, y: 0 }, { x: 100, y: 100 }]) {
      expect(pressOnCanvas(world, [at(0, 1)], p, TOL, false)).toEqual(pressAt(world, [at(0, 1)], p, TOL, false));
    }
  });
});

describe('dragging a handle', () => {
  const press = (): NodeGesture => pressOnCanvas(base(), [at(0, 1)], { x: 25, y: 8 }, TOL, false).gesture as NodeGesture;
  it('counts as a drag only once it has gone far enough', () => {
    const g1 = moveGesture(press(), { x: 25.2, y: 8 }, THRESH);
    expect(g1.kind === 'handle' && g1.moved).toBe(false);
    const g2 = moveGesture(g1, { x: 26, y: 8 }, THRESH);
    expect(g2.kind === 'handle' && g2.moved).toBe(true);
  });
  it('shows nothing before that, and afterwards the handle moved by as much as the pointer, whatever is done to the object', () => {
    for (const t of [IDENTITY, AWKWARD, MIRRORED]) {
      const local = base();
      const tip0 = applyToPoint(t, { x: 25, y: 8 });
      let g = pressOnCanvas(toWorldNodes(local, t), [at(0, 1)], tip0, TOL, false).gesture as NodeGesture;
      expect(g.kind).toBe('handle');
      expect(dragDraft(g, freeze(local), t, { x: tip0.x + 0.1, y: tip0.y })).toBeNull();
      g = moveGesture(g, { x: tip0.x + 6, y: tip0.y - 4 }, THRESH);
      const draft = dragDraft(g, local, t, { x: tip0.x + 6, y: tip0.y - 4 }) as NodePath[];
      const node = nodeWorldPosition(draft, at(0, 1), t) as Point2;
      const h = draft[0]?.nodes[1]?.out as { x: number; y: number };
      const tip = applyToPoint(t, { x: (draft[0]?.nodes[1]?.x ?? 0) + h.x, y: (draft[0]?.nodes[1]?.y ?? 0) + h.y });
      near(tip, { x: tip0.x + 6, y: tip0.y - 4 });
      near(node, applyToPoint(t, { x: 20, y: 0 }));
    }
  });
  it('letting go after a drag that moved says how far the handle went, and after a click says nothing', () => {
    let g = press();
    const none = releaseAt(g, base(), [at(0, 1)], { x: 25.1, y: 8 }, THRESH);
    expect(none.handle).toBeNull();
    expect(none.move).toBeNull();
    g = moveGesture(g, { x: 29, y: 5 }, THRESH);
    const r = releaseAt(g, base(), [at(0, 1)], { x: 29, y: 5 }, THRESH);
    expect(r.handle).toEqual({ ref: at(0, 1), side: 'out', dx: 4, dy: -3 });
    expect(r.move).toBeNull();
    expect(r.selection).toEqual([at(0, 1)]);
  });
  it('the other gestures say no handle', () => {
    const drag = pressAt(base(), [], { x: 20, y: 0 }, TOL, false).gesture as NodeGesture;
    expect(releaseAt(moveGesture(drag, { x: 22, y: 0 }, THRESH), base(), [], { x: 22, y: 0 }, THRESH).handle).toBeNull();
    expect(releaseAt(null, base(), [], { x: 0, y: 0 }, THRESH).handle).toBeNull();
  });
});

describe('moveHandleWorld', () => {
  it('moves a handle by a step in world millimetres and bends the outline', () => {
    const local = base();
    const moved = moveHandleWorld(freeze(local), at(0, 1), 'out', IDENTITY, 0, 10);
    expect(moved[0]?.nodes[1]?.out).toEqual({ x: 5, y: 18 });
    expect(moved[0]?.nodes[1]?.in).toEqual({ x: -5, y: 0 });
    expect(flattenNodes(moved)[0]?.points.length).toBeGreaterThan(flattenNodes(local)[0]?.points.length ?? 0);
  });
  it('a smooth node swings its other handle round to match', () => {
    const smooth: NodePath[] = [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 20, y: 0, in: { x: -5, y: 0 }, out: { x: 5, y: 0 }, mode: 'smooth' }, { x: 40, y: 0 }] }];
    const moved = moveHandleWorld(smooth, at(0, 1), 'out', IDENTITY, -5, 5);
    expect(moved[0]?.nodes[1]?.out).toEqual({ x: 0, y: 5 });
    expect(moved[0]?.nodes[1]?.in).toEqual({ x: 0, y: -5 });
  });
  it('gives the same list back for no move, a node that is not there or an object that cannot be undone', () => {
    const local = base();
    expect(moveHandleWorld(local, at(0, 1), 'out', IDENTITY, 0, 0)).toBe(local);
    expect(moveHandleWorld(local, at(2, 2), 'out', IDENTITY, 1, 1)).toBe(local);
    expect(moveHandleWorld(local, at(0, 1), 'out', { a: 1, b: 0, c: 2, d: 0, e: 0, f: 0 }, 1, 1)).toBe(local);
  });
});
