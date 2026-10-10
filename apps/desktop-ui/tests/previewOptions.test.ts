import { describe, expect, it } from 'vitest';
import {
  SHOW_TRAVEL_STORAGE_KEY,
  TRAVEL_OPACITY,
  createPreviewOptionsStore,
  parseStoredShowTravel,
  shouldDrawKind,
} from '../src/lib/previewOptions';
import { KIND_CUT, KIND_ENGRAVE, KIND_FILL, KIND_SCORE, KIND_TRAVEL } from '../src/lib/toolpath';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('shouldDrawKind', () => {
  it('draws everything when travel is shown', () => {
    for (const kind of [KIND_TRAVEL, KIND_CUT, KIND_SCORE, KIND_FILL, KIND_ENGRAVE]) expect(shouldDrawKind(kind, true)).toBe(true);
  });

  it('leaves out only travel when it is hidden, so what will burn is always drawn', () => {
    expect(shouldDrawKind(KIND_TRAVEL, false)).toBe(false);
    for (const kind of [KIND_CUT, KIND_SCORE, KIND_FILL, KIND_ENGRAVE]) expect(shouldDrawKind(kind, false)).toBe(true);
  });
});

describe('travel opacity', () => {
  it('is faint but visible', () => {
    expect(TRAVEL_OPACITY).toBeGreaterThan(0.1);
    expect(TRAVEL_OPACITY).toBeLessThan(0.6);
  });
});

describe('parseStoredShowTravel', () => {
  it('shows travel by default and for anything unexpected', () => {
    expect(parseStoredShowTravel(null)).toBe(true);
    expect(parseStoredShowTravel('1')).toBe(true);
    expect(parseStoredShowTravel('')).toBe(true);
    expect(parseStoredShowTravel('junk')).toBe(true);
  });

  it('hides it only for a stored 0', () => {
    expect(parseStoredShowTravel('0')).toBe(false);
  });
});

describe('the preview options store', () => {
  it('starts with travel shown', () => {
    expect(createPreviewOptionsStore(fakeStorage()).get()).toEqual({ showTravel: true });
  });

  it('works without any storage', () => {
    const store = createPreviewOptionsStore();
    store.setShowTravel(false);
    expect(store.get().showTravel).toBe(false);
  });

  it('remembers the choice for next time', () => {
    const storage = fakeStorage();
    createPreviewOptionsStore(storage).setShowTravel(false);
    expect(storage.data.get(SHOW_TRAVEL_STORAGE_KEY)).toBe('0');
    expect(createPreviewOptionsStore(storage).get().showTravel).toBe(false);
    createPreviewOptionsStore(storage).setShowTravel(true);
    expect(createPreviewOptionsStore(storage).get().showTravel).toBe(true);
  });

  it('ignores a stored value that is junk', () => {
    expect(createPreviewOptionsStore(fakeStorage({ [SHOW_TRAVEL_STORAGE_KEY]: 'x' })).get().showTravel).toBe(true);
  });

  it('tells subscribers about changes, and only about changes', () => {
    const store = createPreviewOptionsStore(fakeStorage());
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.setShowTravel(true);
    expect(calls).toBe(0);
    store.setShowTravel(false);
    expect(calls).toBe(1);
    store.setShowTravel(false);
    expect(calls).toBe(1);
    unsubscribe();
    store.setShowTravel(true);
    expect(calls).toBe(1);
  });

  it('keeps one snapshot until something changes, as React needs', () => {
    const store = createPreviewOptionsStore(fakeStorage());
    const before = store.get();
    expect(store.get()).toBe(before);
    store.setShowTravel(false);
    expect(store.get()).not.toBe(before);
  });

  it('carries on when the storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const store = createPreviewOptionsStore(broken);
    expect(store.get().showTravel).toBe(true);
    store.setShowTravel(false);
    expect(store.get().showTravel).toBe(false);
  });
});
