// What the font list in the text editor shows: the fonts installed on this computer, the fonts that
// come with MakerLaser (by kind), and the generic families. Pure TypeScript, unit-tested in plain
// Node (tests/fontPicker.test.ts).

import { BUNDLED_FONTS, CATEGORY_LABELS, CATEGORY_ORDER, bundledInCategory, isBundledFont } from '@/lib/bundledFonts';
import { cssFontFamily } from '@/lib/fontLoad';
import { GENERIC_FONTS } from '@/lib/fonts';

export interface FontOption {
  value: string;
  label: string;
  /** CSS font-family to show the name in its own face, or null to show it plainly. */
  css: string | null;
}

export interface FontGroup {
  label: string;
  options: FontOption[];
}

export interface FontPicker {
  groups: FontGroup[];
  /** The option value that matches the font in use, with the capital letters the list uses. */
  selected: string;
}

export const GROUP_INSTALLED = 'Installed on this computer';
export const GROUP_GENERIC = 'Generic';
export const GROUP_MISSING = 'Not available on this computer';

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The font list for the text editor. `installed` is what was found on this computer and `current` is
 * the font the text uses. A font that is in use but is not in any list (a project made on another
 * computer) is added at the top, so the box shows it honestly instead of quietly changing it.
 */
export function fontOptionGroups(installed: readonly string[], current: string): FontPicker {
  const groups: FontGroup[] = [];

  const mine = installed
    .filter((name) => !isBundledFont(name) && !GENERIC_FONTS.some((g) => sameName(g, name)))
    .slice()
    .sort((a, b) => a.localeCompare(b));
  if (mine.length > 0) {
    groups.push({ label: GROUP_INSTALLED, options: mine.map((name) => ({ value: name, label: name, css: cssFontFamily(name) })) });
  }

  for (const category of CATEGORY_ORDER) {
    const fonts = bundledInCategory(category);
    if (fonts.length > 0) {
      groups.push({
        label: `${CATEGORY_LABELS[category]} (included)`,
        options: fonts.map((f) => ({ value: f.family, label: f.family, css: cssFontFamily(f.family) })),
      });
    }
  }

  groups.push({ label: GROUP_GENERIC, options: GENERIC_FONTS.map((name) => ({ value: name, label: name, css: null })) });

  const wanted = current.trim();
  if (wanted === '') return { groups, selected: GENERIC_FONTS[0] ?? 'sans-serif' };
  for (const group of groups) {
    const hit = group.options.find((o) => sameName(o.value, wanted));
    if (hit) return { groups, selected: hit.value };
  }
  groups.unshift({ label: GROUP_MISSING, options: [{ value: wanted, label: `${wanted} (not installed)`, css: null }] });
  return { groups, selected: wanted };
}

/** How many fonts come with MakerLaser (for a hint under the list). */
export function bundledCount(): number {
  return BUNDLED_FONTS.length;
}
