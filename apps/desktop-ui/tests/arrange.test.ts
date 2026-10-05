import { describe, expect, it } from 'vitest';
import {
  MAX_ARRAY_COPIES,
  MAX_ARRAY_DIM,
  planAlign,
  planArray,
  planCenterOnBed,
  planDistribute,
  validateArrayOptions,
} from '@/lib/arrange';
import { chain, rotation, translation, worldBounds, type Bounds } from '@/lib/transform';
import type { Transform2D, WorkspaceObject } from '@/types/domain';

const BED = { width: 300, height: 200 };

/** A w x h rectangle whose top-left corner is at (x, y). */
function box(id: string, x: number, y: number, w = 10, h = 10, over: Partial<WorkspaceObject> = {}): WorkspaceObject {
  return {
    id,
    name: id,
    kind: {
      type: 'vector',
      paths: [{ closed: true, points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] }],
    },
    transform: translation(x, y),
    layer_id: null,
    visible: true,
    locked: false,
    z_index: 0,
    ...over,
  };
}

/** The objects after applying a plan's updates. */
function applied(objects: WorkspaceObject[], updates: Record<string, Transform2D>): WorkspaceObject[] {
  return objects.map((o) => (updates[o.id] ? { ...o, transform: updates[o.id] as Transform2D } : o));
}
const bounds = (o: WorkspaceObject): Bounds => worldBounds(o) as Bounds;
const byId = (list: WorkspaceObject[], id: string) => bounds(list.find((o) => o.id === id) as WorkspaceObject);

describe('planAlign to the selection', () => {
  const a = box('a', 10, 10, 20, 10);
  const b = box('b', 50, 40, 10, 30);
  const c = box('c', 100, 5, 40, 20);
  const all = [a, b, c];
  const ids = ['a', 'b', 'c'];
  const run = (mode: Parameters<typeof planAlign>[2]) => applied(all, planAlign(all, ids, mode, 'selection', BED).updates);

  it('left edges line up with the leftmost', () => {
    const r = run('left');
    for (const id of ids) expect(byId(r, id).minX).toBe(10);
  });
  it('right edges line up with the rightmost', () => {
    const r = run('right');
    for (const id of ids) expect(byId(r, id).maxX).toBe(140);
  });
  it('centres line up on the middle of the selection', () => {
    const r = run('hcenter');
    for (const id of ids) expect((byId(r, id).minX + byId(r, id).maxX) / 2).toBe(75);
  });
  it('top, bottom and middle work on the Y axis (smaller Y is higher up)', () => {
    for (const id of ids) expect(byId(run('top'), id).minY).toBe(5);
    for (const id of ids) expect(byId(run('bottom'), id).maxY).toBe(70);
    for (const id of ids) expect((byId(run('vcenter'), id).minY + byId(run('vcenter'), id).maxY) / 2).toBe(37.5);
  });
  it('only moves along the axis being aligned', () => {
    const r = run('left');
    expect(byId(r, 'b').minY).toBe(40);
    expect(byId(r, 'c').minY).toBe(5);
  });
  it('does not list objects that are already in place', () => {
    const plan = planAlign(all, ids, 'left', 'selection', BED);
    expect(Object.keys(plan.updates).includes('a')).toBe(false);
    expect(Object.keys(plan.updates)).toHaveLength(2);
  });
  it('needs at least two objects', () => {
    const plan = planAlign(all, ['a'], 'left', 'selection', BED);
    expect(plan.updates).toEqual({});
    expect(plan.message).toMatch(/at least two/);
  });
  it('says so when there is nothing to do', () => {
    const lined = [box('p', 10, 0), box('q', 10, 20)];
    const plan = planAlign(lined, ['p', 'q'], 'left', 'selection', BED);
    expect(plan.updates).toEqual({});
    expect(plan.message).toBe('Already aligned.');
  });
  it('ignores objects that are not selected', () => {
    const plan = planAlign(all, ['a', 'b'], 'left', 'selection', BED);
    expect(plan.updates['c']).toBe(undefined);
  });
});

describe('planAlign to the bed', () => {
  it('works with a single object', () => {
    const o = box('o', 100, 100, 20, 20);
    const r = applied([o], planAlign([o], ['o'], 'left', 'bed', BED).updates);
    expect(byId(r, 'o').minX).toBe(0);
    const r2 = applied([o], planAlign([o], ['o'], 'bottom', 'bed', BED).updates);
    expect(byId(r2, 'o').maxY).toBe(200);
    const r3 = applied([o], planAlign([o], ['o'], 'hcenter', 'bed', BED).updates);
    expect(byId(r3, 'o').minX).toBe(140);
  });
});

describe('locked and rotated objects', () => {
  it('never moves a locked object, ignores it as a reference, and counts it', () => {
    const a = box('a', 10, 0);
    const b = box('b', 50, 0);
    const locked = box('l', 0, 0, 10, 10, { locked: true });
    const plan = planAlign([a, b, locked], ['a', 'b', 'l'], 'left', 'selection', BED);
    expect(plan.updates['l']).toBe(undefined);
    expect(plan.skippedLocked).toBe(1);
    const r = applied([a, b, locked], plan.updates);
    expect(byId(r, 'b').minX).toBe(10); // aligned to a, not to the locked object at 0
  });
  it('explains when everything selected is locked', () => {
    const plan = planAlign([box('l', 0, 0, 10, 10, { locked: true })], ['l'], 'left', 'bed', BED);
    expect(plan.message).toBe('The selected objects are locked.');
  });
  it('uses the bounding box of a rotated object', () => {
    const square = box('s', 50, 50, 10, 10);
    const turned = { ...square, transform: chain(rotation(45), translation(80, 40)) };
    const other = box('o', 20, 0);
    const r = applied([turned, other], planAlign([turned, other], ['s', 'o'], 'left', 'selection', BED).updates);
    expect(Math.abs(byId(r, 's').minX - byId(r, 'o').minX) < 1e-9).toBe(true);
  });
});

describe('planDistribute', () => {
  it('makes the gaps equal and keeps the first and last in place', () => {
    const objs = [box('a', 0, 0), box('b', 10, 0), box('c', 100, 0)];
    const r = applied(objs, planDistribute(objs, ['a', 'b', 'c'], 'x').updates);
    expect(byId(r, 'a').minX).toBe(0);
    expect(byId(r, 'b').minX).toBe(50);
    expect(byId(r, 'c').minX).toBe(100);
  });
  it('works vertically and leaves the other axis alone', () => {
    const objs = [box('a', 5, 0), box('b', 7, 10), box('c', 9, 100)];
    const r = applied(objs, planDistribute(objs, ['a', 'b', 'c'], 'y').updates);
    expect(byId(r, 'b').minY).toBe(50);
    expect(byId(r, 'b').minX).toBe(7);
  });
  it('gives equal gaps even when the objects are different sizes and selected in a different order', () => {
    const objs = [box('a', 0, 0, 10), box('b', 17, 0, 40), box('c', 30, 0, 5), box('d', 120, 0, 20)];
    const r = applied(objs, planDistribute(objs, ['d', 'b', 'a', 'c'], 'x').updates);
    const sorted = ['a', 'b', 'c', 'd'].map((id) => byId(r, id)).sort((p, q) => p.minX - q.minX);
    const gaps = sorted.slice(1).map((s, i) => s.minX - (sorted[i] as Bounds).maxX);
    for (const g of gaps) expect(Math.abs(g - (gaps[0] as number)) < 1e-9).toBe(true);
    expect(sorted[0]?.minX).toBe(0);
    expect(sorted[3]?.maxX).toBe(140);
  });
  it('needs at least three objects', () => {
    const objs = [box('a', 0, 0), box('b', 50, 0)];
    const plan = planDistribute(objs, ['a', 'b'], 'x');
    expect(plan.updates).toEqual({});
    expect(plan.message).toMatch(/at least three/);
  });
  it('says so when the spacing is already even', () => {
    const objs = [box('a', 0, 0), box('b', 50, 0), box('c', 100, 0)];
    expect(planDistribute(objs, ['a', 'b', 'c'], 'x').message).toBe('Already evenly spaced.');
  });
  it('leaves locked objects out', () => {
    const objs = [box('a', 0, 0), box('b', 10, 0), box('c', 100, 0), box('l', 60, 0, 10, 10, { locked: true })];
    const plan = planDistribute(objs, ['a', 'b', 'c', 'l'], 'x');
    expect(plan.skippedLocked).toBe(1);
    expect(plan.updates['l']).toBe(undefined);
  });
});

describe('planCenterOnBed', () => {
  it('moves the group so its centre is the bed centre and keeps the layout', () => {
    const objs = [box('a', 10, 10, 20, 20), box('b', 60, 40, 20, 20)];
    const r = applied(objs, planCenterOnBed(objs, ['a', 'b'], BED).updates);
    const ba = byId(r, 'a');
    const bb = byId(r, 'b');
    expect((Math.min(ba.minX, bb.minX) + Math.max(ba.maxX, bb.maxX)) / 2).toBe(150);
    expect((Math.min(ba.minY, bb.minY) + Math.max(ba.maxY, bb.maxY)) / 2).toBe(100);
    expect(bb.minX - ba.minX).toBe(50);
    expect(bb.minY - ba.minY).toBe(30);
  });
  it('says so when it is already centred', () => {
    expect(planCenterOnBed([box('a', 145, 95)], ['a'], BED).message).toBe('Already centred.');
  });
});

describe('validateArrayOptions', () => {
  const ok = { rows: 2, cols: 3, gapX: 5, gapY: 5 };
  it('accepts sensible settings', () => {
    expect(validateArrayOptions(ok, 1)).toEqual([]);
    expect(validateArrayOptions({ ...ok, gapX: 0, gapY: 0 }, 1)).toEqual([]);
  });
  it('rejects bad row and column counts', () => {
    expect(validateArrayOptions({ ...ok, rows: 0 }, 1)[0]).toMatch(/Rows/);
    expect(validateArrayOptions({ ...ok, cols: MAX_ARRAY_DIM + 1 }, 1)[0]).toMatch(/Columns/);
    expect(validateArrayOptions({ ...ok, cols: 2.5 }, 1)[0]).toMatch(/Columns/);
  });
  it('rejects a 1 x 1 array, bad gaps and NaN', () => {
    expect(validateArrayOptions({ ...ok, rows: 1, cols: 1 }, 1)[0]).toMatch(/more than one/);
    expect(validateArrayOptions({ ...ok, gapX: -1 }, 1)[0]).toMatch(/Column gap/);
    expect(validateArrayOptions({ ...ok, gapY: Number.NaN }, 1)[0]).toMatch(/Row gap/);
  });
  it('rejects an array that would make too many copies', () => {
    expect(validateArrayOptions({ rows: 10, cols: 10, gapX: 1, gapY: 1 }, 5)[0]).toMatch(String(MAX_ARRAY_COPIES));
    expect(validateArrayOptions({ rows: 10, cols: 10, gapX: 1, gapY: 1 }, 4)).toEqual([]);
  });
});

describe('planArray', () => {
  let n = 0;
  const newId = () => `new-${++n}`;
  const src = box('a', 20, 20, 10, 10);

  it('makes the copies on the grid, without repeating the original', () => {
    const plan = planArray([src], ['a'], { rows: 2, cols: 3, gapX: 5, gapY: 5 }, BED, newId);
    expect(plan.errors).toEqual([]);
    expect(plan.copies).toHaveLength(5);
    const positions = plan.copies.map((c) => [bounds(c).minX, bounds(c).minY]);
    expect(positions).toEqual([[35, 20], [50, 20], [20, 35], [35, 35], [50, 35]]);
  });
  it('treats a selection of several objects as one group', () => {
    const objs = [box('a', 0, 0, 10, 10), box('b', 20, 0, 10, 10)];
    const plan = planArray(objs, ['a', 'b'], { rows: 1, cols: 2, gapX: 10, gapY: 0 }, BED, newId);
    expect(plan.copies).toHaveLength(2);
    expect(plan.copies.map((c) => bounds(c).minX)).toEqual([40, 60]); // group is 30 wide, plus a 10 gap
  });
  it('gives the copies new ids and names, sits them above the rest, unlocked', () => {
    const objs = [box('a', 20, 20, 10, 10, { z_index: 7, locked: true }), box('z', 200, 150, 10, 10, { z_index: 12 })];
    const plan = planArray(objs, ['a'], { rows: 1, cols: 3, gapX: 2, gapY: 2 }, BED, newId);
    expect(new Set(plan.copies.map((c) => c.id)).size).toBe(2);
    expect(plan.copies.map((c) => c.name)).toEqual(['a (1,2)', 'a (1,3)']);
    expect(plan.copies.map((c) => c.z_index)).toEqual([13, 14]);
    expect(plan.copies.every((c) => !c.locked)).toBe(true);
    expect(plan.copies.every((c) => c.layer_id === null)).toBe(true);
  });
  it('shares the shape data with the original instead of copying it', () => {
    const plan = planArray([src], ['a'], { rows: 1, cols: 2, gapX: 1, gapY: 1 }, BED, newId);
    expect(plan.copies[0]?.kind === src.kind).toBe(true);
  });
  it('reports the box around the whole array', () => {
    const plan = planArray([src], ['a'], { rows: 2, cols: 3, gapX: 5, gapY: 5 }, BED, newId);
    expect(plan.bounds).toEqual({ minX: 20, minY: 20, maxX: 20 + 3 * 10 + 2 * 5, maxY: 20 + 2 * 10 + 5 });
  });
  it('warns when the array runs off the bed and not when it fits', () => {
    expect(planArray([src], ['a'], { rows: 1, cols: 40, gapX: 5, gapY: 0 }, BED, newId).warnings[0]).toMatch(/does not fit/);
    expect(planArray([src], ['a'], { rows: 2, cols: 3, gapX: 5, gapY: 5 }, BED, newId).warnings).toEqual([]);
  });
  it('returns the reasons and no copies when the settings are wrong or nothing is selected', () => {
    const bad = planArray([src], ['a'], { rows: 0, cols: 3, gapX: 5, gapY: 5 }, BED, newId);
    expect(bad.copies).toEqual([]);
    expect(bad.errors).toHaveLength(1);
    const none = planArray([src], [], { rows: 2, cols: 2, gapX: 5, gapY: 5 }, BED, newId);
    expect(none.errors).toEqual(['Select something first.']);
  });
  it('does not change the objects it was given', () => {
    const before = JSON.stringify([src]);
    planArray([src], ['a'], { rows: 3, cols: 3, gapX: 5, gapY: 5 }, BED, newId);
    expect(JSON.stringify([src])).toBe(before);
  });
  it('copies a rotated object with its rotation intact', () => {
    const turned = { ...box('r', 0, 0, 10, 10), transform: chain(rotation(30), translation(50, 50)) };
    const plan = planArray([turned], ['r'], { rows: 1, cols: 2, gapX: 5, gapY: 0 }, BED, newId);
    const t = plan.copies[0]?.transform as Transform2D;
    expect(Math.abs(t.a - turned.transform.a) < 1e-12 && Math.abs(t.b - turned.transform.b) < 1e-12).toBe(true);
  });
});
