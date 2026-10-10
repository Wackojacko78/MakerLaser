import { describe, expect, it } from 'vitest';
import { BUNDLED_FONTS, CATEGORY_ORDER } from '../src/lib/bundledFonts';
import { GROUP_GENERIC, GROUP_INSTALLED, GROUP_MISSING, bundledCount, fontOptionGroups } from '../src/lib/fontPicker';

const labels = (installed: string[], current = 'Arial') => fontOptionGroups(installed, current).groups.map((g) => g.label);
const values = (installed: string[], current = 'Arial') => fontOptionGroups(installed, current).groups.flatMap((g) => g.options.map((o) => o.value));

describe('fontOptionGroups', () => {
  it('shows installed fonts first, then each kind of bundled font, then the generic families', () => {
    const groups = labels(['Arial', 'Verdana']);
    expect(groups[0]).toBe(GROUP_INSTALLED);
    expect(groups.slice(1, 1 + CATEGORY_ORDER.length)).toEqual([
      'Sans-serif (included)',
      'Serif (included)',
      'Slab serif (included)',
      'Display and headline (included)',
      'Script and handwriting (included)',
      'Monospace (included)',
    ]);
    expect(groups[groups.length - 1]).toBe(GROUP_GENERIC);
  });

  it('lists every bundled font exactly once', () => {
    const all = values([]);
    for (const f of BUNDLED_FONTS) expect(all.filter((v) => v === f.family).length).toBe(1);
    expect(bundledCount()).toBe(BUNDLED_FONTS.length);
  });

  it('sorts the installed fonts and does not repeat one that is also bundled', () => {
    const installed = fontOptionGroups(['Verdana', 'Arial', 'Roboto', 'Calibri', 'Open Sans'], 'Arial').groups[0];
    expect(installed?.options.map((o) => o.value)).toEqual(['Arial', 'Calibri', 'Verdana']);
    expect(values(['Roboto']).filter((v) => v === 'Roboto').length).toBe(1);
  });

  it('leaves out the installed group when nothing is installed', () => {
    expect(labels([], 'Roboto')[0]).toBe('Sans-serif (included)');
    expect(labels([], 'Roboto').includes(GROUP_INSTALLED)).toBe(false);
  });

  it('does not offer a generic family twice', () => {
    expect(values(['Monospace', 'Arial']).filter((v) => v.toLowerCase() === 'monospace').length).toBe(1);
  });

  it('selects the font in use, with the capital letters the list uses', () => {
    expect(fontOptionGroups(['Arial'], 'arial').selected).toBe('Arial');
    expect(fontOptionGroups([], '  roboto slab ').selected).toBe('Roboto Slab');
    expect(fontOptionGroups([], 'SERIF').selected).toBe('serif');
  });

  it('shows a font that is in use but is not available here, instead of quietly changing it', () => {
    const picker = fontOptionGroups(['Arial'], 'Calibri');
    expect(picker.selected).toBe('Calibri');
    expect(picker.groups[0]?.label).toBe(GROUP_MISSING);
    expect(picker.groups[0]?.options).toEqual([{ value: 'Calibri', label: 'Calibri (not installed)', css: null }]);
  });

  it('starts on sans-serif when no font is set', () => {
    expect(fontOptionGroups([], '').selected).toBe('sans-serif');
    expect(fontOptionGroups([], '   ').selected).toBe('sans-serif');
  });

  it('gives each real font a CSS family to preview itself in, and the generic ones none', () => {
    const groups = fontOptionGroups(['Arial'], 'Arial').groups;
    expect(groups.find((g) => g.label === GROUP_INSTALLED)?.options[0]?.css).toBe('"Arial", sans-serif');
    expect(groups.flatMap((g) => g.options).find((o) => o.value === 'Roboto Slab')?.css).toBe('"Roboto Slab", sans-serif');
    expect(groups.find((g) => g.label === GROUP_GENERIC)?.options.every((o) => o.css === null)).toBe(true);
  });
});
