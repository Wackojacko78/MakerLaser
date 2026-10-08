import { create } from 'zustand';
import { nextPicks, type MeasureItem } from '@/lib/measure';
import type { Point2 } from '@/types/domain';

export type Tool = 'select' | 'measure';

/**
 * The Measure tool's state. Deliberately not part of the project store: a measurement is not
 * undoable, is never saved, and must not mark the project as changed.
 */
interface MeasureState {
  tool: Tool;
  /** What has been clicked: none, one, or two items. */
  picks: MeasureItem[];
  /** What a click would pick at the pointer right now (Measure tool only). */
  hover: MeasureItem | null;
  /** Pointer position in workspace mm, or null when it is off the canvas. */
  cursor: Point2 | null;
  setTool: (tool: Tool) => void;
  addPick: (item: MeasureItem) => void;
  setHover: (item: MeasureItem | null) => void;
  setCursor: (p: Point2 | null) => void;
  clear: () => void;
}

export const useMeasureStore = create<MeasureState>((set) => ({
  tool: 'select',
  picks: [],
  hover: null,
  cursor: null,
  // Leaving the Measure tool drops the measurement, so it cannot reappear later, out of date.
  setTool: (tool) => set((s) => (s.tool === tool ? s : tool === 'select' ? { tool, picks: [], hover: null } : { tool })),
  addPick: (item) => set((s) => ({ picks: nextPicks(s.picks, item) })),
  setHover: (item) => set((s) => (s.hover === null && item === null ? s : { hover: item })),
  setCursor: (p) => set((s) => (s.cursor === null && p === null ? s : { cursor: p })),
  clear: () => set((s) => (s.picks.length === 0 && s.hover === null ? s : { picks: [], hover: null })),
}));
