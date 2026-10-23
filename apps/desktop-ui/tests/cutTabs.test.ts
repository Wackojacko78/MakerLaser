import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TAB_SPACING_MM,
  MAX_TAB_SPACING_MM,
  MAX_TAB_WIDTH_MM,
  MIN_TAB_SPACING_MM,
  MIN_TAB_WIDTH_MM,
  clampTabSpacing,
  clampTabWidth,
  tabSpacing,
  tabWidth,
  tabsOn,
} from '@/lib/cutTabs';

describe('the limits', () => {
  it('are the ones the Rust layer checks use', () => {
    // packages/common/src/layers.rs: MAX_TAB_WIDTH_MM, MIN_TAB_SPACING_MM, MAX_TAB_SPACING_MM and default_tab_spacing.
    expect(MAX_TAB_WIDTH_MM).toBe(20);
    expect(MIN_TAB_SPACING_MM).toBe(5);
    expect(MAX_TAB_SPACING_MM).toBe(1000);
    expect(DEFAULT_TAB_SPACING_MM).toBe(50);
    expect(MIN_TAB_WIDTH_MM).toBeGreaterThan(0);
  });
});

describe('tabWidth and tabSpacing', () => {
  it('are off and the usual 50 mm for a layer saved before tabs existed', () => {
    expect(tabWidth({})).toBe(0);
    expect(tabSpacing({})).toBe(50);
  });
  it('follow what is saved', () => {
    expect(tabWidth({ tab_width_mm: 2.5 })).toBe(2.5);
    expect(tabSpacing({ tab_spacing_mm: 80 })).toBe(80);
    expect(tabWidth({ tab_width_mm: 0 })).toBe(0);
  });
});

describe('clampTabWidth', () => {
  it('keeps a sensible width as it is', () => {
    expect(clampTabWidth(2)).toBe(2);
    expect(clampTabWidth(0.5)).toBe(0.5);
    expect(clampTabWidth(MAX_TAB_WIDTH_MM)).toBe(MAX_TAB_WIDTH_MM);
  });
  it('turns 0, a negative number and something that is not a number into off', () => {
    for (const bad of [0, -3, Number.NaN, Number.NEGATIVE_INFINITY]) expect(clampTabWidth(bad)).toBe(0);
  });
  it('brings a width that is too small up to the smallest, and one that is too big down to the largest', () => {
    expect(clampTabWidth(0.01)).toBe(MIN_TAB_WIDTH_MM);
    expect(clampTabWidth(35)).toBe(MAX_TAB_WIDTH_MM);
    expect(clampTabWidth(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('clampTabSpacing', () => {
  it('keeps a sensible spacing as it is', () => {
    expect(clampTabSpacing(50)).toBe(50);
    expect(clampTabSpacing(MIN_TAB_SPACING_MM)).toBe(MIN_TAB_SPACING_MM);
    expect(clampTabSpacing(MAX_TAB_SPACING_MM)).toBe(MAX_TAB_SPACING_MM);
  });
  it('keeps it between the closest and the furthest apart', () => {
    expect(clampTabSpacing(1)).toBe(MIN_TAB_SPACING_MM);
    expect(clampTabSpacing(0)).toBe(MIN_TAB_SPACING_MM);
    expect(clampTabSpacing(-20)).toBe(MIN_TAB_SPACING_MM);
    expect(clampTabSpacing(5000)).toBe(MAX_TAB_SPACING_MM);
  });
  it('uses the usual 50 mm for something that is not a number', () => {
    expect(clampTabSpacing(Number.NaN)).toBe(DEFAULT_TAB_SPACING_MM);
    expect(clampTabSpacing(Number.POSITIVE_INFINITY)).toBe(DEFAULT_TAB_SPACING_MM);
  });
});

describe('tabsOn', () => {
  it('is true only for a Cut layer with a width above 0', () => {
    expect(tabsOn({ kind: 'cut', tab_width_mm: 2 })).toBe(true);
    expect(tabsOn({ kind: 'cut', tab_width_mm: 0 })).toBe(false);
    expect(tabsOn({ kind: 'cut' })).toBe(false);
  });
  it('is false for the layers that ignore tabs, whatever the setting', () => {
    for (const kind of ['score', 'fill', 'image'] as const) expect(tabsOn({ kind, tab_width_mm: 2 })).toBe(false);
  });
});
