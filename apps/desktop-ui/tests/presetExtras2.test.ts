import { describe, expect, it } from 'vitest';
import {
  MATERIALS_FORMAT,
  mergeMaterials,
  parseMaterialsFile,
  serializeMaterialsFile,
  validateMaterialEntry,
  type MaterialEntry,
} from '@/lib/configFormat';
import {
  applyPresetToLayer,
  describePresetExtras,
  extrasFromLayer,
  findMatchingPreset,
  presetAppliedMessage,
  presetExtras,
  presetExtrasSuffix,
  presetMatchesLayer,
} from '@/lib/selectionInfo';
import type { Layer, LayerKind, MaterialPreset, RasterOperation } from '@/types/domain';

// Material presets also remember the tab width and spacing (Cut), and the threshold and sharpen (Image).
const preset = (over: Record<string, unknown> = {}) => ({
  name: 'Ply cut',
  for_layer_kind: 'cut' as LayerKind,
  speed_mm_min: 150,
  power_percent: 100,
  passes: 3,
  air_assist: true,
  ...over,
});
type Raster = Pick<RasterOperation, 'threshold' | 'sharpen'>;
type L = Pick<Layer, 'kind' | 'speed_mm_min' | 'power_percent' | 'passes' | 'air_assist' | 'overscan_mm' | 'fill_outline' | 'ramp_mm' | 'tab_width_mm' | 'tab_spacing_mm'> & { raster?: Raster };
const layer = (over: Record<string, unknown> = {}): L => ({
  kind: 'cut' as LayerKind,
  speed_mm_min: 150,
  power_percent: 100,
  passes: 3,
  air_assist: true,
  ...over,
});
const imageLayer = (raster: Raster, over: Record<string, unknown> = {}): L => layer({ kind: 'image', raster, ...over });

describe('presetExtras: the new settings follow the layer type', () => {
  const all = { overscan_mm: 3, fill_outline: true, ramp_mm: 5, tab_width_mm: 2, tab_spacing_mm: 40, threshold: 90, sharpen: 30 };
  it('Cut keeps the tab width and spacing only', () => {
    expect(presetExtras({ for_layer_kind: 'cut', ...all })).toEqual({ tab_width_mm: 2, tab_spacing_mm: 40 });
  });
  it('Image keeps overscan, threshold and sharpen', () => {
    expect(presetExtras({ for_layer_kind: 'image', ...all })).toEqual({ overscan_mm: 3, threshold: 90, sharpen: 30 });
  });
  it('Fill and Score keep none of the new ones', () => {
    expect(presetExtras({ for_layer_kind: 'fill', ...all })).toEqual({ overscan_mm: 3, fill_outline: true });
    expect(presetExtras({ for_layer_kind: 'score', ...all })).toEqual({ ramp_mm: 5 });
  });
  it('leaves out what the preset does not set, and keeps zero and off', () => {
    expect(presetExtras({ for_layer_kind: 'cut' })).toEqual({});
    expect(presetExtras({ for_layer_kind: 'cut', tab_width_mm: 0 })).toEqual({ tab_width_mm: 0 });
    expect(presetExtras({ for_layer_kind: 'image', threshold: 0, sharpen: 0 })).toEqual({ threshold: 0, sharpen: 0 });
  });
});

describe('extrasFromLayer: what "Save as preset" stores', () => {
  it('stores the tabs of a Cut layer, and the usual values for a layer that never set them', () => {
    expect(extrasFromLayer({ kind: 'cut', tab_width_mm: 2.5, tab_spacing_mm: 40 })).toEqual({ tab_width_mm: 2.5, tab_spacing_mm: 40 });
    expect(extrasFromLayer({ kind: 'cut' })).toEqual({ tab_width_mm: 0, tab_spacing_mm: 50 });
  });
  it('stores the threshold and sharpen of an Image layer, and 128 and off for a layer that never set them', () => {
    expect(extrasFromLayer({ kind: 'image', overscan_mm: 2, raster: { threshold: 90, sharpen: 35 } })).toEqual({ overscan_mm: 2, threshold: 90, sharpen: 35 });
    expect(extrasFromLayer({ kind: 'image', raster: {} })).toEqual({ overscan_mm: 0, threshold: 128, sharpen: 0 });
  });
  it('stores a threshold of 0 as 0, not as the usual 128', () => {
    expect(extrasFromLayer({ kind: 'image', raster: { threshold: 0, sharpen: 0 } })).toMatchObject({ threshold: 0, sharpen: 0 });
  });
  it('does not give Fill and Score layers the new settings', () => {
    expect(extrasFromLayer({ kind: 'fill', tab_width_mm: 2, raster: { threshold: 90 } })).toEqual({ overscan_mm: 0, fill_outline: false });
    expect(extrasFromLayer({ kind: 'score', tab_width_mm: 2, raster: { sharpen: 9 } })).toEqual({ ramp_mm: 0 });
  });
});

describe('applyPresetToLayer', () => {
  it('sets the tabs on a Cut layer, and not the threshold', () => {
    const l = layer({ raster: { threshold: 128, sharpen: 0 } });
    applyPresetToLayer(preset({ tab_width_mm: 2, tab_spacing_mm: 40, threshold: 90 }), l, true);
    expect(l.tab_width_mm).toBe(2);
    expect(l.tab_spacing_mm).toBe(40);
    expect(l.raster).toEqual({ threshold: 128, sharpen: 0 });
  });
  it('sets the threshold and sharpen inside the raster settings of an Image layer, and not the tabs', () => {
    const l = imageLayer({ threshold: 128, sharpen: 0 });
    applyPresetToLayer(preset({ for_layer_kind: 'image', threshold: 90, sharpen: 35, tab_width_mm: 2 }), l, true);
    expect(l.raster).toEqual({ threshold: 90, sharpen: 35 });
    expect(l.tab_width_mm).toBeUndefined();
  });
  it('leaves everything alone for a preset that does not set them', () => {
    const c = layer({ tab_width_mm: 3, tab_spacing_mm: 70 });
    applyPresetToLayer(preset(), c, true);
    expect([c.tab_width_mm, c.tab_spacing_mm]).toEqual([3, 70]);
    const i = imageLayer({ threshold: 70, sharpen: 20 });
    applyPresetToLayer(preset({ for_layer_kind: 'image' }), i, true);
    expect(i.raster).toEqual({ threshold: 70, sharpen: 20 });
  });
  it('can switch tabs, threshold and sharpen off', () => {
    const c = layer({ tab_width_mm: 3 });
    applyPresetToLayer(preset({ tab_width_mm: 0 }), c, true);
    expect(c.tab_width_mm).toBe(0);
    const i = imageLayer({ threshold: 70, sharpen: 20 });
    applyPresetToLayer(preset({ for_layer_kind: 'image', threshold: 0, sharpen: 0 }), i, true);
    expect(i.raster).toEqual({ threshold: 0, sharpen: 0 });
  });
  it('does not fail on a layer that has no raster settings', () => {
    const l = layer();
    applyPresetToLayer(preset({ for_layer_kind: 'image', threshold: 90 }), l, true);
    expect(l.raster).toBeUndefined();
  });
});

describe('presetMatchesLayer with the new settings', () => {
  it('a preset that sets none ignores them, so existing presets still match', () => {
    expect(presetMatchesLayer(preset(), layer({ tab_width_mm: 7 }), true)).toBe(true);
    expect(presetMatchesLayer(preset({ for_layer_kind: 'image' }), imageLayer({ threshold: 9, sharpen: 9 }), true)).toBe(true);
  });
  it('matches a Cut preset only when the tab width and spacing agree', () => {
    const p = preset({ tab_width_mm: 2, tab_spacing_mm: 40 });
    expect(presetMatchesLayer(p, layer({ tab_width_mm: 2, tab_spacing_mm: 40 }), true)).toBe(true);
    expect(presetMatchesLayer(p, layer({ tab_width_mm: 3, tab_spacing_mm: 40 }), true)).toBe(false);
    expect(presetMatchesLayer(p, layer({ tab_width_mm: 2, tab_spacing_mm: 41 }), true)).toBe(false);
    expect(presetMatchesLayer(p, layer({ tab_width_mm: 2 }), true)).toBe(false);
  });
  it('treats a layer with no tabs as 0 mm every 50 mm', () => {
    expect(presetMatchesLayer(preset({ tab_width_mm: 0, tab_spacing_mm: 50 }), layer(), true)).toBe(true);
    expect(presetMatchesLayer(preset({ tab_width_mm: 1 }), layer(), true)).toBe(false);
  });
  it('matches an Image preset only when threshold and sharpen agree, and treats no raster as 128 and off', () => {
    const p = preset({ for_layer_kind: 'image', threshold: 90, sharpen: 35 });
    expect(presetMatchesLayer(p, imageLayer({ threshold: 90, sharpen: 35 }), true)).toBe(true);
    expect(presetMatchesLayer(p, imageLayer({ threshold: 91, sharpen: 35 }), true)).toBe(false);
    expect(presetMatchesLayer(p, imageLayer({ threshold: 90, sharpen: 0 }), true)).toBe(false);
    expect(presetMatchesLayer(preset({ for_layer_kind: 'image', threshold: 128, sharpen: 0 }), layer({ kind: 'image' }), true)).toBe(true);
  });
  it('shows the preset again when the layer is changed back, and custom while it differs', () => {
    const list = [preset({ name: 'A', tab_width_mm: 2 }), preset({ name: 'B', tab_width_mm: 4 })];
    const l = layer({ tab_width_mm: 2 });
    expect(findMatchingPreset(l, list, true)?.name).toBe('A');
    l.tab_width_mm = 3;
    expect(findMatchingPreset(l, list, true)).toBeUndefined();
    l.tab_width_mm = 4;
    expect(findMatchingPreset(l, list, true)?.name).toBe('B');
  });
  it('saving from a layer and applying to another gives a layer that matches', () => {
    const source = layer({ tab_width_mm: 1.5, tab_spacing_mm: 35 });
    const saved = { ...preset(), ...extrasFromLayer(source) };
    const other = layer({ speed_mm_min: 10 });
    applyPresetToLayer(saved, other, true);
    expect(presetMatchesLayer(saved, other, true)).toBe(true);
    expect(other.tab_width_mm).toBe(1.5);
    const src = imageLayer({ threshold: 77, sharpen: 12 });
    const savedImage = { ...preset({ for_layer_kind: 'image' }), ...extrasFromLayer(src) };
    const target = imageLayer({ threshold: 128, sharpen: 0 });
    applyPresetToLayer(savedImage, target, true);
    expect(presetMatchesLayer(savedImage, target, true)).toBe(true);
    expect(target.raster).toEqual({ threshold: 77, sharpen: 12 });
  });
});

describe('labels', () => {
  it('describes the tabs', () => {
    expect(describePresetExtras(preset({ tab_width_mm: 2, tab_spacing_mm: 40 }))).toEqual(['tabs 2 mm every 40 mm']);
    expect(describePresetExtras(preset({ tab_width_mm: 0, tab_spacing_mm: 50 }))).toEqual(['tabs off']);
    expect(describePresetExtras(preset({ tab_width_mm: 1.5 }))).toEqual(['tabs 1.5 mm']);
    expect(describePresetExtras(preset({ tab_spacing_mm: 30 }))).toEqual(['tab spacing 30 mm']);
  });
  it('describes the threshold and sharpen', () => {
    expect(describePresetExtras(preset({ for_layer_kind: 'image', overscan_mm: 2, threshold: 90, sharpen: 35 }))).toEqual(['overscan 2 mm', 'threshold 90', 'sharpen 35%']);
    expect(describePresetExtras(preset({ for_layer_kind: 'image', threshold: 128, sharpen: 0 }))).toEqual(['threshold 128', 'sharpen off']);
  });
  it('writes them in the suffix and the applied message, and says nothing for an older preset', () => {
    expect(presetExtrasSuffix(preset({ tab_width_mm: 2, tab_spacing_mm: 40 }))).toBe(' (tabs 2 mm every 40 mm)');
    expect(presetExtrasSuffix(preset())).toBe('');
    expect(presetAppliedMessage(preset({ tab_width_mm: 2, tab_spacing_mm: 40 }), 'Cut', true)).toBe(
      'Applied "Ply cut" to layer "Cut": 150 mm/min, 100% power, 3 passes, air assist on, tabs 2 mm every 40 mm.',
    );
  });
});

describe('material files with the new settings', () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    name: 'Ply cut',
    for_layer_kind: 'cut',
    speed_mm_min: 150,
    power_percent: 100,
    passes: 3,
    air_assist: true,
    thickness_mm: 3,
    notes: null,
    ...over,
  });
  const file = (presets: unknown[]) => JSON.stringify({ format: MATERIALS_FORMAT, version: 1, presets });
  const problems = (over: Record<string, unknown>) => validateMaterialEntry(raw(over)).problems.join('|');
  it('reads them', () => {
    const e = validateMaterialEntry(raw({ tab_width_mm: 2, tab_spacing_mm: 40 })).entry;
    expect(e?.tab_width_mm).toBe(2);
    expect(e?.tab_spacing_mm).toBe(40);
    const i = validateMaterialEntry(raw({ for_layer_kind: 'image', threshold: 90, sharpen: 35 })).entry;
    expect(i?.threshold).toBe(90);
    expect(i?.sharpen).toBe(35);
  });
  it('treats null and missing as "not set"', () => {
    const e = validateMaterialEntry(raw({ tab_width_mm: null, tab_spacing_mm: null, threshold: null, sharpen: null })).entry as MaterialEntry;
    for (const key of ['tab_width_mm', 'tab_spacing_mm', 'threshold', 'sharpen']) expect(Object.keys(e)).not.toContain(key);
  });
  it('accepts the edges of the ranges', () => {
    expect(validateMaterialEntry(raw({ tab_width_mm: 0 })).entry?.tab_width_mm).toBe(0);
    expect(validateMaterialEntry(raw({ tab_width_mm: 20 })).entry?.tab_width_mm).toBe(20);
    expect(validateMaterialEntry(raw({ tab_spacing_mm: 5 })).entry?.tab_spacing_mm).toBe(5);
    expect(validateMaterialEntry(raw({ tab_spacing_mm: 1000 })).entry?.tab_spacing_mm).toBe(1000);
    expect(validateMaterialEntry(raw({ for_layer_kind: 'image', threshold: 0, sharpen: 100 })).entry).toMatchObject({ threshold: 0, sharpen: 100 });
    expect(validateMaterialEntry(raw({ for_layer_kind: 'image', threshold: 255 })).entry?.threshold).toBe(255);
  });
  it('rejects bad values', () => {
    expect(problems({ tab_width_mm: -1 })).toContain('tab_width_mm');
    expect(problems({ tab_width_mm: 20.1 })).toContain('tab_width_mm');
    expect(problems({ tab_width_mm: '2' })).toContain('tab_width_mm');
    expect(problems({ tab_spacing_mm: 4.9 })).toContain('tab_spacing_mm');
    expect(problems({ tab_spacing_mm: 1000.1 })).toContain('tab_spacing_mm');
    expect(problems({ tab_spacing_mm: 0 })).toContain('tab_spacing_mm');
    expect(problems({ for_layer_kind: 'image', threshold: -1 })).toContain('threshold');
    expect(problems({ for_layer_kind: 'image', threshold: 256 })).toContain('threshold');
    expect(problems({ for_layer_kind: 'image', threshold: 99.5 })).toContain('threshold');
    expect(problems({ for_layer_kind: 'image', sharpen: 100.1 })).toContain('sharpen');
    expect(problems({ for_layer_kind: 'image', sharpen: -5 })).toContain('sharpen');
  });
  it('drops settings the layer type does not use', () => {
    const cut = validateMaterialEntry(raw({ threshold: 90, sharpen: 30, tab_width_mm: 2 })).entry as MaterialEntry;
    expect(cut.threshold).toBeUndefined();
    expect(cut.sharpen).toBeUndefined();
    expect(cut.tab_width_mm).toBe(2);
    const image = validateMaterialEntry(raw({ for_layer_kind: 'image', tab_width_mm: 2, tab_spacing_mm: 40, threshold: 90 })).entry as MaterialEntry;
    expect(image.tab_width_mm).toBeUndefined();
    expect(image.tab_spacing_mm).toBeUndefined();
    expect(image.threshold).toBe(90);
    const fill = validateMaterialEntry(raw({ for_layer_kind: 'fill', tab_width_mm: 2, threshold: 90, sharpen: 3 })).entry as MaterialEntry;
    expect([fill.tab_width_mm, fill.threshold, fill.sharpen]).toEqual([undefined, undefined, undefined]);
  });
  it('rejects only the preset with the bad value', () => {
    const r = parseMaterialsFile(file([raw({ name: 'Good', tab_width_mm: 2 }), raw({ name: 'Far', tab_width_mm: 99 })]));
    expect(r.presets.map((p) => p.name)).toEqual(['Good']);
    expect(r.rejected[0]).toContain('"Far"');
  });
  it('writes them in a fixed order after the older extras, and leaves out what is not set', () => {
    const lib = [
      { id: 'a', ...raw({ tab_width_mm: 2, tab_spacing_mm: 40 }) },
      { id: 'b', ...raw({ name: 'Photo', for_layer_kind: 'image', overscan_mm: 2, threshold: 90, sharpen: 35 }) },
      { id: 'c', ...raw({ name: 'Old' }) },
    ] as unknown as MaterialPreset[];
    const json = JSON.parse(serializeMaterialsFile({ presets: lib })) as { presets: Record<string, unknown>[] };
    expect(Object.keys(json.presets[0] as object)).toEqual(['name', 'for_layer_kind', 'speed_mm_min', 'power_percent', 'passes', 'air_assist', 'tab_width_mm', 'tab_spacing_mm', 'thickness_mm', 'notes']);
    expect(Object.keys(json.presets[1] as object)).toEqual(['name', 'for_layer_kind', 'speed_mm_min', 'power_percent', 'passes', 'air_assist', 'overscan_mm', 'threshold', 'sharpen', 'thickness_mm', 'notes']);
    expect(Object.keys(json.presets[2] as object)).toEqual(['name', 'for_layer_kind', 'speed_mm_min', 'power_percent', 'passes', 'air_assist', 'thickness_mm', 'notes']);
  });
  it('round-trips, and importing a library back into itself adds nothing', () => {
    const lib = [
      { id: 'a', ...raw({ tab_width_mm: 0, tab_spacing_mm: 50 }) },
      { id: 'b', ...raw({ name: 'Photo', for_layer_kind: 'image', threshold: 0, sharpen: 0 }) },
    ] as unknown as MaterialPreset[];
    const back = parseMaterialsFile(serializeMaterialsFile({ presets: lib }));
    expect(back.rejected).toEqual([]);
    expect(back.presets[0]).toMatchObject({ tab_width_mm: 0, tab_spacing_mm: 50 });
    expect(back.presets[1]).toMatchObject({ threshold: 0, sharpen: 0 });
    expect(mergeMaterials(lib, back.presets, () => 'x').added).toEqual([]);
  });
  it('an older preset file reads exactly as before', () => {
    expect(parseMaterialsFile(file([raw()])).presets[0]).toEqual(raw());
  });
  it('importing a preset that differs only in the new settings keeps both', () => {
    const existing = [{ id: 'a', ...raw({ tab_width_mm: 2 }) }] as unknown as MaterialPreset[];
    const r = mergeMaterials(existing, parseMaterialsFile(file([raw({ tab_width_mm: 3 })])).presets, () => 'new');
    expect(r.added.map((p) => p.name)).toEqual(['Ply cut (2)']);
    const sameButOlder = mergeMaterials(existing, parseMaterialsFile(file([raw()])).presets, () => 'n2');
    expect(sameButOlder.added).toHaveLength(1);
    const image = [{ id: 'i', ...raw({ for_layer_kind: 'image', threshold: 90 }) }] as unknown as MaterialPreset[];
    expect(mergeMaterials(image, parseMaterialsFile(file([raw({ for_layer_kind: 'image', threshold: 91 })])).presets, () => 'n3').added).toHaveLength(1);
  });
});
