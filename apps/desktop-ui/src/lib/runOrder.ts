// The order the layers run in, and moving a layer earlier or later. Pure TypeScript (no React,
// Konva or Tauri imports), so everything here is unit-tested in plain Node
// (tests/runOrder.test.ts).
//
// This mirrors `plan_operations` in packages/project/src/cam.rs, which is what actually decides
// the order the laser runs in. The panel only DISPLAYS what that code will do, so keep the two
// in step.
//
//   Automatic (the default): every layer that runs is sorted by type first (image, fill, score,
//   cut: engraving first, cutting last), then by its place in the layer list.
//   My own order (custom_run_order): sorted by its place in the layer list only.
//
// "Place in the layer list" is the layer's z_order (ties keep their list order).

import type { Layer, LayerKind, ProjectFile } from '@/types/domain';

/** The same ranking as `LaserOperation::execution_priority` in Rust: lower runs first. */
export const KIND_PRIORITY: Record<LayerKind, number> = { image: 0, fill: 1, score: 2, cut: 3 };

type OrderProject = {
  layers: readonly Layer[];
  objects: ReadonlyArray<Pick<ProjectFile['objects'][number], 'layer_id' | 'visible' | 'kind'>>;
  settings: { custom_run_order?: boolean };
};

export const isCustomOrder = (p: Pick<OrderProject, 'settings'>): boolean => p.settings.custom_run_order === true;

/** The layers in list order (z_order, ties in their current order): the order the panel shows. */
export function orderedLayers<L extends Pick<Layer, 'z_order'>>(layers: readonly L[]): L[] {
  return layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => a.layer.z_order - b.layer.z_order || a.index - b.index)
    .map((row) => row.layer);
}

/** True when the layer is enabled and holds at least one visible object it can run. */
function runs(layer: Layer, objects: OrderProject['objects']): boolean {
  if (!layer.enabled) return false;
  const wantsImage = layer.kind === 'image';
  return objects.some((o) => o.visible && o.layer_id === layer.id && (o.kind.type === 'image') === wantsImage);
}

/** Ids of the layers that will run, in the order they run. */
export function computeRunOrder(project: OrderProject): string[] {
  const custom = isCustomOrder(project);
  return project.layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => runs(layer, project.objects))
    .sort(
      (a, b) =>
        (custom ? 0 : KIND_PRIORITY[a.layer.kind]) - (custom ? 0 : KIND_PRIORITY[b.layer.kind]) ||
        a.layer.z_order - b.layer.z_order ||
        a.index - b.index,
    )
    .map(({ layer }) => layer.id);
}

/**
 * A warning when, in your own order, something runs after a cut: the cut-out piece can shift or
 * drop out before it is engraved. Null when the order is safe (or automatic).
 */
export function runOrderWarning(project: OrderProject): string | null {
  if (!isCustomOrder(project)) return null;
  const byId = new Map(project.layers.map((l) => [l.id, l]));
  const kinds = computeRunOrder(project).map((id) => byId.get(id) as Layer);
  const firstCut = kinds.findIndex((l) => l.kind === 'cut');
  if (firstCut < 0) return null;
  const later = kinds.slice(firstCut + 1).filter((l) => l.kind !== 'cut');
  if (later.length === 0) return null;
  const names = later.map((l) => `\u201c${l.name}\u201d`).join(', ');
  return `${names} ${later.length === 1 ? 'runs' : 'run'} after a cut. The cut-out piece may shift or drop out before it is engraved: put the cut layer last unless the piece is held in place.`;
}

function renumber(layers: Layer[]): void {
  layers.forEach((l, i) => {
    l.z_order = i;
  });
}

/**
 * Switching to "my own order": put the layers in the order they are running in right now
 * (engraving first, cutting last), so nothing changes until you move a layer yourself.
 * Rewrites the list order and z_order in place.
 */
export function adoptAutomaticOrder(layers: Layer[]): void {
  const sorted = layers
    .map((layer, index) => ({ layer, index }))
    .sort((a, b) => KIND_PRIORITY[a.layer.kind] - KIND_PRIORITY[b.layer.kind] || a.layer.z_order - b.layer.z_order || a.index - b.index)
    .map((row) => row.layer);
  renumber(sorted);
  layers.splice(0, layers.length, ...sorted);
}

/** Index in `sorted` that `from` would swap with, or -1. `withinKind` skips layers of other types. */
function targetIndex(sorted: readonly Layer[], from: number, delta: -1 | 1, withinKind: boolean): number {
  const here = sorted[from];
  if (!here) return -1;
  let to = from + delta;
  if (withinKind) {
    while (to >= 0 && to < sorted.length && sorted[to]?.kind !== here.kind) to += delta;
  }
  return to >= 0 && to < sorted.length ? to : -1;
}

/** Whether `moveLayer` would do anything. */
export function canMoveLayer(layers: readonly Layer[], id: string, delta: -1 | 1, withinKind: boolean): boolean {
  const sorted = orderedLayers(layers);
  return targetIndex(sorted, sorted.findIndex((l) => l.id === id), delta, withinKind) >= 0;
}

/**
 * Moves a layer one place earlier (-1) or later (+1) in the list and renumbers z_order to match.
 * With `withinKind` (automatic order) it swaps with the nearest layer of the same type, because
 * only those can change the run order there. Returns false, changing nothing, if it cannot move.
 */
export function moveLayer(layers: Layer[], id: string, delta: -1 | 1, withinKind: boolean): boolean {
  const sorted = orderedLayers(layers);
  const from = sorted.findIndex((l) => l.id === id);
  const to = targetIndex(sorted, from, delta, withinKind);
  const a = sorted[from];
  const b = sorted[to];
  if (from < 0 || to < 0 || !a || !b) return false;
  sorted[from] = b;
  sorted[to] = a;
  renumber(sorted);
  layers.splice(0, layers.length, ...sorted);
  return true;
}
