// The tabs of the right-hand panel. Pure TypeScript (no React), so it is unit-tested in plain Node
// (tests/rightTabs.test.ts). The tab bar itself is components/RightTabs.tsx.

export type RightTab = 'properties' | 'shape' | 'trace';

export interface TabInfo {
  id: RightTab;
  label: string;
  title: string;
}

/** The tabs, left to right. */
export const RIGHT_TABS: readonly TabInfo[] = [
  { id: 'properties', label: 'Properties', title: 'The selection, the objects, the layers and the material library' },
  { id: 'shape', label: 'Shape tools', title: 'Combine, offset and repeat shapes' },
  { id: 'trace', label: 'Trace', title: 'Turn a picture into outlines' },
];

export const DEFAULT_TAB: RightTab = 'properties';

/** The tab an arrow key, Home or End moves to from `current`, or null when the key does nothing. Arrows wrap round. */
export function nextTab(current: RightTab, key: string): RightTab | null {
  const index = RIGHT_TABS.findIndex((t) => t.id === current);
  const last = RIGHT_TABS.length - 1;
  let target: number;
  if (key === 'ArrowRight') target = index >= last ? 0 : index + 1;
  else if (key === 'ArrowLeft') target = index <= 0 ? last : index - 1;
  else if (key === 'Home') target = 0;
  else if (key === 'End') target = last;
  else return null;
  return RIGHT_TABS[target]?.id ?? null;
}

/** What a toolbar button does: show its tab, or, when that tab is already showing, go back to Properties. */
export function toggledTab(current: RightTab, wanted: RightTab): RightTab {
  return current === wanted ? DEFAULT_TAB : wanted;
}
