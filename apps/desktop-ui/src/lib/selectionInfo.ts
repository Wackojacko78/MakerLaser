// Small pure helpers behind the "which machine / which material preset is selected?" labels.
// No React, Konva or Tauri imports, so they are unit-tested in plain Node
// (tests/selectionInfo.test.ts).

import type { Layer, MachineOrigin, MachineProfile, MaterialPreset } from '@/types/domain';

const NEAR = 1e-9;
const near = (a: number, b: number) => Math.abs(a - b) <= NEAR;

/** The air-assist setting a preset really gives a layer: it cannot be on if the machine has none. */
export function effectiveAirAssist(preset: Pick<MaterialPreset, 'air_assist'>, machineHasAirAssist: boolean): boolean {
  return preset.air_assist && machineHasAirAssist;
}

/** True when the layer currently has exactly the settings this preset would give it. */
export function presetMatchesLayer(
  preset: Pick<MaterialPreset, 'for_layer_kind' | 'speed_mm_min' | 'power_percent' | 'passes' | 'air_assist'>,
  layer: Pick<Layer, 'kind' | 'speed_mm_min' | 'power_percent' | 'passes' | 'air_assist'>,
  machineHasAirAssist: boolean,
): boolean {
  return (
    preset.for_layer_kind === layer.kind &&
    near(preset.speed_mm_min, layer.speed_mm_min) &&
    near(preset.power_percent, layer.power_percent) &&
    preset.passes === layer.passes &&
    effectiveAirAssist(preset, machineHasAirAssist) === layer.air_assist
  );
}

/** The first preset whose settings the layer currently has, if any. */
export function findMatchingPreset<P extends Pick<MaterialPreset, 'for_layer_kind' | 'speed_mm_min' | 'power_percent' | 'passes' | 'air_assist'>>(
  layer: Pick<Layer, 'kind' | 'speed_mm_min' | 'power_percent' | 'passes' | 'air_assist'>,
  presets: readonly P[],
  machineHasAirAssist: boolean,
): P | undefined {
  return presets.find((p) => presetMatchesLayer(p, layer, machineHasAirAssist));
}

/** "bottom_left" becomes "bottom-left". */
export function originLabel(origin: MachineOrigin): string {
  return origin.replace('_', '-');
}

const trimNumber = (v: number) => String(Number(v.toFixed(1)));

/** "300 x 300 mm, origin bottom-left" (with a proper multiplication sign). */
export function machineSummary(m: Pick<MachineProfile, 'bed_width_mm' | 'bed_height_mm' | 'origin'>): string {
  return `${trimNumber(m.bed_width_mm)} \u00d7 ${trimNumber(m.bed_height_mm)} mm, origin ${originLabel(m.origin)}`;
}

/** The confirmation shown right after a material preset is applied to a layer. */
export function presetAppliedMessage(
  preset: Pick<MaterialPreset, 'name' | 'speed_mm_min' | 'power_percent' | 'passes' | 'air_assist'>,
  layerName: string,
  machineHasAirAssist: boolean,
): string {
  const air = effectiveAirAssist(preset, machineHasAirAssist);
  const note = preset.air_assist && !machineHasAirAssist ? ' (air assist left off: this machine has none)' : '';
  return (
    `Applied "${preset.name}" to layer "${layerName}": ${trimNumber(preset.speed_mm_min)} mm/min, ` +
    `${trimNumber(preset.power_percent)}% power, ${preset.passes} ${preset.passes === 1 ? 'pass' : 'passes'}` +
    `${air ? ', air assist on' : ''}${note}.`
  );
}
