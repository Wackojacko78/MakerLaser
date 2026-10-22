import { describe, expect, it } from 'vitest';
import { describeMotionRead, motionFromSettings, parseGrblSettings } from '@/lib/grblSettings';

const REPORT = ['$0=10', '$11=0.010', '$30=1000', '$32=1', '$110=30000.000', '$111=30000.000', '$120=2500.000', '$121=2500.000', 'ok'];

describe('parseGrblSettings', () => {
  it('reads every $number=value line', () => {
    const s = parseGrblSettings(REPORT);
    expect(s.get(110)).toBe(30000);
    expect(s.get(120)).toBe(2500);
    expect(s.get(11)).toBe(0.01);
    expect(s.get(32)).toBe(1);
    expect(s.size).toBe(8);
  });
  it('copes with a time stamp, spaces, a negative number and lines that are not settings', () => {
    const s = parseGrblSettings(['9:46:40 pm  $110=30000.000', '$ 5 = x', '  $120 = 2500', 'Grbl 1.1h [$ for help]', '$130=-5']);
    expect(s.get(110)).toBe(30000);
    expect(s.get(120)).toBe(2500);
    expect(s.get(130)).toBe(-5);
    expect(s.size).toBe(3);
  });
  it('keeps the last value of a setting that appears twice, and nothing for no lines', () => {
    expect(parseGrblSettings(['$110=1000', '$110=2000']).get(110)).toBe(2000);
    expect(parseGrblSettings([]).size).toBe(0);
  });
});

describe('motionFromSettings', () => {
  it('picks the rapid speed, the acceleration and the junction deviation', () => {
    const r = motionFromSettings(parseGrblSettings(REPORT));
    expect(r.values).toEqual({ rapid_feed_mm_min: 30000, acceleration_mm_s2: 2500, junction_deviation_mm: 0.01 });
    expect(r.found).toBe(true);
    expect(r.notes).toEqual([]);
  });
  it('uses the smaller of two axes that differ, and says so', () => {
    const r = motionFromSettings(new Map([[110, 30000], [111, 24000], [120, 2500], [121, 2500]]));
    expect(r.values).toEqual({ rapid_feed_mm_min: 24000, acceleration_mm_s2: 2500 });
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toContain('rapid speeds');
    expect(r.notes[0]).toContain('smaller');
  });
  it('uses the one axis it has', () => {
    expect(motionFromSettings(new Map([[111, 18000]])).values).toEqual({ rapid_feed_mm_min: 18000 });
  });
  it('refuses a value outside what can be used', () => {
    const r = motionFromSettings(new Map([[110, 0], [120, 5e9], [11, -1]]));
    expect(r.values).toEqual({});
    expect(r.found).toBe(false);
    expect(r.notes).toHaveLength(3);
  });
  it('finds nothing in a reply with none of the settings', () => {
    const r = motionFromSettings(parseGrblSettings(['ok']));
    expect(r.found).toBe(false);
    expect(describeMotionRead(r)).toContain('did not report');
  });
});

describe('describeMotionRead', () => {
  it('says what was read, with units', () => {
    const text = describeMotionRead(motionFromSettings(parseGrblSettings(REPORT)));
    expect(text).toBe('Read from the machine: rapid speed 30000 mm/min, acceleration 2500 mm/s², junction deviation 0.01 mm.');
  });
  it('adds the notes', () => {
    const text = describeMotionRead(motionFromSettings(new Map([[110, 30000], [111, 24000]])));
    expect(text).toContain('rapid speed 24000 mm/min');
    expect(text).toContain('different rapid speeds');
  });
});
