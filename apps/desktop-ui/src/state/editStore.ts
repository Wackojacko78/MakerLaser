import { create } from 'zustand';

/**
 * Which text or shape object is open in its edit box, if any. Deliberately not part of the project
 * store: opening a box is not a change to the project and is not undoable.
 */
interface EditState {
  editingId: string | null;
  open: (id: string) => void;
  close: () => void;
}

export const useEditStore = create<EditState>((set) => ({
  editingId: null,
  open: (id) => set({ editingId: id }),
  close: () => set({ editingId: null }),
}));
