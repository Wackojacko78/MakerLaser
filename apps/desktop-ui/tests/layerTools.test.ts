import { describe, expect, it } from 'vitest';
import { canMoveLayerTo, layerLockState, moveLayerTo, normalizeColor, setLayerLocked } from '@/lib/layerTools';
import { computeRunOrder, orderedLayers } from '@/lib/runOrder';
import type { Layer, LayerKind, WorkspaceObject } from '@/types/domain';

const layer = (id: string, kind: LayerKind, z: number): Layer => ({
  id,
  name: id,
  kind,
  speed_mm_min: 1000,
  power_percent: 50,
  passes: 1,
  air_assist: false,
  enabled: true,
  z_order: z,
  color: '#FFFFFF',
  kerf_mm: 0,
  line_spacing_mm: 0.1,
  fill_angle_deg: 0,
  cross_hatch: false,
  raster: { dpi: 254, dither: 'floyd_steinberg', direction: 'horizontal', bidirectional: true, brightness: 0, contrast: 0, gamma: 1, invert: false },
});

const obj = (id: string, layerId: string | null, locked = false): WorkspaceObject => ({
  id,
  name: id,
  kind: { type: 'vector', paths: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false }] },
  transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  layer_id: layerId,
  visible: true,
  locked,
  z_index: 0,
});

const names = (layers: readonly Layer[]) => orderedLayers(layers).map((l) => l.id);

describe('normalizeColor', () => {
  it('writes a colour the way layers are saved: # and six capitals', () => {
    expect(normalizeColor('#4d8dff')).toBe('#4D8DFF');
    expect(normalizeColor('4D8DFF')).toBe('#4D8DFF');
    expect(normalizeColor('  #ff4d4d ')).toBe('#FF4D4D');
  });
  it('expands the short form', () => {
    expect(normalizeColor('#48f')).toBe('#4488FF');
    expect(normalizeColor('FA0')).toBe('#FFAA00');
  });
  it('refuses anything else', () => {
    for (const bad of ['', '#', '#12', '#12345', '#1234567', '#gggggg', 'red', 'rgb(1,2,3)', '#12 345']) {
      expect(normalizeColor(bad)).toBeNull();
    }
  });
});

describe('layer lock', () => {
  const objects = () => [obj('a', 'L1'), obj('b', 'L1', true), obj('c', 'L2', true), obj('d', null)];
  it('says how much of a layer is locked', () => {
    const o = objects();
    expect(layerLockState(o, 'L1')).toBe('some');
    expect(layerLockState(o, 'L2')).toBe('all');
    expect(layerLockState(o, 'L3')).toBe('empty');
    expect(layerLockState([obj('x', 'L1')], 'L1')).toBe('none');
    expect(layerLockState([], 'L1')).toBe('empty');
  });
  it('locks only the objects on that layer and counts the ones it changed', () => {
    const o = objects();
    expect(setLayerLocked(o, 'L1', true)).toBe(1);
    expect(o.map((x) => x.locked)).toEqual([true, true, true, false]);
    expect(layerLockState(o, 'L1')).toBe('all');
  });
  it('unlocks them again and leaves other layers and unassigned objects alone', () => {
    const o = objects();
    expect(setLayerLocked(o, 'L2', false)).toBe(1);
    expect(o.map((x) => x.locked)).toEqual([false, true, false, false]);
    expect(setLayerLocked(o, 'L2', false)).toBe(0);
    expect(setLayerLocked(o, 'nope', true)).toBe(0);
  });
});

describe('moveLayerTo: in your own order', () => {
  const four = () => [layer('A', 'cut', 0), layer('B', 'score', 1), layer('C', 'fill', 2), layer('D', 'fill', 3)];
  it('moves a layer down onto another and takes its place', () => {
    const l = four();
    expect(moveLayerTo(l, 'A', 'C', false)).toBe(true);
    expect(names(l)).toEqual(['B', 'C', 'A', 'D']);
  });
  it('moves a layer up onto another and takes its place', () => {
    const l = four();
    expect(moveLayerTo(l, 'D', 'B', false)).toBe(true);
    expect(names(l)).toEqual(['A', 'D', 'B', 'C']);
  });
  it('moves to the very top and the very bottom', () => {
    const top = four();
    moveLayerTo(top, 'C', 'A', false);
    expect(names(top)).toEqual(['C', 'A', 'B', 'D']);
    const bottom = four();
    moveLayerTo(bottom, 'A', 'D', false);
    expect(names(bottom)).toEqual(['B', 'C', 'D', 'A']);
  });
  it('renumbers z_order 0, 1, 2 ... and keeps the array in list order', () => {
    const l = four();
    moveLayerTo(l, 'A', 'C', false);
    expect(l.map((x) => x.z_order)).toEqual([0, 1, 2, 3]);
    expect(l.map((x) => x.id)).toEqual(['B', 'C', 'A', 'D']);
  });
  it('does nothing for the same layer, an unknown layer, or a missing target', () => {
    const l = four();
    expect(moveLayerTo(l, 'A', 'A', false)).toBe(false);
    expect(moveLayerTo(l, 'A', 'zzz', false)).toBe(false);
    expect(moveLayerTo(l, 'zzz', 'A', false)).toBe(false);
    expect(names(l)).toEqual(['A', 'B', 'C', 'D']);
    expect(canMoveLayerTo(l, 'A', 'A', false)).toBe(false);
    expect(canMoveLayerTo(l, 'A', 'B', false)).toBe(true);
  });
  it('works on a list whose z_order does not match the array order', () => {
    const l = [layer('A', 'cut', 5), layer('B', 'score', 1), layer('C', 'fill', 3)];
    expect(names(l)).toEqual(['B', 'C', 'A']);
    moveLayerTo(l, 'A', 'B', false);
    expect(names(l)).toEqual(['A', 'B', 'C']);
  });
  it('changes what runs first when the order is your own', () => {
    const l = four();
    const project = { layers: l, objects: l.map((x) => obj(`o-${x.id}`, x.id)), settings: { custom_run_order: true } };
    expect(computeRunOrder(project)).toEqual(['A', 'B', 'C', 'D']);
    moveLayerTo(l, 'D', 'A', false);
    expect(computeRunOrder(project)).toEqual(['D', 'A', 'B', 'C']);
  });
});

describe('moveLayerTo: in the automatic order', () => {
  const six = () => [layer('Cut1', 'cut', 0), layer('Fill1', 'fill', 1), layer('Cut2', 'cut', 2), layer('Fill2', 'fill', 3)];
  it('swaps only between layers of the same type', () => {
    const l = six();
    expect(canMoveLayerTo(l, 'Cut1', 'Fill1', true)).toBe(false);
    expect(moveLayerTo(l, 'Cut1', 'Fill1', true)).toBe(false);
    expect(names(l)).toEqual(['Cut1', 'Fill1', 'Cut2', 'Fill2']);
    expect(canMoveLayerTo(l, 'Cut1', 'Cut2', true)).toBe(true);
  });
  it('puts a second layer of a type ahead of the first, and the run order follows', () => {
    const l = six();
    const project = { layers: l, objects: l.map((x) => obj(`o-${x.id}`, x.id)), settings: { custom_run_order: false } };
    expect(computeRunOrder(project)).toEqual(['Fill1', 'Fill2', 'Cut1', 'Cut2']);
    expect(moveLayerTo(l, 'Fill2', 'Fill1', true)).toBe(true);
    expect(computeRunOrder(project)).toEqual(['Fill2', 'Fill1', 'Cut1', 'Cut2']);
    expect(moveLayerTo(l, 'Cut1', 'Cut2', true)).toBe(true);
    expect(computeRunOrder(project)).toEqual(['Fill2', 'Fill1', 'Cut2', 'Cut1']);
  });
  it('moving down onto a layer of the same type also reverses the two', () => {
    const l = six();
    moveLayerTo(l, 'Fill1', 'Fill2', true);
    expect(names(l).filter((n) => n.startsWith('Fill'))).toEqual(['Fill2', 'Fill1']);
  });
});
