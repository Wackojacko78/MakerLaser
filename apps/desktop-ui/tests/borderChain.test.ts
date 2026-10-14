import { describe, expect, it } from 'vitest';
import {
  MAX_BAND_MM,
  MAX_CHAIN_ENTRIES,
  bandName,
  bandNote,
  bandProblem,
  chainAfter,
  chainEntryFor,
  nextBand,
  objectSignature,
  planBand,
  type ChainEntry,
} from '@/lib/borderChain';
import type { Path2D, WorkspaceObject } from '@/types/domain';

const square = (s: number, x = 0, y = 0): Path2D => ({
  points: [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ],
  closed: true,
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

const entryFor = (o: WorkspaceObject, over: Partial<ChainEntry> = {}): ChainEntry => ({
  base: [square(10)],
  baseName: 'Square',
  lo: 0,
  hi: 2,
  sig: objectSignature(o),
  ...over,
});

describe('nextBand with no frame behind it', () => {
  it('Outward is the band from the shape out to the distance', () => {
    expect(nextBand(null, 1, 2)).toEqual({ lo: 0, hi: 2 });
    expect(nextBand(null, 1, 0.25)).toEqual({ lo: 0, hi: 0.25 });
  });
  it('Inward is the band from the distance inside up to the shape', () => {
    expect(nextBand(null, -1, 2)).toEqual({ lo: -2, hi: 0 });
  });
});

describe('nextBand stepping on from a frame', () => {
  it('Outward steps to the band beyond the frame, again and again', () => {
    let band = nextBand(null, 1, 2);
    const seen = [band];
    for (let i = 0; i < 3; i++) {
      band = nextBand(band, 1, 2);
      seen.push(band);
    }
    expect(seen).toEqual([
      { lo: 0, hi: 2 },
      { lo: 2, hi: 4 },
      { lo: 4, hi: 6 },
      { lo: 6, hi: 8 },
    ]);
  });
  it('Inward steps to the next band inside, again and again', () => {
    let band = nextBand(null, -1, 2);
    const seen = [band];
    for (let i = 0; i < 2; i++) {
      band = nextBand(band, -1, 2);
      seen.push(band);
    }
    expect(seen).toEqual([
      { lo: -2, hi: 0 },
      { lo: -4, hi: -2 },
      { lo: -6, hi: -4 },
    ]);
  });
  it('Inward from an outer band steps back towards the shape, and on inside it; Outward does the same the other way', () => {
    expect(nextBand({ lo: 2, hi: 4 }, -1, 2)).toEqual({ lo: 0, hi: 2 });
    expect(nextBand({ lo: 0, hi: 2 }, -1, 2)).toEqual({ lo: -2, hi: 0 });
    expect(nextBand({ lo: -2, hi: 0 }, 1, 2)).toEqual({ lo: 0, hi: 2 });
  });
  it('uses the distance in the box now, not the one the frame was made with', () => {
    expect(nextBand({ lo: 0, hi: 2 }, 1, 5)).toEqual({ lo: 2, hi: 7 });
    expect(nextBand({ lo: 0, hi: 2 }, -1, 0.5)).toEqual({ lo: -0.5, hi: 0 });
  });
  it('does not let rounding errors build up over many steps', () => {
    let band = nextBand(null, 1, 0.1);
    for (let i = 0; i < 9; i++) band = nextBand(band, 1, 0.1);
    expect(band).toEqual({ lo: 0.9, hi: 1 });
  });
});

describe('bandProblem', () => {
  it('accepts a band within the limit and refuses one beyond it', () => {
    expect(bandProblem({ lo: 0, hi: 2 })).toBeNull();
    expect(bandProblem({ lo: -MAX_BAND_MM, hi: MAX_BAND_MM })).toBeNull();
    expect(bandProblem({ lo: 0, hi: MAX_BAND_MM + 0.5 })).toContain('at most 1000 mm');
    expect(bandProblem({ lo: -1001, hi: -999 })).toContain('at most 1000 mm');
    expect(bandProblem({ lo: Number.NaN, hi: 2 })).toContain('at most 1000 mm');
  });
});

describe('planBand', () => {
  const outer = [square(14, -2, -2)];
  const inner = [square(10)];
  it('cuts the inner outline out of the outer one', () => {
    expect(planBand(outer, inner)).toEqual({ kind: 'subtract', shapes: [outer, inner] });
  });
  it('makes the whole outer shape the frame when the inner outline has shrunk away', () => {
    expect(planBand(outer, [])).toEqual({ kind: 'whole', paths: outer });
  });
  it('makes nothing when the outer outline has shrunk away', () => {
    expect(planBand([], [])).toEqual({ kind: 'none' });
    expect(planBand([], inner)).toEqual({ kind: 'none' });
  });
  it('does not change what it is given', () => {
    const before = JSON.stringify([outer, inner]);
    planBand(outer, inner);
    planBand(outer, []);
    expect(JSON.stringify([outer, inner])).toBe(before);
  });
});

describe('chainEntryFor', () => {
  const ring = vec('ring', [square(14, -2, -2), square(10)]);

  it('gives the entry for a frame that is as it was made', () => {
    const chain = new Map([['ring', entryFor(ring)]]);
    expect(chainEntryFor(chain, ring)).toBe(chain.get('ring'));
  });
  it('gives nothing for an object that is not in the memory', () => {
    expect(chainEntryFor(new Map(), ring)).toBeNull();
    expect(chainEntryFor(new Map([['other', entryFor(ring)]]), ring)).toBeNull();
  });
  it('gives nothing once the frame has been moved, resized or edited', () => {
    const chain = new Map([['ring', entryFor(ring)]]);
    expect(chainEntryFor(chain, { ...ring, transform: { ...ring.transform, e: 5 } })).toBeNull();
    expect(chainEntryFor(chain, { ...ring, transform: { ...ring.transform, a: 2 } })).toBeNull();
    expect(chainEntryFor(chain, vec('ring', [square(14, -2, -2), square(9)]))).toBeNull();
  });
  it('is not fooled by a name, layer or position in the list changing, which do not change the outline', () => {
    const chain = new Map([['ring', entryFor(ring)]]);
    expect(chainEntryFor(chain, { ...ring, name: 'Renamed', layer_id: 'L9', z_index: 7, visible: false })).not.toBeNull();
  });
  it('never trusts a picture', () => {
    const p = picture('ring');
    expect(objectSignature(p)).toBe('');
    expect(chainEntryFor(new Map([['ring', entryFor(p, { sig: '' })]]), p)).toBeNull();
  });
});

describe('names and notes', () => {
  it('names a band by how far it is from the shape', () => {
    expect(bandName('Square', { lo: 2, hi: 4 })).toBe('Square (border +2 to +4 mm)');
    expect(bandName('Square', { lo: 0, hi: 2 })).toBe('Square (border 0 to +2 mm)');
    expect(bandName('Square', { lo: -4, hi: -2 })).toBe('Square (border -4 to -2 mm)');
    expect(bandName('Square', { lo: -2, hi: 0 })).toBe('Square (border -2 to 0 mm)');
    expect(bandName('Square', { lo: 1.2346, hi: 3.5 })).toBe('Square (border +1.235 to +3.5 mm)');
  });
  it('says where a band is, outside or inside', () => {
    expect(bandNote({ lo: 2, hi: 4 })).toBe('The frame is 2 to 4 mm outside the shape it came from.');
    expect(bandNote({ lo: -4, hi: -2 })).toBe('The frame is 2 to 4 mm inside the shape it came from.');
    expect(bandNote({ lo: -2, hi: 3 })).toContain('2 mm inside to 3 mm outside');
  });
});

describe('chainAfter', () => {
  const o = vec('a', [square(10)]);
  it('adds entries without changing the memory it was given', () => {
    const old = new Map([['a', entryFor(o)]]);
    const next = chainAfter(old, [['b', entryFor(o, { lo: 2, hi: 4 })]]);
    expect([...next.keys()]).toEqual(['a', 'b']);
    expect([...old.keys()]).toEqual(['a']);
  });
  it('replaces an entry that is already there', () => {
    const next = chainAfter(new Map([['a', entryFor(o)]]), [['a', entryFor(o, { lo: 2, hi: 4 })]]);
    expect(next.size).toBe(1);
    expect(next.get('a')?.hi).toBe(4);
  });
  it('forgets the oldest entries past the limit and keeps the newest', () => {
    let chain: Map<string, ChainEntry> = new Map();
    for (let i = 0; i < MAX_CHAIN_ENTRIES + 5; i++) chain = chainAfter(chain, [[`id${i}`, entryFor(o)]]);
    expect(chain.size).toBe(MAX_CHAIN_ENTRIES);
    expect(chain.has('id0')).toBe(false);
    expect(chain.has('id4')).toBe(false);
    expect(chain.has('id5')).toBe(true);
    expect(chain.has(`id${MAX_CHAIN_ENTRIES + 4}`)).toBe(true);
  });
});
