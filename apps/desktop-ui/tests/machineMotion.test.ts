import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JUNCTION_DEVIATION_MM,
  DEFAULT_RAPID_MM_MIN,
  MAX_JUNCTION_DEVIATION_MM,
  MAX_MOTION_VALUE,
  MOTION_KEYS,
  MOTION_LIMITS,
  clearMotion,
  motionInput,
  motionOf,
  setMotion,
  usesAcceleration,
  type MotionFields,
} from '@/lib/machineMotion';

describe('the settings the time estimate uses', () => {
  it('are the three names the Rust machine profile saves, in the order they are shown', () => {
    expect([...MOTION_KEYS]).toEqual(['rapid_feed_mm_min', 'acceleration_mm_s2', 'junction_deviation_mm']);
  });
  it('assume the same defaults and accept the same limits as the Rust estimate and machine checks', () => {
    // packages/machine/src/motion.rs and packages/common/src/machine.rs: keep them in step.
    expect(DEFAULT_RAPID_MM_MIN).toBe(6000);
    expect(DEFAULT_JUNCTION_DEVIATION_MM).toBe(0.01);
    expect(MAX_MOTION_VALUE).toBe(1_000_000);
    expect(MAX_JUNCTION_DEVIATION_MM).toBe(10);
    expect(MOTION_LIMITS).toEqual({
      rapid_feed_mm_min: { min: 1, max: 1_000_000 },
      acceleration_mm_s2: { min: 1, max: 1_000_000 },
      junction_deviation_mm: { min: 0.0001, max: 10 },
    });
  });
});

describe('motionInput', () => {
  it('shows what the estimate assumes for a setting that is not there', () => {
    expect(motionInput({}, 'rapid_feed_mm_min')).toBe(DEFAULT_RAPID_MM_MIN);
    expect(motionInput({}, 'junction_deviation_mm')).toBe(DEFAULT_JUNCTION_DEVIATION_MM);
    expect(motionInput({}, 'acceleration_mm_s2')).toBe(0);
  });
  it('shows the saved value', () => {
    const m: Partial<MotionFields> = { rapid_feed_mm_min: 30000, acceleration_mm_s2: 2500, junction_deviation_mm: 0.02 };
    expect(MOTION_KEYS.map((k) => motionInput(m, k))).toEqual([30000, 2500, 0.02]);
  });
});

describe('setMotion', () => {
  it('saves what was typed', () => {
    const m: Partial<MotionFields> = {};
    expect(setMotion(m, 'rapid_feed_mm_min', 30000)).toBe('set');
    expect(setMotion(m, 'acceleration_mm_s2', 2500)).toBe('set');
    expect(setMotion(m, 'junction_deviation_mm', 0.02)).toBe('set');
    expect(m).toEqual({ rapid_feed_mm_min: 30000, acceleration_mm_s2: 2500, junction_deviation_mm: 0.02 });
  });
  it('takes the setting away for 0, a negative or something that is not a number', () => {
    for (const bad of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY, 0.5]) {
      const m: Partial<MotionFields> = { acceleration_mm_s2: 2500 };
      expect(setMotion(m, 'acceleration_mm_s2', bad)).toBe('cleared');
      expect('acceleration_mm_s2' in m).toBe(false);
    }
    const j: Partial<MotionFields> = { junction_deviation_mm: 0.02 };
    expect(setMotion(j, 'junction_deviation_mm', 0)).toBe('cleared');
    expect(j).toEqual({});
  });
  it('brings a value that is too big down to the largest', () => {
    const m: Partial<MotionFields> = {};
    setMotion(m, 'rapid_feed_mm_min', 5e9);
    setMotion(m, 'junction_deviation_mm', 50);
    expect(m).toEqual({ rapid_feed_mm_min: MAX_MOTION_VALUE, junction_deviation_mm: MAX_JUNCTION_DEVIATION_MM });
  });
  it('leaves the other settings alone', () => {
    const m: Partial<MotionFields> = { rapid_feed_mm_min: 24000 };
    setMotion(m, 'acceleration_mm_s2', 1800);
    expect(m).toEqual({ rapid_feed_mm_min: 24000, acceleration_mm_s2: 1800 });
  });
});

describe('clearMotion, motionOf and usesAcceleration', () => {
  it('clearMotion takes all three away and leaves the rest of the machine', () => {
    const m = { name: 'X', rapid_feed_mm_min: 1, acceleration_mm_s2: 2, junction_deviation_mm: 3 };
    clearMotion(m);
    expect(m).toEqual({ name: 'X' });
  });
  it('motionOf keeps only what is set', () => {
    expect(motionOf({})).toEqual({});
    expect(motionOf({ acceleration_mm_s2: 2500 })).toEqual({ acceleration_mm_s2: 2500 });
    const all: Partial<MotionFields> = { rapid_feed_mm_min: 1, acceleration_mm_s2: 2, junction_deviation_mm: 3 };
    expect(motionOf(all)).toEqual(all);
    expect(motionOf(all)).not.toBe(all);
  });
  it('usesAcceleration needs an acceleration above 0', () => {
    expect(usesAcceleration({})).toBe(false);
    expect(usesAcceleration({ acceleration_mm_s2: 0 })).toBe(false);
    expect(usesAcceleration({ acceleration_mm_s2: 2500 })).toBe(true);
  });
});
