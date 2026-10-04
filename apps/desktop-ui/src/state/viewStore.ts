import { create } from 'zustand';

interface ViewState {
  x: number;
  y: number;
  scale: number;
  /** Bumped to ask the canvas to fit the bed to the viewport. */
  fitNonce: number;
  setView: (v: { x: number; y: number; scale: number }) => void;
  requestFit: () => void;
}

export const useViewStore = create<ViewState>((set) => ({
  x: 36,
  y: 36,
  scale: 1,
  fitNonce: 1,
  setView: (v) => set(v),
  requestFit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),
}));
