import { describe, expect, it } from 'vitest';
import {
  BUNDLED_FONTS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  allCssImportPaths,
  bundledInCategory,
  cssImportPaths,
  isBundledFont,
  npmInstallCommand,
} from '../src/lib/bundledFonts';
import { GENERIC_FONTS, cleanFontName } from '../src/lib/fonts';

const kebab = (family: string): string => family.toLowerCase().replace(/ /g, '-');

describe('the bundled font list', () => {
  it('offers a good range', () => {
    expect(BUNDLED_FONTS.length).toBeGreaterThanOrEqual(30);
  });

  it('has no repeated family or package', () => {
    const families = BUNDLED_FONTS.map((f) => f.family.toLowerCase());
    const packages = BUNDLED_FONTS.map((f) => f.pkg);
    expect(new Set(families).size).toBe(families.length);
    expect(new Set(packages).size).toBe(packages.length);
  });

  it('names each package after its family, as Fontsource does', () => {
    for (const f of BUNDLED_FONTS) {
      expect(f.pkg).toBe(kebab(f.family));
      expect(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.pkg)).toBe(true);
    }
  });

  it('uses family names that are safe to put in CSS and are not generic families', () => {
    for (const f of BUNDLED_FONTS) {
      expect(cleanFontName(f.family)).toBe(f.family);
      expect(GENERIC_FONTS.includes(f.family.toLowerCase())).toBe(false);
    }
  });

  it('always includes the regular weight, and only weights that make sense', () => {
    for (const f of BUNDLED_FONTS) {
      expect(f.weights.includes(400)).toBe(true);
      expect(f.weights.every((w) => w === 400 || w === 700)).toBe(true);
      expect(new Set(f.weights).size).toBe(f.weights.length);
    }
  });

  it('puts every font in a category that has a label, and fills every category', () => {
    for (const f of BUNDLED_FONTS) expect(CATEGORY_ORDER.includes(f.category)).toBe(true);
    for (const c of CATEGORY_ORDER) {
      expect(CATEGORY_LABELS[c].length).toBeGreaterThan(0);
      expect(bundledInCategory(c).length).toBeGreaterThan(0);
    }
    expect(CATEGORY_ORDER.reduce((n, c) => n + bundledInCategory(c).length, 0)).toBe(BUNDLED_FONTS.length);
  });

  it('includes the fonts people ask for first, in each kind', () => {
    for (const name of ['Roboto', 'Open Sans', 'Montserrat', 'Playfair Display', 'Roboto Slab', 'Bebas Neue', 'Pacifico', 'JetBrains Mono']) {
      expect(isBundledFont(name)).toBe(true);
    }
  });

  it('has the Latin Extended characters (macrons) in the fonts used for everyday text', () => {
    for (const name of ['Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Merriweather', 'Roboto Slab']) {
      expect(BUNDLED_FONTS.find((f) => f.family === name)?.latinExt).toBe(true);
    }
  });
});

describe('isBundledFont', () => {
  it('ignores case and spaces at the ends, and nothing else', () => {
    expect(isBundledFont('roboto slab')).toBe(true);
    expect(isBundledFont('  Roboto Slab  ')).toBe(true);
    expect(isBundledFont('RobotoSlab')).toBe(false);
    expect(isBundledFont('Arial')).toBe(false);
    expect(isBundledFont('')).toBe(false);
  });
});

describe('cssImportPaths', () => {
  const find = (family: string) => {
    const font = BUNDLED_FONTS.find((f) => f.family === family);
    if (!font) throw new Error(`no ${family}`);
    return font;
  };

  it('lists latin and latin-ext for each weight, with italics when the font has them', () => {
    expect(cssImportPaths(find('Roboto')).sort()).toEqual(
      [
        '@fontsource/roboto/latin-400.css',
        '@fontsource/roboto/latin-400-italic.css',
        '@fontsource/roboto/latin-700.css',
        '@fontsource/roboto/latin-700-italic.css',
        '@fontsource/roboto/latin-ext-400.css',
        '@fontsource/roboto/latin-ext-400-italic.css',
        '@fontsource/roboto/latin-ext-700.css',
        '@fontsource/roboto/latin-ext-700-italic.css',
      ].sort(),
    );
  });

  it('lists only what a one-weight display font has', () => {
    expect(cssImportPaths(find('Bebas Neue'))).toEqual(['@fontsource/bebas-neue/latin-400.css']);
  });

  it('has no repeats across the whole list, and every path has the shape Fontsource uses', () => {
    const all = allCssImportPaths();
    expect(new Set(all).size).toBe(all.length);
    for (const p of all) expect(/^@fontsource\/[a-z0-9-]+\/(latin|latin-ext)-(400|700)(-italic)?\.css$/.test(p)).toBe(true);
  });
});

describe('npmInstallCommand', () => {
  it('installs every font package into the UI workspace', () => {
    const command = npmInstallCommand();
    expect(command.startsWith('npm install -w desktop-ui ')).toBe(true);
    for (const f of BUNDLED_FONTS) expect(command.includes(` @fontsource/${f.pkg}`)).toBe(true);
  });
});
