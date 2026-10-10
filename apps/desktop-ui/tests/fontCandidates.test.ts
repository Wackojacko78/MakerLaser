import { describe, expect, it } from 'vitest';
import { CANDIDATE_FONTS, cleanFontName, detectInstalledFonts, type Measure } from '../src/lib/fonts';

/** A fake machine with only the given fonts installed. */
function machine(installed: readonly string[]): Measure {
  const bases: Record<string, number> = { monospace: 90, serif: 80, 'sans-serif': 85 };
  const have = new Set(installed.map((n) => n.toLowerCase()));
  return (css) => {
    for (const part of css.split(',').map((p) => p.trim())) {
      const name = part.replace(/^"|"$/g, '');
      if (name in bases) return bases[name] as number;
      if (have.has(name.toLowerCase())) return 200 + name.length * 7;
    }
    return 0;
  };
}

describe('more installed fonts are looked for', () => {
  it('includes common Windows and Mac fonts beyond the first list', () => {
    for (const name of ['Trebuchet MS', 'Comic Sans MS', 'Palatino Linotype', 'Century Gothic', 'Rockwell', 'Brush Script MT', 'Ink Free', 'Futura', 'Baskerville']) {
      expect(CANDIDATE_FONTS.includes(name)).toBe(true);
    }
  });

  it('keeps the original fonts', () => {
    for (const name of ['Arial', 'Segoe UI', 'Times New Roman', 'DejaVu Sans', 'Helvetica']) {
      expect(CANDIDATE_FONTS.includes(name)).toBe(true);
    }
  });

  it('has no repeats and nothing that could break a CSS font list', () => {
    const lower = CANDIDATE_FONTS.map((f) => f.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
    for (const f of CANDIDATE_FONTS) expect(cleanFontName(f)).toBe(f);
  });

  it('finds an added font on a machine that has it, and does not invent it on one that does not', () => {
    expect(detectInstalledFonts(CANDIDATE_FONTS, machine(['Trebuchet MS', 'Arial']))).toEqual(['Arial', 'Trebuchet MS'].sort((a, b) => CANDIDATE_FONTS.indexOf(a) - CANDIDATE_FONTS.indexOf(b)));
    expect(detectInstalledFonts(CANDIDATE_FONTS, machine(['Arial'])).includes('Trebuchet MS')).toBe(false);
  });
});
