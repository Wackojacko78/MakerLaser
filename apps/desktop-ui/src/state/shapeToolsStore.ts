import { create } from 'zustand';

/**
 * Whether the Shape tools window is open. It is a window you bring up from the toolbar and it stays
 * up, whatever is selected, until you close it. (Its settings live in the window's own component,
 * which stays mounted while it is closed, so they are kept too.)
 */
interface ShapeToolsState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useShapeToolsStore = create<ShapeToolsState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
