// The keys and the guards of node editing. The rules (which key does what, when node editing has to stop) are in
// lib/nodeEdit.ts and are unit-tested; this file only listens and calls them.
import { useEffect } from 'react';
import { guardNodeMode, nodeKeyAction } from '@/lib/nodeEdit';
import { deletePickedNodes, escapeNodeEdit, leaveNodeEdit, nudgePickedNodes, toggleNodeEdit } from '@/canvas/nodeActions';
import { useEditStore } from '@/state/editStore';
import { useMeasureStore } from '@/state/measureStore';
import { useNodeEditStore } from '@/state/nodeEditStore';
import { useProjectStore } from '@/state/projectStore';

/** N, Esc, V, Delete and the arrow keys for node editing, and what keeps node editing in step with the rest of the program. */
export function useNodeEdit(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      const target = el instanceof HTMLElement ? { tag: el.tagName, contentEditable: el.isContentEditable } : null;
      const editing = useNodeEditStore.getState().editingId !== null;
      const action = nodeKeyAction(e, target, document.querySelector('.modal-backdrop') !== null, editing);
      if (!action) return;
      e.preventDefault();
      if (action.type === 'toggle') toggleNodeEdit();
      else if (action.type === 'escape') escapeNodeEdit();
      else if (action.type === 'leave') leaveNodeEdit();
      else if (action.type === 'delete') deletePickedNodes();
      else nudgePickedNodes(action.dx, action.dy);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Stop node editing when the object goes away or changes into something that cannot be edited, when something else is
  // picked, or when a drawing tool or Measure is; carry on (pick the object again) after Undo or Redo empties the selection.
  useEffect(() => {
    const check = () => {
      const editingId = useNodeEditStore.getState().editingId;
      if (editingId === null) return;
      const project = useProjectStore.getState();
      const action = guardNodeMode({
        editingId,
        object: project.project?.objects.find((o) => o.id === editingId),
        selected: project.selected,
        drawToolPicked: useEditStore.getState().tool !== null,
        measureToolPicked: useMeasureStore.getState().tool === 'measure',
      });
      if (action === 'leave') leaveNodeEdit();
      else if (action === 'reselect') project.setSelection([editingId]);
    };
    const unsubscribers = [
      useProjectStore.subscribe(check),
      useNodeEditStore.subscribe(check),
      useEditStore.subscribe(check),
      useMeasureStore.subscribe(check),
    ];
    return () => unsubscribers.forEach((u) => u());
  }, []);
}
