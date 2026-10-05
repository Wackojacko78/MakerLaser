import { describe, expect, it } from 'vitest';
import {
  adoptAutomaticOrder,
  canMoveLayer,
  computeRunOrder,
  isCustomOrder,
  moveLayer,
  orderedLayers,
  runOrderWarning,
} from '@/lib/runOrder';
import type { Layer, LayerKind, WorkspaceObject } from '@/types/domain';

const RASTER = { dpi: 254, dither: 'floyd_steinberg', direction: 'horizontal', bidirectional: true, brightness: 0, contrast: 0, gamma: 1, invert: false } as const;

function layer(id: string, kind: LayerKind, z: number, over: Partial<Layer> = {}): Layer {
  return {
    id, name: id, kind, speed_mm_min: 300, power_percent: 50, passes: 1, air_assist: false, enabled: true, z_order: z,
    color: '#fff', kerf_mm: 0, line_spacing_mm: 0.1, fill_angle_deg: 0, cross_hatch: false, raster: { ...RASTER }, ...over,
  };
}
const vector = (layerId: string | null, over: Partial<WorkspaceObject> = {}): WorkspaceObject => ({
  id: `v-${layerId}`, name: 'v', kind: { type: 'vector', paths: [] }, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  layer_id: layerId, visible: true, locked: false, z_index: 0, ...over,
});
const image = (layerId: string | null, over: Partial<WorkspaceObject> = {}): WorkspaceObject => ({
  ...vector(layerId), id: `i-${layerId}`,
  kind: { type: 'image', asset_id: 'a', format: 'png', source_path: null, width_px: 1, height_px: 1, dpi: 96 }, ...over,
});

/** The four default layers, in the order a new project has them. */
const defaults = () => [layer('Cut', 'cut', 0), layer('Score', 'score', 1), layer('Fill', 'fill', 2), layer('Image', 'image', 3)];
const project = (layers: Layer[], objects: WorkspaceObject[], custom?: boolean) => ({ layers, objects, settings: { custom_run_order: custom } });
const everything = [vector('Cut'), vector('Score'), vector('Fill'), image('Image')];

describe('automatic order', () => {
  it('runs engraving first and cutting last, whatever the layer list says', () => {
    expect(computeRunOrder(project(defaults(), everything))).toEqual(['Image', 'Fill', 'Score', 'Cut']);
  });
  it('is the default when the setting is absent or false', () => {
    expect(isCustomOrder({ settings: {} })).toBe(false);
    expect(isCustomOrder({ settings: { custom_run_order: false } })).toBe(false);
    expect(computeRunOrder(project(defaults(), everything, false))).toEqual(['Image', 'Fill', 'Score', 'Cut']);
  });
  it('orders two layers of the same type by their place in the list', () => {
    const layers = [layer('CutA', 'cut', 5), layer('CutB', 'cut', 1), layer('Image', 'image', 9)];
    expect(computeRunOrder(project(layers, [vector('CutA'), vector('CutB'), image('Image')]))).toEqual(['Image', 'CutB', 'CutA']);
  });
  it('keeps list order for equal z_order', () => {
    const layers = [layer('A', 'cut', 0), layer('B', 'cut', 0)];
    expect(computeRunOrder(project(layers, [vector('A'), vector('B')]))).toEqual(['A', 'B']);
  });
});

describe('custom order', () => {
  it('follows the layer list only', () => {
    expect(computeRunOrder(project(defaults(), everything, true))).toEqual(['Cut', 'Score', 'Fill', 'Image']);
    const reordered = [layer('Image', 'image', 0), layer('Cut', 'cut', 1), layer('Fill', 'fill', 2), layer('Score', 'score', 3)];
    expect(computeRunOrder(project(reordered, everything, true))).toEqual(['Image', 'Cut', 'Fill', 'Score']);
  });
});

describe('which layers run at all', () => {
  it('skips disabled layers, empty layers, and layers with only hidden objects', () => {
    const layers = defaults();
    layers[1] = layer('Score', 'score', 1, { enabled: false });
    const objs = [vector('Cut'), vector('Score'), vector('Fill', { visible: false }), image('Image')];
    expect(computeRunOrder(project(layers, objs))).toEqual(['Image', 'Cut']);
    expect(computeRunOrder(project(defaults(), []))).toEqual([]);
  });
  it('skips objects with no layer, and objects of the wrong type for the layer', () => {
    const objs = [vector(null), image('Cut'), vector('Image'), vector('Score')];
    expect(computeRunOrder(project(defaults(), objs))).toEqual(['Score']);
  });
  it('counts a locked object', () => {
    expect(computeRunOrder(project(defaults(), [vector('Cut', { locked: true })]))).toEqual(['Cut']);
  });
});

describe('runOrderWarning', () => {
  it('is silent in automatic order', () => {
    expect(runOrderWarning(project(defaults(), everything))).toBe(null);
  });
  it('warns when engraving runs after a cut, naming the layers', () => {
    const w = runOrderWarning(project(defaults(), everything, true)) as string;
    expect(w).toContain('\u201cScore\u201d, \u201cFill\u201d, \u201cImage\u201d run after a cut');
    expect(runOrderWarning(project(defaults(), [vector('Cut'), image('Image')], true))).toContain('\u201cImage\u201d runs after a cut');
  });
  it('is silent when the cut is last, when there is no cut, and when only cuts follow a cut', () => {
    const cutLast = [layer('Image', 'image', 0), layer('Cut', 'cut', 1)];
    expect(runOrderWarning(project(cutLast, [image('Image'), vector('Cut')], true))).toBe(null);
    expect(runOrderWarning(project(defaults(), [vector('Score'), image('Image')], true))).toBe(null);
    const twoCuts = [layer('CutA', 'cut', 0), layer('CutB', 'cut', 1)];
    expect(runOrderWarning(project(twoCuts, [vector('CutA'), vector('CutB')], true))).toBe(null);
  });
  it('ignores layers that do not run', () => {
    expect(runOrderWarning(project(defaults(), [vector('Cut')], true))).toBe(null);
  });
});

describe('adoptAutomaticOrder', () => {
  it('lists the layers in the order they run now and renumbers z_order', () => {
    const layers = defaults();
    adoptAutomaticOrder(layers);
    expect(layers.map((l) => l.id)).toEqual(['Image', 'Fill', 'Score', 'Cut']);
    expect(layers.map((l) => l.z_order)).toEqual([0, 1, 2, 3]);
  });
  it('changes nothing about what runs: custom order straight after adopting equals the automatic order', () => {
    const layers = [layer('CutB', 'cut', 7), layer('Image', 'image', 3), layer('CutA', 'cut', 2), layer('Fill', 'fill', 11), layer('Score', 'score', 0)];
    const objs = [vector('CutB'), vector('CutA'), image('Image'), vector('Fill'), vector('Score')];
    const before = computeRunOrder(project(layers, objs, false));
    adoptAutomaticOrder(layers);
    expect(computeRunOrder(project(layers, objs, true))).toEqual(before);
  });
  it('is stable for layers of the same type', () => {
    const layers = [layer('B', 'cut', 5), layer('A', 'cut', 5)];
    adoptAutomaticOrder(layers);
    expect(layers.map((l) => l.id)).toEqual(['B', 'A']);
  });
});

describe('moveLayer (custom order: adjacent swap)', () => {
  it('moves a layer up and down and renumbers', () => {
    const layers = defaults();
    expect(moveLayer(layers, 'Image', -1, false)).toBe(true);
    expect(layers.map((l) => l.id)).toEqual(['Cut', 'Score', 'Image', 'Fill']);
    expect(layers.map((l) => l.z_order)).toEqual([0, 1, 2, 3]);
    expect(moveLayer(layers, 'Cut', 1, false)).toBe(true);
    expect(layers.map((l) => l.id)).toEqual(['Score', 'Cut', 'Image', 'Fill']);
  });
  it('changes the run order the way you expect', () => {
    const layers = defaults();
    adoptAutomaticOrder(layers); // Image, Fill, Score, Cut
    const objs = [vector('Cut'), vector('Score'), vector('Fill'), image('Image')];
    moveLayer(layers, 'Cut', -1, false);
    moveLayer(layers, 'Cut', -1, false);
    moveLayer(layers, 'Cut', -1, false);
    expect(computeRunOrder(project(layers, objs, true))).toEqual(['Cut', 'Image', 'Fill', 'Score']);
  });
  it('does nothing at the ends', () => {
    const layers = defaults();
    const before = JSON.stringify(layers);
    expect(moveLayer(layers, 'Cut', -1, false)).toBe(false);
    expect(moveLayer(layers, 'Image', 1, false)).toBe(false);
    expect(moveLayer(layers, 'nope', 1, false)).toBe(false);
    expect(JSON.stringify(layers)).toBe(before);
  });
  it('first brings a list whose array order and z_order disagree into line', () => {
    const layers = [layer('B', 'cut', 2), layer('A', 'cut', 0), layer('C', 'cut', 1)]; // list order is A, C, B
    expect(orderedLayers(layers).map((l) => l.id)).toEqual(['A', 'C', 'B']);
    expect(moveLayer(layers, 'B', -1, false)).toBe(true);
    expect(layers.map((l) => l.id)).toEqual(['A', 'B', 'C']);
    expect(layers.map((l) => l.z_order)).toEqual([0, 1, 2]);
  });
});

describe('moveLayer (automatic order: within the same type)', () => {
  it('swaps with the nearest layer of the same type and leaves the others alone', () => {
    const layers = [layer('CutA', 'cut', 0), layer('Image', 'image', 1), layer('CutB', 'cut', 2), layer('Fill', 'fill', 3)];
    expect(moveLayer(layers, 'CutB', -1, true)).toBe(true);
    expect(layers.map((l) => l.id)).toEqual(['CutB', 'Image', 'CutA', 'Fill']);
  });
  it('cannot move a layer that is alone of its type', () => {
    const layers = defaults();
    expect(canMoveLayer(layers, 'Cut', -1, true)).toBe(false);
    expect(canMoveLayer(layers, 'Cut', 1, true)).toBe(false);
    expect(moveLayer(layers, 'Image', -1, true)).toBe(false);
  });
  it('really changes the order the two cut layers run in', () => {
    const layers = [layer('CutA', 'cut', 0), layer('CutB', 'cut', 1)];
    const objs = [vector('CutA'), vector('CutB')];
    expect(computeRunOrder(project(layers, objs))).toEqual(['CutA', 'CutB']);
    moveLayer(layers, 'CutB', -1, true);
    expect(computeRunOrder(project(layers, objs))).toEqual(['CutB', 'CutA']);
  });
});

describe('canMoveLayer', () => {
  it('matches what moveLayer does', () => {
    const layers = defaults();
    expect(canMoveLayer(layers, 'Cut', -1, false)).toBe(false);
    expect(canMoveLayer(layers, 'Cut', 1, false)).toBe(true);
    expect(canMoveLayer(layers, 'Image', 1, false)).toBe(false);
    expect(canMoveLayer(layers, 'Image', -1, false)).toBe(true);
    expect(canMoveLayer(layers, 'missing', 1, false)).toBe(false);
  });
  it('does not change anything', () => {
    const layers = defaults();
    const before = JSON.stringify(layers);
    canMoveLayer(layers, 'Image', -1, false);
    expect(JSON.stringify(layers)).toBe(before);
  });
});
