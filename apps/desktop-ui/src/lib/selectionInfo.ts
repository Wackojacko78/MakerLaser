// Small pure helpers behind the "which machine / which material preset is selected?" labels,
// and behind what a material preset remembers. No React, Konva or Tauri imports, so they are
// unit-tested in plain Node (tests/selectionInfo.test.ts and tests/presetExtras.test.ts).
import { DEFAULT_TAB_SPACING_MM } from '@/lib/cutTabs';
import type { Layer, LayerKind, MachineOrigin, MachineProfile, MaterialPreset, RasterOperation } from '@/types/domain';

const NEAR = 1e-9;
const near = (a: number, b: number) => Math.abs(a - b) <= NEAR;

/** Largest overscan a layer (and so a preset) may have, in mm. Matches MAX_OVERSCAN_MM in Rust. */
export const MAX_OVERSCAN_MM = 25;
/** Largest power ramp a layer (and so a preset) may have, in mm. Matches MAX_RAMP_MM in Rust. */
export const MAX_RAMP_MM = 10;
/** Largest sharpening an Image layer (and so a preset) may have. Matches MAX_SHARPEN in Rust. */
export const MAX_SHARPEN = 100;
/** Largest grey level the Threshold of an Image layer (and so a preset) may have. */
export const MAX_THRESHOLD = 255;
/** The Threshold and Sharpen of an Image layer that has never set them (the values older files load with). */
export const DEFAULT_THRESHOLD = 128;
export const DEFAULT_SHARPEN = 0;

// ---- what a preset remembers beyond speed, power, passes and air assist -----------------
//
// Overscan belongs to Fill and Image layers, the outline pass to Fill layers, the power ramp
// to Score layers, the tab width and spacing to Cut layers, and the threshold and sharpen to
// Image layers. A preset only remembers the ones its layer type uses. A preset that does not
// set one (an older preset, or a file written before this existed) leaves that setting on the
// layer alone when applied and is not compared with it.

export const usesOverscan = (kind: LayerKind) => kind === 'fill' || kind === 'image';
export const usesOutline = (kind: LayerKind) => kind === 'fill';
export const usesRamp = (kind: LayerKind) => kind === 'score';
export const usesTabs = (kind: LayerKind) => kind === 'cut';
export const usesThreshold = (kind: LayerKind) => kind === 'image';
export const usesSharpen = (kind: LayerKind) => kind === 'image';

export type PresetExtras = Pick<MaterialPreset, 'overscan_mm' | 'fill_outline' | 'ramp_mm' | 'tab_width_mm' | 'tab_spacing_mm' | 'threshold' | 'sharpen'>;
/** What a layer holds of the extras: the tabs on the layer, the threshold and sharpen inside its raster settings. */
type LayerExtras = Pick<Layer, 'overscan_mm' | 'fill_outline' | 'ramp_mm' | 'tab_width_mm' | 'tab_spacing_mm'> & { raster?: Pick<RasterOperation, 'threshold' | 'sharpen'> };

/** The extra settings this preset sets, limited to the ones its layer type uses. */
export function presetExtras(preset: Pick<MaterialPreset, 'for_layer_kind'> & PresetExtras): PresetExtras {
  const kind = preset.for_layer_kind;
  const out: PresetExtras = {};
  if (usesOverscan(kind) && typeof preset.overscan_mm === 'number') out.overscan_mm = preset.overscan_mm;
  if (usesOutline(kind) && typeof preset.fill_outline === 'boolean') out.fill_outline = preset.fill_outline;
  if (usesRamp(kind) && typeof preset.ramp_mm === 'number') out.ramp_mm = preset.ramp_mm;
  if (usesTabs(kind) && typeof preset.tab_width_mm === 'number') out.tab_width_mm = preset.tab_width_mm;
  if (usesTabs(kind) && typeof preset.tab_spacing_mm === 'number') out.tab_spacing_mm = preset.tab_spacing_mm;
  if (usesThreshold(kind) && typeof preset.threshold === 'number') out.threshold = preset.threshold;
  if (usesSharpen(kind) && typeof preset.sharpen === 'number') out.sharpen = preset.sharpen;
  return out;
}

/** What "Save as preset" stores from a layer: the extras its layer type uses, 0 and off included. */
export function extrasFromLayer(layer: Pick<Layer, 'kind'> & LayerExtras): PresetExtras {
  const out: PresetExtras = {};
  if (usesOverscan(layer.kind)) out.overscan_mm = layer.overscan_mm ?? 0;
  if (usesOutline(layer.kind)) out.fill_outline = layer.fill_outline ?? false;
  if (usesRamp(layer.kind)) out.ramp_mm = layer.ramp_mm ?? 0;
  if (usesTabs(layer.kind)) {
    out.tab_width_mm = layer.tab_width_mm ?? 0;
    out.tab_spacing_mm = layer.tab_spacing_mm ?? DEFAULT_TAB_SPACING_MM;
  }
  if (usesThreshold(layer.kind)) out.threshold = layer.raster?.threshold ?? DEFAULT_THRESHOLD;
  if (usesSharpen(layer.kind)) out.sharpen = layer.raster?.sharpen ?? DEFAULT_SHARPEN;
  return out;
}

const mm = (v: number) => (v > 0 ? `${trimNumber(v)} mm` : 'off');

/** "overscan 3 mm", "outline on", "ramp off": the extras a preset sets, for labels. */
export function describePresetExtras(preset: Pick<MaterialPreset, 'for_layer_kind'> & PresetExtras): string[] {
  const x = presetExtras(preset);
  const parts: string[] = [];
  if (x.overscan_mm !== undefined) parts.push(`overscan ${mm(x.overscan_mm)}`);
  if (x.fill_outline !== undefined) parts.push(`outline ${x.fill_outline ? 'on' : 'off'}`);
  if (x.ramp_mm !== undefined) parts.push(`ramp ${mm(x.ramp_mm)}`);
  if (x.tab_width_mm !== undefined) {
    const every = x.tab_spacing_mm !== undefined ? ` every ${trimNumber(x.tab_spacing_mm)} mm` : '';
    parts.push(x.tab_width_mm > 0 ? `tabs ${trimNumber(x.tab_width_mm)} mm${every}` : 'tabs off');
  } else if (x.tab_spacing_mm !== undefined) {
    parts.push(`tab spacing ${trimNumber(x.tab_spacing_mm)} mm`);
  }
  if (x.threshold !== undefined) parts.push(`threshold ${Math.round(x.threshold)}`);
  if (x.sharpen !== undefined) parts.push(x.sharpen > 0 ? `sharpen ${trimNumber(x.sharpen)}%` : 'sharpen off');
  return parts;
}

/** " (overscan 3 mm, outline on)", or an empty string when the preset sets none of them. */
export function presetExtrasSuffix(preset: Pick<MaterialPreset, 'for_layer_kind'> & PresetExtras): string {
  const parts = describePresetExtras(preset);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

type PresetLike = Pick<MaterialPreset, 'for_layer_kind' | 'speed_mm_min' | 'power_percent' | 'passes' | 'air_assist'> & PresetExtras;
type LayerLike = Pick<Layer, 'kind' | 'speed_mm_min' | 'power_percent' | 'passes' | 'air_assist'> & LayerExtras;

/** The air-assist setting a preset really gives a layer: it cannot be on if the machine has none. */
export function effectiveAirAssist(preset: Pick<MaterialPreset, 'air_assist'>, machineHasAirAssist: boolean): boolean {
  return preset.air_assist && machineHasAirAssist;
}

/** Gives the layer the settings of the preset. Settings the preset does not set are left alone. */
export function applyPresetToLayer(preset: PresetLike, layer: LayerLike, machineHasAirAssist: boolean): void {
  layer.speed_mm_min = preset.speed_mm_min;
  layer.power_percent = preset.power_percent;
  layer.passes = preset.passes;
  layer.air_assist = effectiveAirAssist(preset, machineHasAirAssist);
  const x = presetExtras(preset);
  if (x.overscan_mm !== undefined) layer.overscan_mm = x.overscan_mm;
  if (x.fill_outline !== undefined) layer.fill_outline = x.fill_outline;
  if (x.ramp_mm !== undefined) layer.ramp_mm = x.ramp_mm;
  if (x.tab_width_mm !== undefined) layer.tab_width_mm = x.tab_width_mm;
  if (x.tab_spacing_mm !== undefined) layer.tab_spacing_mm = x.tab_spacing_mm;
  // The threshold and sharpen live in the layer's raster settings. A layer with none (only in tests) is left alone.
  if (layer.raster) {
    if (x.threshold !== undefined) layer.raster.threshold = x.threshold;
    if (x.sharpen !== undefined) layer.raster.sharpen = x.sharpen;
  }
}

/** True when the layer currently has exactly the settings this preset would give it. */
export function presetMatchesLayer(preset: PresetLike, layer: LayerLike, machineHasAirAssist: boolean): boolean {
  if (
    !(
      preset.for_layer_kind === layer.kind &&
      near(preset.speed_mm_min, layer.speed_mm_min) &&
      near(preset.power_percent, layer.power_percent) &&
      preset.passes === layer.passes &&
      effectiveAirAssist(preset, machineHasAirAssist) === layer.air_assist
    )
  ) {
    return false;
  }
  const x = presetExtras(preset);
  if (x.overscan_mm !== undefined && !near(x.overscan_mm, layer.overscan_mm ?? 0)) return false;
  if (x.fill_outline !== undefined && x.fill_outline !== (layer.fill_outline ?? false)) return false;
  if (x.ramp_mm !== undefined && !near(x.ramp_mm, layer.ramp_mm ?? 0)) return false;
  if (x.tab_width_mm !== undefined && !near(x.tab_width_mm, layer.tab_width_mm ?? 0)) return false;
  if (x.tab_spacing_mm !== undefined && !near(x.tab_spacing_mm, layer.tab_spacing_mm ?? DEFAULT_TAB_SPACING_MM)) return false;
  if (x.threshold !== undefined && !near(x.threshold, layer.raster?.threshold ?? DEFAULT_THRESHOLD)) return false;
  if (x.sharpen !== undefined && !near(x.sharpen, layer.raster?.sharpen ?? DEFAULT_SHARPEN)) return false;
  return true;
}

/** The first preset whose settings the layer currently has, if any. */
export function findMatchingPreset<P extends PresetLike>(
  layer: LayerLike,
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
  preset: Pick<MaterialPreset, 'name' | 'for_layer_kind' | 'speed_mm_min' | 'power_percent' | 'passes' | 'air_assist'> & PresetExtras,
  layerName: string,
  machineHasAirAssist: boolean,
): string {
  const air = effectiveAirAssist(preset, machineHasAirAssist);
  const note = preset.air_assist && !machineHasAirAssist ? ' (air assist left off: this machine has none)' : '';
  const extras = describePresetExtras(preset)
    .map((s) => `, ${s}`)
    .join('');
  return (
    `Applied "${preset.name}" to layer "${layerName}": ${trimNumber(preset.speed_mm_min)} mm/min, ` +
    `${trimNumber(preset.power_percent)}% power, ${preset.passes} ${preset.passes === 1 ? 'pass' : 'passes'}` +
    `${air ? ', air assist on' : ''}${extras}${note}.`
  );
}
