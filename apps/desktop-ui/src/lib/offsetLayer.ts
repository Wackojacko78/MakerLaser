// Which layer an Offset result goes on. By default a result stays on the layer of the shape it was made from;
// "Put the result on layer" lets it go on another one (a cut line round an engraving usually belongs on a Cut
// layer, not on the Fill layer of the engraving). Pure TypeScript (no React, Konva or Tauri imports), so it is
// unit-tested in plain Node (tests/offsetLayer.test.ts).
import { traceLayerChoices } from '@/lib/traceObject';
import type { Layer, LayerKind } from '@/types/domain';

/** The value of the choice that keeps each result on the layer of the shape it was made from (the usual choice). */
export const SAME_LAYER = '';

/** The label of that choice. */
export const SAME_LAYER_LABEL = 'Same layer as the original';

export interface ResultLayerChoice {
  id: string;
  name: string;
  kind: LayerKind;
}

/**
 * The layers an Offset result can go on, in the order of the Layers list. A picture layer cannot hold outlines,
 * so it is left out. (The same layers the Trace tab offers.)
 */
export function resultLayerChoices(layers: readonly Layer[]): ResultLayerChoice[] {
  return traceLayerChoices(layers);
}

/**
 * The layer the results go on: the id of the layer that was picked, or null for "same layer as the original".
 * A pick that is no longer there (the layer was deleted, or is a picture layer) counts as the usual choice,
 * so a stale pick can never put a result on a layer that does not exist.
 */
export function chosenResultLayer(choices: readonly { id: string }[], picked: string): string | null {
  if (picked === SAME_LAYER) return null;
  return choices.some((c) => c.id === picked) ? picked : null;
}

/** The part of the message after an action that says where the results went: ' on the layer "Cut"', or nothing for the usual choice. */
export function onLayerNote(choices: readonly { id: string; name: string }[], layerId: string | null): string {
  if (layerId === null) return '';
  const found = choices.find((c) => c.id === layerId);
  return found ? ` on the layer "${found.name}"` : '';
}
