import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_FONTS,
  GENERIC_FONTS,
  cleanFontName,
  detectInstalledFonts,
  fontChoices,
  isFontAvailable,
  isFontInstalled,
  pickDefaultFont,
  type Measure,
} from '@/lib/fonts';

/**
 * A fake machine: each installed font has its own width; a font that is not installed is
 * replaced by the next family in the list (the fallback), like a real browser does.
 */
function machine(installed: readonly string[], widths: Record<string, number> = {}): Measure {
  const bases: Record<string, number> = { monospace: 90, serif: 80, 'sans-serif': 85 };
  const widthOf = (name: string) => widths[name] ?? 200 + name.length * 7;
  const have = new Set(installed.map((n) => n.toLowerCase()));
  return (css) => {
    for (const part of css.split(',').map((p) => p.trim())) {
      const name = part.replace(/^"|"$/g, '');
      if (name in bases) return bases[name] as number;
      if (have.has(name.toLowerCase())) return widthOf(name);
    }
    return 0;
  };
}

describe('isFontInstalled', () => {
  const m = machine(['Arial', 'DejaVu Sans']);
  it('is true for an installed font and false for one that is not', () => {
    expect(isFontInstalled('Arial', m)).toBe(true);
    expect(isFontInstalled('Calibri', m)).toBe(false);
  });
  it('ignores case, spaces and quote characters', () => {
    expect(isFontInstalled('  arial ', m)).toBe(true);
    expect(isFontInstalled('"Arial"', m)).toBe(true);
    expect(isFontInstalled("Dejavu' Sans", m)).toBe(true);
  });
  it('treats the generic families as always installed, and an empty name as not', () => {
    expect(isFontInstalled('sans-serif', m)).toBe(true);
    expect(isFontInstalled('Monospace', m)).toBe(true);
    expect(isFontInstalled('', m)).toBe(false);
    expect(isFontInstalled('   ', m)).toBe(false);
  });
  it('still finds a font whose width happens to equal one of the fallback widths', () => {
    // Liberation Mono measures exactly like the monospace fallback here, but not like serif or sans-serif.
    const same = machine(['Liberation Mono'], { 'Liberation Mono': 90 });
    expect(isFontInstalled('Liberation Mono', same)).toBe(true);
    const sameAsSerif = machine(['Georgia'], { Georgia: 80 });
    expect(isFontInstalled('Georgia', sameAsSerif)).toBe(true);
  });
  it('cannot be fooled by a font name that tries to add CSS', () => {
    const seen: string[] = [];
    isFontInstalled('Evil"; color: red', (css) => {
      seen.push(css);
      return 1;
    });
    expect(seen.every((css) => !css.includes(';'))).toBe(true);
  });
});

describe('detectInstalledFonts', () => {
  it('keeps the candidates that are installed, in the given order', () => {
    const m = machine(['Verdana', 'Arial', 'Georgia']);
    expect(detectInstalledFonts(['Arial', 'Calibri', 'Verdana', 'Impact', 'Georgia'], m)).toEqual(['Arial', 'Verdana', 'Georgia']);
  });
  it('finds nothing on a machine with no fonts', () => {
    expect(detectInstalledFonts(CANDIDATE_FONTS, machine([]))).toEqual([]);
  });
  it('on a Windows-like machine finds the Windows fonts and not the Linux ones', () => {
    const win = ['Arial', 'Calibri', 'Segoe UI', 'Verdana', 'Tahoma', 'Impact', 'Times New Roman', 'Georgia', 'Consolas', 'Courier New'];
    const found = detectInstalledFonts(CANDIDATE_FONTS, machine(win));
    expect(found).toEqual(CANDIDATE_FONTS.filter((f) => win.includes(f)));
    expect(found.includes('DejaVu Sans')).toBe(false);
  });
  it('on a Linux-like machine finds the Linux fonts and not Calibri', () => {
    const linux = ['DejaVu Sans', 'DejaVu Sans Mono', 'Liberation Sans', 'Noto Sans', 'Ubuntu'];
    const found = detectInstalledFonts(CANDIDATE_FONTS, machine(linux));
    expect(found.sort()).toEqual([...linux].sort());
  });
});

describe('the candidate list', () => {
  it('has no duplicates (ignoring case) and no generic families', () => {
    const lower = CANDIDATE_FONTS.map((f) => f.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
    expect(CANDIDATE_FONTS.some((f) => GENERIC_FONTS.includes(f))).toBe(false);
  });
  it('contains no characters that could break a CSS font-family list', () => {
    for (const f of CANDIDATE_FONTS) expect(cleanFontName(f)).toBe(f);
  });
});

describe('pickDefaultFont', () => {
  it('keeps Arial when it is installed, so Windows behaves as before', () => {
    expect(pickDefaultFont(['Calibri', 'Arial', 'Verdana'])).toBe('Arial');
  });
  it('falls back through the preference list on other systems', () => {
    expect(pickDefaultFont(['DejaVu Sans', 'Liberation Sans', 'Noto Sans'])).toBe('Liberation Sans');
    expect(pickDefaultFont(['Noto Sans', 'DejaVu Sans'])).toBe('DejaVu Sans');
    expect(pickDefaultFont(['Noto Sans', 'Lato'])).toBe('Noto Sans');
  });
  it('takes the first installed font when none is preferred, and sans-serif when there are none', () => {
    expect(pickDefaultFont(['Lato', 'Roboto'])).toBe('Lato');
    expect(pickDefaultFont([])).toBe('sans-serif');
  });
  it('returns the name as it appears in the installed list', () => {
    expect(pickDefaultFont(['arial'])).toBe('arial');
  });
});

describe('fontChoices', () => {
  it('lists the installed fonts then the generic families', () => {
    expect(fontChoices(['Arial', 'Verdana'])).toEqual(['Arial', 'Verdana', 'sans-serif', 'serif', 'monospace']);
  });
  it('always offers something, even with no installed fonts', () => {
    expect(fontChoices([])).toEqual(['sans-serif', 'serif', 'monospace']);
  });
  it('does not repeat a generic family', () => {
    expect(fontChoices(['Monospace', 'Arial'])).toEqual(['Monospace', 'Arial', 'sans-serif', 'serif']);
  });
});

describe('without a browser', () => {
  it('isFontAvailable says true when it cannot measure, so there is never a false warning', () => {
    expect(isFontAvailable('Some Font That Does Not Exist')).toBe(true);
  });
});
