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
  /** Dragged nodes jump onto nearby nodes and corners (lib/nodeSnap.ts). On to start with, and remembered between sessions. */
  snap: boolean;
  setSnap: (on: boolean) => void;
  start: (id: string) => void;
  stop: () => void;
  setSelection: (refs: NodeRef[]) => void;
}

const SNAP_KEY = 'makerlaser.snapNodes';

/** The remembered choice (a missing or unreadable one means on). */
function readSnap(): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(SNAP_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saveSnap(on: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SNAP_KEY, on ? 'on' : 'off');
  } catch {
    // A browser that will not store it just forgets the choice.
  }
}

export const useNodeEditStore = create<NodeEditState>((set) => ({
  editingId: null,
  selection: [],
  snap: readSnap(),
  setSnap: (on) => {
    saveSnap(on);
    set((s) => (s.snap === on ? s : { snap: on }));
  },
  start: (id) => set((s) => (s.editingId === id ? s : { editingId: id, selection: [] })),
  stop: () => set((s) => (s.editingId === null && s.selection.length === 0 ? s : { editingId: null, selection: [] })),
  setSelection: (refs) => set({ selection: refs }),
}));
