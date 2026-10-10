// Which fonts this computer has, for the text tool's font list. Windows, macOS and Linux ship
// different fonts (Arial, Calibri and Segoe UI are not on most Linux machines), so a fixed
// list would offer fonts that silently fall back to something else.
//
// The detection is a measurement trick: text drawn in an installed font has a different width
// to the same text drawn in the browser's fallback font. The pure logic takes the measuring
// function as a parameter, so it is unit-tested in plain Node (tests/fonts.test.ts); only
// `installedFonts()` / `isFontAvailable()` at the bottom touch the browser.

/** Measures the width of `text` drawn in a CSS font-family list. */
export type Measure = (cssFontFamily: string, text: string) => number;

const WINDOWS_FONTS = ['Arial', 'Calibri', 'Segoe UI', 'Verdana', 'Tahoma', 'Impact', 'Times New Roman', 'Georgia', 'Consolas', 'Courier New'];
const MAC_FONTS = ['Helvetica', 'Helvetica Neue', 'Arial', 'Georgia', 'Times', 'Menlo', 'Courier'];
const LINUX_FONTS = [
  'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono', 'Liberation Sans', 'Liberation Serif', 'Liberation Mono',
  'Noto Sans', 'Noto Serif', 'Ubuntu', 'Cantarell', 'Open Sans', 'Roboto', 'Lato', 'FreeSans',
];

const unique = (names: readonly string[]) => names.filter((n, i) => names.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === i);

/** More fonts that are common on Windows and Mac, so more of the installed fonts are found. */
const MORE_SYSTEM_FONTS = [
  'Trebuchet MS', 'Comic Sans MS', 'Lucida Console', 'Lucida Sans Unicode', 'Palatino Linotype', 'Book Antiqua',
  'Garamond', 'Century Gothic', 'Franklin Gothic Medium', 'Cambria', 'Candara', 'Corbel', 'Constantia', 'Rockwell',
  'Gill Sans', 'Futura', 'Optima', 'Baskerville', 'Didot', 'Brush Script MT', 'Copperplate', 'Papyrus',
  'Segoe Print', 'Segoe Script', 'Ink Free', 'Bahnschrift', 'Cascadia Code', 'Cascadia Mono',
];

/** Every font worth checking for, on any platform. Only the ones that are installed are shown. */
export const CANDIDATE_FONTS: readonly string[] = unique([...WINDOWS_FONTS, ...MAC_FONTS, ...LINUX_FONTS, ...MORE_SYSTEM_FONTS]);

/** CSS generic families: always available, so there is always something to pick. */
export const GENERIC_FONTS: readonly string[] = ['sans-serif', 'serif', 'monospace'];

/** Preferred starting font, best first. Windows keeps Arial, as before. */
export const DEFAULT_FONT_PREFERENCE: readonly string[] = ['Arial', 'Helvetica', 'Liberation Sans', 'DejaVu Sans', 'Noto Sans', 'Ubuntu', 'Segoe UI'];

/** A string of wide and narrow glyphs, so different fonts measure differently. */
const PROBE = 'mmmmmmmmmmlli0O1WwQ';
const BASES = ['monospace', 'serif', 'sans-serif'] as const;

/** A font name made safe to put inside a CSS font-family list. */
export function cleanFontName(name: string): string {
  return name.replace(/["'\\;{}<>]/g, '').trim();
}

const isGeneric = (name: string) => GENERIC_FONTS.includes(name.toLowerCase());

/**
 * True when `name` is installed. A font that is not installed is replaced by the fallback, so
 * its width equals the fallback's. The three fallbacks differ from each other, so an installed
 * font can match at most one of them: it always shows up as different from at least two.
 */
export function isFontInstalled(name: string, measure: Measure): boolean {
  const clean = cleanFontName(name);
  if (clean === '') return false;
  if (isGeneric(clean)) return true;
  return BASES.some((base) => measure(`"${clean}", ${base}`, PROBE) !== measure(base, PROBE));
}

/** The candidates that are installed, in the order given. */
export function detectInstalledFonts(candidates: readonly string[], measure: Measure): string[] {
  return candidates.filter((name) => isFontInstalled(name, measure));
}

/** The font to start with: the most preferred one that is installed. */
export function pickDefaultFont(installed: readonly string[]): string {
  for (const wanted of DEFAULT_FONT_PREFERENCE) {
    const hit = installed.find((f) => f.toLowerCase() === wanted.toLowerCase());
    if (hit) return hit;
  }
  return installed[0] ?? 'sans-serif';
}

/** What the font list offers: the installed fonts, then the generic families. */
export function fontChoices(installed: readonly string[]): string[] {
  return unique([...installed, ...GENERIC_FONTS]);
}

// ---- the browser part -------------------------------------------------------------------

let canvasMeasure: Measure | null | undefined;

function getCanvasMeasure(): Measure | null {
  if (canvasMeasure !== undefined) return canvasMeasure;
  canvasMeasure = null;
  if (typeof document === 'undefined') return null;
  const ctx = document.createElement('canvas').getContext('2d');
  if (ctx) {
    canvasMeasure = (family, text) => {
      ctx.font = `72px ${family}`;
      return ctx.measureText(text).width;
    };
  }
  return canvasMeasure;
}

let installedCache: string[] | null = null;

/** The candidate fonts installed on this computer (measured once, then remembered). */
export function installedFonts(): string[] {
  if (installedCache) return installedCache;
  const measure = getCanvasMeasure();
  // No way to measure (should not happen in the app): offer only the generic families.
  installedCache = measure ? detectInstalledFonts(CANDIDATE_FONTS, measure) : [];
  return installedCache;
}

const availableCache = new Map<string, boolean>();

/**
 * Whether a font name (possibly typed by hand) is installed. Says true when it cannot tell,
 * so a measuring problem never shows a false warning.
 */
export function isFontAvailable(name: string): boolean {
  const measure = getCanvasMeasure();
  if (!measure) return true;
  const key = name.trim().toLowerCase();
  const known = availableCache.get(key);
  if (known !== undefined) return known;
  const result = isFontInstalled(name, measure);
  availableCache.set(key, result);
  return result;
}
