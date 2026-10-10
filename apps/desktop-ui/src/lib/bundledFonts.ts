// The fonts that ship inside MakerLaser, so text looks the same on every computer and works
// offline. They come from Fontsource (npm packages that carry the font files); fonts/bundled.ts
// imports their CSS. This file is plain data and helpers (no browser, React or Tauri imports), so
// it is unit-tested in plain Node (tests/bundledFonts*.test.ts).
//
// To add a font: add a line to BUNDLED_FONTS, run `npm install -w desktop-ui @fontsource/<package>`,
// add its import lines to fonts/bundled.ts (the tests list the ones that are missing).

export type FontCategory = 'sans' | 'serif' | 'slab' | 'display' | 'script' | 'mono';
export type FontWeight = 400 | 700;

export interface BundledFont {
  /** The CSS font-family name, which is also what is saved with the text. */
  family: string;
  /** The Fontsource npm package, without the "@fontsource/" prefix. */
  pkg: string;
  category: FontCategory;
  /** The weights that are included. Bold on a font with only 400 is synthesised by the browser. */
  weights: readonly FontWeight[];
  /** Italic faces are included (otherwise the browser slants the regular face). */
  italic: boolean;
  /** The Latin Extended subset is included, which has macrons (ā ē ī ō ū), Polish, Czech and so on. */
  latinExt: boolean;
}

export const BUNDLED_FONTS: readonly BundledFont[] = [
  { family: 'Roboto', pkg: 'roboto', category: 'sans', weights: [400, 700], italic: true, latinExt: true },
  { family: 'Open Sans', pkg: 'open-sans', category: 'sans', weights: [400, 700], italic: true, latinExt: true },
  { family: 'Lato', pkg: 'lato', category: 'sans', weights: [400, 700], italic: true, latinExt: true },
  { family: 'Montserrat', pkg: 'montserrat', category: 'sans', weights: [400, 700], italic: false, latinExt: true },
  { family: 'Poppins', pkg: 'poppins', category: 'sans', weights: [400, 700], italic: false, latinExt: true },
  { family: 'Nunito', pkg: 'nunito', category: 'sans', weights: [400, 700], italic: false, latinExt: true },
  { family: 'Raleway', pkg: 'raleway', category: 'sans', weights: [400, 700], italic: false, latinExt: true },
  { family: 'Inter', pkg: 'inter', category: 'sans', weights: [400, 700], italic: false, latinExt: true },
  { family: 'Oswald', pkg: 'oswald', category: 'sans', weights: [400, 700], italic: false, latinExt: true },
  { family: 'Merriweather', pkg: 'merriweather', category: 'serif', weights: [400, 700], italic: true, latinExt: true },
  { family: 'Playfair Display', pkg: 'playfair-display', category: 'serif', weights: [400, 700], italic: false, latinExt: true },
  { family: 'Lora', pkg: 'lora', category: 'serif', weights: [400, 700], italic: true, latinExt: true },
  { family: 'PT Serif', pkg: 'pt-serif', category: 'serif', weights: [400, 700], italic: false, latinExt: true },
  { family: 'Cinzel', pkg: 'cinzel', category: 'serif', weights: [400, 700], italic: false, latinExt: false },
  { family: 'Roboto Slab', pkg: 'roboto-slab', category: 'slab', weights: [400, 700], italic: false, latinExt: true },
  { family: 'Bitter', pkg: 'bitter', category: 'slab', weights: [400, 700], italic: false, latinExt: true },
  { family: 'Bebas Neue', pkg: 'bebas-neue', category: 'display', weights: [400], italic: false, latinExt: false },
  { family: 'Anton', pkg: 'anton', category: 'display', weights: [400], italic: false, latinExt: false },
  { family: 'Abril Fatface', pkg: 'abril-fatface', category: 'display', weights: [400], italic: false, latinExt: false },
  { family: 'Archivo Black', pkg: 'archivo-black', category: 'display', weights: [400], italic: false, latinExt: false },
  { family: 'Righteous', pkg: 'righteous', category: 'display', weights: [400], italic: false, latinExt: false },
  { family: 'Bangers', pkg: 'bangers', category: 'display', weights: [400], italic: false, latinExt: false },
  { family: 'Black Ops One', pkg: 'black-ops-one', category: 'display', weights: [400], italic: false, latinExt: false },
  { family: 'Orbitron', pkg: 'orbitron', category: 'display', weights: [400, 700], italic: false, latinExt: false },
  { family: 'Press Start 2P', pkg: 'press-start-2p', category: 'display', weights: [400], italic: false, latinExt: false },
  { family: 'Pacifico', pkg: 'pacifico', category: 'script', weights: [400], italic: false, latinExt: false },
  { family: 'Dancing Script', pkg: 'dancing-script', category: 'script', weights: [400, 700], italic: false, latinExt: false },
  { family: 'Lobster', pkg: 'lobster', category: 'script', weights: [400], italic: false, latinExt: false },
  { family: 'Great Vibes', pkg: 'great-vibes', category: 'script', weights: [400], italic: false, latinExt: false },
  { family: 'Caveat', pkg: 'caveat', category: 'script', weights: [400, 700], italic: false, latinExt: false },
  { family: 'Permanent Marker', pkg: 'permanent-marker', category: 'script', weights: [400], italic: false, latinExt: false },
  { family: 'Satisfy', pkg: 'satisfy', category: 'script', weights: [400], italic: false, latinExt: false },
  { family: 'Source Code Pro', pkg: 'source-code-pro', category: 'mono', weights: [400, 700], italic: false, latinExt: true },
  { family: 'JetBrains Mono', pkg: 'jetbrains-mono', category: 'mono', weights: [400, 700], italic: false, latinExt: true },
  { family: 'Roboto Mono', pkg: 'roboto-mono', category: 'mono', weights: [400, 700], italic: false, latinExt: true },
];

export const CATEGORY_ORDER: readonly FontCategory[] = ['sans', 'serif', 'slab', 'display', 'script', 'mono'];

export const CATEGORY_LABELS: Record<FontCategory, string> = {
  sans: 'Sans-serif',
  serif: 'Serif',
  slab: 'Slab serif',
  display: 'Display and headline',
  script: 'Script and handwriting',
  mono: 'Monospace',
};

/** True when the name is one of the bundled fonts (ignoring case and spaces at the ends). */
export function isBundledFont(name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return BUNDLED_FONTS.some((f) => f.family.toLowerCase() === wanted);
}

/** The bundled fonts of one category, in list order. */
export function bundledInCategory(category: FontCategory): BundledFont[] {
  return BUNDLED_FONTS.filter((f) => f.category === category);
}

/** The CSS files (as imported in fonts/bundled.ts) that one font needs. */
export function cssImportPaths(font: BundledFont): string[] {
  const subsets = font.latinExt ? ['latin', 'latin-ext'] : ['latin'];
  const out: string[] = [];
  for (const weight of font.weights) {
    for (const subset of subsets) {
      out.push(`@fontsource/${font.pkg}/${subset}-${weight}.css`);
      if (font.italic) out.push(`@fontsource/${font.pkg}/${subset}-${weight}-italic.css`);
    }
  }
  return out;
}

/** Every CSS import, for every bundled font. */
export function allCssImportPaths(): string[] {
  return BUNDLED_FONTS.flatMap(cssImportPaths);
}

/** The npm command that installs every font package (run it from the repo root). */
export function npmInstallCommand(): string {
  return `npm install -w desktop-ui ${BUNDLED_FONTS.map((f) => `@fontsource/${f.pkg}`).join(' ')}`;
}
