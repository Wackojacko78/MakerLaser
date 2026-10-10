import { describe, expect, it } from 'vitest';
import {
  FRAME_LASER_DEFAULT_PERCENT,
  FRAME_LASER_MAX_PERCENT,
  FRAME_LASER_MIN_PERCENT,
  FRAME_LASER_STORAGE_KEY,
  FRAME_LASER_WARNING,
  clampFramePercent,
  createFrameLaserStore,
  frameButtonLabel,
  frameLogMessage,
  framePowerRequest,
  parseStoredFramePercent,
} from '../src/lib/frameLaser';

/** A stand-in for localStorage. */
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

describe('clampFramePercent', () => {
  it('keeps powers inside the limits', () => {
    for (const ok of [0.1, 1, 2.5, 5]) expect(clampFramePercent(ok)).toBe(ok);
  });

  it('pulls powers outside the limits back to them', () => {
    expect(clampFramePercent(0)).toBe(FRAME_LASER_MIN_PERCENT);
    expect(clampFramePercent(-3)).toBe(FRAME_LASER_MIN_PERCENT);
    expect(clampFramePercent(50)).toBe(FRAME_LASER_MAX_PERCENT);
    expect(clampFramePercent(Number.POSITIVE_INFINITY)).toBe(FRAME_LASER_DEFAULT_PERCENT);
  });

  it('rounds to one decimal place', () => {
    expect(clampFramePercent(1.26)).toBe(1.3);
    expect(clampFramePercent(0.04)).toBe(FRAME_LASER_MIN_PERCENT);
  });

  it('turns junk into the default instead of a surprise power', () => {
    for (const junk of [Number.NaN, undefined, null, '', '  ', 'abc', {}, [], true]) {
      expect(clampFramePercent(junk)).toBe(FRAME_LASER_DEFAULT_PERCENT);
    }
  });

  it('accepts a number typed as text', () => {
    expect(clampFramePercent('2')).toBe(2);
    expect(clampFramePercent(' 3.5 ')).toBe(3.5);
  });

  it('never allows a power the machine side would refuse', () => {
    expect(FRAME_LASER_MIN_PERCENT).toBeGreaterThan(0);
    expect(FRAME_LASER_MAX_PERCENT).toBeLessThanOrEqual(5);
    expect(FRAME_LASER_DEFAULT_PERCENT).toBeGreaterThanOrEqual(FRAME_LASER_MIN_PERCENT);
    expect(FRAME_LASER_DEFAULT_PERCENT).toBeLessThanOrEqual(FRAME_LASER_MAX_PERCENT);
  });
});

describe('framePowerRequest', () => {
  it('asks for no laser at all when the option is off, whatever the power is', () => {
    expect(framePowerRequest(false, 3)).toBeNull();
    expect(framePowerRequest(false, 'junk')).toBeNull();
  });

  it('asks for the clamped power when the option is on', () => {
    expect(framePowerRequest(true, 2)).toBe(2);
    expect(framePowerRequest(true, 99)).toBe(FRAME_LASER_MAX_PERCENT);
    expect(framePowerRequest(true, 'junk')).toBe(FRAME_LASER_DEFAULT_PERCENT);
  });
});

describe('parseStoredFramePercent', () => {
  it('uses the default when nothing is stored', () => {
    expect(parseStoredFramePercent(null)).toBe(FRAME_LASER_DEFAULT_PERCENT);
  });

  it('reads a stored power and clamps a stored mess', () => {
    expect(parseStoredFramePercent('2.5')).toBe(2.5);
    expect(parseStoredFramePercent('99')).toBe(FRAME_LASER_MAX_PERCENT);
    expect(parseStoredFramePercent('junk')).toBe(FRAME_LASER_DEFAULT_PERCENT);
  });
});

describe('the frame laser store', () => {
  it('starts with the laser off and the default power', () => {
    const store = createFrameLaserStore(fakeStorage());
    expect(store.get()).toEqual({ enabled: false, percent: FRAME_LASER_DEFAULT_PERCENT });
  });

  it('works without any storage', () => {
    const store = createFrameLaserStore();
    store.setPercent(2);
    expect(store.get().percent).toBe(2);
  });

  it('remembers the power but never the option', () => {
    const storage = fakeStorage();
    const first = createFrameLaserStore(storage);
    first.setEnabled(true);
    first.setPercent(2.5);
    expect(storage.data.get(FRAME_LASER_STORAGE_KEY)).toBe('2.5');
    const second = createFrameLaserStore(storage);
    expect(second.get()).toEqual({ enabled: false, percent: 2.5 });
  });

  it('stores the clamped power, not what was typed', () => {
    const storage = fakeStorage();
    const store = createFrameLaserStore(storage);
    store.setPercent(80);
    expect(store.get().percent).toBe(FRAME_LASER_MAX_PERCENT);
    expect(storage.data.get(FRAME_LASER_STORAGE_KEY)).toBe(String(FRAME_LASER_MAX_PERCENT));
  });

  it('ignores a stored value that is junk', () => {
    const store = createFrameLaserStore(fakeStorage({ [FRAME_LASER_STORAGE_KEY]: 'not a number' }));
    expect(store.get().percent).toBe(FRAME_LASER_DEFAULT_PERCENT);
  });

  it('tells subscribers about changes, and only about changes', () => {
    const store = createFrameLaserStore(fakeStorage());
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.setEnabled(true);
    expect(calls).toBe(1);
    store.setEnabled(true);
    store.setPercent(FRAME_LASER_DEFAULT_PERCENT);
    expect(calls).toBe(1);
    store.setPercent(3);
    expect(calls).toBe(2);
    unsubscribe();
    store.setEnabled(false);
    expect(calls).toBe(2);
  });

  it('keeps one snapshot until something changes, as React needs', () => {
    const store = createFrameLaserStore(fakeStorage());
    const before = store.get();
    expect(store.get()).toBe(before);
    store.setEnabled(true);
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
    const store = createFrameLaserStore(broken);
    expect(store.get().percent).toBe(FRAME_LASER_DEFAULT_PERCENT);
    store.setPercent(2);
    expect(store.get().percent).toBe(2);
  });
});

describe('the words on screen', () => {
  it('logs whether the laser is on, and at what power', () => {
    expect(frameLogMessage(null)).toBe('Framing the job outline (laser off).');
    expect(frameLogMessage(1.5)).toBe('Framing the job outline with the laser ON at 1.5% power.');
  });

  it('labels the Frame button for every state', () => {
    expect(frameButtonLabel({ framing: false, enabled: false })).toBe('Frame');
    expect(frameButtonLabel({ framing: false, enabled: true })).toBe('Frame (laser on)');
    expect(frameButtonLabel({ framing: true, enabled: true })).toBe('Framing…');
    expect(frameButtonLabel({ framing: true, enabled: false })).toBe('Framing…');
  });

  it('warns about marking, eyes and the way out', () => {
    expect(FRAME_LASER_WARNING).toContain('eye');
    expect(FRAME_LASER_WARNING).toContain('STOP');
    expect(FRAME_LASER_WARNING).toContain('scrap');
  });
});
