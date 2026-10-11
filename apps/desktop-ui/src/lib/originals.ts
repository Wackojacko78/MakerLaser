// What happens to the shapes a Shape tools action was made from (the "originals"): the result can take their
// place (Replace), they can be hidden (Hide) or they can stay as they are (Keep). Pure TypeScript (no React,
// Konva or Tauri imports), so it is unit-tested in plain Node (tests/originals.test.ts).
//
// Replace is the usual choice: the result keeps the original's name and its place in the stacking order, so
// a shape you combine, offset or round is still one shape in the Objects list instead of a pile of copies.
// A locked shape is never replaced or hidden, and neither is one with open lines (they would be lost); the
// result is then made as a new shape beside it.
import type { WorkspaceObject } from '@/types/domain';

export type OriginalMode = 'replace' | 'hide' | 'keep';

export const ORIGINAL_MODES: readonly OriginalMode[] = ['replace', 'hide', 'keep'];
export const DEFAULT_ORIGINAL_MODE: OriginalMode = 'replace';

export const ORIGINAL_MODE_LABELS: Record<OriginalMode, string> = {
  replace: 'Replace them with the result',
  hide: 'Hide them',
  keep: 'Leave them as they are',
};

export const ORIGINAL_MODE_HELP: Record<OriginalMode, string> = {
  replace: 'The result takes the place of the shapes it is made from, with the same name and position in the list. Ctrl+Z brings them back.',
  hide: 'The shapes it is made from are hidden, and do not run. The eye beside each one in the Objects list shows it again.',
  keep: 'The shapes it is made from stay where they are, under the result.',
};

/** What the plan needs to know about each original. */
export interface OriginalRef {
  id: string;
  locked: boolean;
  /** The object also has open lines or tiny paths, which a result does not contain. */
  hasLoose: boolean;
}

export interface OriginalsPlan {
  mode: OriginalMode;
  /** The originals that are taken out of the project (Replace). */
  remove: string[];
  /** The originals that are hidden (Hide). */
  hide: string[];
  /** Originals left alone because they are locked or have open lines, although Replace or Hide was chosen. */
  kept: number;
  /** How many originals there are. */
  total: number;
}

/** Decides what happens to each original. Nothing is changed. */
export function planOriginals(mode: OriginalMode, refs: readonly OriginalRef[]): OriginalsPlan {
  const plan: OriginalsPlan = { mode, remove: [], hide: [], kept: 0, total: refs.length };
  if (mode === 'keep') return plan;
  for (const r of refs) {
    if (r.locked || r.hasLoose) {
      plan.kept++;
      continue;
    }
    (mode === 'replace' ? plan.remove : plan.hide).push(r.id);
  }
  return plan;
}

/** The objects after the plan is carried out: the ones to remove are gone and the ones to hide are not visible. Returns a new list; nothing it is given is changed. */
export function applyOriginals(objects: readonly WorkspaceObject[], plan: OriginalsPlan): WorkspaceObject[] {
  const remove = new Set(plan.remove);
  const hide = new Set(plan.hide);
  const out: WorkspaceObject[] = [];
  for (const o of objects) {
    if (remove.has(o.id)) continue;
    out.push(hide.has(o.id) && o.visible ? { ...o, visible: false } : o);
  }
  return out;
}

/**
 * The name and stacking position of a result. A result that takes the place of its original keeps the
 * original's name and position; any other result gets a descriptive name ("Square (rounded 3 mm)") and goes on top.
 */
export function resultLook(
  removed: boolean,
  originalName: string,
  describedName: string,
  originalZIndex: number | undefined,
  nextZIndex: number,
): { name: string; zIndex: number } {
  if (removed && originalZIndex !== undefined && Number.isFinite(originalZIndex)) return { name: originalName, zIndex: originalZIndex };
  if (removed) return { name: originalName, zIndex: nextZIndex };
  return { name: describedName, zIndex: nextZIndex };
}

/** The sentence(s) added to the message after an action, about what happened to the originals. Empty for a plain Replace. */
export function originalsNote(plan: OriginalsPlan): string {
  const parts: string[] = [];
  if (plan.mode === 'hide' && plan.hide.length > 0) {
    parts.push(
      plan.hide.length === 1
        ? 'The original is hidden: the eye in the Objects list shows it again.'
        : `The ${plan.hide.length} originals are hidden: the eye in the Objects list shows them again.`,
    );
  }
  if (plan.mode === 'keep' && plan.total > 0) {
    parts.push(plan.total === 1 ? 'The original is still there, under the result.' : `The ${plan.total} originals are still there, under the results.`);
  }
  if (plan.mode !== 'keep' && plan.kept > 0) parts.push('Locked shapes and shapes with open lines were kept.');
  return parts.join(' ');
}
