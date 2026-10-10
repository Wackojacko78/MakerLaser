import { describe, expect, it } from 'vitest';
import { cssFontFamily, fontReady, fontSpec, loadFont, type FontSetLike } from '../src/lib/fontLoad';

/** A fake browser font set: faces are "not loaded" until load() is called. */
function fakeSet(options: { loaded?: boolean; checkThrows?: boolean; loadThrows?: boolean; neverLoads?: boolean } = {}) {
  const state = { loaded: options.loaded ?? false, checks: [] as string[][], loads: [] as string[][] };
  const set: FontSetLike = {
    check(font, text) {
      state.checks.push([font, text ?? '']);
      if (options.checkThrows) throw new SyntaxError('bad font');
      return state.loaded;
    },
    async load(font, text) {
      state.loads.push([font, text ?? '']);
      if (options.loadThrows) throw new Error('network');
      if (!options.neverLoads) state.loaded = true;
      return [];
    },
  };
  return { set, state };
}

describe('cssFontFamily', () => {
  it('quotes a font name and adds a fallback', () => {
    expect(cssFontFamily('Arial')).toBe('"Arial", sans-serif');
    expect(cssFontFamily('Roboto Slab')).toBe('"Roboto Slab", sans-serif');
  });

  it('leaves the generic families unquoted, because "serif" in quotes is a font named serif', () => {
    expect(cssFontFamily('serif')).toBe('serif');
    expect(cssFontFamily('Monospace')).toBe('monospace');
    expect(cssFontFamily(' sans-serif ')).toBe('sans-serif');
  });

  it('turns an empty name into sans-serif and cannot be made to add CSS', () => {
    expect(cssFontFamily('')).toBe('sans-serif');
    expect(cssFontFamily('   ')).toBe('sans-serif');
    const hostile = cssFontFamily('Evil"; color: red; }');
    expect(hostile.includes(';')).toBe(false);
    expect(hostile.includes('}')).toBe(false);
    expect(hostile.split('"').length).toBe(3);
  });
});

describe('fontSpec', () => {
  it('builds a CSS font shorthand in the order canvas expects', () => {
    expect(fontSpec('Roboto Slab', false, false)).toBe('16px "Roboto Slab", sans-serif');
    expect(fontSpec('Roboto Slab', true, false)).toBe('bold 16px "Roboto Slab", sans-serif');
    expect(fontSpec('Roboto Slab', false, true)).toBe('italic 16px "Roboto Slab", sans-serif');
    expect(fontSpec('Roboto Slab', true, true)).toBe('italic bold 16px "Roboto Slab", sans-serif');
    expect(fontSpec('serif', false, false, 20)).toBe('20px serif');
  });
});

describe('fontReady', () => {
  it('asks the font set about the face and the text', () => {
    const { set, state } = fakeSet({ loaded: false });
    expect(fontReady(set, 'Lobster', false, false, 'Hi ā')).toBe(false);
    expect(state.checks).toEqual([['16px "Lobster", sans-serif', 'Hi ā']]);
  });

  it('is true once the face has loaded', () => {
    expect(fontReady(fakeSet({ loaded: true }).set, 'Lobster', false, false, 'Hi')).toBe(true);
  });

  it('asks about a space when there is no text, because an empty string asks about nothing', () => {
    const { set, state } = fakeSet();
    fontReady(set, 'Lobster', false, false, '');
    expect(state.checks[0]?.[1]).toBe(' ');
  });

  it('is true when there is no font set, or the font set cannot understand the question', () => {
    expect(fontReady(undefined, 'Lobster', false, false, 'Hi')).toBe(true);
    expect(fontReady(fakeSet({ checkThrows: true }).set, 'Lobster', false, false, 'Hi')).toBe(true);
  });
});

describe('loadFont', () => {
  it('loads the face and says it is ready', async () => {
    const { set, state } = fakeSet();
    expect(await loadFont(set, 'Lobster', true, false, 'Hi')).toBe(true);
    expect(state.loads).toEqual([['bold 16px "Lobster", sans-serif', 'Hi']]);
  });

  it('never throws, and says not ready when the face could not be loaded', async () => {
    expect(await loadFont(fakeSet({ loadThrows: true }).set, 'Lobster', false, false, 'Hi')).toBe(false);
    expect(await loadFont(fakeSet({ neverLoads: true }).set, 'Lobster', false, false, 'Hi')).toBe(false);
  });

  it('does nothing without a font set', async () => {
    expect(await loadFont(undefined, 'Lobster', false, false, 'Hi')).toBe(true);
  });
});
