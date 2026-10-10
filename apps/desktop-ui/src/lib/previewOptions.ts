// Options for the toolpath preview: whether the laser-off moves are drawn. Pure TypeScript (no React,
// Konva or Tauri imports), so it is unit-tested in plain Node (tests/previewOptions.test.ts). React
// reads it through usePreviewOptions (state/previewStore.ts).
//
// "Travel" here is every move the laser makes with the beam off: the rapid moves between shapes and
// between the separate runs on one scan line, and the run-ups and joins that overscan adds. The
// preview cannot tell them apart (a preview move only carries its kind), so they share one option.

import { KIND_TRAVEL } from '@/lib/toolpath';

/** Where the choice is remembered between sessions. */
export const SHOW_TRAVEL_STORAGE_KEY = 'makerlaser.showTravel';

/** How solid the laser-off moves are drawn, 0 to 1. Faint, because there can be thousands. */
export const TRAVEL_OPACITY = 0.35;

/** True when moves of this kind are drawn: everything is, except travel when it is switched off. */
export function shouldDrawKind(kind: number, showTravel: boolean): boolean {
  return showTravel || kind !== KIND_TRAVEL;
}

/** The remembered choice. Travel is shown unless "0" was stored: anything else means the default. */
export function parseStoredShowTravel(raw: string | null): boolean {
  return raw !== '0';
}

export interface PreviewOptions {
  readonly showTravel: boolean;
}

/** The part of the browser's localStorage the store needs. */
export interface PreviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readStored(storage: PreviewStorage | undefined): boolean {
  try {
    return parseStoredShowTravel(storage ? storage.getItem(SHOW_TRAVEL_STORAGE_KEY) : null);
  } catch {
    return true;
  }
}

function writeStored(storage: PreviewStorage | undefined, showTravel: boolean): void {
  try {
    storage?.setItem(SHOW_TRAVEL_STORAGE_KEY, showTravel ? '1' : '0');
  } catch {
    /* storage is unavailable: the choice is just not remembered */
  }
}

/** The preview options, remembered between sessions. React reads it through usePreviewOptions. */
export function createPreviewOptionsStore(storage?: PreviewStorage) {
  let state: PreviewOptions = { showTravel: readStored(storage) };
  const listeners = new Set<() => void>();
  return {
    get: (): PreviewOptions => state,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setShowTravel: (showTravel: boolean): void => {
      writeStored(storage, showTravel);
      if (showTravel === state.showTravel) return;
      state = { showTravel };
      listeners.forEach((listener) => listener());
    },
  };
}
