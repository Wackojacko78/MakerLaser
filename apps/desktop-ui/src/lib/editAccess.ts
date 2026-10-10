// When a text or shape object can be opened for editing, when a double-click or a key press should
// open it, and what to tell the user when it cannot. Pure TypeScript (no React, Konva or Tauri
// imports), so it is unit-tested in plain Node (tests/editAccess.test.ts).

/** The part of a bounding box (in mm) this file needs. */
export interface BoundsLike {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The part of an object this file needs. Any WorkspaceObject fits. */
export interface EditableLike {
  locked: boolean;
  kind: { type: string; source?: unknown };
}

/**
 * editable: it has saved settings and is not locked.
 * locked: it has saved settings but is locked.
 * no-settings: it is artwork with no saved settings (imported, or made before editing existed).
 * not-editable: it is not vector artwork at all (an image).
 */
export type EditAccess = 'editable' | 'locked' | 'no-settings' | 'not-editable';

export function editAccess(object: EditableLike): EditAccess {
  if (object.kind.type !== 'vector') return 'not-editable';
  if (!object.kind.source) return 'no-settings';
  return object.locked ? 'locked' : 'editable';
}

/** How far outside an object's box (in screen pixels) a double-click still counts as on it. */
export const EDIT_SLACK_PX = 6;

/** True when the point is inside the box, or within `slack` of it (all in the same unit). */
export function pointInBounds(point: { x: number; y: number }, b: BoundsLike, slack: number = 0): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  return point.x >= b.minX - slack && point.x <= b.maxX + slack && point.y >= b.minY - slack && point.y <= b.maxY + slack;
}

/** What to tell the user when a double-click on an object cannot open the editor, or null for nothing. */
export function editBlockedMessage(access: EditAccess): string | null {
  switch (access) {
    case 'locked':
      return 'This object is locked. Unlock it to edit it.';
    case 'no-settings':
      return (
        'This object was imported, or made before editing was added, so it has no saved settings to edit. ' +
        'Add it again with the Rectangle, Ellipse, Polygon, Star or Text tool to make it editable.'
      );
    default:
      return null;
  }
}

/** The part of a keyboard event this file needs. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
// Enter on a focused button or link means "click it", so it must be left alone.
const CLICKABLE_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);

/**
 * Enter or F2 opens the editor of the selected text or shape, but never while typing in a box or
 * with a button or link focused, and never with a modifier key held.
 */
export function opensEditorOnKey(e: KeyLike, target: { tag: string; contentEditable: boolean } | null, access: EditAccess | null): boolean {
  if (e.key !== 'Enter' && e.key !== 'F2') return false;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  if (target) {
    const tag = target.tag.toUpperCase();
    if (TYPING_TAGS.has(tag) || CLICKABLE_TAGS.has(tag) || target.contentEditable) return false;
  }
  return access === 'editable';
}
