// The "Path planning" choices in the Layers panel: how the laser head moves inside a layer. Pure TypeScript
// (no React, Konva or Tauri imports), so it is unit-tested in plain Node (tests/cutPlanner.test.ts).
//
// The three settings are saved in the project (ProjectSettings) under these names, and are read by the toolpath
// generator in packages/project (see docs/user-guide.md, "Path planning"). A project saved before they existed
// has none of them, which means off.
import type { ProjectSettings } from '@/types/domain';

export type PlannerKey = 'order_fills_by_distance' | 'cut_part_by_part' | 'cut_shared_lines_once';

export interface PlannerOption {
  key: PlannerKey;
  label: string;
  /** What it does, in a sentence or two (shown as the tooltip). */
  help: string;
}

export const PLANNER_OPTIONS: readonly PlannerOption[] = [
  {
    key: 'order_fills_by_distance',
    label: 'Burn filled objects nearest first',
    help: 'Fill layers: burns the filled objects in the order that keeps the laser-off moves short, instead of the order they were drawn in. What is burned does not change.',
  },
  {
    key: 'cut_part_by_part',
    label: 'Finish each part before the next',
    help: "Cut and Score layers: cuts a part's holes, then its outline, and only then moves on to the next part, instead of every hole on the sheet first. A part is an outline with everything inside it.",
  },
  {
    key: 'cut_shared_lines_once',
    label: 'Cut lines that lie on top of each other once',
    help: 'Cut and Score layers: where two lines lie on top of each other (the shared edge of two touching parts, a shape drawn twice) the second one is skipped. Not applied to a Cut layer that has Kerf set. Lines within 0.01 mm of each other count as the same.',
  },
];

/** True when the choice is on. A project saved before the choice existed does not have it, which means off. */
export function plannerValue(settings: Pick<ProjectSettings, PlannerKey>, key: PlannerKey): boolean {
  return settings[key] === true;
}

/** How many of the choices are on. */
export function plannerOnCount(settings: Pick<ProjectSettings, PlannerKey>): number {
  return PLANNER_OPTIONS.filter((o) => plannerValue(settings, o.key)).length;
}
