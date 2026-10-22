import { describe, expect, it } from 'vitest';
import { MODELLED_NOTE, SIMPLE_NOTE, describeEstimate } from '@/lib/estimateInfo';

describe('describeEstimate', () => {
  it('gives the total, the laser-off part and the modelled note for a response that has the new fields', () => {
    const v = describeEstimate({ estimated_seconds: 760, estimated_travel_seconds: 245, estimate_modelled: true });
    expect(v).toEqual({ totalSeconds: 760, travelSeconds: 245, modelled: true, note: MODELLED_NOTE });
  });
  it('gives the simple note when the machine has no acceleration', () => {
    const v = describeEstimate({ estimated_seconds: 100, estimated_travel_seconds: 10, estimate_modelled: false });
    expect(v.modelled).toBe(false);
    expect(v.note).toBe(SIMPLE_NOTE);
    expect(SIMPLE_NOTE).toContain('ignores acceleration');
  });
  it('treats a response from before the new fields as the simple estimate with no laser-off figure', () => {
    const v = describeEstimate({ estimated_seconds: 100 });
    expect(v).toEqual({ totalSeconds: 100, travelSeconds: null, modelled: false, note: SIMPLE_NOTE });
  });
  it('never shows a laser-off part that is more than the whole, or one that is not a number', () => {
    expect(describeEstimate({ estimated_seconds: 50, estimated_travel_seconds: 80, estimate_modelled: true }).travelSeconds).toBe(50);
    expect(describeEstimate({ estimated_seconds: 50, estimated_travel_seconds: Number.NaN }).travelSeconds).toBeNull();
    expect(describeEstimate({ estimated_seconds: 50, estimated_travel_seconds: -3 }).travelSeconds).toBeNull();
  });
  it('turns a total that is not a number into 0', () => {
    expect(describeEstimate({ estimated_seconds: Number.NaN }).totalSeconds).toBe(0);
    expect(describeEstimate({ estimated_seconds: -5 }).totalSeconds).toBe(0);
  });
});
