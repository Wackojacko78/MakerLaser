import { applyEdit, makeTextSource, shapeFromObject, textFromObject, type LaserMode, type TextForm } from '@/lib/objectEdit';
import { changeShapeKind, patchShape, pickLayerId, type FieldKey } from '@/lib/inlineEdit';
import { shapePaths } from '@/lib/shapes';
import { TEST_PREFIX } from '@/lib/testGrid';
import { renderTextForm } from '@/lib/textForm';
import { useProjectStore } from '@/state/projectStore';
import type { ObjectSource, Path2D, ShapeKind, ShapeSource } from '@/types/domain';

type TextPatch = Partial<Omit<TextForm, 'mode'>>;

/**
 * Reads and changes the settings of one text or shape object, live: every change rebuilds the
 * outlines at once and goes into the project, and a run of changes to the same object is one undo
 * step. The object keeps its position, rotation, layer and stacking; any stretching done with the
 * handles is folded into the size, so the numbers shown are the real ones.
 */
export function useObjectEditing(id: string) {
  const project = useProjectStore((s) => s.project);
  const mutate = useProjectStore((s) => s.mutate);
  const object = project?.objects.find((o) => o.id === id);
  const shape = project && object ? shapeFromObject(object, project.layers) : null;
  const text = project && object ? textFromObject(object, project.layers) : null;

  /** Puts new settings and outlines on the object. `mode` moves it to that laser mode's layer. */
  const commit = (source: ObjectSource, paths: Path2D[], mode: LaserMode | null) => {
    mutate((p) => {
      const at = p.objects.findIndex((o) => o.id === id);
      const current = p.objects[at];
      if (!current) return;
      const layerId = mode === null ? undefined : (pickLayerId(p.layers, mode, TEST_PREFIX) ?? undefined);
      p.objects[at] = applyEdit(current, source, paths, layerId);
    }, `inline:${id}`);
  };

  const setShapeField = (key: FieldKey, value: number) => {
    if (!shape) return;
    const next = patchShape(shape.source, key, value);
    commit(next, shapePaths(next), null);
  };

  const setShapeKind = (kind: ShapeKind) => {
    if (!shape) return;
    const next: ShapeSource = changeShapeKind(shape.source, kind);
    commit(next, shapePaths(next), null);
  };

  const setShapeMode = (mode: LaserMode) => {
    if (shape) commit(shape.source, shapePaths(shape.source), mode);
  };

  /** Returns false, and changes nothing, when the new settings draw nothing (for example blank text). */
  const setText = (patch: TextPatch, mode: LaserMode | null = null): boolean => {
    if (!text) return false;
    const form = {
      text: text.text,
      fontFamily: text.fontFamily,
      bold: text.bold,
      italic: text.italic,
      capHeight: text.capHeight,
      align: text.align,
      lineSpacing: text.lineSpacing,
      ...patch,
    };
    const rendered = renderTextForm(form);
    if (!rendered) return false;
    commit(makeTextSource(form), rendered.paths, mode);
    return true;
  };

  const setTextMode = (mode: LaserMode) => {
    setText({}, mode);
  };

  return { object, shape, text, setShapeField, setShapeKind, setShapeMode, setText, setTextMode };
}
