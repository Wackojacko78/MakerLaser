import { describe, expect, it } from 'vitest';
import {
  DRAG_START_PX,
  NODE_HIT_PX,
  bandBox,
  dragDraft,
  editableNodes,
  guardNodeMode,
  insertAtWorldPoint,
  invertTransform,
  isSelected,
  moveGesture,
  moveSelectedWorld,
  nodeKeyAction,
  nodeSummary,
  nodeWorldPosition,
  planDelete,
  pointerToWorldMm,
  pressAt,
  pxToMm,
  releaseAt,
  setNodeWorldPosition,
  toWorldNodes,
  toggleRef,
  unionRefs,
  validRefs,
  worldStepToLocal,
  type GuardInput,
  type NodeKeyEvent,
} from '@/lib/nodeEdit';
import { flattenNodes, nodesFromPaths, type NodeRef } from '@/lib/nodePath';
import { applyToPoint, compose } from '@/lib/transform';
import type { NodePath, ObjectKind, Path2D, Point2, Transform2D } from '@/types/domain';

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
const IDENTITY: Transform2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
/** An object placed at (30, 40), turned 30 degrees and stretched 2 x 0.5: nothing about it is simple. */
const AWKWARD = compose({ x: 30, y: 40, rotationDeg: 30, scaleX: 2, scaleY: 0.5 });
const MIRRORED = compose({ x: 5, y: 5, rotationDeg: 0, scaleX: 1, scaleY: -1 });
const near = (a: Point2 | null, b: Point2, eps = 1e-6) => {
  expect(a).not.toBeNull();
  expect(Math.abs((a?.x ?? NaN) - b.x)).toBeLessThan(eps);
  expect(Math.abs((a?.y ?? NaN) - b.y)).toBeLessThan(eps);
};

// ---- the transform ------------------------------------------------------------------------------------

describe('the transform', () => {
  it('can be undone, whatever it does to the object', () => {
    for (const t of [IDENTITY, AWKWARD, MIRRORED, compose({ x: -7, y: 2, rotationDeg: 200, scaleX: 0.1, scaleY: 9 })]) {
      const inv = invertTransform(t) as Transform2D;
      expect(inv).not.toBeNull();
      near(applyToPoint(inv, applyToPoint(t, { x: 12.5, y: -3 })), { x: 12.5, y: -3 });
      near(applyToPoint(t, applyToPoint(inv, { x: 80, y: 20 })), { x: 80, y: 20 });
    }
  });
  it('cannot be undone when it flattens the object', () => {
    expect(invertTransform({ a: 1, b: 0, c: 2, d: 0, e: 0, f: 0 })).toBeNull();
    expect(invertTransform({ a: 0, b: 0, c: 0, d: 0, e: 1, f: 1 })).toBeNull();
    expect(invertTransform({ a: NaN, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBeNull();
    expect(worldStepToLocal({ a: 1, b: 0, c: 2, d: 0, e: 0, f: 0 }, 1, 1)).toBeNull();
  });
  it('gives the nodes in world millimetres: positions through all of it, handles through the linear part', () => {
    const nodes: NodePath[] = [{ closed: false, nodes: [{ x: 1, y: 2, out: { x: 3, y: 0 }, mode: 'smooth' }, { x: 5, y: 2, in: { x: 0, y: 4 } }] }];
    const w = toWorldNodes(freeze(nodes), AWKWARD);
    near({ x: w[0]?.nodes[0]?.x ?? NaN, y: w[0]?.nodes[0]?.y ?? NaN }, applyToPoint(AWKWARD, { x: 1, y: 2 }));
    // the handle of 3 along x is 3 * (a, b), which is the control point minus the node in world space
    const c1 = applyToPoint(AWKWARD, { x: 4, y: 2 });
    const n0 = w[0]?.nodes[0];
    near({ x: (n0?.x ?? 0) + (n0?.out?.x ?? 0), y: (n0?.y ?? 0) + (n0?.out?.y ?? 0) }, c1);
    expect(n0?.mode).toBe('smooth');
    const n1 = w[0]?.nodes[1];
    const c2 = applyToPoint(AWKWARD, { x: 5, y: 6 });
    near({ x: (n1?.x ?? 0) + (n1?.in?.x ?? 0), y: (n1?.y ?? 0) + (n1?.in?.y ?? 0) }, c2);
    expect(n1?.out).toBeUndefined();
  });
  it('moves nodes by a step in world millimetres, so on screen they go exactly that far', () => {
    const nodes = nodesFromPaths([square(10)]);
    for (const t of [IDENTITY, AWKWARD, MIRRORED]) {
      const moved = moveSelectedWorld(freeze(nodes), [{ path: 0, node: 2 }], t, 4, -3);
      const before = nodeWorldPosition(nodes, { path: 0, node: 2 }, t) as Point2;
      const after = nodeWorldPosition(moved, { path: 0, node: 2 }, t) as Point2;
      near(after, { x: before.x + 4, y: before.y - 3 }, 0.01);
      // nothing else moved
      near(nodeWorldPosition(moved, { path: 0, node: 0 }, t), nodeWorldPosition(nodes, { path: 0, node: 0 }, t) as Point2);
    }
  });
  it('leaves everything alone for a step that is nothing or an object that cannot be undone', () => {
    const nodes = nodesFromPaths([square(10)]);
    expect(moveSelectedWorld(nodes, [{ path: 0, node: 0 }], IDENTITY, 0, 0)).toBe(nodes);
    expect(moveSelectedWorld(nodes, [{ path: 0, node: 0 }], { a: 1, b: 0, c: 2, d: 0, e: 0, f: 0 }, 1, 1)).toBe(nodes);
    expect(moveSelectedWorld(nodes, [], IDENTITY, 1, 1)).toBe(nodes);
  });
  it('puts a node at an exact world position', () => {
    const nodes = nodesFromPaths([square(10)]);
    for (const t of [IDENTITY, AWKWARD, MIRRORED]) {
      const moved = setNodeWorldPosition(freeze(nodes), { path: 0, node: 1 }, t, 61.5, 44.25);
      near(nodeWorldPosition(moved, { path: 0, node: 1 }, t), { x: 61.5, y: 44.25 }, 0.002);
    }
    expect(setNodeWorldPosition(nodes, { path: 0, node: 1 }, { a: 1, b: 0, c: 2, d: 0, e: 0, f: 0 }, 1, 1)).toBe(nodes);
    expect(setNodeWorldPosition(nodes, { path: 4, node: 1 }, IDENTITY, 1, 1)).toBe(nodes);
    expect(nodeWorldPosition(nodes, { path: 4, node: 1 }, IDENTITY)).toBeNull();
  });
});

describe('the pointer', () => {
  it('turns a position on the stage into world millimetres, at any pan and zoom', () => {
    expect(pointerToWorldMm({ x: 36, y: 36 }, { x: 36, y: 36, scale: 1 }, 2)).toEqual({ x: 0, y: 0 });
    expect(pointerToWorldMm({ x: 236, y: 136 }, { x: 36, y: 36, scale: 1 }, 2)).toEqual({ x: 100, y: 50 });
    expect(pointerToWorldMm({ x: 236, y: 136 }, { x: 36, y: 36, scale: 2 }, 2)).toEqual({ x: 50, y: 25 });
    expect(pointerToWorldMm({ x: 0, y: 0 }, { x: 100, y: 40, scale: 0.5 }, 2)).toEqual({ x: -100, y: -40 });
  });
  it('turns a distance in pixels into millimetres, and a smaller one the closer you zoom in', () => {
    expect(pxToMm(8, 1, 2)).toBe(4);
    expect(pxToMm(8, 4, 2)).toBe(1);
    expect(pxToMm(8, 0.5, 2)).toBe(8);
  });
});

// ---- the selection --------------------------------------------------------------------------------------

describe('the selection of nodes', () => {
  const nodes = nodesFromPaths([square(10), square(4, 20, 20)]);
  it('keeps what is there, once, in order, and drops the rest', () => {
    const refs: NodeRef[] = [{ path: 1, node: 3 }, { path: 0, node: 1 }, { path: 0, node: 1 }, { path: 0, node: 9 }, { path: 7, node: 0 }];
    expect(validRefs(freeze(nodes), freeze(refs))).toEqual([{ path: 0, node: 1 }, { path: 1, node: 3 }]);
    expect(validRefs(nodes, [])).toEqual([]);
  });
  it('adds a node, or takes it out when it is there already', () => {
    const a = toggleRef([], { path: 0, node: 1 });
    expect(a).toEqual([{ path: 0, node: 1 }]);
    expect(toggleRef(a, { path: 0, node: 2 })).toHaveLength(2);
    expect(toggleRef(a, { path: 0, node: 1 })).toEqual([]);
    const input = freeze([{ path: 0, node: 1 }]);
    toggleRef(input, { path: 0, node: 1 });
  });
  it('joins two selections without doubling', () => {
    expect(unionRefs([{ path: 0, node: 1 }], [{ path: 0, node: 1 }, { path: 0, node: 2 }])).toEqual([{ path: 0, node: 1 }, { path: 0, node: 2 }]);
    expect(isSelected([{ path: 0, node: 1 }], { path: 0, node: 1 })).toBe(true);
    expect(isSelected([{ path: 0, node: 1 }], { path: 1, node: 1 })).toBe(false);
  });
});

// ---- one gesture ----------------------------------------------------------------------------------------

describe('pressing, dragging and letting go', () => {
  const local = nodesFromPaths([square(10)]);
  const world = toWorldNodes(local, IDENTITY);
  const TOL = 1;
  const THRESH = 0.5;
  it('a press on a node picks it and starts a drag', () => {
    const r = pressAt(world, [], { x: 10.2, y: 0.1 }, TOL, false);
    expect(r.selection).toEqual([{ path: 0, node: 1 }]);
    expect(r.gesture?.kind).toBe('drag');
    expect(r.gesture?.kind === 'drag' && r.gesture.moved).toBe(false);
  });
  it('a press on a node that is already picked keeps all of the picked nodes, so they drag together', () => {
    const picked = [{ path: 0, node: 1 }, { path: 0, node: 2 }];
    const r = pressAt(world, picked, { x: 10, y: 10 }, TOL, false);
    expect(r.selection).toEqual(picked);
    expect(r.gesture?.kind === 'drag' && r.gesture.refs).toEqual(picked);
  });
  it('a press on another node picks just that one', () => {
    const r = pressAt(world, [{ path: 0, node: 1 }, { path: 0, node: 2 }], { x: 0, y: 0 }, TOL, false);
    expect(r.selection).toEqual([{ path: 0, node: 0 }]);
  });
  it('Shift or Ctrl adds a node and drags with it, and takes one out without dragging', () => {
    const added = pressAt(world, [{ path: 0, node: 1 }], { x: 10, y: 10 }, TOL, true);
    expect(added.selection).toHaveLength(2);
    expect(added.gesture?.kind).toBe('drag');
    const removed = pressAt(world, [{ path: 0, node: 1 }, { path: 0, node: 2 }], { x: 10, y: 10 }, TOL, true);
    expect(removed.selection).toEqual([{ path: 0, node: 1 }]);
    expect(removed.gesture).toBeNull();
  });
  it('a press on empty canvas clears the pick and starts a box, unless it is additive', () => {
    const picked = [{ path: 0, node: 1 }];
    const clear = pressAt(world, picked, { x: 50, y: 50 }, TOL, false);
    expect(clear.selection).toEqual([]);
    expect(clear.gesture?.kind).toBe('band');
    const keep = pressAt(world, picked, { x: 50, y: 50 }, TOL, true);
    expect(keep.selection).toEqual(picked);
    expect(keep.gesture?.kind === 'band' && keep.gesture.additive).toBe(true);
  });
  it('a drag counts only once it has gone far enough, and keeps counting after', () => {
    const g0 = pressAt(world, [], { x: 10, y: 0 }, TOL, false).gesture as NonNullable<ReturnType<typeof pressAt>['gesture']>;
    const g1 = moveGesture(g0, { x: 10.2, y: 0 }, THRESH);
    expect(g1.kind === 'drag' && g1.moved).toBe(false);
    const g2 = moveGesture(g1, { x: 11, y: 0 }, THRESH);
    expect(g2.kind === 'drag' && g2.moved).toBe(true);
    const g3 = moveGesture(g2, { x: 10.05, y: 0 }, THRESH);
    expect(g3.kind === 'drag' && g3.moved).toBe(true);
  });
  it('shows the nodes as they will be while dragging, and nothing before it counts', () => {
    const g0 = pressAt(world, [], { x: 10, y: 10 }, TOL, false).gesture;
    expect(dragDraft(g0, freeze(local), IDENTITY, { x: 10.1, y: 10 })).toBeNull();
    const g1 = moveGesture(g0 as NonNullable<typeof g0>, { x: 13, y: 12 }, THRESH);
    const draft = dragDraft(g1, local, IDENTITY, { x: 13, y: 12 }) as NodePath[];
    expect(draft[0]?.nodes[2]).toEqual({ x: 13, y: 12 });
    expect(draft[0]?.nodes[0]).toEqual({ x: 0, y: 0 });
    expect(dragDraft(null, local, IDENTITY, { x: 1, y: 1 })).toBeNull();
  });
  it('letting go after a drag that moved commits the move, from where the press was', () => {
    let g = pressAt(world, [], { x: 10, y: 10 }, TOL, false).gesture;
    g = moveGesture(g as NonNullable<typeof g>, { x: 14, y: 7 }, THRESH);
    const r = releaseAt(g, world, [{ path: 0, node: 2 }], { x: 14, y: 7 }, THRESH);
    expect(r.move).toEqual({ dx: 4, dy: -3, refs: [{ path: 0, node: 2 }] });
    expect(r.selection).toEqual([{ path: 0, node: 2 }]);
  });
  it('letting go after a click commits nothing and keeps the pick', () => {
    const g = pressAt(world, [], { x: 10, y: 10 }, TOL, false).gesture;
    const r = releaseAt(g, world, [{ path: 0, node: 2 }], { x: 10.1, y: 10 }, THRESH);
    expect(r.move).toBeNull();
    expect(r.selection).toEqual([{ path: 0, node: 2 }]);
    expect(releaseAt(null, world, [{ path: 0, node: 2 }], { x: 0, y: 0 }, THRESH).move).toBeNull();
  });
  it('a box picks the nodes inside it, edges included, whichever corner it was dragged from', () => {
    for (const [a, b] of [[{ x: -1, y: -1 }, { x: 10, y: 1 }], [{ x: 10, y: 1 }, { x: -1, y: -1 }]] as const) {
      let g = pressAt(world, [], a, 0.1, false).gesture;
      g = moveGesture(g as NonNullable<typeof g>, b, THRESH);
      expect(bandBox(g)).toEqual({ minX: -1, maxX: 10, minY: -1, maxY: 1 });
      const r = releaseAt(g, world, [], b, THRESH);
      expect(r.selection).toEqual([{ path: 0, node: 0 }, { path: 0, node: 1 }]);
      expect(r.move).toBeNull();
    }
  });
  it('an additive box adds to what was picked before it', () => {
    const before = [{ path: 0, node: 3 }];
    let g = pressAt(world, before, { x: -1, y: -1 }, 0.1, true).gesture;
    g = moveGesture(g as NonNullable<typeof g>, { x: 10, y: 1 }, THRESH);
    const r = releaseAt(g, world, before, { x: 10, y: 1 }, THRESH);
    expect(r.selection).toEqual([{ path: 0, node: 3 }, { path: 0, node: 0 }, { path: 0, node: 1 }]);
  });
  it('a box that is only a click picks nothing and leaves the (already cleared) pick', () => {
    const g = pressAt(world, [{ path: 0, node: 1 }], { x: 50, y: 50 }, TOL, false).gesture;
    const r = releaseAt(g, world, [{ path: 0, node: 1 }], { x: 50.1, y: 50.1 }, THRESH);
    expect(r.selection).toEqual([{ path: 0, node: 1 }]);
  });
  it('has no box unless it is a box', () => {
    expect(bandBox(null)).toBeNull();
    expect(bandBox({ kind: 'drag', start: { x: 0, y: 0 }, refs: [], moved: true })).toBeNull();
  });
  it('picks by world position, so it works for an object that is turned and stretched', () => {
    const nodes = nodesFromPaths([square(10)]);
    const w = toWorldNodes(nodes, AWKWARD);
    const target = applyToPoint(AWKWARD, { x: 10, y: 10 });
    const r = pressAt(w, [], { x: target.x + 0.2, y: target.y - 0.1 }, 1, false);
    expect(r.selection).toEqual([{ path: 0, node: 2 }]);
  });
  it('has sensible reach in pixels', () => {
    expect(NODE_HIT_PX).toBeGreaterThan(3);
    expect(NODE_HIT_PX).toBeLessThan(20);
    expect(DRAG_START_PX).toBeGreaterThan(0);
    expect(DRAG_START_PX).toBeLessThan(10);
  });
});

describe('adding a node by double-click', () => {
  const local = nodesFromPaths([square(10)]);
  it('puts a node on the line under the pointer, wherever the object is', () => {
    for (const t of [IDENTITY, AWKWARD, MIRRORED]) {
      const onLine = applyToPoint(t, { x: 10, y: 3 });
      const r = insertAtWorldPoint(freeze(local), t, { x: onLine.x + 0.05, y: onLine.y + 0.05 }, 0.5, 0.5);
      expect(r?.ref).toEqual({ path: 0, node: 2 });
      expect(r?.nodes[0]?.nodes).toHaveLength(5);
      near({ x: r?.nodes[0]?.nodes[2]?.x ?? NaN, y: r?.nodes[0]?.nodes[2]?.y ?? NaN }, { x: 10, y: 3 }, 0.2);
    }
  });
  it('does nothing away from every line, or on top of a node', () => {
    expect(insertAtWorldPoint(local, IDENTITY, { x: 5, y: 5 }, 0.5, 0.5)).toBeNull();
    expect(insertAtWorldPoint(local, IDENTITY, { x: 10.1, y: 0.1 }, 0.5, 0.5)).toBeNull();
    expect(insertAtWorldPoint([], IDENTITY, { x: 0, y: 0 }, 1, 1)).toBeNull();
  });
  it('does not change the outline it splits', () => {
    const r = insertAtWorldPoint(local, IDENTITY, { x: 5, y: 0 }, 0.5, 0.5);
    const before = flattenNodes(local)[0]?.points ?? [];
    const after = flattenNodes(r?.nodes ?? [])[0]?.points ?? [];
    expect(after).toHaveLength(before.length + 1);
  });
});

// ---- who can be edited ----------------------------------------------------------------------------------

describe('editableNodes', () => {
  const vec = (extra: Record<string, unknown> = {}): ObjectKind => ({ type: 'vector', paths: [square(10)], ...extra }) as ObjectKind;
  it('gives the nodes of an object that can be edited, and says when they were rebuilt', () => {
    const r = editableNodes({ locked: false, kind: vec() });
    expect(r.ok && r.nodes[0]?.nodes.length === 4 && !r.stale).toBe(true);
    const stale = editableNodes({ locked: false, kind: vec({ nodes: [{ closed: true, nodes: [{ x: 0, y: 0 }] }] }) });
    expect(stale.ok && stale.stale).toBe(true);
  });
  it('gives the very same list when asked again about the same kind, so a change that changes nothing can be told', () => {
    const kind = vec();
    const a = editableNodes({ locked: false, kind });
    const b = editableNodes({ locked: false, kind });
    expect(a.ok && b.ok && a.nodes === b.nodes).toBe(true);
    const c = editableNodes({ locked: false, kind: vec() });
    expect(a.ok && c.ok && a.nodes !== c.nodes).toBe(true);
  });
  it('refuses a locked object before anything else, in words', () => {
    const r = editableNodes({ locked: true, kind: vec() });
    expect(!r.ok && r.message).toContain('locked');
    expect(!editableNodes({ locked: true, kind: vec({ source: { type: 'shape' } }) }).ok).toBe(true);
  });
  it('refuses text and shapes, pictures and empty objects, each in words that say what to do', () => {
    const shape = editableNodes({ locked: false, kind: vec({ source: { type: 'shape' } }) });
    expect(!shape.ok && shape.message).toContain('Convert to outlines');
    const picture = editableNodes({ locked: false, kind: { type: 'image', asset_id: 'a', format: 'png', source_path: null, width_px: 1, height_px: 1, dpi: 96 } });
    expect(!picture.ok && picture.message).toContain('Trace');
    const empty = editableNodes({ locked: false, kind: { type: 'vector', paths: [] } });
    expect(!empty.ok && empty.message.length).toBeGreaterThan(10);
  });
});

describe('when node editing has to stop', () => {
  const object = { id: 'a', locked: false, kind: { type: 'vector', paths: [square(10)] } as ObjectKind };
  const base: GuardInput = { editingId: 'a', object, selected: ['a'], drawToolPicked: false, measureToolPicked: false };
  it('carries on when all is well, and has nothing to do when nothing is being edited', () => {
    expect(guardNodeMode(base)).toBe('none');
    expect(guardNodeMode({ ...base, editingId: null, object: undefined, selected: [] })).toBe('none');
  });
  it('stops when the object has gone, was swapped for another, or is locked or has become text or a shape', () => {
    expect(guardNodeMode({ ...base, object: undefined })).toBe('leave');
    expect(guardNodeMode({ ...base, object: { ...object, id: 'b' } })).toBe('leave');
    expect(guardNodeMode({ ...base, object: { ...object, locked: true } })).toBe('leave');
    expect(guardNodeMode({ ...base, object: { ...object, kind: { type: 'vector', paths: [square(10)], source: { type: 'shape' } } as ObjectKind } })).toBe('leave');
    expect(guardNodeMode({ ...base, object: { ...object, kind: { type: 'vector', paths: [] } as ObjectKind } })).toBe('leave');
  });
  it('stops when a drawing tool or Measure is picked', () => {
    expect(guardNodeMode({ ...base, drawToolPicked: true })).toBe('leave');
    expect(guardNodeMode({ ...base, measureToolPicked: true })).toBe('leave');
  });
  it('stops when something else is picked, or more than the one object', () => {
    expect(guardNodeMode({ ...base, selected: ['b'] })).toBe('leave');
    expect(guardNodeMode({ ...base, selected: ['a', 'b'] })).toBe('leave');
  });
  it('picks the object again when the selection is empty, which is what Undo and Redo leave', () => {
    expect(guardNodeMode({ ...base, selected: [] })).toBe('reselect');
  });
});

describe('deleting', () => {
  const nodes = nodesFromPaths([square(10), square(4, 20, 20)]);
  it('takes the picked nodes out and says what happened', () => {
    const r = planDelete(freeze(nodes), [{ path: 0, node: 0 }]);
    expect(r.nodes?.[0]?.nodes).toHaveLength(3);
    expect(r.message).toBe('Deleted 1 node.');
    expect(planDelete(nodes, [{ path: 0, node: 0 }, { path: 1, node: 1 }]).message).toBe('Deleted 2 nodes.');
  });
  it('says when an outline became an open line or was removed', () => {
    const three = nodesFromPaths([{ closed: true, points: square(10).points.slice(0, 3) }]);
    const a = planDelete(three, [{ path: 0, node: 2 }]);
    expect(a.nodes?.[0]?.closed).toBe(false);
    expect(a.message).toContain('open line');
    const b = planDelete(nodes, [{ path: 1, node: 0 }, { path: 1, node: 1 }, { path: 1, node: 2 }]);
    expect(b.nodes).toHaveLength(1);
    expect(b.message).toContain('removed');
  });
  it('refuses when nothing is picked, and when nothing at all would be left', () => {
    expect(planDelete(nodes, []).nodes).toBeNull();
    expect(planDelete(nodes, []).message).toContain('Pick a node');
    expect(planDelete(nodes, [{ path: 5, node: 5 }]).nodes).toBeNull();
    const all = [0, 1, 2, 3].map((node) => ({ path: 0, node }));
    const one = nodesFromPaths([square(10)]);
    const r = planDelete(one, all);
    expect(r.nodes).toBeNull();
    expect(r.message).toContain('delete the object');
  });
  it('writes the count for the panel', () => {
    expect(nodeSummary(nodes, 0)).toBe('8 nodes on 2 outlines.');
    expect(nodeSummary(nodes, 3)).toBe('8 nodes on 2 outlines. 3 picked.');
    expect(nodeSummary(nodesFromPaths([{ closed: false, points: [{ x: 0, y: 0 }] }]), 0)).toBe('1 node on 1 outline.');
  });
});

// ---- keys -----------------------------------------------------------------------------------------------

describe('the keys', () => {
  const key = (k: string, patch: Partial<NodeKeyEvent> = {}): NodeKeyEvent => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, ...patch });
  const page = { tag: 'DIV', contentEditable: false };
  const act = (e: NodeKeyEvent, editing: boolean, target: { tag: string; contentEditable: boolean } | null = page, modal = false) => nodeKeyAction(e, target, modal, editing);
  it('N starts and stops node editing, in either case', () => {
    expect(act(key('n'), false)).toEqual({ type: 'toggle' });
    expect(act(key('N'), true)).toEqual({ type: 'toggle' });
    expect(act(key('n'), false, null)).toEqual({ type: 'toggle' });
  });
  it('the other keys do nothing until node editing is on', () => {
    for (const k of ['Escape', 'v', 'Delete', 'Backspace', 'ArrowLeft', 'ArrowUp']) expect(act(key(k), false)).toBeNull();
  });
  it('while editing: Esc, V, Delete and Backspace', () => {
    expect(act(key('Escape'), true)).toEqual({ type: 'escape' });
    expect(act(key('v'), true)).toEqual({ type: 'leave' });
    expect(act(key('V'), true)).toEqual({ type: 'leave' });
    expect(act(key('Delete'), true)).toEqual({ type: 'delete' });
    expect(act(key('Backspace'), true)).toEqual({ type: 'delete' });
  });
  it('while editing: the arrows nudge by 1 mm, or 10 with Shift, in screen directions', () => {
    expect(act(key('ArrowLeft'), true)).toEqual({ type: 'nudge', dx: -1, dy: 0 });
    expect(act(key('ArrowRight'), true)).toEqual({ type: 'nudge', dx: 1, dy: 0 });
    expect(act(key('ArrowUp'), true)).toEqual({ type: 'nudge', dx: 0, dy: -1 });
    expect(act(key('ArrowDown', { shiftKey: true }), true)).toEqual({ type: 'nudge', dx: 0, dy: 10 });
  });
  it('arrows repeat when held, but Delete, N, V and Esc do not (Delete would eat one node after another)', () => {
    expect(act(key('ArrowLeft', { repeat: true }), true)).toEqual({ type: 'nudge', dx: -1, dy: 0 });
    for (const k of ['Delete', 'Backspace', 'n', 'v', 'Escape']) expect(act(key(k, { repeat: true }), true)).toBeNull();
  });
  it('leaves Ctrl, Alt and the Windows key to the other shortcuts (Ctrl+N is New, Ctrl+Z is Undo)', () => {
    for (const patch of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      for (const k of ['n', 'z', 'Delete', 'ArrowLeft']) expect(act(key(k, patch), true)).toBeNull();
    }
    expect(act(key('N', { shiftKey: true }), true)).toBeNull();
  });
  it('is silent while typing in a box, with a dialog open or while composing text', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) expect(act(key('n'), true, { tag, contentEditable: false })).toBeNull();
    expect(act(key('Delete'), true, { tag: 'DIV', contentEditable: true })).toBeNull();
    expect(act(key('n'), true, page, true)).toBeNull();
    expect(act(key('n', { isComposing: true }), true)).toBeNull();
  });
  it('works with a button focused, because a letter does nothing to a button', () => {
    expect(act(key('n'), false, { tag: 'BUTTON', contentEditable: false })).toEqual({ type: 'toggle' });
  });
  it('ignores every other key', () => {
    for (const k of ['a', 'm', 'r', 'Enter', 'Tab', ' ', 'F2', '1']) expect(act(key(k), true)).toBeNull();
  });
});
