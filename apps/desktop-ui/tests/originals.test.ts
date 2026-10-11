import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORIGINAL_MODES,
  ORIGINAL_MODES,
  ORIGINAL_MODE_HELP,
  ORIGINAL_MODE_LABELS,
  applyOriginals,
  originalsNote,
  planOriginals,
  resultLook,
  type OriginalRef,
} from '@/lib/originals';
import type { WorkspaceObject } from '@/types/domain';

const ref = (id: string, over: Partial<OriginalRef> = {}): OriginalRef => ({ id, locked: false, hasLoose: false, ...over });
const obj = (id: string, over: Partial<WorkspaceObject> = {}): WorkspaceObject => ({
  id,
  name: id,
  kind: { type: 'vector', paths: [] },
  transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  layer_id: 'L1',
  visible: true,
  locked: false,
  z_index: 0,
  ...over,
});

describe('the modes', () => {
  it('are Replace, Hide and Keep', () => {
    expect(ORIGINAL_MODES).toEqual(['replace', 'hide', 'keep']);
    for (const m of ORIGINAL_MODES) {
      expect(ORIGINAL_MODE_LABELS[m].length).toBeGreaterThan(5);
      expect(ORIGINAL_MODE_HELP[m].length).toBeGreaterThan(20);
    }
  });
});

describe('what each tool does to start with', () => {
  it('Combine and Fillet / Chamfer replace the original, and Offset keeps it (its point is a new line round it)', () => {
    expect(DEFAULT_ORIGINAL_MODES).toEqual({ combine: 'replace', offset: 'keep', corners: 'replace' });
  });
});

describe('planOriginals', () => {
  const refs = [ref('A'), ref('B'), ref('C')];
  it('Replace removes every original', () => {
    expect(planOriginals('replace', refs)).toEqual({ mode: 'replace', remove: ['A', 'B', 'C'], hide: [], kept: 0, total: 3 });
  });
  it('Hide hides every original', () => {
    expect(planOriginals('hide', refs)).toEqual({ mode: 'hide', remove: [], hide: ['A', 'B', 'C'], kept: 0, total: 3 });
  });
  it('Keep leaves every original alone, and does not count any as "kept"', () => {
    expect(planOriginals('keep', [ref('A', { locked: true }), ref('B', { hasLoose: true })])).toEqual({ mode: 'keep', remove: [], hide: [], kept: 0, total: 2 });
  });
  it('a locked original, or one with open lines, is never replaced or hidden', () => {
    const mixed = [ref('A'), ref('L', { locked: true }), ref('O', { hasLoose: true }), ref('B', { locked: true, hasLoose: true })];
    expect(planOriginals('replace', mixed)).toEqual({ mode: 'replace', remove: ['A'], hide: [], kept: 3, total: 4 });
    expect(planOriginals('hide', mixed)).toEqual({ mode: 'hide', remove: [], hide: ['A'], kept: 3, total: 4 });
  });
  it('copes with nothing, and does not change what it is given', () => {
    expect(planOriginals('replace', [])).toEqual({ mode: 'replace', remove: [], hide: [], kept: 0, total: 0 });
    const input = [ref('A', { locked: true })];
    const before = JSON.stringify(input);
    planOriginals('replace', input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('applyOriginals', () => {
  const objects = [obj('A', { z_index: 1 }), obj('B', { z_index: 2 }), obj('C', { z_index: 3 }), obj('D', { visible: false })];
  it('takes the removed ones out and keeps the order of the rest', () => {
    const out = applyOriginals(objects, planOriginals('replace', [ref('A'), ref('C')]));
    expect(out.map((o) => o.id)).toEqual(['B', 'D']);
  });
  it('hides the hidden ones without touching anything else about them', () => {
    const out = applyOriginals(objects, planOriginals('hide', [ref('A'), ref('B')]));
    expect(out.map((o) => [o.id, o.visible])).toEqual([['A', false], ['B', false], ['C', true], ['D', false]]);
    expect(out[0]).toEqual({ ...objects[0]!, visible: false });
    // The objects that were not hidden are the very same objects.
    expect(out[2]).toBe(objects[2]);
  });
  it('Keep changes nothing', () => {
    const out = applyOriginals(objects, planOriginals('keep', [ref('A')]));
    expect(out).toEqual(objects);
  });
  it('never changes the list or the objects it is given', () => {
    const before = JSON.stringify(objects);
    applyOriginals(objects, planOriginals('hide', [ref('A')]));
    applyOriginals(objects, planOriginals('replace', [ref('B')]));
    expect(JSON.stringify(objects)).toBe(before);
  });
  it('ignores an id that is not in the list', () => {
    expect(applyOriginals(objects, planOriginals('replace', [ref('nope')])).map((o) => o.id)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('resultLook', () => {
  it('a result that takes its original\'s place keeps its name and its position in the stack', () => {
    expect(resultLook(true, 'Square', 'Square (rounded 3 mm)', 4, 99)).toEqual({ name: 'Square', zIndex: 4 });
    expect(resultLook(true, 'Square', 'Square (rounded 3 mm)', 0, 99)).toEqual({ name: 'Square', zIndex: 0 });
    expect(resultLook(true, 'Square', 'Square (rounded 3 mm)', -2, 99)).toEqual({ name: 'Square', zIndex: -2 });
  });
  it('any other result gets the descriptive name and goes on top', () => {
    expect(resultLook(false, 'Square', 'Square (rounded 3 mm)', 4, 99)).toEqual({ name: 'Square (rounded 3 mm)', zIndex: 99 });
  });
  it('an original whose position is not known falls back to the top', () => {
    expect(resultLook(true, 'Square', 'x', undefined, 99)).toEqual({ name: 'Square', zIndex: 99 });
    expect(resultLook(true, 'Square', 'x', Number.NaN, 99)).toEqual({ name: 'Square', zIndex: 99 });
  });
});

describe('originalsNote', () => {
  it('says nothing for a plain Replace', () => {
    expect(originalsNote(planOriginals('replace', [ref('A'), ref('B')]))).toBe('');
    expect(originalsNote(planOriginals('replace', []))).toBe('');
  });
  it('says the originals are hidden, and how to get them back', () => {
    expect(originalsNote(planOriginals('hide', [ref('A')]))).toBe('The original is hidden: the eye in the Objects list shows it again.');
    expect(originalsNote(planOriginals('hide', [ref('A'), ref('B')]))).toBe('The 2 originals are hidden: the eye in the Objects list shows them again.');
  });
  it('says the originals are still there', () => {
    expect(originalsNote(planOriginals('keep', [ref('A')]))).toBe('The original is still there, under the result.');
    expect(originalsNote(planOriginals('keep', [ref('A'), ref('B'), ref('C')]))).toBe('The 3 originals are still there, under the results.');
  });
  it('says nothing about what is the usual behaviour of the tool, and still speaks up about anything else', () => {
    // Offset keeps its original: nothing to say. Fillet / Chamfer and Combine replace: nothing to say.
    expect(originalsNote(planOriginals('keep', [ref('A')]), 'offset')).toBe('');
    expect(originalsNote(planOriginals('keep', [ref('A'), ref('B')]), 'offset')).toBe('');
    expect(originalsNote(planOriginals('replace', [ref('A')]), 'corners')).toBe('');
    // Leaving the original is out of the ordinary for Fillet / Chamfer and Combine, and replacing it is for Offset.
    expect(originalsNote(planOriginals('keep', [ref('A')]), 'corners')).toBe('The original is still there, under the result.');
    expect(originalsNote(planOriginals('keep', [ref('A'), ref('B')]), 'combine')).toBe('The 2 originals are still there, under the results.');
    // Hiding is never the usual behaviour.
    expect(originalsNote(planOriginals('hide', [ref('A')]), 'offset')).toBe('The original is hidden: the eye in the Objects list shows it again.');
    // Locked shapes that were kept are always worth saying.
    expect(originalsNote(planOriginals('replace', [ref('A'), ref('L', { locked: true })]), 'offset')).toBe('Locked shapes and shapes with open lines were kept.');
  });
  it('says which were kept because they are locked or have open lines', () => {
    expect(originalsNote(planOriginals('replace', [ref('A'), ref('L', { locked: true })]))).toBe('Locked shapes and shapes with open lines were kept.');
    expect(originalsNote(planOriginals('hide', [ref('A'), ref('L', { hasLoose: true })]))).toBe(
      'The original is hidden: the eye in the Objects list shows it again. Locked shapes and shapes with open lines were kept.',
    );
    expect(originalsNote(planOriginals('hide', [ref('L', { locked: true })]))).toBe('Locked shapes and shapes with open lines were kept.');
  });
});
