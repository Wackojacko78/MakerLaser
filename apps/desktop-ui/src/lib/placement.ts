// Start From and Job Origin: where a job is placed on the machine. Pure TypeScript (no React,
// Konva or Tauri imports), so it is unit-tested in plain Node (tests/placement.test.ts).
//
// The settings are stored in the project (`settings.start_from`, `settings.job_origin`) and are
// read by the Rust side: StartFrom and JobOrigin in packages/common/src/project.rs. Files from
// before this feature have neither field, which means absolute coordinates, bottom-left.

import type { JobOrigin, StartFrom } from '@/types/domain';

export const START_FROM_VALUES: readonly StartFrom[] = ['absolute', 'current_position', 'user_origin'];

export const DEFAULT_START_FROM: StartFrom = 'absolute';
export const DEFAULT_JOB_ORIGIN: JobOrigin = 'bottom_left';

export const START_FROM_LABEL: Readonly<Record<StartFrom, string>> = {
  absolute: 'Absolute coordinates',
  current_position: 'Current position',
  user_origin: 'User origin',
};

export const START_FROM_HELP: Readonly<Record<StartFrom, string>> = {
  absolute:
    'The workspace is the machine bed: the job runs where you see it, measured from the machine origin corner. Set the origin at that corner before running.',
  current_position:
    'The job is placed around wherever the laser head is when you press Start. The job origin says which point of the job sits on the head. Jog the head into place, then use Frame to check.',
  user_origin:
    'Like Current position, but the head first goes to a start point you set: jog to it and press Set user origin. The start point is forgotten when you disconnect, reconnect or stop a job.',
};

/** The nine dots, as laid out on screen (top row first). */
export const JOB_ORIGIN_GRID: readonly (readonly JobOrigin[])[] = [
  ['top_left', 'top', 'top_right'],
  ['left', 'center', 'right'],
  ['bottom_left', 'bottom', 'bottom_right'],
];

export const JOB_ORIGIN_LABEL: Readonly<Record<JobOrigin, string>> = {
  top_left: 'top left',
  top: 'top',
  top_right: 'top right',
  left: 'left',
  center: 'centre',
  right: 'right',
  bottom_left: 'bottom left',
  bottom: 'bottom',
  bottom_right: 'bottom right',
};

const JOB_ORIGINS: readonly JobOrigin[] = JOB_ORIGIN_GRID.flat();

/** The Start From setting of a project; anything missing or unknown means absolute coordinates. */
export function startFromOf(settings: { start_from?: unknown }): StartFrom {
  const v = settings.start_from;
  return START_FROM_VALUES.includes(v as StartFrom) ? (v as StartFrom) : DEFAULT_START_FROM;
}

/** The Job Origin setting of a project; anything missing or unknown means bottom left. */
export function jobOriginOf(settings: { job_origin?: unknown }): JobOrigin {
  const v = settings.job_origin;
  return JOB_ORIGINS.includes(v as JobOrigin) ? (v as JobOrigin) : DEFAULT_JOB_ORIGIN;
}

/** True when the job is placed relative to the laser head rather than the bed. */
export const isRelative = (settings: { start_from?: unknown }): boolean => startFromOf(settings) !== 'absolute';

/** "X 120.50, Y 80.00 (machine position)", or a note that none is set. */
export function describeUserOrigin(origin: readonly [number, number] | null | undefined): string {
  if (!origin) return 'Not set.';
  return `X ${origin[0].toFixed(2)}, Y ${origin[1].toFixed(2)} (machine position).`;
}
