import { applyEdit, makeTextSource, shapeFromObject, textFromObject, type LaserMode, type TextForm } from '@/lib/objectEdit';
import { changeShapeKind, patchShape, pickLayerId, type FieldKey } from '@/lib/inlineEdit';
import { documentFontSet, fontReady, loadFont } from '@/lib/fontLoad';
import { shapePaths } from '@/lib/shapes';
import { TEST_PREFIX } from '@/lib/testGrid';
import { renderTextForm } from '@/lib/textForm';
import { createTextSettler } from '@/lib/textSettle';
import { useProjectStore } from '@/state/projectStore';
import type { ObjectSource, Path2D, ShapeKind, ShapeSource } from '@/types/domain';

type TextFormValues = Omit<TextForm, 'mode'>;
type TextPatch = Partial<TextFormValues>;

/** Puts new settings and outlines on the object. `mode` moves it to that laser mode's layer. */
function commitEdit(id: string, source: ObjectSource, paths: Path2D[], mode: LaserMode | null): void {
  useProjectStore.getState().mutate((p) => {
    const at = p.objects.findIndex((o) => o.id === id);
    const current = p.objects[at];
    if (!current) return;
    const layerId = mode === null ? undefined : (pickLayerId(p.layers, mode, TEST_PREFIX) ?? undefined);
    p.objects[at] = applyEdit(current, source, paths, layerId);
  }, `inline:${id}`);
}

/** The text settings of an object as the project has them right now, or null if it is not text. */
function currentTextForm(id: string): TextForm | null {
  const { project } = useProjectStore.getState();
  const object = project?.objects.find((o) => o.id === id);
  return project && object ? textFromObject(object, project.layers) : null;
}

/** The text settings with a change applied (the laser mode is not part of it). */
function textFormWith(id: string, patch: TextPatch): TextFormValues | null {
  const current = currentTextForm(id);
  if (!current) return null;
  return {
    text: current.text,
    fontFamily: current.fontFamily,
    bold: current.bold,
    italic: current.italic,
    capHeight: current.capHeight,
    align: current.align,
    lineSpacing: current.lineSpacing,
    ...patch,
  };
}

/** Draws the text with the change and puts it on the object. False when there is nothing to draw. */
function applyTextPatch(id: string, patch: TextPatch, mode: LaserMode | null): boolean {
  const form = textFormWith(id, patch);
  if (!form) return false;
  const rendered = renderTextForm(form);
  if (!rendered) return false;
  commitEdit(id, makeTextSource(form), rendered.paths, mode);
  return true;
}

/**
 * Changes to text go through here: when the font has not loaded yet (the fonts that come with the app
 * load the first time they are used), the change waits for it, so the text is never drawn in a
 * fallback font by mistake.
 */
const textSettler = createTextSettler<TextPatch, TextFormValues, LaserMode | null>(
  {
    formWith: textFormWith,
    isReady: (form) => fontReady(documentFontSet(), form.fontFamily, form.bold, form.italic, form.text),
    load: (form) => loadFont(documentFontSet(), form.fontFamily, form.bold, form.italic, form.text),
    apply: applyTextPatch,
  },
  (older, newer) => newer ?? older,
);

/**
 * Reads and changes the settings of one text or shape object, live: every change rebuilds the
 * outlines at once and goes into the project, and a run of changes to the same object is one undo
 * step. The object keeps its position, rotation, layer and stacking; any stretching done with the
 * handles is folded into the size, so the numbers shown are the real ones.
 */
export function useObjectEditing(id: string) {
  const project = useProjectStore((s) => s.project);
  const object = project?.objects.find((o) => o.id === id);
  const shape = project && object ? shapeFromObject(object, project.layers) : null;
  const text = project && object ? textFromObject(object, project.layers) : null;

  const setShapeField = (key: FieldKey, value: number) => {
    if (!shape) return;
    const next = patchShape(shape.source, key, value);
    commitEdit(id, next, shapePaths(next), null);
  };

  const setShapeKind = (kind: ShapeKind) => {
    if (!shape) return;
    const next: ShapeSource = changeShapeKind(shape.source, kind);
    commitEdit(id, next, shapePaths(next), null);
  };

  const setShapeMode = (mode: LaserMode) => {
    if (shape) commitEdit(id, shape.source, shapePaths(shape.source), mode);
  };

  /** Returns false, and changes nothing, when the new settings draw nothing (for example blank text). */
  const setText = (patch: TextPatch, mode: LaserMode | null = null): boolean => textSettler.request(id, patch, mode);

  const setTextMode = (mode: LaserMode) => {
    setText({}, mode);
  };

  return { object, shape, text, setShapeField, setShapeKind, setShapeMode, setText, setTextMode };
}
