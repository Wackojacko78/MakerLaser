// Draws text with the browser's own font engine (any font installed on the PC), then traces
// the result into closed outlines with src/lib/textTrace.ts. Needs a DOM canvas, so it is not
// unit-tested in Node; the tracing it relies on is (tests/textTrace.test.ts).

import { alphaFromRGBA, alphaToShape, type TextShape } from '@/lib/textTrace';

export type TextAlign = 'left' | 'center' | 'right';

export interface TextStyle {
  text: string;
  /** A font family installed on this PC, e.g. "Arial" or "Segoe UI". */
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  /** Height of a capital letter, in mm. */
  capHeightMm: number;
  align: TextAlign;
  /** Distance between lines as a multiple of the font size. */
  lineSpacing: number;
}

export const MAX_TEXT_CHARS = 500;
export const MIN_CAP_HEIGHT_MM = 1;
export const MAX_CAP_HEIGHT_MM = 200;

const TARGET_PX_PER_MM = 16; // 0.0625 mm per pixel
const MIN_PX_PER_MM = 3;
const MAX_CANVAS_DIM = 8192;
const MAX_CANVAS_PIXELS = 24_000_000;

function family(name: string): string {
  const clean = name.replace(/["'\\;{}]/g, '').trim();
  if (clean === '') return 'sans-serif';
  // The generic families must not be quoted: "serif" in quotes is a font named serif, not the generic one.
  if (/^(sans-serif|serif|monospace)$/i.test(clean)) return clean.toLowerCase();
  return `"${clean}", sans-serif`;
}

/** Problems with the settings (empty when valid). */
export function validateTextStyle(s: TextStyle): string[] {
  const p: string[] = [];
  if (s.text.trim() === '') p.push('Type some text.');
  if (s.text.length > MAX_TEXT_CHARS) p.push(`Keep the text under ${MAX_TEXT_CHARS} characters.`);
  if (!(s.capHeightMm >= MIN_CAP_HEIGHT_MM && s.capHeightMm <= MAX_CAP_HEIGHT_MM)) {
    p.push(`Letter height must be between ${MIN_CAP_HEIGHT_MM} and ${MAX_CAP_HEIGHT_MM} mm.`);
  }
  if (!(s.lineSpacing >= 0.8 && s.lineSpacing <= 3)) p.push('Line spacing must be between 0.8 and 3.');
  return p;
}

/** Text as closed outlines in mm (top-left of the text at 0,0). Throws Error with a readable message. */
export function renderText(style: TextStyle): TextShape | null {
  const problems = validateTextStyle(style);
  if (problems.length > 0) throw new Error(problems.join(' '));

  const lines = style.text.split(/\r?\n/);
  const spec = (px: number) =>
    `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${px.toFixed(2)}px ${family(style.fontFamily)}`;

  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('This window cannot draw text.');

  // Calibrate so that a capital letter is exactly capHeightMm tall, whatever the font.
  probe.font = spec(100);
  const capRatio = probe.measureText('H').actualBoundingBoxAscent / 100 || 0.7;

  const layout = (pxPerMm: number) => {
    const fontPx = (style.capHeightMm * pxPerMm) / capRatio;
    probe.font = spec(fontPx);
    const widest = Math.max(...lines.map((l) => probe.measureText(l).width));
    const pad = Math.ceil(fontPx * 0.25);
    const advance = fontPx * style.lineSpacing;
    return {
      fontPx,
      pad,
      advance,
      width: Math.ceil(widest + 2 * pad),
      height: Math.ceil(fontPx * 1.5 + (lines.length - 1) * advance + 2 * pad),
    };
  };

  let pxPerMm = TARGET_PX_PER_MM;
  let g = layout(pxPerMm);
  const shrink = Math.min(1, MAX_CANVAS_DIM / Math.max(g.width, g.height), Math.sqrt(MAX_CANVAS_PIXELS / (g.width * g.height)));
  if (shrink < 1) {
    pxPerMm *= shrink * 0.97;
    g = layout(pxPerMm);
  }
  if (pxPerMm < MIN_PX_PER_MM || g.width > MAX_CANVAS_DIM || g.height > MAX_CANVAS_DIM) {
    throw new Error('That text is too large to trace. Reduce the letter height or the amount of text.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = g.width;
  canvas.height = g.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This window cannot draw text.');
  ctx.clearRect(0, 0, g.width, g.height);
  ctx.font = spec(g.fontPx);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = style.align;
  const x = style.align === 'left' ? g.pad : style.align === 'center' ? g.width / 2 : g.width - g.pad;
  lines.forEach((line, i) => ctx.fillText(line, x, g.pad + g.fontPx + i * g.advance));

  const rgba = ctx.getImageData(0, 0, g.width, g.height).data;
  return alphaToShape(alphaFromRGBA(rgba, g.width, g.height), g.width, g.height, pxPerMm);
}
