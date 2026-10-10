// Draws text from the settings typed in an editor. Needs the browser (the text is drawn on a canvas
// and traced), so it is the one piece of the text editing that is not unit-tested in plain Node.

import type { RenderedText, TextForm0 } from '@/lib/inlineEdit';
import { renderText } from '@/lib/textRender';

/** The outlines for these settings, or null when there is nothing to draw (blank text, a bad size). */
export function renderTextForm(form: TextForm0): RenderedText | null {
  try {
    return renderText({
      text: form.text,
      fontFamily: form.fontFamily,
      bold: form.bold,
      italic: form.italic,
      capHeightMm: Number(form.capHeight),
      align: form.align,
      lineSpacing: Number(form.lineSpacing),
    });
  } catch {
    return null;
  }
}
