// Reading the machine's own speed settings from what it prints for `$$`. Pure TypeScript (no React, Konva
// or Tauri imports), so it is unit-tested in plain Node (tests/grblSettings.test.ts).
//
// GRBL prints one setting per line, like `$110=30000.000`. The ones used here: $110 and $111 (the fastest
// the X and Y axes move, mm/min), $120 and $121 (how fast they speed up and slow down, mm/s2) and $11
// (junction deviation, mm). The estimate has one value for both axes, so if they differ the smaller wins.
import { MOTION_LIMITS, type MotionKey } from '@/lib/machineMotion';

/** Every `$number=value` in the lines, by number. A setting that appears twice keeps its last value. */
export function parseGrblSettings(lines: readonly string[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const line of lines) {
    for (const m of line.matchAll(/\$(\d+)\s*=\s*(-?\d+(?:\.\d+)?)/g)) {
      const n = Number(m[1]);
      const v = Number(m[2]);
      if (Number.isInteger(n) && Number.isFinite(v)) out.set(n, v);
    }
  }
  return out;
}

export interface MotionRead {
  /** The settings that were found and can be used. */
  values: Partial<Record<MotionKey, number>>;
  /** Things worth telling the user: axes that differ, values that were refused. */
  notes: string[];
  /** True when at least one setting was found. */
  found: boolean;
}

const SOURCES: ReadonlyArray<{ key: MotionKey; numbers: readonly number[]; label: string; unit: string }> = [
  { key: 'rapid_feed_mm_min', numbers: [110, 111], label: 'rapid speed', unit: 'mm/min' },
  { key: 'acceleration_mm_s2', numbers: [120, 121], label: 'acceleration', unit: 'mm/s²' },
  { key: 'junction_deviation_mm', numbers: [11], label: 'junction deviation', unit: 'mm' },
];

/** Picks the three settings out of what `$$` printed. */
export function motionFromSettings(settings: ReadonlyMap<number, number>): MotionRead {
  const values: Partial<Record<MotionKey, number>> = {};
  const notes: string[] = [];
  for (const { key, numbers, label } of SOURCES) {
    const present = numbers.flatMap((n) => {
      const v = settings.get(n);
      return v === undefined ? [] : [{ n, v }];
    });
    if (present.length === 0) continue;
    const { min, max } = MOTION_LIMITS[key];
    const usable = present.filter((p) => p.v >= min && p.v <= max);
    if (usable.length === 0) {
      notes.push(`The ${label} the machine reported (${present.map((p) => `$${p.n}=${p.v}`).join(', ')}) is outside the range that can be used, so it was left alone.`);
      continue;
    }
    const chosen = Math.min(...usable.map((p) => p.v));
    values[key] = chosen;
    if (new Set(usable.map((p) => p.v)).size > 1) {
      notes.push(`The two axes have different ${label}s (${usable.map((p) => `$${p.n}=${p.v}`).join(', ')}): the smaller one was used.`);
    }
  }
  return { values, notes, found: Object.keys(values).length > 0 };
}

const trim = (v: number): string => String(Number(v.toFixed(4)));

/** What to tell the user after asking the machine. */
export function describeMotionRead(read: MotionRead): string {
  if (!read.found) {
    return ['The machine did not report $110, $111, $120, $121 or $11, so nothing was changed.', ...read.notes].join(' ');
  }
  const parts: string[] = [];
  for (const { key, label, unit } of SOURCES) {
    const v = read.values[key];
    if (v !== undefined) parts.push(`${label} ${trim(v)} ${unit}`);
  }
  return [`Read from the machine: ${parts.join(', ')}.`, ...read.notes].join(' ');
}
