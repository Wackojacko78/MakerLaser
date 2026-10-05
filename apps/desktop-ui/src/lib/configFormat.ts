// Standard exchange formats for material libraries and machine profiles, plus the small
// helpers around them. Pure TypeScript (no React, Konva or Tauri imports), so everything here
// is unit-tested in plain Node (tests/configFormat.test.ts). See docs/config-formats.md.
//
// Both formats are versioned JSON:
//   { "format": "makerlaser.materials", "version": 1, "presets": [ ... ] }
//   { "format": "makerlaser.machine",   "version": 1, "machine": { ... } }
// Ids are never stored in files; they are created when a file is imported. Fields this
// version does not know are ignored, so the formats can grow without breaking old files.
// Material files written before this format existed ({ "presets": [...] }, no "format")
// are still read.

import type { LayerKind, MachineOrigin, MachineProfile, MaterialPreset } from '@/types/domain';

export const MATERIALS_FORMAT = 'makerlaser.materials';
export const MACHINE_FORMAT = 'makerlaser.machine';
export const FORMAT_VERSION = 1;
export const MAX_PRESETS_PER_FILE = 1000;
export const MAX_SAVED_MACHINES = 50;
export const MAX_NAME_CHARS = 100;
export const MAX_NOTES_CHARS = 1000;

export type MaterialEntry = Omit<MaterialPreset, 'id'>;
export type MachineEntry = Omit<MachineProfile, 'id'>;

const LAYER_KINDS: readonly LayerKind[] = ['cut', 'score', 'fill', 'image'];
const ORIGINS: readonly MachineOrigin[] = ['bottom_left', 'bottom_right', 'top_left', 'top_right'];
const CONTROLLERS: readonly MachineProfile['controller'][] = ['grbl1_1', 'ruida', 'galvo'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v);

/** Case-insensitive name comparison used for duplicates. */
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}\u2026` : s);

// ---- reading the envelope ---------------------------------------------------------------

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')); // Windows editors often add a BOM
  } catch (e) {
    throw new Error(`This file is not valid JSON (${e instanceof Error ? e.message : String(e)}).`);
  }
}

function describeFormat(format: string): string | null {
  if (format === MATERIALS_FORMAT) return 'a material library';
  if (format === MACHINE_FORMAT) return 'a machine profile';
  return null;
}

/** Checks `format` and `version`. `legacy` is true when the file has no "format" at all. */
function openEnvelope(text: string, expected: string): { root: Obj; legacy: boolean } {
  const root = parseJson(text);
  if (!isObj(root)) throw new Error('This is not a MakerLaser file (expected a JSON object).');
  const format = root.format;
  if (format === undefined) return { root, legacy: true };
  if (typeof format !== 'string') throw new Error('The "format" field must be text.');
  if (format !== expected) {
    const found = describeFormat(format);
    const wanted = describeFormat(expected) ?? expected;
    throw new Error(found ? `This file is ${found}, not ${wanted}.` : `Unknown file format "${clip(format)}".`);
  }
  const version = root.version;
  if (!isInt(version) || version < 1) throw new Error('The file has no valid "version" number.');
  if (version > FORMAT_VERSION) {
    throw new Error(
      `This file is version ${version}, made by a newer MakerLaser. This version reads up to version ${FORMAT_VERSION}: update MakerLaser to open it.`,
    );
  }
  return { root, legacy: false };
}

// ---- materials --------------------------------------------------------------------------

export interface MaterialCheck {
  entry: MaterialEntry | null;
  problems: string[];
}

/** Validates one material preset. `entry` is null when anything is wrong. */
export function validateMaterialEntry(raw: unknown, index = 0): MaterialCheck {
  const label = isObj(raw) && typeof raw.name === 'string' && raw.name.trim() !== '' ? `"${clip(raw.name.trim())}"` : `entry ${index + 1}`;
  if (!isObj(raw)) return { entry: null, problems: [`${label}: must be an object`] };
  const problems: string[] = [];
  const bad = (msg: string) => problems.push(`${label}: ${msg}`);

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name === '') bad('name is required');
  else if (name.length > MAX_NAME_CHARS) bad(`name is longer than ${MAX_NAME_CHARS} characters`);

  const kind = raw.for_layer_kind;
  if (!LAYER_KINDS.includes(kind as LayerKind)) bad('for_layer_kind must be one of cut, score, fill, image');
  if (!isNum(raw.speed_mm_min) || raw.speed_mm_min <= 0) bad('speed_mm_min must be a number above 0');
  if (!isNum(raw.power_percent) || raw.power_percent <= 0 || raw.power_percent > 100) bad('power_percent must be above 0 and at most 100');
  if (!isInt(raw.passes) || raw.passes < 1 || raw.passes > 100) bad('passes must be a whole number from 1 to 100');

  const air = raw.air_assist ?? false;
  if (typeof air !== 'boolean') bad('air_assist must be true or false');

  const thickness = raw.thickness_mm ?? null;
  if (thickness !== null && (!isNum(thickness) || thickness <= 0 || thickness > 1000)) bad('thickness_mm must be a number above 0, or null');

  const notes = raw.notes ?? null;
  if (notes !== null && (typeof notes !== 'string' || notes.length > MAX_NOTES_CHARS)) {
    bad(`notes must be text of at most ${MAX_NOTES_CHARS} characters, or null`);
  }

  if (problems.length > 0) return { entry: null, problems };
  return {
    entry: {
      name,
      for_layer_kind: kind as LayerKind,
      speed_mm_min: raw.speed_mm_min as number,
      power_percent: raw.power_percent as number,
      passes: raw.passes as number,
      air_assist: air as boolean,
      thickness_mm: thickness as number | null,
      notes: notes as string | null,
    },
    problems,
  };
}

export interface ParsedMaterials {
  presets: MaterialEntry[];
  /** One message per rejected preset. The rest of the file is still usable. */
  rejected: string[];
  /** True for files written before the format existed (no "format" field). */
  legacy: boolean;
}

/** Reads a material library file. Throws Error with a readable message if the file is unusable. */
export function parseMaterialsFile(text: string): ParsedMaterials {
  const { root, legacy } = openEnvelope(text, MATERIALS_FORMAT);
  if (legacy && !Array.isArray(root.presets)) {
    throw new Error('This is not a MakerLaser material library (it has no "format" and no "presets" list).');
  }
  const list = root.presets;
  if (!Array.isArray(list)) throw new Error('The file has no "presets" list.');
  if (list.length > MAX_PRESETS_PER_FILE) throw new Error(`The file has more than ${MAX_PRESETS_PER_FILE} presets.`);

  const presets: MaterialEntry[] = [];
  const rejected: string[] = [];
  list.forEach((raw, i) => {
    const { entry, problems } = validateMaterialEntry(raw, i);
    if (entry) presets.push(entry);
    else rejected.push(problems.join('; '));
  });
  return { presets, rejected, legacy };
}

/** The file text for a material library: no ids, fixed field order. */
export function serializeMaterialsFile(library: { presets: readonly MaterialEntry[] }): string {
  const presets = library.presets.map((p) => ({
    name: p.name,
    for_layer_kind: p.for_layer_kind,
    speed_mm_min: p.speed_mm_min,
    power_percent: p.power_percent,
    passes: p.passes,
    air_assist: p.air_assist,
    thickness_mm: p.thickness_mm ?? null,
    notes: p.notes ?? null,
  }));
  return JSON.stringify({ format: MATERIALS_FORMAT, version: FORMAT_VERSION, presets }, null, 2) + '\n';
}

const sameSettings = (a: MaterialEntry, b: MaterialEntry) =>
  a.for_layer_kind === b.for_layer_kind &&
  a.speed_mm_min === b.speed_mm_min &&
  a.power_percent === b.power_percent &&
  a.passes === b.passes &&
  a.air_assist === b.air_assist &&
  (a.thickness_mm ?? null) === (b.thickness_mm ?? null) &&
  (a.notes ?? null) === (b.notes ?? null);

export interface MergeResult {
  /** New presets to add to the library, with fresh ids. */
  added: MaterialPreset[];
  /** Presets skipped because the library already had the same name and settings. */
  skippedIdentical: number;
  /** Added presets whose name was changed to "name (2)" because the name was taken. */
  renamed: number;
}

/**
 * Works out what importing `incoming` into `existing` should add. Never overwrites: a preset
 * with the same name but different settings is kept alongside as "name (2)".
 */
export function mergeMaterials(existing: readonly MaterialEntry[], incoming: readonly MaterialEntry[], newId: () => string): MergeResult {
  const pool: MaterialEntry[] = [...existing];
  const added: MaterialPreset[] = [];
  let skippedIdentical = 0;
  let renamed = 0;

  for (const entry of incoming) {
    const sameNamed = pool.filter((p) => sameName(p.name, entry.name));
    if (sameNamed.some((p) => sameSettings(p, entry))) {
      skippedIdentical++;
      continue;
    }
    let name = entry.name;
    if (sameNamed.length > 0) {
      let n = 2;
      while (pool.some((p) => sameName(p.name, `${entry.name} (${n})`))) n++;
      name = `${entry.name} (${n})`;
      renamed++;
    }
    const preset: MaterialPreset = { id: newId(), ...entry, name };
    added.push(preset);
    pool.push(preset);
  }
  return { added, skippedIdentical, renamed };
}

/** The notice to show after a material import. */
export function summarizeMaterialImport(parsed: ParsedMaterials, merge: MergeResult): { kind: 'info' | 'warning'; text: string } {
  const parts: string[] = [];
  const added = merge.added.length;
  if (added > 0) {
    parts.push(
      `Imported ${plural(added, 'preset', 'presets')}${merge.renamed > 0 ? ` (${merge.renamed} renamed because the name was already used)` : ''}.`,
    );
  } else if (parsed.rejected.length === 0 && merge.skippedIdentical === 0) {
    parts.push('The file contains no presets.');
  } else {
    parts.push('Nothing was imported.');
  }
  if (merge.skippedIdentical > 0) {
    parts.push(`${plural(merge.skippedIdentical, 'identical preset was', 'identical presets were')} already in your library.`);
  }
  if (parsed.rejected.length > 0) {
    const shown = parsed.rejected.slice(0, 2).join('; ');
    const more = parsed.rejected.length > 2 ? `; and ${parsed.rejected.length - 2} more` : '';
    parts.push(`${parsed.rejected.length} rejected: ${shown}${more}.`);
  }
  return { kind: parsed.rejected.length > 0 ? 'warning' : 'info', text: parts.join(' ') };
}

// ---- machines ---------------------------------------------------------------------------

export interface MachineCheck {
  entry: MachineEntry | null;
  problems: string[];
}

/** Validates one machine profile. `entry` is null when anything is wrong. */
export function validateMachineEntry(raw: unknown): MachineCheck {
  if (!isObj(raw)) return { entry: null, problems: ['The machine must be an object.'] };
  const problems: string[] = [];
  const bad = (msg: string) => problems.push(msg);

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name === '') bad('name is required');
  else if (name.length > MAX_NAME_CHARS) bad(`name is longer than ${MAX_NAME_CHARS} characters`);

  const controller = raw.controller ?? 'grbl1_1';
  if (!CONTROLLERS.includes(controller as MachineProfile['controller'])) bad('controller must be one of grbl1_1, ruida, galvo');

  const inRange = (v: unknown, lo: number, hi: number) => isNum(v) && v >= lo && v <= hi;
  if (!inRange(raw.bed_width_mm, 10, 5000)) bad('bed_width_mm must be a number from 10 to 5000');
  if (!inRange(raw.bed_height_mm, 10, 5000)) bad('bed_height_mm must be a number from 10 to 5000');

  if (!ORIGINS.includes(raw.origin as MachineOrigin)) bad('origin must be one of bottom_left, bottom_right, top_left, top_right');
  if (!isNum(raw.max_feed_rate_mm_min) || raw.max_feed_rate_mm_min < 1) bad('max_feed_rate_mm_min must be a number of at least 1');
  if (!isInt(raw.max_spindle_value) || raw.max_spindle_value < 1 || raw.max_spindle_value > 100000) {
    bad('max_spindle_value must be a whole number from 1 to 100000');
  }

  const homing = raw.homing_supported ?? false;
  if (typeof homing !== 'boolean') bad('homing_supported must be true or false');
  const air = raw.air_assist_supported ?? false;
  if (typeof air !== 'boolean') bad('air_assist_supported must be true or false');
  const baud = raw.baud_rate ?? 115200;
  if (!isInt(baud) || baud < 300) bad('baud_rate must be a whole number of at least 300');

  if (problems.length > 0) return { entry: null, problems };
  return {
    entry: {
      name,
      controller: controller as MachineProfile['controller'],
      bed_width_mm: raw.bed_width_mm as number,
      bed_height_mm: raw.bed_height_mm as number,
      origin: raw.origin as MachineOrigin,
      max_feed_rate_mm_min: raw.max_feed_rate_mm_min as number,
      max_spindle_value: raw.max_spindle_value as number,
      homing_supported: homing as boolean,
      air_assist_supported: air as boolean,
      baud_rate: baud as number,
    },
    problems,
  };
}

/** A machine profile without its id, which is what files and saved presets hold. */
export function machineToEntry(m: MachineProfile | MachineEntry): MachineEntry {
  return {
    name: m.name,
    controller: m.controller,
    bed_width_mm: m.bed_width_mm,
    bed_height_mm: m.bed_height_mm,
    origin: m.origin,
    max_feed_rate_mm_min: m.max_feed_rate_mm_min,
    max_spindle_value: m.max_spindle_value,
    homing_supported: m.homing_supported,
    air_assist_supported: m.air_assist_supported,
    baud_rate: m.baud_rate,
  };
}

/** Reads a machine file. Throws Error with a readable message if the file is unusable. */
export function parseMachineFile(text: string): { machine: MachineEntry } {
  const { root, legacy } = openEnvelope(text, MACHINE_FORMAT);
  if (legacy) throw new Error('This is not a MakerLaser machine file (it has no "format" field).');
  const { entry, problems } = validateMachineEntry(root.machine);
  if (!entry) throw new Error(`The machine in this file is not valid: ${problems.join('; ')}.`);
  return { machine: entry };
}

/** The file text for one machine profile: no id, fixed field order. */
export function serializeMachineFile(machine: MachineProfile | MachineEntry): string {
  return JSON.stringify({ format: MACHINE_FORMAT, version: FORMAT_VERSION, machine: machineToEntry(machine) }, null, 2) + '\n';
}

// ---- the user's saved machine list ------------------------------------------------------

/** Adds `entry`, or replaces the saved machine with the same name. Null when the list is full. */
export function upsertMachine(list: readonly MachineEntry[], entry: MachineEntry): MachineEntry[] | null {
  const i = list.findIndex((m) => sameName(m.name, entry.name));
  if (i >= 0) return list.map((m, k) => (k === i ? entry : m));
  if (list.length >= MAX_SAVED_MACHINES) return null;
  return [...list, entry];
}

export function removeMachine(list: readonly MachineEntry[], name: string): MachineEntry[] {
  return list.filter((m) => !sameName(m.name, name));
}

/** Reads the saved list back from storage. Anything unreadable or invalid is dropped. */
export function parseSavedMachines(json: string | null): MachineEntry[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  let list: MachineEntry[] = [];
  for (const item of raw) {
    const { entry } = validateMachineEntry(item);
    if (entry && list.length < MAX_SAVED_MACHINES) list = upsertMachine(list, entry) ?? list;
  }
  return list;
}

export function serializeSavedMachines(list: readonly MachineEntry[]): string {
  return JSON.stringify(list.map(machineToEntry));
}
