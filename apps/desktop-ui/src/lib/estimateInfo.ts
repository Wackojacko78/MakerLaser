// What the pre-flight dialog says about the estimated time. Pure TypeScript (no React, Konva or Tauri
// imports), so it is unit-tested in plain Node (tests/estimateInfo.test.ts).
import type { GenerateResponse } from '@/types/domain';

export interface EstimateView {
  totalSeconds: number;
  /** How much of it is the laser off (rapid moves, overscan run-ups), or null when the figure is not available. */
  travelSeconds: number | null;
  /** True when the estimate uses the machine's acceleration. */
  modelled: boolean;
  /** One or two sentences about how the figure was worked out. */
  note: string;
}

export const MODELLED_NOTE = "Worked out from the machine's rapid speed and acceleration. A real job can differ a little.";
export const SIMPLE_NOTE =
  "This estimate ignores acceleration, so a job of many short moves takes longer than shown. Enter the machine's rapid speed and acceleration in Machine… (Read from machine fills them in) for a closer figure.";

export type EstimateSource = Pick<GenerateResponse, 'estimated_seconds'> &
  Partial<Pick<GenerateResponse, 'estimated_travel_seconds' | 'estimate_modelled'>>;

/** The figures and the note for the time estimate. A response from before the new fields counts as the simple estimate. */
export function describeEstimate(r: EstimateSource): EstimateView {
  const total = Number.isFinite(r.estimated_seconds) && r.estimated_seconds > 0 ? r.estimated_seconds : 0;
  const travel = r.estimated_travel_seconds;
  const travelSeconds = travel !== undefined && Number.isFinite(travel) && travel >= 0 ? Math.min(travel, total) : null;
  const modelled = r.estimate_modelled === true;
  return { totalSeconds: total, travelSeconds, modelled, note: modelled ? MODELLED_NOTE : SIMPLE_NOTE };
}
