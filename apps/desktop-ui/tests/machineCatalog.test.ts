import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMachineFile, parseMaterialsFile, serializeMachineFile, sameName, validateMachineEntry } from '@/lib/configFormat';
import { CATALOG_PREFIX, MACHINE_CATALOG, catalogNote, findCatalogEntry } from '@/lib/machineCatalog';

describe('machine catalogue', () => {
  it('has machines', () => {
    expect(MACHINE_CATALOG.length).toBeGreaterThan(10);
  });

  it('every entry is a valid machine profile, exactly as an imported file would be checked', () => {
    for (const c of MACHINE_CATALOG) {
      const r = validateMachineEntry(c.machine);
      expect(r.problems).toEqual([]);
      expect(r.entry).toEqual(c.machine);
    }
  });

  it('every entry survives a trip through a machine file', () => {
    for (const c of MACHINE_CATALOG) {
      expect(parseMachineFile(serializeMachineFile(c.machine)).machine).toEqual(c.machine);
    }
  });

  it('names are unique, ignoring case, and never look like a saved or catalogue prefix', () => {
    const names = MACHINE_CATALOG.map((c) => c.machine.name);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) expect(sameName(names[i] as string, names[j] as string)).toBe(false);
    }
    for (const n of names) {
      expect(n.startsWith(CATALOG_PREFIX)).toBe(false);
      expect(n.startsWith('saved:')).toBe(false);
    }
  });

  it('none shares a name with the three built-in machine presets', () => {
    for (const builtin of ['Two Trees TTS-55 Pro', 'Two Trees TTS-55 Pro (extended)', 'Generic GRBL laser']) {
      expect(MACHINE_CATALOG.some((c) => sameName(c.machine.name, builtin))).toBe(false);
    }
  });

  it('every entry names a web source and says whether its bed size is from the maker', () => {
    for (const c of MACHINE_CATALOG) {
      expect(c.source).toMatch(/^https:\/\//);
      expect(typeof c.official).toBe('boolean');
    }
  });

  it('is GRBL 1.1 with the usual S value and baud rate, and only claims homing it has a source for', () => {
    for (const c of MACHINE_CATALOG) {
      expect(c.machine.controller).toBe('grbl1_1');
      expect(c.machine.max_spindle_value).toBe(1000);
      expect(c.machine.baud_rate).toBe(115200);
    }
    const homing = MACHINE_CATALOG.filter((c) => c.machine.homing_supported).map((c) => c.machine.name).sort();
    expect(homing).toEqual(['ACMER P1 10W', 'ACMER P1 S Pro 10W', 'Comgrow COMGO Z1 10W']);
  });

  it('a speed that is only a default is marked, explained in the notes, and flagged in the message', () => {
    const defaults = MACHINE_CATALOG.filter((c) => c.feedBasis === 'default');
    expect(defaults.map((c) => c.machine.name).sort()).toEqual(['ACMER P1 10W', 'Atomstack X20 Pro 20W']);
    for (const c of defaults) {
      expect(c.machine.max_feed_rate_mm_min).toBe(6000);
      expect(c.notes).toMatch(/No top speed/);
      expect(catalogNote(c)).toMatch(/low default/);
    }
    for (const c of MACHINE_CATALOG.filter((x) => x.feedBasis === 'published')) expect(catalogNote(c)).not.toMatch(/low default/);
  });

  it('an assumed GRBL controller is flagged in the message the user sees', () => {
    const assumed = MACHINE_CATALOG.filter((c) => c.grbl === 'assumed');
    expect(assumed.length).toBeGreaterThan(0);
    for (const c of assumed) expect(catalogNote(c)).toMatch(/assumed/);
    for (const c of MACHINE_CATALOG.filter((x) => x.grbl === 'listed')) expect(catalogNote(c)).not.toMatch(/assumed/);
  });

  it('the message always asks for the bed and origin check', () => {
    for (const c of MACHINE_CATALOG) {
      expect(catalogNote(c)).toMatch(/jog test/);
      expect(catalogNote(c)).toContain(`${c.machine.bed_width_mm} x ${c.machine.bed_height_mm}`);
    }
  });

  it('finds an entry by name', () => {
    expect(findCatalogEntry('Ortur Laser Master 3 20W')?.machine.bed_height_mm).toBe(380);
    expect(findCatalogEntry('nope')).toBeUndefined();
  });

  it('where sources gave a smaller bed for a larger-wattage module, the smaller is used (Ortur)', () => {
    const ten = findCatalogEntry('Ortur Laser Master 3 10W');
    const twenty = findCatalogEntry('Ortur Laser Master 3 20W');
    expect(ten?.machine.bed_height_mm).toBe(400);
    expect(twenty?.machine.bed_height_mm).toBe(380);
  });
});

describe('starter material presets file', () => {
  const text = readFileSync(new URL('../../../docs/catalog/makerlaser-materials-starter.json', import.meta.url), 'utf8');
  const parsed = parseMaterialsFile(text);

  it('is read by the real importer with nothing rejected', () => {
    expect(parsed.rejected).toEqual([]);
    expect(parsed.legacy).toBe(false);
    expect(parsed.presets.length).toBeGreaterThan(20);
  });

  it('has unique names', () => {
    const names = parsed.presets.map((p) => p.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('names the laser power each preset was published for and a source in every note', () => {
    for (const p of parsed.presets) {
      expect(p.name).toMatch(/\((22 W Falcon2|20 W Atomstack)\)$/);
      expect(p.notes ?? '').toMatch(/https?:|\.com/);
      expect(p.notes ?? '').toMatch(/Test on scrap/);
    }
  });

  it('only cut and fill layers, one pass unless the source gave more', () => {
    for (const p of parsed.presets) expect(['cut', 'fill']).toContain(p.for_layer_kind);
    const multi = parsed.presets.filter((p) => p.passes > 1).map((p) => p.name);
    expect(multi).toEqual(['Black acrylic 7.6 mm - Cut (22 W Falcon2)']);
  });

  it('leaves out materials whose fumes or identity the sources do not make clear', () => {
    const all = parsed.presets.map((p) => p.name.toLowerCase()).join('|');
    for (const banned of ['pvc', 'vinyl', 'abs', 'polycarbonate', 'galvanized', 'iron', 'resin', 'plastic', 'foam', 'rubber']) {
      expect(all).not.toContain(banned);
    }
  });

  it('every leather preset says vegetable-tanned only', () => {
    const leather = parsed.presets.filter((p) => p.name.toLowerCase().includes('leather'));
    expect(leather.length).toBeGreaterThan(1);
    for (const p of leather) expect(p.notes ?? '').toMatch(/never laser chrome-tanned/);
  });

  it('every acrylic preset says dark or opaque only', () => {
    const acrylic = parsed.presets.filter((p) => p.name.toLowerCase().includes('acrylic'));
    expect(acrylic.length).toBeGreaterThan(1);
    for (const p of acrylic) expect(p.notes ?? '').toMatch(/opaque/);
  });
});
