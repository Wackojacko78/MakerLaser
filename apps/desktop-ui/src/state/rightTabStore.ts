import { create } from 'zustand';
import { DEFAULT_TAB, toggledTab, type RightTab } from '@/lib/rightTabs';

/**
 * Which tab of the right-hand panel is showing. The toolbar buttons "Shape tools…" and "Trace…" switch to
 * their tab (and back to Properties when pressed again). The panels of the tabs that are not showing stay
 * mounted, so what you typed in them is kept.
 */
interface RightTabState {
  tab: RightTab;
  setTab: (tab: RightTab) => void;
  /** Show this tab, or go back to Properties if it is already showing. */
  toggle: (tab: RightTab) => void;
}

export const useRightTabStore = create<RightTabState>((set) => ({
  tab: DEFAULT_TAB,
  setTab: (tab) => set((s) => (s.tab === tab ? s : { tab })),
  toggle: (tab) => set((s) => ({ tab: toggledTab(s.tab, tab) })),
}));
