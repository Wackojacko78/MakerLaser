import { describe, expect, it } from 'vitest';
import { clamp, errorMessage, formatDuration, formatLength, formatNumber } from '@/lib/format';

describe('format helpers', () => {
  it('formats numbers without trailing zeros', () => {
    expect(formatNumber(10)).toBe('10');
    expect(formatNumber(10.5)).toBe('10.5');
    expect(formatNumber(1 / 3)).toBe('0.333');
    expect(formatNumber(NaN)).toBe('0');
  });

  it('clamps with optional bounds', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2)).toBe(2);
  });

  it('formats durations', () => {
    expect(formatDuration(0.2)).toBe('<1s');
    expect(formatDuration(75)).toBe('1m 15s');
    expect(formatDuration(3725)).toBe('1h 02m');
    expect(formatDuration(NaN)).toBe('-');
  });

  it('formats lengths', () => {
    expect(formatLength(250)).toBe('250 mm');
    expect(formatLength(1500)).toBe('1.50 m');
  });

  it('extracts readable error text from whatever Tauri rejects with', () => {
    expect(errorMessage('plain string')).toBe('plain string');
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage({ code: 1 })).toBe('{"code":1}');
  });
});
