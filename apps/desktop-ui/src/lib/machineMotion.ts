// The machine's speed settings that the time estimate uses: how fast it moves with the laser off, how
// fast it speeds up and slows down, and GRBL's junction deviation. Pure TypeScript (no React, Konva or
// Tauri imports), so it is unit-tested in plain Node (tests/machineMotion.test.ts).
//
// They are saved with the machine profile (and in machine files) as three optional numbers. A machine
// without them is estimated as it always was: rapids at 6000 mm/min and no acceleration. See
// docs/user-guide.md, "Choose your machine".
import type { MachineProfile } from '@/types/domain';

export type MotionKey = 'rapid_feed_mm_min' | 'acceleration_mm_s2' | 'junction_deviation_mm';

/** The three settings, in the order they are shown. */
export const MOTION_KEYS: readonly MotionKey[] = ['rapid_feed_mm_min', 'acceleration_mm_s2', 'junction_deviation_mm'];

/** The rapid speed the estimate assumes when the machine's own is not set, in mm/min. */
export const DEFAULT_RAPID_MM_MIN = 6000;
/** GRBL's default junction deviation ($11), in mm. */
export const DEFAULT_JUNCTION_DEVIATION_MM = 0.01;
/** The largest rapid speed (mm/min) or acceleration (mm/s2) that is accepted. */
export const MAX_MOTION_VALUE = 1_000_000;
/** The largest junction deviation that is accepted, in mm. */
export const MAX_JUNCTION_DEVIATION_MM = 10;

/** What each setting may be. Anything below `min` means "not set". */
export const MOTION_LIMITS: Record<MotionKey, { min: number; max: number }> = {
  rapid_feed_mm_min: { min: 1, max: MAX_MOTION_VALUE },
  acceleration_mm_s2: { min: 1, max: MAX_MOTION_VALUE },
  junction_deviation_mm: { min: 0.0001, max: MAX_JUNCTION_DEVIATION_MM },
};

export type MotionFields = Pick<MachineProfile, MotionKey>;

/** What the box for this setting shows: the saved value, or what the estimate assumes (0 for the acceleration, meaning none). */
export function motionInput(m: Partial<MotionFields>, key: MotionKey): number {
  const v = m[key];
  if (v !== undefined) return v;
  if (key === 'rapid_feed_mm_min') return DEFAULT_RAPID_MM_MIN;
  if (key === 'junction_deviation_mm') return DEFAULT_JUNCTION_DEVIATION_MM;
  return 0;
}

/**
 * Sets one setting from what was typed. A value that is not a number, or is below the smallest allowed (0 for
 * "not known"), takes the setting away; a value above the largest is brought down to it.
 */
export function setMotion(m: Partial<MotionFields>, key: MotionKey, value: number): 'set' | 'cleared' {
  const { min, max } = MOTION_LIMITS[key];
  if (!Number.isFinite(value) || value < min) {
    delete m[key];
    return 'cleared';
  }
  m[key] = Math.min(value, max);
  return 'set';
}

/** Takes all three away (a machine that is loaded from a preset or a file brings its own, or none). */
export function clearMotion(m: Partial<MotionFields>): void {
  for (const key of MOTION_KEYS) delete m[key];
}

/** The settings that are set, and nothing else (for a machine file). */
export function motionOf(m: Partial<MotionFields>): Partial<MotionFields> {
  const out: Partial<MotionFields> = {};
  for (const key of MOTION_KEYS) {
    const v = m[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** True when the estimate will use the machine's acceleration. */
export function usesAcceleration(m: Partial<MotionFields>): boolean {
  return m.acceleration_mm_s2 !== undefined && m.acceleration_mm_s2 > 0;
}
