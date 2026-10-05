import { describe, expect, it } from 'vitest';
import {
  FORMAT_VERSION,
  MACHINE_FORMAT,
  MATERIALS_FORMAT,
  MAX_SAVED_MACHINES,
  machineToEntry,
  mergeMaterials,
  parseMachineFile,
  parseMaterialsFile,
  parseSavedMachines,
  removeMachine,
  serializeMachineFile,
  serializeMaterialsFile,
  serializeSavedMachines,
  summarizeMaterialImport,
  upsertMachine,
  validateMachineEntry,
  validateMaterialEntry,
  type MachineEntry,
  type MaterialEntry,
} from '@/lib/configFormat';
import type { MachineProfile, MaterialPreset } from '@/types/domain';

const mat = (over: Record<string, unknown> = {}) => ({
  name: 'Birch 3mm',
  for_layer_kind: 'cut',
  speed_mm_min: 300,
  power_percent: 80,
  passes: 2,
  air_assist: true,
  thickness_mm: 3,
  notes: 'test',
  ...over,
});
const matFile = (presets: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: MATERIALS_FORMAT, version: 1, presets, ...extra });

const mach = (over: Record<string, unknown> = {}) => ({
  name: 'My laser',
  controller: 'grbl1_1',
  bed_width_mm: 300,
  bed_height_mm: 300,
  origin: 'bottom_left',
  max_feed_rate_mm_min: 10000,
  max_spindle_value: 1000,
  homing_supported: false,
  air_assist_supported: true,
  baud_rate: 115200,
  ...over,
});
const machFile = (machine: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: MACHINE_FORMAT, version: 1, machine, ...extra });

let counter = 0;
const newId = () => `id-${++counter}`;

describe('material files: reading', () => {
  it('reads a valid file', () => {
    const r = parseMaterialsFile(matFile([mat(), mat({ name: 'Card', for_layer_kind: 'score', passes: 1 })]));
    expect(r.presets).toHaveLength(2);
    expect(r.rejected).toEqual([]);
    expect(r.legacy).toBe(false);
    expect(r.presets[0]).toEqual(mat());
  });

  it('reads the older file with no "format" field, ignoring its ids', () => {
    const r = parseMaterialsFile(JSON.stringify({ presets: [{ id: 'abc', ...mat() }] }));
    expect(r.legacy).toBe(true);
    expect(r.presets).toHaveLength(1);
    expect(Object.keys(r.presets[0] as object).includes('id')).toBe(false);
  });

  it('copes with a byte-order mark', () => {
    expect(parseMaterialsFile('\uFEFF' + matFile([mat()])).presets).toHaveLength(1);
  });

  it('fills in optional fields', () => {
    const r = parseMaterialsFile(matFile([{ name: 'Min', for_layer_kind: 'fill', speed_mm_min: 3000, power_percent: 40, passes: 1 }]));
    expect(r.presets[0]).toEqual({
      name: 'Min',
      for_layer_kind: 'fill',
      speed_mm_min: 3000,
      power_percent: 40,
      passes: 1,
      air_assist: false,
      thickness_mm: null,
      notes: null,
    });
  });

  it('ignores fields it does not know', () => {
    const r = parseMaterialsFile(matFile([mat({ colour: 'red' })], { future_field: 1 }));
    expect(r.presets).toHaveLength(1);
  });

  it('trims names', () => {
    expect(parseMaterialsFile(matFile([mat({ name: '  Pine  ' })])).presets[0]?.name).toBe('Pine');
  });

  it('refuses text that is not JSON', () => {
    expect(() => parseMaterialsFile('not json')).toThrow(/not valid JSON/);
    expect(() => parseMaterialsFile('')).toThrow(/not valid JSON/);
  });

  it('refuses JSON that is not an object', () => {
    expect(() => parseMaterialsFile('[1,2]')).toThrow(/expected a JSON object/);
    expect(() => parseMaterialsFile('42')).toThrow(/expected a JSON object/);
  });

  it('says so when it is given a machine file', () => {
    expect(() => parseMaterialsFile(machFile(mach()))).toThrow(/machine profile, not a material library/);
  });

  it('refuses an unknown format and a file with no presets list', () => {
    expect(() => parseMaterialsFile(JSON.stringify({ format: 'something.else', version: 1 }))).toThrow(/Unknown file format/);
    expect(() => parseMaterialsFile(JSON.stringify({ hello: 1 }))).toThrow(/not a MakerLaser material library/);
    expect(() => parseMaterialsFile(JSON.stringify({ format: MATERIALS_FORMAT, version: 1 }))).toThrow(/no "presets" list/);
  });

  it('refuses a file from a newer version, and a bad version', () => {
    expect(() => parseMaterialsFile(matFile([mat()], { version: FORMAT_VERSION + 1 }))).toThrow(/newer MakerLaser/);
    expect(() => parseMaterialsFile(matFile([mat()], { version: 0 }))).toThrow(/valid "version"/);
    expect(() => parseMaterialsFile(matFile([mat()], { version: '1' }))).toThrow(/valid "version"/);
    expect(() => parseMaterialsFile(matFile([mat()], { version: 1.5 }))).toThrow(/valid "version"/);
  });

  it('keeps the good presets and reports the bad ones by name', () => {
    const r = parseMaterialsFile(matFile([mat(), mat({ name: 'Too hot', power_percent: 150 }), 'nope', mat({ name: 'Fine 2' })]));
    expect(r.presets.map((p) => p.name)).toEqual(['Birch 3mm', 'Fine 2']);
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected[0]).toContain('"Too hot"');
    expect(r.rejected[0]).toContain('power_percent');
    expect(r.rejected[1]).toContain('entry 3');
  });

  it('allows an empty list', () => {
    const r = parseMaterialsFile(matFile([]));
    expect(r.presets).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it('refuses a huge file', () => {
    expect(() => parseMaterialsFile(matFile(Array.from({ length: 1001 }, () => mat())))).toThrow(/more than 1000/);
  });
});

describe('material entries: validation', () => {
  const problems = (over: Record<string, unknown>) => validateMaterialEntry(mat(over)).problems.join('|');

  it('accepts the edges of the allowed ranges', () => {
    expect(validateMaterialEntry(mat({ power_percent: 100, passes: 100, speed_mm_min: 0.1, thickness_mm: 1000 })).entry).not.toBeNull();
    expect(validateMaterialEntry(mat({ power_percent: 0.1, passes: 1 })).entry).not.toBeNull();
  });

  it('rejects power outside (0, 100]', () => {
    expect(problems({ power_percent: 0 })).toContain('power_percent');
    expect(problems({ power_percent: 100.1 })).toContain('power_percent');
    expect(problems({ power_percent: -5 })).toContain('power_percent');
    expect(problems({ power_percent: '50' })).toContain('power_percent');
    expect(problems({ power_percent: null })).toContain('power_percent');
  });

  it('rejects bad speed', () => {
    expect(problems({ speed_mm_min: 0 })).toContain('speed_mm_min');
    expect(problems({ speed_mm_min: -1 })).toContain('speed_mm_min');
    expect(problems({ speed_mm_min: '300' })).toContain('speed_mm_min');
  });

  it('rejects bad passes', () => {
    expect(problems({ passes: 0 })).toContain('passes');
    expect(problems({ passes: 101 })).toContain('passes');
    expect(problems({ passes: 1.5 })).toContain('passes');
  });

  it('rejects an unknown layer kind, a missing name and an over-long name', () => {
    expect(problems({ for_layer_kind: 'engrave' })).toContain('for_layer_kind');
    expect(problems({ name: '' })).toContain('name is required');
    expect(problems({ name: '   ' })).toContain('name is required');
    expect(problems({ name: 5 })).toContain('name is required');
    expect(problems({ name: 'x'.repeat(101) })).toContain('longer than 100');
  });

  it('rejects bad optional fields', () => {
    expect(problems({ air_assist: 'yes' })).toContain('air_assist');
    expect(problems({ thickness_mm: 0 })).toContain('thickness_mm');
    expect(problems({ thickness_mm: '3' })).toContain('thickness_mm');
    expect(problems({ notes: 5 })).toContain('notes');
    expect(problems({ notes: 'x'.repeat(1001) })).toContain('notes');
  });

  it('reports every problem in one entry', () => {
    const r = validateMaterialEntry(mat({ power_percent: 0, passes: 0 }));
    expect(r.entry).toBeNull();
    expect(r.problems).toHaveLength(2);
  });

  it('rejects things that are not objects', () => {
    expect(validateMaterialEntry(null).entry).toBeNull();
    expect(validateMaterialEntry([]).entry).toBeNull();
  });
});

describe('material files: writing', () => {
  const lib: MaterialPreset[] = [
    { id: 'a', name: 'One', for_layer_kind: 'cut', speed_mm_min: 100, power_percent: 90, passes: 3, air_assist: true, thickness_mm: null, notes: null },
    { id: 'b', name: 'Two', for_layer_kind: 'fill', speed_mm_min: 3000, power_percent: 40, passes: 1, air_assist: false, thickness_mm: 4, notes: 'hi' },
  ];

  it('writes the envelope and leaves ids out', () => {
    const json = JSON.parse(serializeMaterialsFile({ presets: lib })) as Record<string, unknown>;
    expect(json.format).toBe(MATERIALS_FORMAT);
    expect(json.version).toBe(FORMAT_VERSION);
    expect(JSON.stringify(json)).not.toContain('"id"');
    expect(serializeMaterialsFile({ presets: lib }).endsWith('\n')).toBe(true);
  });

  it('round-trips', () => {
    const back = parseMaterialsFile(serializeMaterialsFile({ presets: lib }));
    const withoutIds = (p: MaterialPreset): MaterialEntry => ({
      name: p.name,
      for_layer_kind: p.for_layer_kind,
      speed_mm_min: p.speed_mm_min,
      power_percent: p.power_percent,
      passes: p.passes,
      air_assist: p.air_assist,
      thickness_mm: p.thickness_mm,
      notes: p.notes,
    });
    expect(back.presets).toEqual(lib.map(withoutIds));
    expect(back.rejected).toEqual([]);
    expect(back.legacy).toBe(false);
  });

  it('round-trips an empty library', () => {
    expect(parseMaterialsFile(serializeMaterialsFile({ presets: [] })).presets).toEqual([]);
  });
});

describe('mergeMaterials', () => {
  const e = (over: Partial<MaterialEntry> = {}): MaterialEntry => ({
    name: 'Ply',
    for_layer_kind: 'cut',
    speed_mm_min: 150,
    power_percent: 100,
    passes: 3,
    air_assist: true,
    thickness_mm: null,
    notes: null,
    ...over,
  });

  it('adds new presets with fresh ids', () => {
    const r = mergeMaterials([], [e(), e({ name: 'MDF' })], newId);
    expect(r.added).toHaveLength(2);
    expect(r.added[0]?.id).toMatch(/^id-/);
    expect(r.added[0]?.id).not.toBe(r.added[1]?.id);
    expect(r.skippedIdentical).toBe(0);
    expect(r.renamed).toBe(0);
  });

  it('skips a preset that is already there with the same settings', () => {
    const r = mergeMaterials([e()], [e()], newId);
    expect(r.added).toEqual([]);
    expect(r.skippedIdentical).toBe(1);
  });

  it('keeps both when the name matches but the settings differ', () => {
    const r = mergeMaterials([e()], [e({ power_percent: 60 })], newId);
    expect(r.added.map((p) => p.name)).toEqual(['Ply (2)']);
    expect(r.renamed).toBe(1);
  });

  it('finds the next free number and ignores case', () => {
    const r = mergeMaterials([e(), e({ name: 'ply (2)', power_percent: 10 })], [e({ name: 'PLY', power_percent: 20 })], newId);
    expect(r.added.map((p) => p.name)).toEqual(['PLY (3)']);
  });

  it('handles duplicates inside the incoming file', () => {
    const r = mergeMaterials([], [e(), e(), e({ power_percent: 50 })], newId);
    expect(r.added.map((p) => p.name)).toEqual(['Ply', 'Ply (2)']);
    expect(r.skippedIdentical).toBe(1);
  });

  it('does not change the existing list', () => {
    const existing = [e()];
    mergeMaterials(existing, [e({ power_percent: 1 })], newId);
    expect(existing).toHaveLength(1);
  });

  it('importing an exported library back into itself adds nothing', () => {
    const lib: MaterialPreset[] = [{ id: 'x', ...e() }, { id: 'y', ...e({ name: 'B', notes: 'n' }) }];
    const parsed = parseMaterialsFile(serializeMaterialsFile({ presets: lib }));
    const r = mergeMaterials(lib, parsed.presets, newId);
    expect(r.added).toEqual([]);
    expect(r.skippedIdentical).toBe(2);
  });
});

describe('summarizeMaterialImport', () => {
  const none = { added: [], skippedIdentical: 0, renamed: 0 };
  const some = (n: number, renamed = 0) => ({
    added: Array.from({ length: n }, (_, i) => ({ id: String(i), name: 'n', for_layer_kind: 'cut' as const, speed_mm_min: 1, power_percent: 1, passes: 1, air_assist: false, thickness_mm: null, notes: null })),
    skippedIdentical: 0,
    renamed,
  });
  const parsed = (rejected: string[] = []) => ({ presets: [], rejected, legacy: false });

  it('reports a plain import', () => {
    expect(summarizeMaterialImport(parsed(), some(1))).toEqual({ kind: 'info', text: 'Imported 1 preset.' });
    expect(summarizeMaterialImport(parsed(), some(3, 2)).text).toBe('Imported 3 presets (2 renamed because the name was already used).');
  });

  it('reports identical skips', () => {
    const s = summarizeMaterialImport(parsed(), { added: [], skippedIdentical: 2, renamed: 0 });
    expect(s.text).toBe('Nothing was imported. 2 identical presets were already in your library.');
    expect(s.kind).toBe('info');
  });

  it('reports rejects as a warning and truncates the list', () => {
    const s = summarizeMaterialImport(parsed(['a', 'b', 'c', 'd']), some(1));
    expect(s.kind).toBe('warning');
    expect(s.text).toBe('Imported 1 preset. 4 rejected: a; b; and 2 more.');
  });

  it('reports an empty file', () => {
    expect(summarizeMaterialImport(parsed(), none).text).toBe('The file contains no presets.');
  });
});

describe('machine files', () => {
  it('reads a valid file', () => {
    expect(parseMachineFile(machFile(mach())).machine).toEqual(mach());
  });

  it('fills in controller, homing, air assist and baud rate when they are missing', () => {
    const r = parseMachineFile(
      machFile({ name: 'Bare', bed_width_mm: 400, bed_height_mm: 200, origin: 'top_left', max_feed_rate_mm_min: 8000, max_spindle_value: 255 }),
    );
    expect(r.machine).toEqual({
      name: 'Bare',
      controller: 'grbl1_1',
      bed_width_mm: 400,
      bed_height_mm: 200,
      origin: 'top_left',
      max_feed_rate_mm_min: 8000,
      max_spindle_value: 255,
      homing_supported: false,
      air_assist_supported: false,
      baud_rate: 115200,
    });
  });

  it('needs an explicit origin, because a wrong one mirrors the job', () => {
    const noOrigin: Record<string, unknown> = mach();
    delete noOrigin.origin;
    expect(() => parseMachineFile(machFile(noOrigin))).toThrow(/origin/);
  });

  it('rejects out-of-range and mistyped values and lists all of them', () => {
    const attempt = () => parseMachineFile(machFile(mach({ bed_width_mm: 5, max_spindle_value: 0.5, baud_rate: 100, controller: 'x', max_feed_rate_mm_min: 0 })));
    expect(attempt).toThrow(/bed_width_mm/);
    expect(attempt).toThrow(/max_spindle_value/);
    expect(attempt).toThrow(/baud_rate/);
    expect(attempt).toThrow(/controller/);
    expect(attempt).toThrow(/max_feed_rate_mm_min/);
  });

  it('accepts the edges of the allowed ranges', () => {
    expect(validateMachineEntry(mach({ bed_width_mm: 10, bed_height_mm: 5000, max_spindle_value: 100000, baud_rate: 300, max_feed_rate_mm_min: 1 })).entry).not.toBeNull();
    expect(validateMachineEntry(mach({ bed_width_mm: 5001 })).entry).toBeNull();
    expect(validateMachineEntry(mach({ max_spindle_value: 100001 })).entry).toBeNull();
  });

  it('rejects strings where numbers belong, and a missing machine', () => {
    expect(validateMachineEntry(mach({ bed_width_mm: '300' })).entry).toBeNull();
    expect(() => parseMachineFile(JSON.stringify({ format: MACHINE_FORMAT, version: 1 }))).toThrow(/not valid/);
    expect(() => parseMachineFile(machFile('nope'))).toThrow(/not valid/);
  });

  it('says so when it is given a material file', () => {
    expect(() => parseMachineFile(matFile([mat()]))).toThrow(/material library, not a machine profile/);
  });

  it('refuses a file with no format, a newer version, and bad JSON', () => {
    expect(() => parseMachineFile(JSON.stringify(mach()))).toThrow(/no "format"/);
    expect(() => parseMachineFile(machFile(mach(), { version: 2 }))).toThrow(/newer MakerLaser/);
    expect(() => parseMachineFile('{')).toThrow(/not valid JSON/);
  });

  it('copes with a byte-order mark', () => {
    expect(parseMachineFile('\uFEFF' + machFile(mach())).machine.name).toBe('My laser');
  });

  it('round-trips and leaves the id out', () => {
    const profile: MachineProfile = { id: 'secret-id', ...(mach() as Omit<MachineProfile, 'id'>) };
    const text = serializeMachineFile(profile);
    expect(text).not.toContain('secret-id');
    expect(JSON.parse(text).format).toBe(MACHINE_FORMAT);
    expect(parseMachineFile(text).machine).toEqual(machineToEntry(profile));
  });
});

describe('saved machines', () => {
  const m = (name: string, over: Record<string, unknown> = {}) => validateMachineEntry(mach({ name, ...over })).entry as MachineEntry;

  it('adds a new machine', () => {
    expect(upsertMachine([], m('A'))?.map((x) => x.name)).toEqual(['A']);
  });

  it('replaces the machine with the same name, ignoring case, and keeps its place', () => {
    const list = [m('A'), m('B')];
    const next = upsertMachine(list, m('a', { bed_width_mm: 500 }));
    expect(next?.map((x) => x.name)).toEqual(['a', 'B']);
    expect(next?.[0]?.bed_width_mm).toBe(500);
    expect(list[0]?.name).toBe('A');
  });

  it('refuses to grow past the limit but still lets you replace one', () => {
    const full = Array.from({ length: MAX_SAVED_MACHINES }, (_, i) => m(`M${i}`));
    expect(upsertMachine(full, m('new'))).toBeNull();
    expect(upsertMachine(full, m('m3', { bed_width_mm: 123 }))).toHaveLength(MAX_SAVED_MACHINES);
  });

  it('removes by name, ignoring case', () => {
    expect(removeMachine([m('A'), m('B')], ' b ').map((x) => x.name)).toEqual(['A']);
    expect(removeMachine([m('A')], 'zzz')).toHaveLength(1);
  });

  it('survives a trip through storage', () => {
    const list = [m('A'), m('B', { origin: 'top_right' })];
    expect(parseSavedMachines(serializeSavedMachines(list))).toEqual(list);
  });

  it('drops unreadable or invalid stored data instead of failing', () => {
    expect(parseSavedMachines(null)).toEqual([]);
    expect(parseSavedMachines('')).toEqual([]);
    expect(parseSavedMachines('{{{')).toEqual([]);
    expect(parseSavedMachines('{"a":1}')).toEqual([]);
    const mixed = JSON.stringify([mach({ name: 'Good' }), { name: 'Bad' }, 7, mach({ name: 'good' })]);
    expect(parseSavedMachines(mixed).map((x) => x.name)).toEqual(['good']);
  });
});
