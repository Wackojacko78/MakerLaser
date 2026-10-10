import { describe, expect, it } from 'vitest';
import { MAX_FONT_WAITS, createTextSettler, type SettleDeps } from '../src/lib/textSettle';

interface Patch {
  font?: string;
  text?: string;
}
interface Form {
  font: string;
  text: string;
}
type Mode = string | null;

/** A fake project and browser: Arial is always available; other fonts need load() and a release. */
function world(options: { neverReady?: boolean; loadThrows?: boolean; drawable?: boolean } = {}) {
  const w = {
    form: { font: 'Arial', text: 'Hi' } as Form | null,
    available: new Set<string>(['Arial']),
    loads: [] as string[],
    applied: [] as { patch: Patch; mode: Mode }[],
    pending: [] as (() => void)[],
  };
  const deps: SettleDeps<Patch, Form, Mode> = {
    formWith: (_id, patch) => (w.form ? { ...w.form, ...patch } : null),
    isReady: (f) => w.available.has(f.font),
    load: (f) => {
      w.loads.push(f.font);
      if (options.loadThrows) return Promise.reject(new Error('no'));
      return new Promise<void>((resolve) => {
        w.pending.push(() => {
          if (!options.neverReady) w.available.add(f.font);
          resolve();
        });
      });
    },
    apply: (_id, patch, mode) => {
      w.applied.push({ patch, mode });
      if (options.drawable === false) return false;
      if (w.form) w.form = { ...w.form, ...patch };
      return true;
    },
  };
  const settler = createTextSettler<Patch, Form, Mode>(deps, (older, newer) => newer ?? older);
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const releaseNext = async () => {
    w.pending.shift()?.();
    await flush();
  };
  return { w, settler, flush, releaseNext };
}

describe('a change when the font is ready', () => {
  it('is applied at once, without waiting', () => {
    const { w, settler } = world();
    expect(settler.request('t', { text: 'Hello' }, null)).toBe(true);
    expect(w.applied).toEqual([{ patch: { text: 'Hello' }, mode: null }]);
    expect(w.loads).toEqual([]);
    expect(settler.isWaiting('t')).toBe(false);
  });

  it('says false when there is nothing to draw', () => {
    const { settler } = world({ drawable: false });
    expect(settler.request('t', { text: '' }, null)).toBe(false);
  });

  it('says false for an object that no longer exists, and does nothing', () => {
    const { w, settler } = world();
    w.form = null;
    expect(settler.request('gone', { text: 'x' }, null)).toBe(false);
    expect(w.applied).toEqual([]);
  });
});

describe('a change when the font has not loaded', () => {
  it('waits for the font, then applies the change once', async () => {
    const { w, settler, releaseNext } = world();
    expect(settler.request('t', { font: 'Lobster' }, null)).toBe(true);
    expect(w.applied).toEqual([]);
    expect(w.loads).toEqual(['Lobster']);
    expect(settler.isWaiting('t')).toBe(true);
    await releaseNext();
    expect(w.applied).toEqual([{ patch: { font: 'Lobster' }, mode: null }]);
    expect(settler.isWaiting('t')).toBe(false);
  });

  it('merges changes made while waiting, so none is lost and an older one never wins', async () => {
    const { w, settler, releaseNext } = world();
    settler.request('t', { font: 'Lobster' }, null);
    settler.request('t', { text: 'a' }, null);
    settler.request('t', { text: 'ab' }, null);
    expect(w.loads).toEqual(['Lobster']);
    await releaseNext();
    expect(w.applied).toEqual([{ patch: { font: 'Lobster', text: 'ab' }, mode: null }]);
  });

  it('waits again when the font is changed again while waiting', async () => {
    const { w, settler, releaseNext } = world();
    settler.request('t', { font: 'Lobster' }, null);
    settler.request('t', { font: 'Pacifico' }, null);
    await releaseNext();
    expect(w.loads).toEqual(['Lobster', 'Pacifico']);
    expect(w.applied).toEqual([]);
    await releaseNext();
    expect(w.applied).toEqual([{ patch: { font: 'Pacifico' }, mode: null }]);
  });

  it('keeps the laser mode asked for while waiting', async () => {
    const { w, settler, releaseNext } = world();
    settler.request('t', { font: 'Lobster' }, 'cut');
    settler.request('t', { text: 'x' }, null);
    await releaseNext();
    expect(w.applied[0]?.mode).toBe('cut');
  });

  it('gives up waiting for a font that never becomes ready, and draws with what there is', async () => {
    const { w, settler, releaseNext } = world({ neverReady: true });
    settler.request('t', { font: 'Broken' }, null);
    for (let i = 0; i < MAX_FONT_WAITS; i += 1) await releaseNext();
    expect(w.loads.length).toBe(MAX_FONT_WAITS);
    expect(w.applied).toEqual([{ patch: { font: 'Broken' }, mode: null }]);
    expect(settler.isWaiting('t')).toBe(false);
  });

  it('still applies the change when loading fails with an error', async () => {
    const { w, settler, flush } = world({ loadThrows: true });
    settler.request('t', { font: 'Broken' }, null);
    await flush();
    expect(w.applied).toEqual([{ patch: { font: 'Broken' }, mode: null }]);
  });

  it('drops the change when the object is deleted while waiting', async () => {
    const { w, settler, releaseNext } = world();
    settler.request('t', { font: 'Lobster' }, null);
    w.form = null;
    await releaseNext();
    expect(w.applied).toEqual([]);
    expect(settler.isWaiting('t')).toBe(false);
  });

  it('applies changes to other objects at once while one is waiting', async () => {
    const { w, settler, releaseNext } = world();
    settler.request('a', { font: 'Lobster' }, null);
    expect(settler.request('b', { text: 'Hello' }, null)).toBe(true);
    expect(w.applied).toEqual([{ patch: { text: 'Hello' }, mode: null }]);
    await releaseNext();
    expect(w.applied.length).toBe(2);
  });

  it('applies the next change at once after a font has loaded', async () => {
    const { w, settler, releaseNext } = world();
    settler.request('t', { font: 'Lobster' }, null);
    await releaseNext();
    settler.request('t', { text: 'next' }, null);
    expect(w.applied.length).toBe(2);
    expect(w.loads).toEqual(['Lobster']);
  });
});
