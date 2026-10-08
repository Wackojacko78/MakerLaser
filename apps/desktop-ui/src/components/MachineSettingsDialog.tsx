import { useEffect, useState } from 'react';
import { NumberField } from '@/components/NumberField';
import { JobPlacementFields } from '@/components/JobPlacementFields';
import { MachineConnectionFields } from '@/components/MachineConnectionFields';
import { machineSummary } from '@/lib/selectionInfo';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  MAX_SAVED_MACHINES,
  machineToEntry,
  parseMachineFile,
  removeMachine,
  sameName,
  serializeMachineFile,
  upsertMachine,
  validateMachineEntry,
  type MachineEntry,
} from '@/lib/configFormat';
import { errorMessage } from '@/lib/format';
import { CATALOG_PREFIX, MACHINE_CATALOG, catalogNote, findCatalogEntry } from '@/lib/machineCatalog';
import { loadSavedMachines, storeSavedMachines } from '@/lib/savedMachines';
import { useNoticeStore } from '@/state/noticeStore';
import { api } from '@/lib/tauri';
import { useProjectStore } from '@/state/projectStore';
import type { MachineOrigin, MachineProfile } from '@/types/domain';

const ORIGINS: Array<[MachineOrigin, string]> = [
  ['bottom_left', 'Bottom-left (most GRBL lasers)'],
  ['bottom_right', 'Bottom-right'],
  ['top_left', 'Top-left'],
  ['top_right', 'Top-right'],
];

const MACHINE_FILTER = [{ name: 'MakerLaser machine', extensions: ['json'] }];
const SAVED_PREFIX = 'saved:';

export function MachineSettingsDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const mutate = useProjectStore((s) => s.mutate);
  const [presets, setPresets] = useState<MachineProfile[]>([]);
  const [saved, setSaved] = useState<MachineEntry[]>(() => loadSavedMachines());
  const notify = useNoticeStore((s) => s.show);

  useEffect(() => {
    api.machinePresets().then(setPresets).catch(() => setPresets([]));
  }, []);

  if (!project) return null;
  const m = project.machine;
  const patch = (key: string, fn: (m: MachineProfile) => void) =>
    mutate((p) => {
      // Loading a preset or a file replaces the whole machine, and one with no connection
      // means USB serial: forget the old connection first so a network setting cannot stick.
      if (key === 'preset' || key === 'import') delete p.machine.connection;
      fn(p.machine);
    }, `machine-${key}`);

  /** Keeps `entry` in the "Saved by you" list, replacing a saved preset with the same name. */
  const remember = (entry: MachineEntry): 'new' | 'updated' | 'builtin' | 'full' => {
    if (presets.some((p) => sameName(p.name, entry.name))) return 'builtin';
    const existed = saved.some((s) => sameName(s.name, entry.name));
    const next = upsertMachine(saved, entry);
    if (!next) return 'full';
    setSaved(next);
    storeSavedMachines(next);
    return existed ? 'updated' : 'new';
  };

  const saveCurrent = () => {
    const { entry, problems } = validateMachineEntry(machineToEntry(m));
    if (!entry) {
      notify('error', `Cannot save these settings: ${problems.join('; ')}.`);
      return;
    }
    const result = remember(entry);
    if (result === 'builtin') {
      notify('warning', `"${entry.name}" is the name of a built-in preset. Change the Name first, then save.`);
    } else if (result === 'full') {
      notify('error', `You can keep up to ${MAX_SAVED_MACHINES} saved presets. Delete one first.`);
    } else if (result === 'updated') {
      notify('info', `Updated your saved preset "${entry.name}".`);
    } else {
      notify('info', `Saved "${entry.name}". It is in the preset list under "Saved by you".`);
    }
  };

  const deleteSaved = () => {
    const name = m.name.trim();
    if (!saved.some((s) => sameName(s.name, name))) {
      notify('info', `There is no saved preset called "${name}". Load one from the preset list first, then press Delete.`);
      return;
    }
    const next = removeMachine(saved, name);
    setSaved(next);
    storeSavedMachines(next);
    notify('info', `Deleted the saved preset "${name}". The settings in use are unchanged.`);
  };

  const exportMachine = async () => {
    try {
      const { entry, problems } = validateMachineEntry(machineToEntry(m));
      if (!entry) throw new Error(problems.join('; '));
      const base = entry.name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'machine';
      const path = await save({ defaultPath: `${base}.machine.json`, filters: MACHINE_FILTER });
      if (!path) return;
      await api.writeConfigFile(path, serializeMachineFile(entry));
      notify('info', `Exported "${entry.name}".`);
    } catch (e) {
      notify('error', `Export failed: ${errorMessage(e)}`);
    }
  };

  const importMachine = async () => {
    try {
      const path = await open({ multiple: false, directory: false, filters: MACHINE_FILTER });
      if (typeof path !== 'string') return;
      const { machine } = parseMachineFile(await api.readConfigFile(path));
      patch('import', (mm) => Object.assign(mm, machine, { id: mm.id }));
      const result = remember(machine);
      if (result === 'new') {
        notify('info', `Loaded "${machine.name}" and added it to your saved presets.`);
      } else if (result === 'updated') {
        notify('info', `Loaded "${machine.name}" and updated your saved preset of the same name.`);
      } else if (result === 'builtin') {
        notify('warning', `Loaded "${machine.name}". It was not added to your saved presets because that name belongs to a built-in preset.`);
      } else {
        notify('warning', `Loaded "${machine.name}". Your saved list is full, so it was not added.`);
      }
    } catch (e) {
      notify('error', `Import failed: ${errorMessage(e)}`);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Machine settings" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Machine &amp; view</h2>
        <p className="hint" style={{ margin: '0 0 10px' }}>
          Selected machine: <b>{m.name}</b> ({machineSummary(m)})
        </p>

        <div className="grid wide">
          <label>Preset</label>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value.startsWith(CATALOG_PREFIX)) {
                const entry = findCatalogEntry(e.target.value.slice(CATALOG_PREFIX.length));
                if (!entry) return;
                patch('preset', (mm) => Object.assign(mm, { ...entry.machine, id: mm.id }));
                notify('info', `Machine set to "${entry.machine.name}". ${catalogNote(entry)}`);
                return;
              }
              const preset = e.target.value.startsWith(SAVED_PREFIX)
                ? saved.find((s) => s.name === e.target.value.slice(SAVED_PREFIX.length))
                : presets.find((p) => p.id === e.target.value);
              if (!preset) return;
              patch('preset', (mm) => Object.assign(mm, { ...preset, id: mm.id }));
              notify('info', `Machine set to "${preset.name}": ${machineSummary(preset)}.`);
            }}
          >
            <option value="">Load a machine preset…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            <optgroup label="Catalogue (check bed size and origin)">
              {MACHINE_CATALOG.map((c) => (
                <option key={c.machine.name} value={`${CATALOG_PREFIX}${c.machine.name}`}>{c.machine.name}</option>
              ))}
            </optgroup>
            {saved.length > 0 && (
              <optgroup label="Saved by you">
                {saved.map((s) => (
                  <option key={s.name} value={`${SAVED_PREFIX}${s.name}`}>{s.name}</option>
                ))}
              </optgroup>
            )}
          </select>

          <label>Name</label>
          <input value={m.name} onChange={(e) => patch('name', (mm) => (mm.name = e.target.value))} />

          <label>Bed width (mm)</label>
          <NumberField value={m.bed_width_mm} min={10} max={5000} onCommit={(v) => patch('w', (mm) => (mm.bed_width_mm = v))} />
          <label>Bed height (mm)</label>
          <NumberField value={m.bed_height_mm} min={10} max={5000} onCommit={(v) => patch('h', (mm) => (mm.bed_height_mm = v))} />

          <label>Origin corner</label>
          <select value={m.origin} onChange={(e) => patch('origin', (mm) => (mm.origin = e.target.value as MachineOrigin))}>
            {ORIGINS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          <label>Max feed (mm/min)</label>
          <NumberField value={m.max_feed_rate_mm_min} min={1} onCommit={(v) => patch('feed', (mm) => (mm.max_feed_rate_mm_min = v))} />
          <label>Max S value ($30)</label>
          <NumberField value={m.max_spindle_value} min={1} max={100000} onCommit={(v) => patch('s', (mm) => (mm.max_spindle_value = Math.round(v)))} />
          <label>Baud rate</label>
          <NumberField value={m.baud_rate} min={300} onCommit={(v) => patch('baud', (mm) => (mm.baud_rate = Math.round(v)))} />
          <MachineConnectionFields />

          <label>Air assist fitted</label>
          <input type="checkbox" checked={m.air_assist_supported} onChange={(e) => patch('air', (mm) => (mm.air_assist_supported = e.target.checked))} />
          <label>Saved presets</label>
          <div className="preset-row" style={{ flexWrap: 'wrap' }}>
            <button onClick={saveCurrent} title="Keep these machine settings under the Name above, so they appear in the preset list">Save as preset</button>
            <button onClick={deleteSaved} title="Delete the saved preset that has the Name above">Delete preset</button>
          </div>
          <label>Machine file</label>
          <div className="preset-row" style={{ flexWrap: 'wrap' }}>
            <button onClick={() => void importMachine()} title="Load machine settings from a .json file">Import…</button>
            <button onClick={() => void exportMachine()} title="Save these machine settings to a .json file to share or back up">Export…</button>
          </div>
        </div>

        <p className="hint">
          Check the bed size against your own machine: the “outside the bed” safety check uses these numbers. Max S
          must match GRBL's <code>$30</code>.
        </p>

        <h3>Job placement</h3>
        <JobPlacementFields />
        <h3>View</h3>
        <div className="grid wide">
          <label>Show grid</label>
          <input type="checkbox" checked={project.settings.show_grid} onChange={(e) => mutate((p) => (p.settings.show_grid = e.target.checked))} />
          <label>Show origin</label>
          <input type="checkbox" checked={project.settings.show_origin} onChange={(e) => mutate((p) => (p.settings.show_origin = e.target.checked))} />
          <label>Grid spacing (mm)</label>
          <NumberField value={project.settings.grid_spacing_mm} min={1} max={500} onCommit={(v) => mutate((p) => (p.settings.grid_spacing_mm = v), 'grid')} />
        </div>

        <div className="modal-actions">
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
