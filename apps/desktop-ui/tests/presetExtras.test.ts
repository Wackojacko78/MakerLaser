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
import type { Layer, LayerKind, MaterialPreset } from '@/types/domain';

// Material presets remember overscan (Fill, Image), the outline pass (Fill) and the power ramp (Score).

const preset = (over: Record<string, unknown> = {}) => ({
  name: 'Ply fill',
  for_layer_kind: 'fill' as LayerKind,
  speed_mm_min: 3000,
  power_percent: 40,
  passes: 1,
  air_assist: false,
  ...over,
});

const layer = (over: Record<string, unknown> = {}) => ({
  kind: 'fill' as LayerKind,
  speed_mm_min: 3000,
  power_percent: 40,
  passes: 1,
  air_assist: false,
  ...over,
});

type L = Pick<Layer, 'kind' | 'speed_mm_min' | 'power_percent' | 'passes' | 'air_assist' | 'overscan_mm' | 'fill_outline' | 'ramp_mm'>;

describe('presetExtras: only the settings the layer type uses', () => {
  const all = { overscan_mm: 3, fill_outline: true, ramp_mm: 5 };
  it('Fill keeps overscan and outline', () => {
    expect(presetExtras({ for_layer_kind: 'fill', ...all })).toEqual({ overscan_mm: 3, fill_outline: true });
  });
  it('Image keeps overscan only', () => {
    expect(presetExtras({ for_layer_kind: 'image', ...all })).toEqual({ overscan_mm: 3 });
  });
  it('Score keeps the ramp only', () => {
    expect(presetExtras({ for_layer_kind: 'score', ...all })).toEqual({ ramp_mm: 5 });
  });
  it('Cut keeps nothing', () => {
    expect(presetExtras({ for_layer_kind: 'cut', ...all })).toEqual({});
  });
  it('leaves out what the preset does not set', () => {
    expect(presetExtras({ for_layer_kind: 'fill' })).toEqual({});
    expect(presetExtras({ for_layer_kind: 'fill', overscan_mm: 0 })).toEqual({ overscan_mm: 0 });
  });
});

describe('extrasFromLayer: what "Save as preset" stores', () => {
  it('stores zero and off too, so the preset says what it wants', () => {
    expect(extrasFromLayer({ kind: 'fill' })).toEqual({ overscan_mm: 0, fill_outline: false });
    expect(extrasFromLayer({ kind: 'image' })).toEqual({ overscan_mm: 0 });
    expect(extrasFromLayer({ kind: 'score' })).toEqual({ ramp_mm: 0 });
    expect(extrasFromLayer({ kind: 'cut' })).toEqual({});
  });
  it('stores the layer values', () => {
    expect(extrasFromLayer({ kind: 'fill', overscan_mm: 2.5, fill_outline: true, ramp_mm: 9 })).toEqual({ overscan_mm: 2.5, fill_outline: true });
    expect(extrasFromLayer({ kind: 'score', overscan_mm: 2.5, ramp_mm: 3 })).toEqual({ ramp_mm: 3 });
  });
});

describe('applyPresetToLayer', () => {
  it('sets the basics and the extras the preset has', () => {
    const l: L = layer({ speed_mm_min: 1, power_percent: 1, passes: 5, air_assist: true });
    applyPresetToLayer(preset({ overscan_mm: 3, fill_outline: true, air_assist: true }), l, true);
    expect(l).toEqual(layer({ air_assist: true, overscan_mm: 3, fill_outline: true }));
  });
  it('leaves the layer alone for settings the preset does not set', () => {
    const l: L = layer({ overscan_mm: 2, fill_outline: true });
    applyPresetToLayer(preset(), l, true);
    expect(l.overscan_mm).toBe(2);
    expect(l.fill_outline).toBe(true);
  });
  it('can turn them off', () => {
    const l: L = layer({ overscan_mm: 2, fill_outline: true });
    applyPresetToLayer(preset({ overscan_mm: 0, fill_outline: false }), l, true);
    expect(l.overscan_mm).toBe(0);
    expect(l.fill_outline).toBe(false);
  });
  it('does not give a layer a setting its type does not use', () => {
    const l: L = layer({ kind: 'score' });
    applyPresetToLayer(preset({ for_layer_kind: 'score', overscan_mm: 3, fill_outline: true, ramp_mm: 4 }), l, true);
    expect(l.ramp_mm).toBe(4);
    expect(l.overscan_mm).toBeUndefined();
    expect(l.fill_outline).toBeUndefined();
  });
  it('keeps the air assist rule', () => {
    const l: L = layer();
    applyPresetToLayer(preset({ air_assist: true }), l, false);
    expect(l.air_assist).toBe(false);
  });
});

describe('presetMatchesLayer with the extras', () => {
  it('a preset that sets no extras ignores them, so existing presets still match', () => {
    expect(presetMatchesLayer(preset(), layer({ overscan_mm: 7, fill_outline: true }), true)).toBe(true);
  });
  it('matches only when overscan, outline and ramp agree', () => {
    const p = preset({ overscan_mm: 3, fill_outline: true });
    expect(presetMatchesLayer(p, layer({ overscan_mm: 3, fill_outline: true }), true)).toBe(true);
    expect(presetMatchesLayer(p, layer({ overscan_mm: 2, fill_outline: true }), true)).toBe(false);
    expect(presetMatchesLayer(p, layer({ overscan_mm: 3, fill_outline: false }), true)).toBe(false);
    expect(presetMatchesLayer(p, layer({ overscan_mm: 3 }), true)).toBe(false);
    const s = preset({ for_layer_kind: 'score', ramp_mm: 3 });
    expect(presetMatchesLayer(s, layer({ kind: 'score', ramp_mm: 3 }), true)).toBe(true);
    expect(presetMatchesLayer(s, layer({ kind: 'score', ramp_mm: 4 }), true)).toBe(false);
  });
  it('treats a layer with no overscan, outline or ramp as 0 and off', () => {
    expect(presetMatchesLayer(preset({ overscan_mm: 0, fill_outline: false }), layer(), true)).toBe(true);
    expect(presetMatchesLayer(preset({ overscan_mm: 1 }), layer(), true)).toBe(false);
  });
  it('ignores extras on a preset whose type does not use them', () => {
    expect(presetMatchesLayer(preset({ for_layer_kind: 'cut', ramp_mm: 4 }), layer({ kind: 'cut' }), true)).toBe(true);
  });
  it('shows "custom" after a change and the preset again when it is changed back', () => {
    const list = [preset({ name: 'A', overscan_mm: 3 }), preset({ name: 'B', overscan_mm: 6 })];
    const l: L = layer({ overscan_mm: 3 });
    expect(findMatchingPreset(l, list, true)?.name).toBe('A');
    l.overscan_mm = 4;
    expect(findMatchingPreset(l, list, true)).toBeUndefined();
    l.overscan_mm = 6;
    expect(findMatchingPreset(l, list, true)?.name).toBe('B');
  });
  it('saving from a layer and applying to another layer gives a layer that matches', () => {
    const source = layer({ overscan_mm: 2.5, fill_outline: true });
    const saved = { ...preset(), ...extrasFromLayer(source) };
    const other: L = layer({ speed_mm_min: 100 });
    applyPresetToLayer(saved, other, true);
    expect(presetMatchesLayer(saved, other, true)).toBe(true);
    expect(other.overscan_mm).toBe(2.5);
    expect(other.fill_outline).toBe(true);
  });
});

describe('labels', () => {
  it('describes what a preset sets', () => {
    expect(describePresetExtras(preset({ overscan_mm: 3, fill_outline: true }))).toEqual(['overscan 3 mm', 'outline on']);
    expect(describePresetExtras(preset({ overscan_mm: 0, fill_outline: false }))).toEqual(['overscan off', 'outline off']);
    expect(describePresetExtras(preset({ for_layer_kind: 'score', ramp_mm: 2.5 }))).toEqual(['ramp 2.5 mm']);
    expect(describePresetExtras(preset())).toEqual([]);
  });
  it('writes a suffix for the "Preset in use" line, or nothing', () => {
    expect(presetExtrasSuffix(preset({ overscan_mm: 3 }))).toBe(' (overscan 3 mm)');
    expect(presetExtrasSuffix(preset())).toBe('');
  });
  it('mentions them when a preset is applied, and says nothing for an older preset', () => {
    expect(presetAppliedMessage(preset({ overscan_mm: 3, fill_outline: true }), 'Fill', true)).toBe(
      'Applied "Ply fill" to layer "Fill": 3000 mm/min, 40% power, 1 pass, overscan 3 mm, outline on.',
    );
    expect(presetAppliedMessage(preset(), 'Fill', true)).toBe('Applied "Ply fill" to layer "Fill": 3000 mm/min, 40% power, 1 pass.');
    expect(presetAppliedMessage(preset({ air_assist: true, overscan_mm: 2 }), 'Fill', false)).toBe(
      'Applied "Ply fill" to layer "Fill": 3000 mm/min, 40% power, 1 pass, overscan 2 mm (air assist left off: this machine has none).',
    );
  });
});

describe('material files with the extras', () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    name: 'Ply fill',
    for_layer_kind: 'fill',
    speed_mm_min: 3000,
    power_percent: 40,
    passes: 1,
    air_assist: false,
    thickness_mm: 3,
    notes: null,
    ...over,
  });
  const file = (presets: unknown[]) => JSON.stringify({ format: MATERIALS_FORMAT, version: 1, presets });
  const problems = (over: Record<string, unknown>) => validateMaterialEntry(raw(over)).problems.join('|');

  it('reads them', () => {
    const e = validateMaterialEntry(raw({ overscan_mm: 3, fill_outline: true })).entry;
    expect(e?.overscan_mm).toBe(3);
    expect(e?.fill_outline).toBe(true);
    expect(e?.ramp_mm).toBeUndefined();
  });
  it('treats null and missing as "not set"', () => {
    const e = validateMaterialEntry(raw({ overscan_mm: null, fill_outline: null, ramp_mm: null })).entry as MaterialEntry;
    expect(Object.keys(e)).not.toContain('overscan_mm');
    expect(Object.keys(e)).not.toContain('fill_outline');
    expect(Object.keys(validateMaterialEntry(raw()).entry as object)).not.toContain('overscan_mm');
  });
  it('accepts the edges of the ranges', () => {
    expect(validateMaterialEntry(raw({ overscan_mm: 0 })).entry?.overscan_mm).toBe(0);
    expect(validateMaterialEntry(raw({ overscan_mm: 25 })).entry?.overscan_mm).toBe(25);
    expect(validateMaterialEntry(raw({ for_layer_kind: 'score', ramp_mm: 10 })).entry?.ramp_mm).toBe(10);
  });
  it('rejects bad values', () => {
    expect(problems({ overscan_mm: -1 })).toContain('overscan_mm');
    expect(problems({ overscan_mm: 25.1 })).toContain('overscan_mm');
    expect(problems({ overscan_mm: '3' })).toContain('overscan_mm');
    expect(problems({ fill_outline: 'yes' })).toContain('fill_outline');
    expect(problems({ for_layer_kind: 'score', ramp_mm: 10.5 })).toContain('ramp_mm');
    expect(problems({ ramp_mm: -2 })).toContain('ramp_mm');
  });
  it('drops settings the layer type does not use', () => {
    const cut = validateMaterialEntry(raw({ for_layer_kind: 'cut', overscan_mm: 3, fill_outline: true, ramp_mm: 2 })).entry as MaterialEntry;
    expect(cut.overscan_mm).toBeUndefined();
    expect(cut.fill_outline).toBeUndefined();
    expect(cut.ramp_mm).toBeUndefined();
    const image = validateMaterialEntry(raw({ for_layer_kind: 'image', overscan_mm: 3, fill_outline: true })).entry as MaterialEntry;
    expect(image.overscan_mm).toBe(3);
    expect(image.fill_outline).toBeUndefined();
  });
  it('rejects only the preset with the bad value', () => {
    const r = parseMaterialsFile(file([raw({ name: 'Good', overscan_mm: 2 }), raw({ name: 'Far', overscan_mm: 99 })]));
    expect(r.presets.map((p) => p.name)).toEqual(['Good']);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]).toContain('"Far"');
  });
  it('writes them in a fixed order, and leaves out what is not set', () => {
    const lib: MaterialPreset[] = [
      { id: 'a', ...raw({ overscan_mm: 3, fill_outline: true }) } as unknown as MaterialPreset,
      { id: 'b', ...raw({ name: 'Old' }) } as unknown as MaterialPreset,
    ];
    const json = JSON.parse(serializeMaterialsFile({ presets: lib })) as { presets: Record<string, unknown>[] };
    expect(Object.keys(json.presets[0] as object)).toEqual([
      'name', 'for_layer_kind', 'speed_mm_min', 'power_percent', 'passes', 'air_assist', 'overscan_mm', 'fill_outline', 'thickness_mm', 'notes',
    ]);
    expect(Object.keys(json.presets[1] as object)).toEqual([
      'name', 'for_layer_kind', 'speed_mm_min', 'power_percent', 'passes', 'air_assist', 'thickness_mm', 'notes',
    ]);
  });
  it('round-trips', () => {
    const lib = [
      { id: 'a', ...raw({ overscan_mm: 3, fill_outline: false }) },
      { id: 'b', ...raw({ name: 'Mark', for_layer_kind: 'score', ramp_mm: 4 }) },
    ] as unknown as MaterialPreset[];
    const back = parseMaterialsFile(serializeMaterialsFile({ presets: lib }));
    expect(back.rejected).toEqual([]);
    expect(back.presets[0]).toMatchObject({ overscan_mm: 3, fill_outline: false });
    expect(back.presets[1]).toMatchObject({ ramp_mm: 4 });
    expect(mergeMaterials(lib, back.presets, () => 'x').added).toEqual([]);
  });
  it('an older preset file reads exactly as before', () => {
    const r = parseMaterialsFile(file([raw()]));
    expect(r.presets[0]).toEqual(raw());
  });
  it('importing a preset with different extras keeps both', () => {
    const existing = [{ id: 'a', ...raw({ overscan_mm: 3 }) }] as unknown as MaterialPreset[];
    const incoming = parseMaterialsFile(file([raw({ overscan_mm: 5 })])).presets;
    const r = mergeMaterials(existing, incoming, () => 'new');
    expect(r.added.map((p) => p.name)).toEqual(['Ply fill (2)']);
    // same settings but the older preset sets nothing: also different, because applying it differs
    const older = parseMaterialsFile(file([raw()])).presets;
    expect(mergeMaterials(existing, older, () => 'n2').added).toHaveLength(1);
  });
});
