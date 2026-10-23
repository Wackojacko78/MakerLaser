import { create } from 'zustand';
import type { NodeRef } from '@/lib/nodePath';

/**
 * Node editing: which object is open for it, and which of its nodes are picked. Deliberately not part of the project
 * store: neither is a change to the project, and neither is undoable (the edits themselves are).
 */
interface NodeEditState {
  /** The object whose nodes are being edited. Null when node editing is off. */
  editingId: string | null;
  /** The picked nodes. May name a node that is gone after an Undo: use validRefs (lib/nodeEdit.ts) before trusting it. */
  selection: NodeRef[];
  start: (id: string) => void;
  stop: () => void;
  setSelection: (refs: NodeRef[]) => void;
}

export const useNodeEditStore = create<NodeEditState>((set) => ({
  editingId: null,
  selection: [],
  start: (id) => set((s) => (s.editingId === id ? s : { editingId: id, selection: [] })),
  stop: () => set((s) => (s.editingId === null && s.selection.length === 0 ? s : { editingId: null, selection: [] })),
  setSelection: (refs) => set({ selection: refs }),
}));
