// Small pure helpers behind the Layers panel: layer colours, locking a layer's artwork, and moving
// a layer to a place in the list by dragging it. No React, Konva or Tauri imports, so they are
// unit-tested in plain Node (tests/layerTools.test.ts).
import { orderedLayers } from '@/lib/runOrder';
import type { Layer, WorkspaceObject } from '@/types/domain';

// ---- colour -----------------------------------------------------------------------------

const HEX_COLOUR = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** "#4d8dff", "4D8DFF" and "#48f" all become "#4D8DFF" (the form the layers are saved in). Null if it is not a colour. */
export function normalizeColor(text: string): string | null {
  const digits = HEX_COLOUR.exec(text.trim())?.[1];
  if (!digits) return null;
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((c) => c + c)
          .join('')
      : digits;
  return `#${full.toUpperCase()}`;
}

// ---- locking a layer's artwork ----------------------------------------------------------

type Lockable = Pick<WorkspaceObject, 'layer_id' | 'locked'>;

/** empty: nothing on the layer. none / some / all: how many of its objects are locked. */
export type LayerLockState = 'empty' | 'none' | 'some' | 'all';

export function layerLockState(objects: readonly Lockable[], layerId: string): LayerLockState {
  let total = 0;
  let locked = 0;
  for (const o of objects) {
    if (o.layer_id !== layerId) continue;
    total++;
    if (o.locked) locked++;
  }
  if (total === 0) return 'empty';
  if (locked === 0) return 'none';
  return locked === total ? 'all' : 'some';
}

/**
 * Locks or unlocks every object that is on the layer right now. Objects added to the layer later
 * are not locked by this. Changes the objects in place; returns how many changed.
 */
export function setLayerLocked(objects: Lockable[], layerId: string, locked: boolean): number {
  let changed = 0;
  for (const o of objects) {
    if (o.layer_id === layerId && o.locked !== locked) {
      o.locked = locked;
      changed++;
    }
  }
  return changed;
}

// ---- dragging a layer to a new place ----------------------------------------------------

function plan<L extends Pick<Layer, 'id' | 'kind' | 'z_order'>>(layers: readonly L[], id: string, targetId: string, withinKind: boolean) {
  const sorted = orderedLayers(layers);
  const from = sorted.findIndex((l) => l.id === id);
  const to = sorted.findIndex((l) => l.id === targetId);
  const mover = sorted[from];
  const target = sorted[to];
  if (from < 0 || to < 0 || from === to || !mover || !target) return null;
  // In the automatic order only layers of the same type can change the run order, so only those swap.
  if (withinKind && mover.kind !== target.kind) return null;
  return { sorted, from, to };
}

/** Whether `moveLayerTo` would do anything. */
export function canMoveLayerTo(layers: readonly Layer[], id: string, targetId: string, withinKind: boolean): boolean {
  return plan(layers, id, targetId, withinKind) !== null;
}

/**
 * Moves layer `id` to the place where layer `targetId` is now (the layers in between shift by one)
 * and renumbers z_order to match, like `moveLayer` does. With `withinKind` (the automatic order) it
 * only works between layers of the same type. Returns false, changing nothing, if it cannot move.
 */
export function moveLayerTo(layers: Layer[], id: string, targetId: string, withinKind: boolean): boolean {
  const p = plan(layers, id, targetId, withinKind);
  if (!p) return false;
  const [item] = p.sorted.splice(p.from, 1);
  if (!item) return false;
  p.sorted.splice(p.to, 0, item);
  p.sorted.forEach((l, i) => {
    l.z_order = i;
  });
  layers.splice(0, layers.length, ...p.sorted);
  return true;
}
