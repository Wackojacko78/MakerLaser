import { describe, expect, it } from 'vitest';
import { handleOf, makeCurves, makeStraight, moveHandle, pickedMode, segmentsOfPick, setNodeMode } from '@/lib/nodeCurves';
import { flattenNodes, kindWithNodes, moveNodes, nodeAccess, nodesFromPaths, nodesMatchPaths, type NodeRef } from '@/lib/nodePath';
import type { NodeMode, NodePath, Path2D } from '@/types/domain';

function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v as object)) freeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}
const square = (s = 10): Path2D => ({ closed: true, points: [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }] });
/** Three nodes in a row, open: A (0,0), B (10,0), C (20,0). */
const row = (b: Partial<NodePath['nodes'][number]> = {}): NodePath => ({ closed: false, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0, ...b }, { x: 20, y: 0 }] });
const at = (path: number, node: number): NodeRef => ({ path, node });
const node = (nodes: readonly NodePath[], p: number, n: number) => nodes[p]?.nodes[n];

describe('setNodeMode: smooth and symmetric', () => {
  const sq = nodesFromPaths([square(10)]);
  it('makes handles on a corner that has none, along the line between its two neighbours, a third of the way to each', () => {
    const smooth = setNodeMode(freeze(sq), [at(0, 1)], 'smooth');
    // node 1 is (10, 0); its neighbours are (0, 0) and (10, 10): across is (10, 10), so the tangent is 45 degrees
    expect(node(smooth, 0, 1)).toEqual({ x: 10, y: 0, in: { x: -2.357, y: -2.357 }, out: { x: 2.357, y: 2.357 }, mode: 'smooth' });
    const sym = setNodeMode(sq, [at(0, 1)], 'symmetric');
    expect(node(sym, 0, 1)).toEqual({ x: 10, y: 0, in: { x: -2.357, y: -2.357 }, out: { x: 2.357, y: 2.357 }, mode: 'symmetric' });
    // nothing else changed
    expect(smooth[0]?.nodes[0]).toBe(sq[0]?.nodes[0]);
    expect(smooth[0]?.nodes[2]).toBe(sq[0]?.nodes[2]);
  });
  it('uses the neighbours on the other side of the start of a closed outline', () => {
    const r = setNodeMode(sq, [at(0, 0)], 'smooth');
    // node 0 is (0, 0); its neighbours are (0, 10) before it and (10, 0) after it, so the tangent runs up and to the right
    expect(node(r, 0, 0)).toEqual({ x: 0, y: 0, in: { x: -2.357, y: 2.357 }, out: { x: 2.357, y: -2.357 }, mode: 'smooth' });
  });
  it('makes handles of different lengths when the neighbours are at different distances, and equal ones for symmetric', () => {
    const p = nodesFromPaths([{ closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 40, y: 0 }] }]);
    const s = setNodeMode(p, [at(0, 1)], 'smooth');
    expect(node(s, 0, 1)).toMatchObject({ in: { x: -3.333, y: 0 }, out: { x: 10, y: 0 } });
    const y = setNodeMode(p, [at(0, 1)], 'symmetric');
    expect(node(y, 0, 1)).toMatchObject({ in: { x: -6.667, y: 0 }, out: { x: 6.667, y: 0 } });
  });
  it('the end of an open line has only one side, so only its mode changes', () => {
    const p = [row()];
    const r = setNodeMode(p, [at(0, 0)], 'smooth');
    expect(node(r, 0, 0)).toEqual({ x: 0, y: 0, mode: 'smooth' });
  });
  it('with one handle it makes the other, opposite and a third of the way to the neighbour (or as long, for symmetric)', () => {
    const r = [row({ out: { x: 0, y: 6 } })];
    expect(node(setNodeMode(r, [at(0, 1)], 'smooth'), 0, 1)).toMatchObject({ in: { x: 0, y: -3.333 }, out: { x: 0, y: 6 } });
    expect(node(setNodeMode(r, [at(0, 1)], 'symmetric'), 0, 1)).toMatchObject({ in: { x: 0, y: -6 }, out: { x: 0, y: 6 } });
    const i = [row({ in: { x: -4, y: 0 } })];
    expect(node(setNodeMode(i, [at(0, 1)], 'smooth'), 0, 1)).toMatchObject({ in: { x: -4, y: 0 }, out: { x: 3.333, y: 0 } });
    expect(node(setNodeMode(i, [at(0, 1)], 'symmetric'), 0, 1)).toMatchObject({ in: { x: -4, y: 0 }, out: { x: 4, y: 0 } });
  });
  it('with two handles it lines them up through the middle of their two directions, keeping their lengths (or averaging them)', () => {
    const r = [row({ in: { x: -3, y: 0 }, out: { x: 0, y: 4 } })];
    expect(node(setNodeMode(r, [at(0, 1)], 'smooth'), 0, 1)).toMatchObject({ in: { x: -2.121, y: -2.121 }, out: { x: 2.828, y: 2.828 } });
    expect(node(setNodeMode(r, [at(0, 1)], 'symmetric'), 0, 1)).toMatchObject({ in: { x: -2.475, y: -2.475 }, out: { x: 2.475, y: 2.475 } });
  });
  it('handles that fold straight back on each other are straightened through', () => {
    const r = [row({ in: { x: 3, y: 0 }, out: { x: 3, y: 0 } })];
    expect(node(setNodeMode(r, [at(0, 1)], 'smooth'), 0, 1)).toMatchObject({ in: { x: -3, y: 0 }, out: { x: 3, y: 0 } });
  });
  it('gives back the very same list when the node is already like that', () => {
    const done = [row({ in: { x: -3, y: 0 }, out: { x: 3, y: 0 }, mode: 'smooth' })];
    expect(setNodeMode(done, [at(0, 1)], 'smooth')).toBe(done);
    expect(setNodeMode(sq, [], 'smooth')).toBe(sq);
    expect(setNodeMode(done, [at(9, 9), at(0, 9)], 'smooth')).toBe(done);
  });
  it('does not change what it is given, and keeps the other outlines', () => {
    const two = freeze(nodesFromPaths([square(10), square(4)]));
    const r = setNodeMode(two, [at(0, 1)], 'smooth');
    expect(r[1]).toBe(two[1]);
  });
});

describe('setNodeMode: corner', () => {
  it('keeps the handles and says they are free', () => {
    const r = [row({ in: { x: -3, y: 0 }, out: { x: 3, y: 0 }, mode: 'symmetric' })];
    const c = setNodeMode(r, [at(0, 1)], 'corner');
    expect(node(c, 0, 1)).toEqual({ x: 10, y: 0, in: { x: -3, y: 0 }, out: { x: 3, y: 0 } });
    expect('mode' in (node(c, 0, 1) ?? {})).toBe(false);
  });
  it('a corner that is a corner already is not a change', () => {
    const r = [row()];
    expect(setNodeMode(r, [at(0, 1)], 'corner')).toBe(r);
  });
});

describe('pickedMode', () => {
  const nodes = [row({ mode: 'smooth', in: { x: -1, y: 0 }, out: { x: 1, y: 0 } })];
  it('is none for no pick, the mode they share, or mixed', () => {
    expect(pickedMode(nodes, [])).toBeNull();
    expect(pickedMode(nodes, [at(0, 1)])).toBe('smooth');
    expect(pickedMode(nodes, [at(0, 0), at(0, 2)])).toBe('corner');
    expect(pickedMode(nodes, [at(0, 0), at(0, 1)])).toBe('mixed');
    expect(pickedMode(nodes, [at(5, 5)])).toBeNull();
  });
});

describe('moveHandle', () => {
  const corner = [row({ in: { x: -3, y: 0 }, out: { x: 3, y: 0 } })];
  it('a corner moves just the handle that was dragged', () => {
    const r = moveHandle(freeze(corner), at(0, 1), 'out', { x: 0, y: 8 });
    expect(node(r, 0, 1)).toEqual({ x: 10, y: 0, in: { x: -3, y: 0 }, out: { x: 0, y: 8 } });
  });
  it('a smooth node swings the other handle to the opposite direction and keeps its length', () => {
    const smooth = [row({ in: { x: -3, y: 0 }, out: { x: 3, y: 0 }, mode: 'smooth' })];
    const r = moveHandle(smooth, at(0, 1), 'out', { x: 0, y: 10 });
    expect(node(r, 0, 1)).toEqual({ x: 10, y: 0, in: { x: 0, y: -3 }, out: { x: 0, y: 10 }, mode: 'smooth' });
    const back = moveHandle(smooth, at(0, 1), 'in', { x: -6, y: -8 });
    expect(node(back, 0, 1)).toMatchObject({ in: { x: -6, y: -8 }, out: { x: 1.8, y: 2.4 } });
  });
  it('a symmetric node makes the other handle the mirror image', () => {
    const sym = [row({ in: { x: -3, y: 0 }, out: { x: 3, y: 0 }, mode: 'symmetric' })];
    const r = moveHandle(sym, at(0, 1), 'out', { x: 4, y: 7 });
    expect(node(r, 0, 1)).toMatchObject({ in: { x: -4, y: -7 }, out: { x: 4, y: 7 } });
  });
  it('a smooth node with one handle gets no second one by dragging the first', () => {
    const one = [row({ out: { x: 3, y: 0 }, mode: 'smooth' })];
    const r = moveHandle(one, at(0, 1), 'out', { x: 0, y: 5 });
    expect(node(r, 0, 1)).toEqual({ x: 10, y: 0, out: { x: 0, y: 5 }, mode: 'smooth' });
  });
  it('an offset of nothing takes the handle away and leaves the other one alone', () => {
    const sym = [row({ in: { x: -3, y: 0 }, out: { x: 3, y: 0 }, mode: 'symmetric' })];
    const r = moveHandle(sym, at(0, 1), 'out', { x: 0, y: 0 });
    expect(node(r, 0, 1)).toEqual({ x: 10, y: 0, in: { x: -3, y: 0 }, mode: 'symmetric' });
    expect(handleOf(node(r, 0, 1) as NonNullable<ReturnType<typeof node>>, 'out')).toBeUndefined();
  });
  it('a node marked as a corner is saved without a mode, whatever else is done to it', () => {
    const explicit = [row({ in: { x: -3, y: 0 }, out: { x: 3, y: 0 }, mode: 'corner' })];
    const r = moveHandle(explicit, at(0, 1), 'out', { x: 0, y: 8 });
    expect('mode' in (node(r, 0, 1) ?? {})).toBe(false);
  });
  it('can put a handle on a node that had none', () => {
    const r = moveHandle([row()], at(0, 1), 'in', { x: -2, y: 1 });
    expect(node(r, 0, 1)).toEqual({ x: 10, y: 0, in: { x: -2, y: 1 } });
  });
  it('rounds to a thousandth, and changes nothing when nothing changes', () => {
    const r = moveHandle(corner, at(0, 1), 'out', { x: 3.00001, y: 0.0002 });
    expect(node(r, 0, 1)?.out).toEqual({ x: 3, y: 0 });
    expect(r).toBe(corner);
    expect(moveHandle(corner, at(0, 1), 'out', { x: 3, y: 0 })).toBe(corner);
  });
  it('refuses a node that is not there and an offset that is not a number', () => {
    expect(moveHandle(corner, at(3, 0), 'out', { x: 1, y: 1 })).toBe(corner);
    expect(moveHandle(corner, at(0, 7), 'out', { x: 1, y: 1 })).toBe(corner);
    expect(moveHandle(corner, at(0, 1), 'out', { x: NaN, y: 1 })).toBe(corner);
    expect(moveHandle(corner, at(0, 1), 'in', { x: 1, y: Infinity })).toBe(corner);
  });
  it('bends the outline', () => {
    const r = moveHandle([row()], at(0, 1), 'out', { x: 0, y: 8 });
    const before = flattenNodes([row()])[0]?.points.length ?? 0;
    const after = flattenNodes(r)[0]?.points ?? [];
    expect(after.length).toBeGreaterThan(before);
    expect(after.some((p) => Math.abs(p.y) > 1)).toBe(true);
  });
});

describe('segmentsOfPick', () => {
  const sq = nodesFromPaths([square(10)]);
  it('is every segment with both its ends picked, the closing one included', () => {
    expect(segmentsOfPick(sq, [at(0, 0), at(0, 1)]).segments).toEqual([{ path: 0, segment: 0 }]);
    expect(segmentsOfPick(sq, [at(0, 3), at(0, 0)]).segments).toEqual([{ path: 0, segment: 3 }]);
    expect(segmentsOfPick(sq, [at(0, 0), at(0, 1), at(0, 2)]).segments).toEqual([{ path: 0, segment: 0 }, { path: 0, segment: 1 }]);
    expect(segmentsOfPick(sq, [at(0, 0), at(0, 1), at(0, 2), at(0, 3)]).segments).toHaveLength(4);
  });
  it('is nothing for two nodes that are not neighbours', () => {
    expect(segmentsOfPick(sq, [at(0, 0), at(0, 2)]).segments).toEqual([]);
    expect(segmentsOfPick(sq, []).segments).toEqual([]);
  });
  it('is the segments either side of a node picked alone, and only the one that exists at the end of an open line', () => {
    expect(segmentsOfPick(sq, [at(0, 1)]).segments).toEqual([{ path: 0, segment: 0 }, { path: 0, segment: 1 }]);
    expect(segmentsOfPick(sq, [at(0, 0)]).segments).toEqual([{ path: 0, segment: 3 }, { path: 0, segment: 0 }]);
    const open = [row()];
    expect(segmentsOfPick(open, [at(0, 0)]).segments).toEqual([{ path: 0, segment: 0 }]);
    expect(segmentsOfPick(open, [at(0, 2)]).segments).toEqual([{ path: 0, segment: 1 }]);
    expect(segmentsOfPick(open, [at(0, 1)]).segments).toHaveLength(2);
  });
  it('counts lines and curves', () => {
    const mixed: NodePath[] = [{ closed: false, nodes: [{ x: 0, y: 0, out: { x: 0, y: 3 } }, { x: 10, y: 0 }, { x: 20, y: 0 }] }];
    expect(segmentsOfPick(mixed, [at(0, 1)])).toMatchObject({ curves: 1, lines: 1 });
    expect(segmentsOfPick(mixed, [at(0, 0), at(0, 1)])).toMatchObject({ curves: 1, lines: 0 });
    expect(segmentsOfPick(mixed, [at(0, 1), at(0, 2)])).toMatchObject({ curves: 0, lines: 1 });
  });
  it('keeps the outlines apart, and a node that is not there gives nothing', () => {
    const two = nodesFromPaths([square(10), square(4)]);
    expect(segmentsOfPick(two, [at(1, 0), at(1, 1)]).segments).toEqual([{ path: 1, segment: 0 }]);
    expect(segmentsOfPick(two, [at(0, 0), at(1, 1)]).segments).toEqual([]);
    expect(segmentsOfPick(two, [at(7, 0)]).segments).toEqual([]);
  });
});

describe('makeCurves and makeStraight', () => {
  const sq = nodesFromPaths([square(10)]);
  it('puts handles a third of the way along a line, on the line, so the shape does not change', () => {
    const r = makeCurves(freeze(sq), [{ path: 0, segment: 0 }]);
    expect(node(r, 0, 0)).toEqual({ x: 0, y: 0, out: { x: 3.333, y: 0 } });
    expect(node(r, 0, 1)).toEqual({ x: 10, y: 0, in: { x: -3.333, y: 0 } });
    expect(flattenNodes(r)).toEqual(flattenNodes(sq));
  });
  it('can do several at once, even the ones that share a node', () => {
    const r = makeCurves(sq, [{ path: 0, segment: 0 }, { path: 0, segment: 1 }]);
    expect(node(r, 0, 1)).toEqual({ x: 10, y: 0, in: { x: -3.333, y: 0 }, out: { x: 0, y: 3.333 } });
    expect(flattenNodes(r)).toEqual(flattenNodes(sq));
  });
  it('does the closing segment', () => {
    const r = makeCurves(sq, [{ path: 0, segment: 3 }]);
    expect(node(r, 0, 3)).toEqual({ x: 0, y: 10, out: { x: 0, y: -3.333 } });
    expect(node(r, 0, 0)).toEqual({ x: 0, y: 0, in: { x: 0, y: 3.333 } });
  });
  it('leaves curves alone, skips lines with no length, and gives the same list back when nothing changes', () => {
    const curved = makeCurves(sq, [{ path: 0, segment: 0 }]);
    expect(makeCurves(curved, [{ path: 0, segment: 0 }])).toBe(curved);
    const zero = nodesFromPaths([{ closed: false, points: [{ x: 1, y: 1 }, { x: 1, y: 1 }] }]);
    expect(makeCurves(zero, [{ path: 0, segment: 0 }])).toBe(zero);
    expect(makeCurves(sq, [])).toBe(sq);
    expect(makeCurves(sq, [{ path: 5, segment: 0 }, { path: 0, segment: 9 }, { path: 0, segment: -1 }])).toBe(sq);
  });
  it('a smooth node whose other handle no longer lines up becomes a corner, and one that still does stays smooth', () => {
    const smooth: NodePath[] = [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0, out: { x: 0, y: 3 }, mode: 'smooth' }, { x: 10, y: 10 }] }];
    // the new handle on node 1 points back along the line to node 0, across its other handle
    expect(node(makeCurves(smooth, [{ path: 0, segment: 0 }]), 0, 1)).toEqual({ x: 10, y: 0, in: { x: -3.333, y: 0 }, out: { x: 0, y: 3 } });
    const lined: NodePath[] = [{ closed: false, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0, in: { x: 0, y: -3 }, mode: 'smooth' }, { x: 10, y: 10 }] }];
    // the new out handle on node 1 points down the line to node 2, opposite its in handle
    expect(node(makeCurves(lined, [{ path: 0, segment: 1 }]), 0, 1)).toEqual({ x: 10, y: 0, in: { x: 0, y: -3 }, out: { x: 0, y: 3.333 }, mode: 'smooth' });
  });
  it('makeStraight takes the handles of the curve away, and is the undoing of makeCurves', () => {
    const curved = makeCurves(sq, [{ path: 0, segment: 0 }, { path: 0, segment: 2 }]);
    const back = makeStraight(freeze(curved), [{ path: 0, segment: 0 }, { path: 0, segment: 2 }]);
    expect(back).toEqual(sq);
  });
  it('makeStraight leaves lines alone and gives the same list back when nothing changes', () => {
    expect(makeStraight(sq, [{ path: 0, segment: 0 }])).toBe(sq);
    expect(makeStraight(sq, [])).toBe(sq);
    expect(makeStraight(sq, [{ path: 9, segment: 0 }, { path: 0, segment: 40 }])).toBe(sq);
  });
  it('makeStraight only takes the handles of the segment it is asked about', () => {
    const both = makeCurves(sq, [{ path: 0, segment: 0 }, { path: 0, segment: 1 }]);
    const one = makeStraight(both, [{ path: 0, segment: 0 }]);
    expect(node(one, 0, 1)).toEqual({ x: 10, y: 0, out: { x: 0, y: 3.333 } });
    expect(node(one, 0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('long runs of curve edits', () => {
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const collinearOpposite = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const cross = a.x * b.y - a.y * b.x;
    const dot = a.x * b.x + a.y * b.y;
    return dot < 0 && Math.abs(cross) <= 0.01 * Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  };
  it('never break the rules, never change their input, and keep smooth nodes smooth and symmetric nodes symmetric', () => {
    for (let seed = 1; seed <= 80; seed++) {
      const rand = rng(seed);
      let nodes: readonly NodePath[] = [...nodesFromPaths([square(30), { closed: false, points: [{ x: 50, y: 0 }, { x: 70, y: 20 }, { x: 90, y: 0 }, { x: 110, y: 25 }] }])];
      for (let step = 0; step < 20; step++) {
        const frozen = freeze(JSON.parse(JSON.stringify(nodes)) as NodePath[]);
        const path = Math.floor(rand() * frozen.length);
        const count = frozen[path]?.nodes.length ?? 1;
        const pick = (): NodeRef => ({ path, node: Math.floor(rand() * count) });
        const choice = rand();
        if (choice < 0.25) {
          const mode = (['corner', 'smooth', 'symmetric'] as const)[Math.floor(rand() * 3)] as NodeMode;
          nodes = setNodeMode(frozen, [pick(), pick()], mode);
        } else if (choice < 0.55) {
          const angle = rand() * 2 * Math.PI;
          const size = 2 + rand() * 18;
          nodes = moveHandle(frozen, pick(), rand() < 0.5 ? 'in' : 'out', { x: Math.cos(angle) * size, y: Math.sin(angle) * size });
        } else if (choice < 0.75) {
          const picked = [pick(), pick()];
          nodes = makeCurves(frozen, segmentsOfPick(frozen, picked).segments);
        } else if (choice < 0.9) {
          const picked = [pick(), pick()];
          nodes = makeStraight(frozen, segmentsOfPick(frozen, picked).segments);
        } else {
          nodes = moveNodes(frozen, [pick()], (rand() - 0.5) * 10, (rand() - 0.5) * 10);
        }
        for (const np of nodes) {
          for (const n of np.nodes) {
            expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
            for (const h of [n.in, n.out]) if (h) expect(Number.isFinite(h.x) && Number.isFinite(h.y)).toBe(true);
            const hin = handleOf(n, 'in');
            const hout = handleOf(n, 'out');
            if (hin && hout && n.mode) {
              expect(collinearOpposite(hin, hout)).toBe(true);
              if (n.mode === 'symmetric') expect(Math.abs(Math.hypot(hin.x, hin.y) - Math.hypot(hout.x, hout.y))).toBeLessThan(0.002);
            }
          }
        }
        const kind = kindWithNodes({ type: 'vector', paths: [] }, nodes);
        expect(nodesMatchPaths(kind.nodes ?? [], kind.paths)).toBe(true);
        const access = nodeAccess(kind);
        expect(access.ok && !access.stale && !access.fromPaths).toBe(true);
      }
    }
  });
});
