import { create } from 'zustand';
import type { DrawTool } from '@/lib/inlineEdit';

/**
 * The drawing tool that is picked, and which text or shape object has its floating editor open on
 * the canvas. Deliberately not part of the project store: neither is a change to the project, and
 * neither is undoable.
 */
interface EditState {
  /** The tool picked in the Tools panel: click or drag on the canvas to draw. Null is the Select tool. */
  tool: DrawTool | null;
  /** The object whose floating editor is open. */
  editingId: string | null;
  /** Bumped each time an editor opens, to ask it to put the cursor in its first box. */
  focusNonce: number;
  setTool: (tool: DrawTool | null) => void;
  open: (id: string) => void;
  close: () => void;
}

export const useEditStore = create<EditState>((set) => ({
  tool: null,
  editingId: null,
  focusNonce: 0,
  setTool: (tool) => set((s) => (s.tool === tool ? s : { tool })),
  open: (id) => set((s) => ({ editingId: id, focusNonce: s.focusNonce + 1 })),
  close: () => set((s) => (s.editingId === null ? s : { editingId: null })),
}));
