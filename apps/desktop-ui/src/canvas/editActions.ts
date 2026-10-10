// Opening the editor of the selected text or shape from a double-click or the keyboard. The rules
// (what counts as editable, which keys, what to say) are in lib/editAccess.ts and are unit-tested.

import { PX_PER_MM } from '@/lib/constants';
import { EDIT_SLACK_PX, editAccess, editBlockedMessage, opensEditorOnKey, pointInBounds } from '@/lib/editAccess';
import { worldBounds } from '@/lib/transform';
import { useEditStore } from '@/state/editStore';
import { useNoticeStore } from '@/state/noticeStore';
import { useProjectStore } from '@/state/projectStore';
import type { WorkspaceObject } from '@/types/domain';

/** The one selected object, or undefined when nothing, or more than one thing, is selected. */
function theSelectedObject(): WorkspaceObject | undefined {
  const { project, selected } = useProjectStore.getState();
  const id = selected.length === 1 ? selected[0] : undefined;
  return id === undefined ? undefined : project?.objects.find((o) => o.id === id);
}

/**
 * A double-click at this point (in mm). The first click of the double-click has already selected
 * the object under the pointer, so this opens the editor for the selected object when the pointer
 * is on it. It explains why when the object cannot be edited.
 */
export function openEditorAt(pointMm: { x: number; y: number }, viewScale: number): void {
  const object = theSelectedObject();
  if (!object || object.kind.type !== 'vector') return;
  const bounds = worldBounds(object);
  if (!bounds || !pointInBounds(pointMm, bounds, EDIT_SLACK_PX / (PX_PER_MM * viewScale))) return;
  const access = editAccess(object);
  if (access === 'editable') {
    // Already open for this object: leave it alone, so a double-click inside its box does not steal the cursor.
    if (useEditStore.getState().editingId !== object.id) useEditStore.getState().open(object.id);
    return;
  }
  const message = editBlockedMessage(access);
  if (message) useNoticeStore.getState().show('error', message);
}

/** Enter or F2: open the editor of the selected text or shape. */
export function openEditorForKey(e: KeyboardEvent): void {
  const object = theSelectedObject();
  const el = e.target;
  const target = el instanceof HTMLElement ? { tag: el.tagName, contentEditable: el.isContentEditable } : null;
  if (!object || !opensEditorOnKey(e, target, editAccess(object))) return;
  e.preventDefault();
  useEditStore.getState().open(object.id);
}
