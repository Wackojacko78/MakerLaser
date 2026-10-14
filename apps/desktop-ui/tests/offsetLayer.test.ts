import { describe, expect, it } from 'vitest';
import { SAME_LAYER, SAME_LAYER_LABEL, chosenResultLayer, onLayerNote, resultLayerChoices } from '@/lib/offsetLayer';
import type { Layer, LayerKind } from '@/types/domain';

const layer = (id: string, kind: LayerKind, zOrder: number, name = id): Layer => ({
  id,
  name,
  kind,
  speed_mm_min: 1000,
  power_percent: 50,
  passes: 1,
  air_assist: false,
  enabled: true,
  z_order: zOrder,
  color: '#ff0000',
  kerf_mm: 0,
  line_spacing_mm: 0.1,
  fill_angle_deg: 0,
  cross_hatch: false,
  raster: { dpi: 254, dither: 'none', direction: 'horizontal', bidirectional: true, brightness: 0, contrast: 0, gamma: 1, invert: false },
});

describe('the usual choice', () => {
  it('is the empty value, labelled as the same layer as the original', () => {
    expect(SAME_LAYER).toBe('');
    expect(SAME_LAYER_LABEL).toBe('Same layer as the original');
  });
});

describe('resultLayerChoices', () => {
  it('lists every layer that can hold outlines, in the order of the Layers list, and leaves out picture layers', () => {
    const layers = [layer('F', 'fill', 3, 'Engrave'), layer('P', 'image', 1, 'Photo'), layer('C', 'cut', 2, 'Cut'), layer('S', 'score', 0, 'Score')];
    expect(resultLayerChoices(layers).map((c) => [c.id, c.name, c.kind])).toEqual([
      ['S', 'Score', 'score'],
      ['C', 'Cut', 'cut'],
      ['F', 'Engrave', 'fill'],
    ]);
  });

  it('gives nothing when there are only picture layers or no layers', () => {
    expect(resultLayerChoices([layer('P', 'image', 0)])).toEqual([]);
    expect(resultLayerChoices([])).toEqual([]);
  });

  it('does not change the list it is given', () => {
    const layers = [layer('B', 'cut', 2), layer('A', 'fill', 1)];
    const before = JSON.stringify(layers);
    resultLayerChoices(layers);
    expect(JSON.stringify(layers)).toBe(before);
  });
});

describe('chosenResultLayer', () => {
  const choices = resultLayerChoices([layer('C', 'cut', 0, 'Cut'), layer('F', 'fill', 1, 'Engrave')]);

  it('is null (keep the original\'s layer) for the usual choice', () => {
    expect(chosenResultLayer(choices, SAME_LAYER)).toBeNull();
    expect(chosenResultLayer(choices, '')).toBeNull();
  });

  it('is the layer that was picked while it can still be used', () => {
    expect(chosenResultLayer(choices, 'C')).toBe('C');
    expect(chosenResultLayer(choices, 'F')).toBe('F');
  });

  it('falls back to the original\'s layer when the pick has gone or is not one of the choices', () => {
    expect(chosenResultLayer(choices, 'deleted')).toBeNull();
    // A picture layer is never a choice, so a pick of one (for example after its kind was changed) is not used.
    expect(chosenResultLayer(resultLayerChoices([layer('P', 'image', 0)]), 'P')).toBeNull();
    expect(chosenResultLayer([], 'C')).toBeNull();
  });
});

describe('onLayerNote', () => {
  const choices = [
    { id: 'C', name: 'Cut' },
    { id: 'F', name: 'Fill "A"' },
  ];

  it('says nothing for the usual choice', () => {
    expect(onLayerNote(choices, null)).toBe('');
  });

  it('names the layer the results went on', () => {
    expect(onLayerNote(choices, 'C')).toBe(' on the layer "Cut"');
    expect(onLayerNote(choices, 'F')).toBe(' on the layer "Fill "A""');
  });

  it('says nothing about a layer it does not know', () => {
    expect(onLayerNote(choices, 'gone')).toBe('');
    expect(onLayerNote([], 'C')).toBe('');
  });
});
