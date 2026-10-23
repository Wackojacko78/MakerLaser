// The cut tab settings of a Cut layer: how wide each tab is and about how far apart they are. Pure TypeScript
// (no React, Konva or Tauri imports), so it is unit-tested in plain Node (tests/cutTabs.test.ts).
//
// A tab is a short stretch of the cut line that is left uncut, so the part stays attached to the sheet until it is
// broken free by hand. The two settings are saved with the layer (tab_width_mm and tab_spacing_mm); a layer saved
// before they existed has neither, which means no tabs. The tabs themselves are made when the job is generated
// (packages/project/src/toolpath/tabs.rs). See docs/user-guide.md, "Tabs".
import type { Layer } from '@/types/domain';

/** The widest tab that is accepted, in mm. Matches MAX_TAB_WIDTH_MM in Rust. */
export const MAX_TAB_WIDTH_MM = 20;
/** The narrowest tab that is made, in mm. A smaller number (above 0) is brought up to this. */
export const MIN_TAB_WIDTH_MM = 0.1;
/** The closest and furthest apart tabs may be, in mm of outline. Match MIN_TAB_SPACING_MM and MAX_TAB_SPACING_MM in Rust. */
export const MIN_TAB_SPACING_MM = 5;
export const MAX_TAB_SPACING_MM = 1000;
/** The spacing a layer has when it has never been set. Matches default_tab_spacing in Rust. */
export const DEFAULT_TAB_SPACING_MM = 50;

export type TabFields = Pick<Layer, 'tab_width_mm' | 'tab_spacing_mm'>;

/** The tab width of the layer, 0 (off) for one that has none. */
export const tabWidth = (layer: Partial<TabFields>): number => layer.tab_width_mm ?? 0;

/** The tab spacing of the layer, the usual 50 mm for one that has none. */
export const tabSpacing = (layer: Partial<TabFields>): number => layer.tab_spacing_mm ?? DEFAULT_TAB_SPACING_MM;

/** What was typed in the width box, made safe: 0 or less (or not a number) is off, and the rest is kept between 0.1 and 20 mm. */
export function clampTabWidth(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.max(value, MIN_TAB_WIDTH_MM), MAX_TAB_WIDTH_MM);
}

/** What was typed in the spacing box, made safe: kept between 5 and 1000 mm, and the usual 50 mm for something that is not a number. */
export function clampTabSpacing(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TAB_SPACING_MM;
  return Math.min(Math.max(value, MIN_TAB_SPACING_MM), MAX_TAB_SPACING_MM);
}

/** True when the layer will leave tabs: it is a Cut layer with a width above 0. Other kinds of layer ignore the setting. */
export const tabsOn = (layer: Pick<Layer, 'kind'> & Partial<TabFields>): boolean => layer.kind === 'cut' && tabWidth(layer) > 0;
