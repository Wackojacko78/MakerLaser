// Frame with the laser on: the settings and small pure helpers behind the "Frame with laser on"
// option in the Job panel. Pure TypeScript (no React, Konva or Tauri imports), so it is unit-tested
// in plain Node (tests/frameLaser.test.ts).
//
// The Rust side checks the same limits again and refuses anything outside them:
// FRAME_LASER_MAX_PERCENT in apps/rust-core/src/placement.rs. Keep the two in step.

/** The lowest framing power that can be asked for, in percent of the machine's maximum. */
export const FRAME_LASER_MIN_PERCENT = 0.1;
/** The highest. Framing shows where the job goes; it is not meant to mark the material. */
export const FRAME_LASER_MAX_PERCENT = 5;
/** The power used until you change it. */
export const FRAME_LASER_DEFAULT_PERCENT = 1;
/** Where the power is remembered between sessions. The option itself is never remembered. */
export const FRAME_LASER_STORAGE_KEY = 'makerlaser.frameLaserPercent';

export const FRAME_LASER_WARNING =
  'Frame with the laser on fires the beam along the outline of the job at low power, so you can see where it goes. ' +
  'Even at low power the beam can mark some materials and is an eye hazard: wear laser safety glasses for your laser, ' +
  'keep the area clear and try it on scrap first. STOP switches the laser off straight away. ' +
  'This option is switched off again every time MakerLaser starts.';

/** A framing power the machine will accept: within the limits and rounded to 0.1%. Junk becomes the default. */
export function clampFramePercent(value: unknown): number {
  let n = Number.NaN;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && value.trim() !== '') n = Number(value);
  if (!Number.isFinite(n)) return FRAME_LASER_DEFAULT_PERCENT;
  const clamped = Math.min(FRAME_LASER_MAX_PERCENT, Math.max(FRAME_LASER_MIN_PERCENT, n));
  return Math.round(clamped * 10) / 10;
}

/** The remembered power, or the default when nothing usable was stored. */
export function parseStoredFramePercent(raw: string | null): number {
  return raw === null ? FRAME_LASER_DEFAULT_PERCENT : clampFramePercent(raw);
}

/** What to ask the machine for: the power in percent, or null to frame with the laser off. */
export function framePowerRequest(enabled: boolean, percent: unknown): number | null {
  return enabled ? clampFramePercent(percent) : null;
}

/** The line the console shows when framing starts. */
export function frameLogMessage(laserPercent: number | null): string {
  if (laserPercent === null) return 'Framing the job outline (laser off).';
  return `Framing the job outline with the laser ON at ${laserPercent}% power.`;
}

/** The text on the Frame button. */
export function frameButtonLabel(state: { framing: boolean; enabled: boolean }): string {
  if (state.framing) return 'Framing…';
  if (state.enabled) return 'Frame (laser on)';
  return 'Frame';
}

export interface FrameLaserState {
  readonly enabled: boolean;
  readonly percent: number;
}

/** The part of the browser's localStorage the store needs. */
export interface FrameLaserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readStoredPercent(storage: FrameLaserStorage | undefined): number {
  try {
    return parseStoredFramePercent(storage ? storage.getItem(FRAME_LASER_STORAGE_KEY) : null);
  } catch {
    return FRAME_LASER_DEFAULT_PERCENT;
  }
}

function writeStoredPercent(storage: FrameLaserStorage | undefined, percent: number): void {
  try {
    storage?.setItem(FRAME_LASER_STORAGE_KEY, String(percent));
  } catch {
    /* storage is unavailable: the power is just not remembered */
  }
}

/**
 * The Frame-with-laser-on option. It always starts switched off, whatever happened last time; only
 * the power is remembered. React reads it through useFrameLaser (state/frameLaserStore.ts).
 */
export function createFrameLaserStore(storage?: FrameLaserStorage) {
  let state: FrameLaserState = { enabled: false, percent: readStoredPercent(storage) };
  const listeners = new Set<() => void>();
  const change = (next: FrameLaserState): void => {
    if (next.enabled === state.enabled && next.percent === state.percent) return;
    state = next;
    listeners.forEach((listener) => listener());
  };
  return {
    get: (): FrameLaserState => state,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setEnabled: (enabled: boolean): void => change({ ...state, enabled }),
    setPercent: (value: unknown): void => {
      const percent = clampFramePercent(value);
      writeStoredPercent(storage, percent);
      change({ ...state, percent });
    },
  };
}
