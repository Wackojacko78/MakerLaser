// Fonts that come with the app are loaded by the browser only when something first uses them. Text is
// drawn on a canvas and traced, and a canvas draws a font that has not loaded yet in the fallback
// font. So before drawing, ask the browser to load the face and wait. The logic takes the browser's
// font set as a parameter, so it is unit-tested in plain Node (tests/fontLoad.test.ts); only
// documentFontSet() touches the browser.

import { cleanFontName } from '@/lib/fonts';

/** The part of the browser's FontFaceSet (document.fonts) this file uses. */
export interface FontSetLike {
  check(font: string, text?: string): boolean;
  load(font: string, text?: string): Promise<unknown>;
}

const GENERIC = /^(sans-serif|serif|monospace)$/i;

/**
 * A font name made safe to put in a CSS font-family list. The generic families are left unquoted:
 * in quotes, "serif" would mean a font *named* serif, not the browser's serif.
 */
export function cssFontFamily(name: string): string {
  const clean = cleanFontName(name);
  if (clean === '') return 'sans-serif';
  if (GENERIC.test(clean)) return clean.toLowerCase();
  return `"${clean}", sans-serif`;
}

/** A CSS font shorthand for one face, as used by canvas and the font set. */
export function fontSpec(family: string, bold: boolean, italic: boolean, px: number = 16): string {
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${px}px ${cssFontFamily(family)}`;
}

// An empty string would ask about no characters at all, so ask about a space instead.
const sample = (text: string): string => (text === '' ? ' ' : text);

/**
 * True when the font can be drawn with right now: it is installed on the computer, it is not one of
 * the fonts that come with the app, or it has already loaded. Also true when there is no font set to
 * ask, so nothing ever waits for something that cannot happen.
 */
export function fontReady(set: FontSetLike | undefined, family: string, bold: boolean, italic: boolean, text: string): boolean {
  if (!set) return true;
  try {
    return set.check(fontSpec(family, bold, italic), sample(text));
  } catch {
    return true;
  }
}

/** Asks the browser to load the face (and the character sets the text needs). Never throws. */
export async function loadFont(set: FontSetLike | undefined, family: string, bold: boolean, italic: boolean, text: string): Promise<boolean> {
  if (!set) return true;
  try {
    await set.load(fontSpec(family, bold, italic), sample(text));
  } catch {
    /* a face that cannot load is drawn in the fallback font, as before */
  }
  return fontReady(set, family, bold, italic, text);
}

/** The browser's font set, or undefined outside a browser. */
export function documentFontSet(): FontSetLike | undefined {
  return typeof document !== 'undefined' && document.fonts ? document.fonts : undefined;
}
