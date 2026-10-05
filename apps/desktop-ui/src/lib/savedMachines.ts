// The user's own machine presets, kept in this app's local storage. The pure logic is in
// configFormat.ts; this file only reads and writes the storage. Storage belongs to one build
// of the app (the dev window and the installed app each have their own), so use Export and
// Import to move a machine between them.

import { parseSavedMachines, serializeSavedMachines, type MachineEntry } from '@/lib/configFormat';

const KEY = 'makerlaser.savedMachines';

export function loadSavedMachines(): MachineEntry[] {
  try {
    return parseSavedMachines(window.localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function storeSavedMachines(list: readonly MachineEntry[]): void {
  try {
    window.localStorage.setItem(KEY, serializeSavedMachines(list));
  } catch {
    /* storage unavailable: the list just will not be remembered */
  }
}
