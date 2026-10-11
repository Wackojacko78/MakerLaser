// Small pure helpers for selecting things: which keys add to the selection, and a short key that
// says "which things are selected". No React, Konva or Tauri imports, so they are unit-tested in
// plain Node (tests/selectionKeys.test.ts).

/** The part of a mouse event this file needs. Any MouseEvent (DOM or React) fits. */
export interface ModifierKeys {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * True when a click or a box-select should ADD to the selection (or, for a click on something
 * already selected, take it out) instead of replacing it: Shift or Ctrl, or Cmd on a Mac.
 */
export function isAdditiveSelect(e: ModifierKeys): boolean {
  return e.shiftKey || e.ctrlKey || e.metaKey;
}

/** The same string for the same set of selected ids, whatever order they are in. Empty for none. */
export function selectionKey(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join('|');
}
