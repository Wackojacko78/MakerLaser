import { describe, expect, it } from 'vitest';
import {
  effectiveAirAssist,
  findMatchingPreset,
  machineSummary,
  originLabel,
  presetAppliedMessage,
  presetMatchesLayer,
} from '@/lib/selectionInfo';

const preset = (over: Record<string, unknown> = {}) => ({
  name: 'Ply 3mm',
  for_layer_kind: 'cut' as const,
  speed_mm_min: 150,
  power_percent: 100,
  passes: 3,
  air_assist: true,
  ...over,
});
const layer = (over: Record<string, unknown> = {}) => ({
  kind: 'cut' as const,
  speed_mm_min: 150,
  power_percent: 100,
  passes: 3,
  air_assist: true,
  ...over,
});

describe('presetMatchesLayer', () => {
  it('matches a layer with exactly the preset settings', () => {
    expect(presetMatchesLayer(preset(), layer(), true)).toBe(true);
  });

  it('stops matching as soon as any one setting is edited', () => {
    expect(presetMatchesLayer(preset(), layer({ speed_mm_min: 151 }), true)).toBe(false);
    expect(presetMatchesLayer(preset(), layer({ power_percent: 99.9 }), true)).toBe(false);
    expect(presetMatchesLayer(preset(), layer({ passes: 2 }), true)).toBe(false);
    expect(presetMatchesLayer(preset(), layer({ air_assist: false }), true)).toBe(false);
  });

  it('never matches a layer of a different kind', () => {
    expect(presetMatchesLayer(preset(), layer({ kind: 'score' }), true)).toBe(false);
    expect(presetMatchesLayer(preset({ for_layer_kind: 'fill' }), layer(), true)).toBe(false);
  });

  it('treats air assist as off when the machine has none, matching how a preset is applied', () => {
    expect(effectiveAirAssist({ air_assist: true }, false)).toBe(false);
    expect(effectiveAirAssist({ air_assist: true }, true)).toBe(true);
    expect(effectiveAirAssist({ air_assist: false }, true)).toBe(false);
    // a preset with air assist, applied on a machine without it, leaves the layer's air assist off
    expect(presetMatchesLayer(preset(), layer({ air_assist: false }), false)).toBe(true);
    expect(presetMatchesLayer(preset(), layer({ air_assist: true }), false)).toBe(false);
  });

  it('tolerates floating point noise but nothing larger', () => {
    expect(presetMatchesLayer(preset({ power_percent: 0.1 + 0.2 }), layer({ power_percent: 0.3 }), true)).toBe(true);
    expect(presetMatchesLayer(preset({ power_percent: 0.3 }), layer({ power_percent: 0.31 }), true)).toBe(false);
  });
});

describe('findMatchingPreset', () => {
  const list = [
    preset({ name: 'A', speed_mm_min: 100 }),
    preset({ name: 'B' }),
    preset({ name: 'C' }),
    preset({ name: 'D', for_layer_kind: 'score' as const }),
  ];

  it('returns the first matching preset', () => {
    expect(findMatchingPreset(layer(), list, true)?.name).toBe('B');
  });

  it('returns undefined for custom settings, an empty list, and another kind', () => {
    expect(findMatchingPreset(layer({ speed_mm_min: 5 }), list, true)).toBe(undefined);
    expect(findMatchingPreset(layer(), [], true)).toBe(undefined);
    expect(findMatchingPreset(layer({ kind: 'image' as const }), list, true)).toBe(undefined);
  });

  it('follows an edit: custom after a change, and the preset again when it is changed back', () => {
    const l = layer();
    expect(findMatchingPreset(l, list, true)?.name).toBe('B');
    l.power_percent = 80;
    expect(findMatchingPreset(l, list, true)).toBe(undefined);
    l.power_percent = 100;
    expect(findMatchingPreset(l, list, true)?.name).toBe('B');
  });
});

describe('labels', () => {
  it('writes origins with a hyphen', () => {
    expect(originLabel('bottom_left')).toBe('bottom-left');
    expect(originLabel('top_right')).toBe('top-right');
  });

  it('summarises a machine', () => {
    expect(machineSummary({ bed_width_mm: 410, bed_height_mm: 400, origin: 'bottom_left' })).toBe('410 \u00d7 400 mm, origin bottom-left');
    expect(machineSummary({ bed_width_mm: 300.04, bed_height_mm: 299.96, origin: 'top_left' })).toBe('300 \u00d7 300 mm, origin top-left');
    expect(machineSummary({ bed_width_mm: 412.5, bed_height_mm: 400, origin: 'bottom_right' })).toBe('412.5 \u00d7 400 mm, origin bottom-right');
  });

  it('describes an applied preset, with the right singular and plural', () => {
    expect(presetAppliedMessage(preset(), 'Cut', true)).toBe(
      'Applied "Ply 3mm" to layer "Cut": 150 mm/min, 100% power, 3 passes, air assist on.',
    );
    expect(presetAppliedMessage(preset({ passes: 1, air_assist: false, power_percent: 12.5 }), 'Score', true)).toBe(
      'Applied "Ply 3mm" to layer "Score": 150 mm/min, 12.5% power, 1 pass.',
    );
  });

  it('says when air assist was left off because the machine has none', () => {
    expect(presetAppliedMessage(preset(), 'Cut', false)).toBe(
      'Applied "Ply 3mm" to layer "Cut": 150 mm/min, 100% power, 3 passes (air assist left off: this machine has none).',
    );
  });
});
