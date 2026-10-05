// Align, distribute, centre and grid-array operations. Pure TypeScript (no React, Konva or
// Tauri imports), so everything here is unit-tested in plain Node (tests/arrange.test.ts).
// Every function only PLANS: it returns the new transforms or the new objects, and the dialog
// applies them to the project as one undo step. Nothing here changes its inputs.
//
// Positions are measured on the axis-aligned bounding box of each object in workspace mm
// (Y points down, so "top" is the smaller Y). Locked objects are never moved.

import { chain, translation, unionBounds, worldBounds, type Bounds } from '@/lib/transform';
import type { Transform2D, WorkspaceObject } from '@/types/domain';

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type AlignTo = 'selection' | 'bed';
export type Axis = 'x' | 'y';

export const MAX_ARRAY_DIM = 100;
export const MAX_ARRAY_COPIES = 400;
export const MAX_ARRAY_GAP_MM = 1000;

const EPS = 1e-9;

export interface Bed {
  width: number;
  height: number;
}

export interface MovePlan {
  /** The new transform of every object that has to move (objects not listed stay put). */
  updates: Record<string, Transform2D>;
  /** Why nothing was done, when `updates` is empty. */
  message: string | null;
  /** Selected objects that were left alone because they are locked. */
  skippedLocked: number;
}

interface Item {
  object: WorkspaceObject;
  bounds: Bounds;
}

/** Selected objects that have a size, split into movable and (counted) locked ones. */
function selectedItems(objects: readonly WorkspaceObject[], ids: readonly string[], includeLocked: boolean) {
  const wanted = new Set(ids);
  const items: Item[] = [];
  let skippedLocked = 0;
  for (const object of objects) {
    if (!wanted.has(object.id)) continue;
    const bounds = worldBounds(object);
    if (!bounds) continue;
    if (object.locked && !includeLocked) skippedLocked++;
    else items.push({ object, bounds });
  }
  return { items, skippedLocked };
}

const moveBy = (o: WorkspaceObject, dx: number, dy: number): Transform2D => chain(o.transform, translation(dx, dy));

const unionOf = (items: readonly Item[]): Bounds | null => items.reduce<Bounds | null>((acc, i) => unionBounds(acc, i.bounds), null);

function toPlan(items: readonly Item[], deltas: ReadonlyMap<Item, [number, number]>, skippedLocked: number, noMoveMessage: string): MovePlan {
  const updates: Record<string, Transform2D> = {};
  for (const item of items) {
    const [dx, dy] = deltas.get(item) ?? [0, 0];
    if (Math.abs(dx) > EPS || Math.abs(dy) > EPS) updates[item.object.id] = moveBy(item.object, dx, dy);
  }
  return { updates, message: Object.keys(updates).length === 0 ? noMoveMessage : null, skippedLocked };
}

const nothing = (message: string, skippedLocked = 0): MovePlan => ({ updates: {}, message, skippedLocked });

/** Aligns the selected objects to each other (their combined box) or to the bed. */
export function planAlign(objects: readonly WorkspaceObject[], ids: readonly string[], mode: AlignMode, to: AlignTo, bed: Bed): MovePlan {
  const { items, skippedLocked } = selectedItems(objects, ids, false);
  if (items.length === 0) return nothing(skippedLocked > 0 ? 'The selected objects are locked.' : 'Select something first.', skippedLocked);
  if (to === 'selection' && items.length < 2) {
    return nothing('Select at least two objects to line them up with each other, or choose "Bed".', skippedLocked);
  }
  const ref: Bounds | null = to === 'bed' ? { minX: 0, minY: 0, maxX: bed.width, maxY: bed.height } : unionOf(items);
  if (!ref) return nothing('Select something first.', skippedLocked);

  const deltas = new Map<Item, [number, number]>();
  for (const item of items) {
    const b = item.bounds;
    switch (mode) {
      case 'left': deltas.set(item, [ref.minX - b.minX, 0]); break;
      case 'right': deltas.set(item, [ref.maxX - b.maxX, 0]); break;
      case 'hcenter': deltas.set(item, [(ref.minX + ref.maxX) / 2 - (b.minX + b.maxX) / 2, 0]); break;
      case 'top': deltas.set(item, [0, ref.minY - b.minY]); break;
      case 'bottom': deltas.set(item, [0, ref.maxY - b.maxY]); break;
      case 'vcenter': deltas.set(item, [0, (ref.minY + ref.maxY) / 2 - (b.minY + b.maxY) / 2]); break;
    }
  }
  return toPlan(items, deltas, skippedLocked, 'Already aligned.');
}

/**
 * Spaces the selected objects so the gaps between neighbours are equal. The first and the
 * last (by position along the axis) stay where they are. Needs at least three objects.
 */
export function planDistribute(objects: readonly WorkspaceObject[], ids: readonly string[], axis: Axis): MovePlan {
  const { items, skippedLocked } = selectedItems(objects, ids, false);
  if (items.length < 3) return nothing('Select at least three objects to space them evenly.', skippedLocked);

  const lo = (b: Bounds) => (axis === 'x' ? b.minX : b.minY);
  const hi = (b: Bounds) => (axis === 'x' ? b.maxX : b.maxY);
  const sorted = [...items].sort((p, q) => lo(p.bounds) + hi(p.bounds) - (lo(q.bounds) + hi(q.bounds)) || p.object.id.localeCompare(q.object.id));
  const first = sorted[0] as Item;
  const last = sorted[sorted.length - 1] as Item;
  const sizes = sorted.reduce((sum, i) => sum + (hi(i.bounds) - lo(i.bounds)), 0);
  const gap = (hi(last.bounds) - lo(first.bounds) - sizes) / (sorted.length - 1);

  const deltas = new Map<Item, [number, number]>();
  let cursor = lo(first.bounds);
  for (const item of sorted) {
    const d = cursor - lo(item.bounds);
    deltas.set(item, axis === 'x' ? [d, 0] : [0, d]);
    cursor += hi(item.bounds) - lo(item.bounds) + gap;
  }
  return toPlan(items, deltas, skippedLocked, 'Already evenly spaced.');
}

/** Moves the selection, as one group, so its centre is the centre of the bed. */
export function planCenterOnBed(objects: readonly WorkspaceObject[], ids: readonly string[], bed: Bed): MovePlan {
  const { items, skippedLocked } = selectedItems(objects, ids, false);
  const group = unionOf(items);
  if (!group) return nothing(skippedLocked > 0 ? 'The selected objects are locked.' : 'Select something first.', skippedLocked);
  const dx = bed.width / 2 - (group.minX + group.maxX) / 2;
  const dy = bed.height / 2 - (group.minY + group.maxY) / 2;
  const deltas = new Map<Item, [number, number]>(items.map((i) => [i, [dx, dy]]));
  return toPlan(items, deltas, skippedLocked, 'Already centred.');
}

// ---- grid array -------------------------------------------------------------------------

export interface ArrayOptions {
  rows: number;
  cols: number;
  /** Space between one copy and the next, to the right (gapX) and downwards (gapY). */
  gapX: number;
  gapY: number;
}

export interface ArrayPlan {
  /** The new objects (the originals are not included). Empty when there are errors. */
  copies: WorkspaceObject[];
  /** Box around the whole array, originals included. */
  bounds: Bounds | null;
  errors: string[];
  warnings: string[];
}

/** Problems with the array settings (empty when valid). `objectCount` is how many objects are selected. */
export function validateArrayOptions(o: ArrayOptions, objectCount: number): string[] {
  const p: string[] = [];
  for (const [label, v] of [['Columns', o.cols], ['Rows', o.rows]] as const) {
    if (!Number.isInteger(v) || v < 1 || v > MAX_ARRAY_DIM) p.push(`${label} must be a whole number from 1 to ${MAX_ARRAY_DIM}.`);
  }
  for (const [label, v] of [['Column gap', o.gapX], ['Row gap', o.gapY]] as const) {
    if (!Number.isFinite(v) || v < 0 || v > MAX_ARRAY_GAP_MM) p.push(`${label} must be from 0 to ${MAX_ARRAY_GAP_MM} mm.`);
  }
  if (p.length > 0) return p;
  if (o.rows * o.cols < 2) return ['Choose more than one row or column.'];
  const copies = (o.rows * o.cols - 1) * objectCount;
  if (copies > MAX_ARRAY_COPIES) return [`That would make ${copies} copies. The limit is ${MAX_ARRAY_COPIES}.`];
  return [];
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Repeats the selection as a group in a grid: columns go to the right, rows go down. */
export function planArray(
  objects: readonly WorkspaceObject[],
  ids: readonly string[],
  o: ArrayOptions,
  bed: Bed,
  newId: () => string = () => globalThis.crypto.randomUUID(),
): ArrayPlan {
  const { items } = selectedItems(objects, ids, true); // locked objects can be copied; the copies are unlocked
  const group = unionOf(items);
  if (!group) return { copies: [], bounds: null, errors: ['Select something first.'], warnings: [] };
  const errors = validateArrayOptions(o, items.length);
  if (errors.length > 0) return { copies: [], bounds: null, errors, warnings: [] };

  const w = group.maxX - group.minX;
  const h = group.maxY - group.minY;
  let z = objects.reduce((m, ob) => Math.max(m, ob.z_index), -1) + 1;
  const copies: WorkspaceObject[] = [];
  for (let row = 0; row < o.rows; row++) {
    for (let col = 0; col < o.cols; col++) {
      if (row === 0 && col === 0) continue;
      const dx = col * (w + o.gapX);
      const dy = row * (h + o.gapY);
      for (const { object } of items) {
        copies.push({
          ...object, // the shape itself (paths / image reference) is shared, never edited in place
          id: newId(),
          name: `${object.name} (${row + 1},${col + 1})`,
          transform: moveBy(object, dx, dy),
          locked: false,
          z_index: z++,
        });
      }
    }
  }

  const bounds: Bounds = {
    minX: group.minX,
    minY: group.minY,
    maxX: group.minX + o.cols * w + (o.cols - 1) * o.gapX,
    maxY: group.minY + o.rows * h + (o.rows - 1) * o.gapY,
  };
  const warnings: string[] = [];
  if (bounds.minX < 0 || bounds.minY < 0 || bounds.maxX > bed.width || bounds.maxY > bed.height) {
    warnings.push(
      `The array (${round1(bounds.maxX - bounds.minX)} \u00d7 ${round1(bounds.maxY - bounds.minY)} mm) does not fit the ${bed.width} \u00d7 ${bed.height} mm bed from where it starts.`,
    );
  }
  return { copies, bounds, errors: [], warnings };
}
