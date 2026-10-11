import { describe, expect, it } from 'vitest';
import {
  BOOLEAN_OPS,
  booleanChoices,
  booleanHint,
  chosenBase,
  circularStep,
  circularSummary,
  emptyResultMessage,
  failure,
  hasLoosePaths,
  offsetName,
  planBoolean,
  planBorder,
  planCircularArray,
  planOffset,
  resultObject,
  validateCircularOptions,
  validateOffset,
  worldShapePaths,
  type CircularOptions,
} from '@/lib/shapeOps';
import { decompose, translation, worldBounds } from '@/lib/transform';
import type { Path2D, Transform2D, WorkspaceObject } from '@/types/domain';

const square = (x: number, y: number, s: number, closed = true): Path2D => ({
  points: [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ],
  closed,
});

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

const at = (t: Transform2D) => (o: WorkspaceObject): WorkspaceObject => ({ ...o, transform: t });
const centre = (o: WorkspaceObject): [number, number] => {
  const b = worldBounds(o);
  if (!b) throw new Error('no bounds');
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
};
const bed = { width: 300, height: 300 };

describe('worldShapePaths and hasLoosePaths', () => {
  it('applies the transform and keeps only closed shapes', () => {
    const o = at(translation(100, 50))(vec('a', [square(0, 0, 10), square(20, 0, 5, false)]));
    const paths = worldShapePaths(o);
    expect(paths).toHaveLength(1);
    expect(paths[0]?.points[0]).toEqual({ x: 100, y: 50 });
    expect(paths[0]?.closed).toBe(true);
    expect(hasLoosePaths(o)).toBe(true);
    expect(hasLoosePaths(vec('b', [square(0, 0, 5)]))).toBe(false);
  });
  it('gives nothing for pictures, and a path of two points is not a shape', () => {
    expect(worldShapePaths(picture('p'))).toEqual([]);
    expect(hasLoosePaths(picture('p'))).toBe(false);
    const tiny: Path2D = { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: true };
    expect(worldShapePaths(vec('t', [tiny]))).toEqual([]);
    expect(hasLoosePaths(vec('t', [tiny]))).toBe(true);
  });
});

describe('planBoolean', () => {
  const a = vec('A', [square(0, 0, 10)], { z_index: 2, layer_id: 'LA' });
  const b = vec('B', [square(5, 5, 10)], { z_index: 1, layer_id: 'LB' });
  const c = vec('C', [square(50, 50, 10)], { z_index: 3 });
  it('puts the shape furthest back first by default and takes its layer and name', () => {
    const plan = planBoolean([a, b, c], ['A', 'B', 'C'], 'subtract');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.baseName).toBe('B');
    expect(plan.layerId).toBe('LB');
    expect(plan.otherNames).toEqual(['A', 'C']);
    expect(plan.sourceIds).toEqual(['A', 'B', 'C']);
    expect(plan.shapes).toHaveLength(3);
    expect(plan.shapes[0]?.[0]?.points[0]).toEqual({ x: 5, y: 5 });
    expect(plan.shapes[1]?.[0]?.points[0]).toEqual({ x: 0, y: 0 });
    expect(plan.shapes[2]?.[0]?.points[0]).toEqual({ x: 50, y: 50 });
  });
  it('uses the shape you pick as the base, and the others follow back to front', () => {
    const plan = planBoolean([a, b, c], ['A', 'B', 'C'], 'subtract', 'C');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.baseName).toBe('C');
    expect(plan.layerId).toBe('L1');
    expect(plan.otherNames).toEqual(['B', 'A']);
    expect(plan.shapes[0]?.[0]?.points[0]).toEqual({ x: 50, y: 50 });
    expect(plan.shapes[1]?.[0]?.points[0]).toEqual({ x: 5, y: 5 });
    expect(plan.shapes[2]?.[0]?.points[0]).toEqual({ x: 0, y: 0 });
    // Every selected shape is still replaced by the result.
    expect(plan.sourceIds).toEqual(['A', 'B', 'C']);
  });
  it('picking the shape in front makes it the base, and its layer is the one used', () => {
    const plan = planBoolean([a, b], ['A', 'B'], 'subtract', 'A');
    expect(plan.ok && plan.baseName).toBe('A');
    expect(plan.ok && plan.layerId).toBe('LA');
    expect(plan.ok && plan.otherNames).toEqual(['B']);
  });
  it('falls back to the shape furthest back when the picked shape is not selected or does not exist', () => {
    const notSelected = planBoolean([a, b, c], ['A', 'B'], 'subtract', 'C');
    expect(notSelected.ok && notSelected.baseName).toBe('B');
    const unknown = planBoolean([a, b], ['A', 'B'], 'subtract', 'nope');
    expect(unknown.ok && unknown.baseName).toBe('B');
    const none = planBoolean([a, b], ['A', 'B'], 'subtract', null);
    expect(none.ok && none.baseName).toBe('B');
  });
  it('breaks a tie by the order in the project', () => {
    const x = vec('X', [square(0, 0, 4)]);
    const y = vec('Y', [square(1, 1, 4)]);
    const plan = planBoolean([y, x], ['X', 'Y'], 'union');
    expect(plan.ok && plan.baseName).toBe('Y');
  });
  it('sends world positions, not the local ones', () => {
    const moved = at(translation(100, 0))(vec('M', [square(0, 0, 10)], { z_index: 0 }));
    const plan = planBoolean([moved, b], ['M', 'B'], 'union');
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.shapes[0]?.[0]?.points[0]).toEqual({ x: 100, y: 0 });
  });
  it('needs two or more shapes', () => {
    for (const ids of [[], ['A']]) {
      const plan = planBoolean([a, b], ids, 'union');
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.message).toContain('two or more');
    }
  });
  it('refuses pictures, locked shapes and open lines, and names them', () => {
    const p = planBoolean([a, picture('P')], ['A', 'P'], 'union');
    expect(p.ok === false && p.message).toBe('Pictures cannot be combined: "P".');
    const l = planBoolean([a, { ...b, locked: true }], ['A', 'B'], 'union');
    expect(l.ok === false && l.message).toBe('Unlock "B" first: locked shapes are not changed.');
    const open = vec('Line', [square(0, 0, 5, false)]);
    const o = planBoolean([a, open], ['A', 'Line'], 'union');
    expect(o.ok === false && o.message).toBe('"Line" has open lines. Only closed shapes can be combined.');
    const mixed = vec('Mix', [square(0, 0, 5), square(9, 9, 2, false)]);
    const m = planBoolean([a, mixed], ['A', 'Mix'], 'union');
    expect(m.ok).toBe(false);
    const two = planBoolean([vec('L1', [square(0, 0, 5, false)]), vec('L2', [square(0, 0, 5, false)])], ['L1', 'L2'], 'union');
    expect(two.ok === false && two.message).toContain('"L1", "L2" have open lines');
  });
  it('ignores objects that are not selected and does not change its inputs', () => {
    const before = JSON.stringify([a, b, c]);
    const plan = planBoolean([a, b, c], ['A', 'B'], 'intersect', 'A');
    expect(plan.ok && plan.sourceIds).toEqual(['A', 'B']);
    expect(JSON.stringify([a, b, c])).toBe(before);
  });
  it('has an empty-result message for every operation', () => {
    for (const op of BOOLEAN_OPS) expect(emptyResultMessage(op)).toContain('Nothing is left');
    expect(BOOLEAN_OPS).toEqual(['union', 'subtract', 'intersect', 'exclude']);
  });
});

describe('choosing what Subtract cuts from', () => {
  // A big board at the back and a small circle-like shape in front, with a 300 x 200 picture far away.
  const board = vec('Board', [square(0, 0, 100)], { z_index: 1 });
  const hole = vec('Hole', [square(10, 10, 20)], { z_index: 2 });
  const scaled = { ...vec('Scaled', [square(0, 0, 10)], { z_index: 3 }), transform: { a: 2, b: 0, c: 0, d: 3, e: 40, f: 40 } };
  it('lists the selected closed shapes back to front with their size in the label', () => {
    const choices = booleanChoices([hole, board, scaled, picture('P')], ['Hole', 'Board', 'Scaled', 'P']);
    expect(choices.map((c) => c.id)).toEqual(['Board', 'Hole', 'Scaled']);
    expect(choices[0]?.label).toBe('Board (100 \u00d7 100 mm)');
    expect(choices[1]?.label).toBe('Hole (20 \u00d7 20 mm)');
    // The size is the size on the bed (the transform applied), not the size of the paths.
    expect(choices[2]?.label).toBe('Scaled (20 \u00d7 30 mm)');
  });
  it('leaves out unselected shapes, pictures and open lines', () => {
    const line = vec('Line', [square(0, 0, 5, false)]);
    expect(booleanChoices([board, hole, line, picture('P')], ['Board', 'Line', 'P']).map((c) => c.id)).toEqual(['Board']);
    expect(booleanChoices([board, hole], [])).toEqual([]);
  });
  it('tells two shapes with the same name apart by their size', () => {
    const one = vec('Rectangle', [square(0, 0, 10)], { id: 'r1', z_index: 1 });
    const two = vec('Rectangle', [square(0, 0, 50)], { id: 'r2', z_index: 2 });
    const labels = booleanChoices([one, two], ['r1', 'r2']).map((c) => c.label);
    expect(labels).toEqual(['Rectangle (10 \u00d7 10 mm)', 'Rectangle (50 \u00d7 50 mm)']);
  });
  it('keeps the pick while it is selected and otherwise falls back to the shape furthest back', () => {
    const choices = booleanChoices([board, hole], ['Board', 'Hole']);
    expect(chosenBase(choices, 'Hole')).toBe('Hole');
    expect(chosenBase(choices, 'Board')).toBe('Board');
    expect(chosenBase(choices, 'Gone')).toBe('Board');
    expect(chosenBase(choices, null)).toBe('Board');
    expect(chosenBase([], 'Hole')).toBeNull();
  });
  it('says exactly what Subtract will do, for the shape that is picked', () => {
    expect(booleanHint([board, hole], ['Board', 'Hole'])).toBe('Subtract cuts "Hole" out of "Board". The result goes on the layer of "Board".');
    expect(booleanHint([board, hole], ['Board', 'Hole'], 'Hole')).toBe('Subtract cuts "Board" out of "Hole". The result goes on the layer of "Hole".');
    expect(booleanHint([board, hole, scaled], ['Board', 'Hole', 'Scaled'], 'Hole')).toBe(
      'Subtract cuts "Board", "Scaled" out of "Hole". The result goes on the layer of "Hole".',
    );
    expect(booleanHint([board, hole], ['Board'])).toContain('two or more');
  });
});

describe('resultObject', () => {
  it('moves the paths to the origin and lets the transform put them back', () => {
    const o = resultObject([square(100, 50, 10), square(130, 60, 5)], { name: 'Union', layerId: 'L9', zIndex: 7 }, () => 'new-id');
    expect(o).not.toBeNull();
    if (!o) return;
    expect(o.id).toBe('new-id');
    expect(o.name).toBe('Union');
    expect(o.layer_id).toBe('L9');
    expect(o.z_index).toBe(7);
    expect(o.visible).toBe(true);
    expect(o.locked).toBe(false);
    expect(o.transform).toEqual(translation(100, 50));
    if (o.kind.type !== 'vector') throw new Error('not a vector');
    expect(o.kind.paths[0]?.points[0]).toEqual({ x: 0, y: 0 });
    expect(o.kind.paths[1]?.points[0]).toEqual({ x: 30, y: 10 });
    expect(o.kind.paths.every((p) => p.closed)).toBe(true);
    expect(o.kind.source).toBeUndefined();
    const b = worldBounds(o);
    expect(b).toEqual({ minX: 100, minY: 50, maxX: 135, maxY: 65 });
  });
  it('rounds the local coordinates to a thousandth of a millimetre', () => {
    const o = resultObject([square(10.00049, 20.1234567, 5)], { name: 'R', layerId: null, zIndex: 0 }, () => 'x');
    if (!o || o.kind.type !== 'vector') throw new Error('no object');
    expect(o.kind.paths[0]?.points[1]).toEqual({ x: 5, y: 0 });
    expect(o.layer_id).toBeNull();
  });
  it('makes nothing from nothing, open lines or tiny paths', () => {
    const spec = { name: 'N', layerId: null, zIndex: 0 };
    expect(resultObject([], spec)).toBeNull();
    expect(resultObject([square(0, 0, 5, false)], spec)).toBeNull();
    expect(resultObject([{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: true }], spec)).toBeNull();
  });
});

describe('planOffset', () => {
  it('offsets each selected shape on its own and lists what it leaves out', () => {
    const a = vec('A', [square(0, 0, 10)]);
    const line = vec('Line', [square(0, 0, 5, false)]);
    const plan = planOffset([a, line, picture('P')], ['A', 'Line', 'P']);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.items.map((i) => i.id)).toEqual(['A']);
    expect(plan.skipped).toEqual(['Line', 'P']);
    expect(plan.items[0]).toMatchObject({ name: 'A', layerId: 'L1', hasLoose: false, locked: false });
  });
  it('keeps the closed paths of an object that also has open lines, and says so', () => {
    const mixed = vec('Mix', [square(0, 0, 5), square(9, 9, 2, false)], { locked: true });
    const plan = planOffset([mixed], ['Mix']);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.items[0]?.paths).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ hasLoose: true, locked: true });
  });
  it('gives a message when there is nothing to offset', () => {
    const none = planOffset([vec('A', [square(0, 0, 5)])], []);
    expect(none.ok === false && none.message).toBe('Select a shape to offset.');
    const line = planOffset([vec('Line', [square(0, 0, 5, false)])], ['Line']);
    expect(line.ok === false && line.message).toBe('"Line" is not a closed shape, so there is nothing to offset.');
    const two = planOffset([picture('P'), picture('Q')], ['P', 'Q']);
    expect(two.ok === false && two.message).toBe('"P", "Q" are not a closed shape, so there is nothing to offset.');
  });
  it('names the result and checks the distance', () => {
    expect(offsetName('Square', 2)).toBe('Square (offset +2 mm)');
    expect(offsetName('Square', -0.5)).toBe('Square (offset -0.5 mm)');
    expect(offsetName('Square', 1.23456)).toBe('Square (offset +1.235 mm)');
    expect(offsetName('Square', 3, true)).toBe('Square (border +3 mm)');
    expect(offsetName('Square', -1.5, true)).toBe('Square (border -1.5 mm)');
    expect(validateOffset(2)).toEqual([]);
    expect(validateOffset(1000)).toEqual([]);
    for (const bad of [0, -1, Number.NaN, Infinity]) expect(validateOffset(bad)).toHaveLength(1);
    expect(validateOffset(1000.5)[0]).toContain('at most 1000');
  });
});

describe('planBorder: the band between the old outline and the new one', () => {
  const old = [square(10, 10, 20)];
  const bigger = [square(7, 7, 26)];
  const smaller = [square(13, 13, 14)];
  it('growing: the new shape minus the old one', () => {
    const plan = planBorder(old, bigger, 3);
    expect(plan.kind).toBe('subtract');
    if (plan.kind !== 'subtract') return;
    expect(plan.shapes).toEqual([bigger, old]);
  });
  it('shrinking: the old shape minus the new one', () => {
    const plan = planBorder(old, smaller, -3);
    expect(plan.kind).toBe('subtract');
    if (plan.kind !== 'subtract') return;
    expect(plan.shapes).toEqual([old, smaller]);
  });
  it('a shape shrunk away has no inner outline, so its border is the whole shape', () => {
    const plan = planBorder(old, [], -30);
    expect(plan).toEqual({ kind: 'direct', paths: old });
  });
  it('nothing came back from growing: there is no border', () => {
    expect(planBorder(old, [], 3)).toEqual({ kind: 'direct', paths: [] });
  });
  it('does not change what it is given', () => {
    const before = JSON.stringify([old, bigger]);
    planBorder(old, bigger, 3);
    expect(JSON.stringify([old, bigger])).toBe(before);
  });
});

describe('circular array', () => {
  // A 10 mm square from (40, 0): its middle is (45, 5). Going round (5, 5), 40 mm away.
  const base = at(translation(40, 0))(vec('S', [square(0, 0, 10)]));
  const opts = (over: Partial<CircularOptions> = {}): CircularOptions => ({ count: 4, angleDeg: 360, centerX: 5, centerY: 5, rotateCopies: false, ...over });
  const ids = () => {
    let n = 0;
    return () => `id${++n}`;
  };

  it('shares a full circle out evenly and an arc from the first piece to the last', () => {
    expect(circularStep(4, 360)).toBe(90);
    expect(circularStep(6, 360)).toBe(60);
    expect(circularStep(3, 180)).toBe(90);
    expect(circularStep(2, 90)).toBe(90);
  });
  it('puts the copies clockwise on screen at the same distance from the centre', () => {
    const plan = planCircularArray([base], ['S'], opts(), bed, ids());
    expect(plan.errors).toEqual([]);
    expect(plan.copies).toHaveLength(3);
    expect(plan.radiusMm).toBeCloseTo(40, 9);
    expect(plan.stepDeg).toBe(90);
    const [c1, c2, c3] = plan.copies.map(centre);
    expect(c1?.[0]).toBeCloseTo(5, 6);
    expect(c1?.[1]).toBeCloseTo(45, 6);
    expect(c2?.[0]).toBeCloseTo(-35, 6);
    expect(c2?.[1]).toBeCloseTo(5, 6);
    expect(c3?.[0]).toBeCloseTo(5, 6);
    expect(c3?.[1]).toBeCloseTo(-35, 6);
  });
  it('keeps the way each copy faces unless asked to turn them', () => {
    const still = planCircularArray([base], ['S'], opts(), bed, ids());
    for (const c of still.copies) expect(decompose(c.transform).rotationDeg).toBeCloseTo(0, 6);
    const turned = planCircularArray([base], ['S'], opts({ rotateCopies: true }), bed, ids());
    const turns = turned.copies.map((c) => ((Math.round(decompose(c.transform).rotationDeg) % 360) + 360) % 360);
    expect(turns).toEqual([90, 180, 270]);
    // Turning does not move the middle of each copy.
    const [c1] = turned.copies.map(centre);
    expect(c1?.[0]).toBeCloseTo(5, 6);
    expect(c1?.[1]).toBeCloseTo(45, 6);
  });
  it('goes only part of the way round when the angle is less than 360', () => {
    const plan = planCircularArray([base], ['S'], opts({ count: 3, angleDeg: 180 }), bed, ids());
    expect(plan.stepDeg).toBe(90);
    const [c1, c2] = plan.copies.map(centre);
    expect(c1?.[1]).toBeCloseTo(45, 6);
    expect(c2?.[0]).toBeCloseTo(-35, 6);
    expect(c2?.[1]).toBeCloseTo(5, 6);
  });
  it('repeats a whole selection as one group, and unlocks the copies', () => {
    const second = at(translation(60, 0))(vec('T', [square(0, 0, 10)], { locked: true, z_index: 4 }));
    const first = { ...base, z_index: 1 };
    const plan = planCircularArray([first, second], ['S', 'T'], opts({ count: 3 }), bed, ids());
    expect(plan.copies).toHaveLength(4);
    expect(plan.copies.map((c) => c.name)).toEqual(['S (copy 1)', 'T (copy 1)', 'S (copy 2)', 'T (copy 2)']);
    expect(plan.copies.every((c) => !c.locked)).toBe(true);
    expect(plan.copies.map((c) => c.z_index)).toEqual([5, 6, 7, 8]);
    expect(new Set(plan.copies.map((c) => c.id)).size).toBe(4);
    // The group's middle (55, 5) goes round (5, 5): 50 mm away, a third of the way round is 120 degrees.
    expect(plan.radiusMm).toBeCloseTo(50, 9);
    expect(plan.stepDeg).toBeCloseTo(120, 9);
  });
  it('shares the shape of the originals and does not change them', () => {
    const before = JSON.stringify(base);
    const plan = planCircularArray([base], ['S'], opts(), bed, ids());
    expect(plan.copies.every((c) => c.kind === base.kind)).toBe(true);
    expect(JSON.stringify(base)).toBe(before);
  });
  it('refuses a centre in the middle of the selection unless the copies are turned', () => {
    const middle = opts({ centerX: 45, centerY: 5 });
    const refused = planCircularArray([base], ['S'], middle, bed, ids());
    expect(refused.copies).toEqual([]);
    expect(refused.errors[0]).toContain('on top of each other');
    const fan = planCircularArray([base], ['S'], { ...middle, rotateCopies: true }, bed, ids());
    expect(fan.errors).toEqual([]);
    expect(fan.copies).toHaveLength(3);
  });
  it('checks every setting', () => {
    expect(validateCircularOptions(opts(), 1)).toEqual([]);
    expect(validateCircularOptions(opts({ count: 1 }), 1)[0]).toContain('from 2 to 360');
    expect(validateCircularOptions(opts({ count: 361 }), 1)).toHaveLength(1);
    expect(validateCircularOptions(opts({ count: 2.5 }), 1)).toHaveLength(1);
    expect(validateCircularOptions(opts({ angleDeg: 0 }), 1)[0]).toContain('angle');
    expect(validateCircularOptions(opts({ angleDeg: 361 }), 1)).toHaveLength(1);
    expect(validateCircularOptions(opts({ angleDeg: Number.NaN }), 1)).toHaveLength(1);
    expect(validateCircularOptions(opts({ centerX: Number.NaN }), 1)[0]).toContain('centre');
    expect(validateCircularOptions(opts({ count: 200 }), 3)[0]).toContain('597 copies');
    expect(planCircularArray([base], [], opts(), bed).errors).toEqual(['Select something first.']);
  });
  it('warns when the pattern reaches outside the bed', () => {
    const plan = planCircularArray([base], ['S'], opts(), { width: 100, height: 100 }, ids());
    expect(plan.warnings).toEqual(['The pattern reaches outside the 100 \u00d7 100 mm bed.']);
    const fits = planCircularArray([base], ['S'], opts({ centerX: 45, centerY: 45 }), bed, ids());
    expect(fits.warnings).toEqual([]);
  });
  it('describes what it will make', () => {
    const plan = planCircularArray([base], ['S'], opts(), bed, ids());
    expect(circularSummary(plan, 1)).toBe(
      'Makes 3 new copies, 90\u00b0 apart, on a circle of radius 40 mm. The pattern reaches outside the 300 \u00d7 300 mm bed.',
    );
    const bad = planCircularArray([base], ['S'], opts({ count: 1 }), bed);
    expect(circularSummary(bad, 1)).toContain('from 2 to 360');
    const two = planCircularArray([base, vec('T', [square(0, 0, 4)])], ['S', 'T'], opts({ centerX: 150, centerY: 150 }), bed, ids());
    expect(circularSummary(two, 2)).toContain('Makes 6 new copies (3 of each of the 2 objects), 90\u00b0 apart');
  });
});

describe('failure', () => {
  it('uses the text a command sent back', () => {
    expect(failure('The shape operation failed: x')).toBe('The shape operation failed: x');
    expect(failure(new Error('boom'))).toBe('boom');
    expect(failure(42)).toBe('Something went wrong.');
    expect(failure('')).toBe('Something went wrong.');
  });
});
