import { useSyncExternalStore } from 'react';
import { createFrameLaserStore } from '@/lib/frameLaser';

/**
 * The Frame-with-laser-on option. Only the power is remembered between sessions: the option itself
 * is switched off every time MakerLaser starts.
 */
export const frameLaser = createFrameLaserStore(typeof localStorage === 'undefined' ? undefined : localStorage);

export function useFrameLaser() {
  return useSyncExternalStore(frameLaser.subscribe, frameLaser.get);
}
