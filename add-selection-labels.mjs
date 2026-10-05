// Makes the current selections visible:
//   * the open project's MACHINE NAME is shown in a button on the toolbar, in the Machine
//     window ("Selected machine: ...") and in the pre-flight window before a job;
//     choosing a machine preset now pops up a confirmation;
//   * each layer's MATERIAL PRESET box now shows the preset that layer is using (it changes
//     to "Custom settings" the moment you edit a value), with a line underneath saying so and
//     a confirmation when you apply one.
// Run from C:\Dev\MakerLaser:   node add-selection-labels.mjs
// Safe: checks every required edit point first and writes nothing unless ALL of them match.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const ui = path.join(root, 'apps', 'desktop-ui');
const comp = (name) => path.join(ui, 'src', 'components', name);

const NEW_FILES = {
 "src/lib/selectionInfo.ts": "// Small pure helpers behind the \"which machine / which material preset is selected?\" labels.\n// No React, Konva or Tauri imports, so they are unit-tested in plain Node\n// (tests/selectionInfo.test.ts).\n\nimport type { Layer, MachineOrigin, MachineProfile, MaterialPreset } from '@/types/domain';\n\nconst NEAR = 1e-9;\nconst near = (a: number, b: number) => Math.abs(a - b) <= NEAR;\n\n/** The air-assist setting a preset really gives a layer: it cannot be on if the machine has none. */\nexport function effectiveAirAssist(preset: Pick<MaterialPreset, 'air_assist'>, machineHasAirAssist: boolean): boolean {\n  return preset.air_assist && machineHasAirAssist;\n}\n\n/** True when the layer currently has exactly the settings this preset would give it. */\nexport function presetMatchesLayer(\n  preset: Pick<MaterialPreset, 'for_layer_kind' | 'speed_mm_min' | 'power_percent' | 'passes' | 'air_assist'>,\n  layer: Pick<Layer, 'kind' | 'speed_mm_min' | 'power_percent' | 'passes' | 'air_assist'>,\n  machineHasAirAssist: boolean,\n): boolean {\n  return (\n    preset.for_layer_kind === layer.kind &&\n    near(preset.speed_mm_min, layer.speed_mm_min) &&\n    near(preset.power_percent, layer.power_percent) &&\n    preset.passes === layer.passes &&\n    effectiveAirAssist(preset, machineHasAirAssist) === layer.air_assist\n  );\n}\n\n/** The first preset whose settings the layer currently has, if any. */\nexport function findMatchingPreset<P extends Pick<MaterialPreset, 'for_layer_kind' | 'speed_mm_min' | 'power_percent' | 'passes' | 'air_assist'>>(\n  layer: Pick<Layer, 'kind' | 'speed_mm_min' | 'power_percent' | 'passes' | 'air_assist'>,\n  presets: readonly P[],\n  machineHasAirAssist: boolean,\n): P | undefined {\n  return presets.find((p) => presetMatchesLayer(p, layer, machineHasAirAssist));\n}\n\n/** \"bottom_left\" becomes \"bottom-left\". */\nexport function originLabel(origin: MachineOrigin): string {\n  return origin.replace('_', '-');\n}\n\nconst trimNumber = (v: number) => String(Number(v.toFixed(1)));\n\n/** \"300 x 300 mm, origin bottom-left\" (with a proper multiplication sign). */\nexport function machineSummary(m: Pick<MachineProfile, 'bed_width_mm' | 'bed_height_mm' | 'origin'>): string {\n  return `${trimNumber(m.bed_width_mm)} \\u00d7 ${trimNumber(m.bed_height_mm)} mm, origin ${originLabel(m.origin)}`;\n}\n\n/** The confirmation shown right after a material preset is applied to a layer. */\nexport function presetAppliedMessage(\n  preset: Pick<MaterialPreset, 'name' | 'speed_mm_min' | 'power_percent' | 'passes' | 'air_assist'>,\n  layerName: string,\n  machineHasAirAssist: boolean,\n): string {\n  const air = effectiveAirAssist(preset, machineHasAirAssist);\n  const note = preset.air_assist && !machineHasAirAssist ? ' (air assist left off: this machine has none)' : '';\n  return (\n    `Applied \"${preset.name}\" to layer \"${layerName}\": ${trimNumber(preset.speed_mm_min)} mm/min, ` +\n    `${trimNumber(preset.power_percent)}% power, ${preset.passes} ${preset.passes === 1 ? 'pass' : 'passes'}` +\n    `${air ? ', air assist on' : ''}${note}.`\n  );\n}\n",
 "tests/selectionInfo.test.ts": "import { describe, expect, it } from 'vitest';\nimport {\n  effectiveAirAssist,\n  findMatchingPreset,\n  machineSummary,\n  originLabel,\n  presetAppliedMessage,\n  presetMatchesLayer,\n} from '@/lib/selectionInfo';\n\nconst preset = (over: Record<string, unknown> = {}) => ({\n  name: 'Ply 3mm',\n  for_layer_kind: 'cut' as const,\n  speed_mm_min: 150,\n  power_percent: 100,\n  passes: 3,\n  air_assist: true,\n  ...over,\n});\nconst layer = (over: Record<string, unknown> = {}) => ({\n  kind: 'cut' as const,\n  speed_mm_min: 150,\n  power_percent: 100,\n  passes: 3,\n  air_assist: true,\n  ...over,\n});\n\ndescribe('presetMatchesLayer', () => {\n  it('matches a layer with exactly the preset settings', () => {\n    expect(presetMatchesLayer(preset(), layer(), true)).toBe(true);\n  });\n\n  it('stops matching as soon as any one setting is edited', () => {\n    expect(presetMatchesLayer(preset(), layer({ speed_mm_min: 151 }), true)).toBe(false);\n    expect(presetMatchesLayer(preset(), layer({ power_percent: 99.9 }), true)).toBe(false);\n    expect(presetMatchesLayer(preset(), layer({ passes: 2 }), true)).toBe(false);\n    expect(presetMatchesLayer(preset(), layer({ air_assist: false }), true)).toBe(false);\n  });\n\n  it('never matches a layer of a different kind', () => {\n    expect(presetMatchesLayer(preset(), layer({ kind: 'score' }), true)).toBe(false);\n    expect(presetMatchesLayer(preset({ for_layer_kind: 'fill' }), layer(), true)).toBe(false);\n  });\n\n  it('treats air assist as off when the machine has none, matching how a preset is applied', () => {\n    expect(effectiveAirAssist({ air_assist: true }, false)).toBe(false);\n    expect(effectiveAirAssist({ air_assist: true }, true)).toBe(true);\n    expect(effectiveAirAssist({ air_assist: false }, true)).toBe(false);\n    // a preset with air assist, applied on a machine without it, leaves the layer's air assist off\n    expect(presetMatchesLayer(preset(), layer({ air_assist: false }), false)).toBe(true);\n    expect(presetMatchesLayer(preset(), layer({ air_assist: true }), false)).toBe(false);\n  });\n\n  it('tolerates floating point noise but nothing larger', () => {\n    expect(presetMatchesLayer(preset({ power_percent: 0.1 + 0.2 }), layer({ power_percent: 0.3 }), true)).toBe(true);\n    expect(presetMatchesLayer(preset({ power_percent: 0.3 }), layer({ power_percent: 0.31 }), true)).toBe(false);\n  });\n});\n\ndescribe('findMatchingPreset', () => {\n  const list = [\n    preset({ name: 'A', speed_mm_min: 100 }),\n    preset({ name: 'B' }),\n    preset({ name: 'C' }),\n    preset({ name: 'D', for_layer_kind: 'score' as const }),\n  ];\n\n  it('returns the first matching preset', () => {\n    expect(findMatchingPreset(layer(), list, true)?.name).toBe('B');\n  });\n\n  it('returns undefined for custom settings, an empty list, and another kind', () => {\n    expect(findMatchingPreset(layer({ speed_mm_min: 5 }), list, true)).toBe(undefined);\n    expect(findMatchingPreset(layer(), [], true)).toBe(undefined);\n    expect(findMatchingPreset(layer({ kind: 'image' as const }), list, true)).toBe(undefined);\n  });\n\n  it('follows an edit: custom after a change, and the preset again when it is changed back', () => {\n    const l = layer();\n    expect(findMatchingPreset(l, list, true)?.name).toBe('B');\n    l.power_percent = 80;\n    expect(findMatchingPreset(l, list, true)).toBe(undefined);\n    l.power_percent = 100;\n    expect(findMatchingPreset(l, list, true)?.name).toBe('B');\n  });\n});\n\ndescribe('labels', () => {\n  it('writes origins with a hyphen', () => {\n    expect(originLabel('bottom_left')).toBe('bottom-left');\n    expect(originLabel('top_right')).toBe('top-right');\n  });\n\n  it('summarises a machine', () => {\n    expect(machineSummary({ bed_width_mm: 410, bed_height_mm: 400, origin: 'bottom_left' })).toBe('410 \\u00d7 400 mm, origin bottom-left');\n    expect(machineSummary({ bed_width_mm: 300.04, bed_height_mm: 299.96, origin: 'top_left' })).toBe('300 \\u00d7 300 mm, origin top-left');\n    expect(machineSummary({ bed_width_mm: 412.5, bed_height_mm: 400, origin: 'bottom_right' })).toBe('412.5 \\u00d7 400 mm, origin bottom-right');\n  });\n\n  it('describes an applied preset, with the right singular and plural', () => {\n    expect(presetAppliedMessage(preset(), 'Cut', true)).toBe(\n      'Applied \"Ply 3mm\" to layer \"Cut\": 150 mm/min, 100% power, 3 passes, air assist on.',\n    );\n    expect(presetAppliedMessage(preset({ passes: 1, air_assist: false, power_percent: 12.5 }), 'Score', true)).toBe(\n      'Applied \"Ply 3mm\" to layer \"Score\": 150 mm/min, 12.5% power, 1 pass.',\n    );\n  });\n\n  it('says when air assist was left off because the machine has none', () => {\n    expect(presetAppliedMessage(preset(), 'Cut', false)).toBe(\n      'Applied \"Ply 3mm\" to layer \"Cut\": 150 mm/min, 100% power, 3 passes (air assist left off: this machine has none).',\n    );\n  });\n});\n"
};
const P = {
  layers: comp('LayersPanel.tsx'),
  toolbar: comp('Toolbar.tsx'),
  dialog: comp('MachineSettingsDialog.tsx'),
};
const PREFLIGHT = comp('PreflightDialog.tsx'); // optional

const missing = Object.values(P).filter((f) => !fs.existsSync(f));
if (missing.length > 0) {
  console.log('Run this from the MakerLaser repo root. Not found:');
  for (const f of missing) console.log('  ' + path.relative(root, f).split(path.sep).join('/'));
  console.log('Nothing was changed.');
  process.exit(1);
}
const read = (f) => fs.readFileSync(f, 'utf8');
const src = Object.fromEntries(Object.entries(P).map(([k, f]) => [k, read(f)]));

const targets = Object.keys(NEW_FILES).map((rel) => [rel, path.join(ui, ...rel.split('/'))]);
const existing = targets.filter(([, abs]) => fs.existsSync(abs));
if (existing.length > 0 || src.layers.includes('selectionInfo')) {
  console.log('Already applied (or files exist). Nothing written.');
  process.exit(0);
}

const eolOf = (s) => (s.includes('\r\n') ? '\r\n' : '\n');
const fix = (text, eol) => text.replace(/\r?\n/g, eol);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Matches `find` line by line, ignoring indentation and trailing spaces.
function locate(text, find, label) {
  const lines = find.split(/\r?\n/).map((l) => l.trim());
  const re = new RegExp(lines.map(esc).join('[ \\t]*\\r?\\n[ \\t]*'), 'g');
  const hits = [...text.matchAll(re)];
  if (hits.length === 0) throw new Error('Anchor not found: ' + label);
  if (hits.length > 1) throw new Error('Anchor is not unique: ' + label);
  return hits[0];
}
const splice = (text, hit, replacement) => text.slice(0, hit.index) + replacement + text.slice(hit.index + hit[0].length);
const lines = (arr, eol) => arr.join(eol);

function replaceSpan(text, find, replacementLines, label) {
  const eol = eolOf(text);
  return splice(text, locate(text, find, label), lines(replacementLines, eol));
}
function insertAfter(text, find, newLines, label) {
  const eol = eolOf(text);
  const hit = locate(text, find, label);
  return splice(text, hit, hit[0] + eol + lines(newLines, eol));
}
function insertBefore(text, find, newLines, label) {
  const eol = eolOf(text);
  const hit = locate(text, find, label);
  const lineStart = text.lastIndexOf('\n', hit.index - 1) + 1;
  const indent = text.slice(lineStart, hit.index);
  if (indent.trim() !== '') throw new Error('Anchor does not start a line: ' + label);
  return splice(text, hit, lines(newLines, eol) + eol + indent + hit[0]);
}
function replaceRegex(text, re, replacementLines, label) {
  const hits = [...text.matchAll(new RegExp(re.source, 'g'))];
  if (hits.length === 0) throw new Error('Anchor not found: ' + label);
  if (hits.length > 1) throw new Error('Anchor is not unique: ' + label);
  return splice(text, hits[0], lines(replacementLines, eolOf(text)));
}

const out = {};
const notes = [];

// ---------------- LayersPanel.tsx: which material preset is a layer using? ----------------
{
  let t = src.layers;
  t = insertAfter(t, "import { errorMessage } from '@/lib/format';", ["import { findMatchingPreset, presetAppliedMessage } from '@/lib/selectionInfo';"], 'layers: format import');
  t = insertBefore(t, "import { useProjectStore } from '@/state/projectStore';", ["import { useNoticeStore } from '@/state/noticeStore';"], 'layers: store import');
  t = insertAfter(t, "const [presetName, setPresetName] = useState('');", ['  const notify = useNoticeStore((s) => s.show);'], 'layers: preset name state');
  t = insertAfter(
    t,
    'const presets = project.materials.presets.filter((p) => p.for_layer_kind === layer.kind);',
    [
      '  const airSupported = project.machine.air_assist_supported;',
      "  // The preset whose settings this layer has right now. It changes the moment a value is edited.",
      '  const activePreset = findMatchingPreset(layer, presets, airSupported);',
    ],
    'layers: presets list',
  );
  t = replaceSpan(
    t,
    '<select\nvalue=""\nonChange={(e) => {\nconst preset = presets.find((p) => p.id === e.target.value);\nif (!preset) return;',
    [
      '<select',
      "          value={activePreset?.id ?? ''}",
      '          onChange={(e) => {',
      '            const preset = presets.find((p) => p.id === e.target.value);',
      '            if (!preset) return;',
      "            notify('info', presetAppliedMessage(preset, layer.name, airSupported));",
    ],
    'layers: preset select',
  );
  t = replaceRegex(
    t,
    /<option value="">Apply material preset[^<]*<\/option>/,
    [
      "<option value=\"\">{activePreset ? 'Choose another preset\\u2026' : presets.length > 0 ? 'Custom settings: choose a preset\\u2026' : 'No presets for this layer type'}</option>",
    ],
    'layers: first option',
  );
  t = insertAfter(
    t,
    '))}\n</select>\n</div>',
    [
      "      <p className=\"hint\" style={{ margin: '2px 0 4px', color: activePreset ? 'var(--ok)' : undefined }}>",
      "        {activePreset ? `Preset in use: ${activePreset.name}` : 'Custom settings (no preset applied)'}",
      '      </p>',
    ],
    'layers: after the preset box',
  );
  out[P.layers] = t;
}

// ---------------- Toolbar.tsx: the machine name button ----------------
{
  let t = src.toolbar;
  t = insertAfter(t, "import { useState } from 'react';", ["import { machineSummary } from '@/lib/selectionInfo';"], 'toolbar: react import');
  t = insertAfter(
    t,
    '<span className="spacer" />',
    [
      '      <button',
      '        onClick={() => setSettingsOpen(true)}',
      '        title={`Machine: ${project.machine.name}\\n${machineSummary(project.machine)}\\nClick to change the machine`}',
      "        style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderColor: 'var(--accent)' }}",
      '      >',
      '        Machine: <b>{project.machine.name}</b>',
      '      </button>',
    ],
    'toolbar: spacer',
  );
  out[P.toolbar] = t;
}

// ---------------- MachineSettingsDialog.tsx: confirmation ----------------
{
  let t = src.dialog;
  const hasNotice = t.includes('useNoticeStore');
  t = insertAfter(
    t,
    "import { NumberField } from '@/components/NumberField';",
    hasNotice
      ? ["import { machineSummary } from '@/lib/selectionInfo';"]
      : ["import { machineSummary } from '@/lib/selectionInfo';", "import { useNoticeStore } from '@/state/noticeStore';"],
    'dialog: NumberField import',
  );
  if (!hasNotice) {
    t = insertAfter(t, 'const [presets, setPresets] = useState<MachineProfile[]>([]);', ['  const notify = useNoticeStore((s) => s.show);'], 'dialog: presets state');
  }
  t = replaceSpan(
    t,
    "if (preset) patch('preset', (mm) => Object.assign(mm, { ...preset, id: mm.id }));",
    [
      'if (!preset) return;',
      "              patch('preset', (mm) => Object.assign(mm, { ...preset, id: mm.id }));",
      '              notify(\'info\', `Machine set to "${preset.name}": ${machineSummary(preset)}.`);',
    ],
    'dialog: apply preset',
  );
  t = insertAfter(
    t,
    '<h2>Machine &amp; view</h2>',
    [
      "        <p className=\"hint\" style={{ margin: '0 0 10px' }}>",
      '          Selected machine: <b>{m.name}</b> ({machineSummary(m)})',
      '        </p>',
    ],
    'dialog: heading',
  );
  out[P.dialog] = t;
}

// ---------------- PreflightDialog.tsx: optional ----------------
if (fs.existsSync(PREFLIGHT)) {
  try {
    out[PREFLIGHT] = insertBefore(
      read(PREFLIGHT),
      '<tr><th>Bed</th>',
      ['<tr><th>Machine</th><td>{project.machine.name}</td></tr>'],
      'preflight: Bed row',
    );
  } catch (e) {
    notes.push('Skipped the Machine row in the pre-flight window (' + e.message + '). Everything else was applied.');
  }
} else {
  notes.push('PreflightDialog.tsx not found: skipped the Machine row in the pre-flight window.');
}

// ---------------- all required edits matched: write ----------------
const uiEol = eolOf(src.layers);
for (const [rel, abs] of targets) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, fix(NEW_FILES[rel], uiEol), 'utf8');
  console.log('created ' + path.relative(root, abs).split(path.sep).join('/'));
}
for (const [abs, text] of Object.entries(out)) {
  fs.writeFileSync(abs, text, 'utf8');
  console.log('edited  ' + path.relative(root, abs).split(path.sep).join('/'));
}
for (const n of notes) console.log('note: ' + n);
console.log('');
console.log('Next: npm run ui:typecheck ; npm run ui:test ; npm run dev');
