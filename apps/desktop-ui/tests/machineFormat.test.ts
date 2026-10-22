import { describe, expect, it } from 'vitest';
import { machineToEntry, parseMachineFile, serializeMachineFile, validateMachineEntry, type MachineEntry } from '@/lib/configFormat';

const base = {
  name: 'Test laser',
  controller: 'grbl1_1',
  bed_width_mm: 300,
  bed_height_mm: 300,
  origin: 'bottom_left',
  max_feed_rate_mm_min: 10000,
  max_spindle_value: 1000,
  homing_supported: false,
  air_assist_supported: true,
  baud_rate: 115200,
};

/** The machine the check accepted: the test fails here, with the problems, if it was refused. */
function accepted(raw: unknown): MachineEntry {
  const { entry, problems } = validateMachineEntry(raw);
  if (!entry) throw new Error(`the machine was refused: ${problems.join('; ')}`);
  return entry;
}

describe('the speed settings in a machine profile', () => {
  it('are left out of a machine that does not have them', () => {
    const entry = accepted(base);
    expect('rapid_feed_mm_min' in entry).toBe(false);
    expect(serializeMachineFile(entry)).not.toContain('acceleration');
  });
  it('are kept when they are valid', () => {
    const entry = accepted({ ...base, rapid_feed_mm_min: 30000, acceleration_mm_s2: 2500, junction_deviation_mm: 0.02 });
    expect(entry).toMatchObject({ rapid_feed_mm_min: 30000, acceleration_mm_s2: 2500, junction_deviation_mm: 0.02 });
  });
  it('may be null, which means not set', () => {
    const entry = accepted({ ...base, rapid_feed_mm_min: null, acceleration_mm_s2: null, junction_deviation_mm: null });
    expect('acceleration_mm_s2' in entry).toBe(false);
    expect('rapid_feed_mm_min' in entry).toBe(false);
  });
  it('are refused when they make no sense, with the name in the message', () => {
    for (const [key, bad] of [
      ['rapid_feed_mm_min', 0],
      ['rapid_feed_mm_min', 2e6],
      ['rapid_feed_mm_min', '30000'],
      ['acceleration_mm_s2', -1],
      ['acceleration_mm_s2', Number.NaN],
      ['junction_deviation_mm', 0],
      ['junction_deviation_mm', 11],
    ] as const) {
      const { entry, problems } = validateMachineEntry({ ...base, [key]: bad });
      expect(entry).toBeNull();
      expect(problems.join(' ')).toContain(key);
    }
  });
  it('survive saving a machine to a file and reading it back', () => {
    const entry = accepted({ ...base, rapid_feed_mm_min: 24000, acceleration_mm_s2: 1800, junction_deviation_mm: 0.015 });
    const text = serializeMachineFile(entry);
    expect(text).toContain('"acceleration_mm_s2": 1800');
    const back = parseMachineFile(text).machine;
    expect(back).toMatchObject({ rapid_feed_mm_min: 24000, acceleration_mm_s2: 1800, junction_deviation_mm: 0.015 });
  });
  it('are copied by machineToEntry only when they are set', () => {
    const profile = { ...machineToEntry(accepted(base)), id: 'x' };
    expect('acceleration_mm_s2' in machineToEntry(profile)).toBe(false);
    expect(machineToEntry({ ...profile, acceleration_mm_s2: 2500 }).acceleration_mm_s2).toBe(2500);
  });
});
