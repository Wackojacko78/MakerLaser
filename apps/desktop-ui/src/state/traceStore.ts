import { create } from 'zustand';

/**
 * Whether the Trace window is open. Like the Shape tools window it is brought up from the toolbar and
 * stays up, whatever is selected, until you close it. (Its settings live in the window's own component,
 * which stays mounted while it is closed, so they are kept too.)
 */
interface TraceState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useTraceStore = create<TraceState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
