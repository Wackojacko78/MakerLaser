// What happens when a drag or click with a drawing tool is finished: build the new shape or text,
// add it to the project, go back to the Select tool and open the floating editor on it.

import { PX_PER_MM } from '@/lib/constants';
import { installedFonts, pickDefaultFont } from '@/lib/fonts';
import {
  buildShapeObject,
  buildTextObject,
  centredBox,
  defaultTextForm,
  gestureBox,
  isDragGesture,
  type Draft,
  type NewObjectContext,
} from '@/lib/inlineEdit';
import { defaultShape } from '@/lib/shapes';
import { TEST_PREFIX } from '@/lib/testGrid';
import { renderTextForm } from '@/lib/textForm';
import { useEditStore } from '@/state/editStore';
import { useNoticeStore } from '@/state/noticeStore';
import { useProjectStore } from '@/state/projectStore';
import type { WorkspaceObject } from '@/types/domain';

/** Adds what the drawing tool drew. A click gives a default-sized shape; a drag gives the size dragged. */
export function finishDrawing(draft: Draft, viewScale: number): void {
  const store = useProjectStore.getState();
  const project = store.project;
  if (!project) return;
  const ctx: NewObjectContext = {
    id: crypto.randomUUID(),
    layers: project.layers,
    nextZ: store.nextZIndex(),
    bed: { width: project.machine.bed_width_mm, height: project.machine.bed_height_mm },
    testPrefix: TEST_PREFIX,
  };
  const start = { x: draft.x0, y: draft.y0 };
  const end = { x: draft.x1, y: draft.y1 };

  let object: WorkspaceObject | null;
  if (draft.tool === 'text') {
    object = buildTextObject(defaultTextForm(pickDefaultFont(installedFonts())), start, ctx, renderTextForm);
  } else {
    const base = defaultShape(draft.tool);
    if (isDragGesture(start, end, PX_PER_MM * viewScale)) {
      const box = gestureBox(start, end, draft.square);
      object = buildShapeObject({ ...base, width_mm: box.w, height_mm: box.h }, { x: box.x, y: box.y }, ctx, false);
    } else {
      const box = centredBox(start, base.width_mm, base.height_mm);
      object = buildShapeObject(base, { x: box.x, y: box.y }, ctx, true);
    }
  }

  const edit = useEditStore.getState();
  edit.setTool(null);
  if (!object) {
    useNoticeStore.getState().show('error', 'Could not draw that: nothing was added.');
    return;
  }
  store.addObject(object);
  edit.open(object.id);
}
