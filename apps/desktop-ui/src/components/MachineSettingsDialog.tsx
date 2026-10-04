import { useEffect, useState } from 'react';
import { NumberField } from '@/components/NumberField';
import { api } from '@/lib/tauri';
import { useProjectStore } from '@/state/projectStore';
import type { MachineOrigin, MachineProfile } from '@/types/domain';

const ORIGINS: Array<[MachineOrigin, string]> = [
  ['bottom_left', 'Bottom-left (most GRBL lasers)'],
  ['bottom_right', 'Bottom-right'],
  ['top_left', 'Top-left'],
  ['top_right', 'Top-right'],
];

export function MachineSettingsDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const mutate = useProjectStore((s) => s.mutate);
  const [presets, setPresets] = useState<MachineProfile[]>([]);

  useEffect(() => {
    api.machinePresets().then(setPresets).catch(() => setPresets([]));
  }, []);

  if (!project) return null;
  const m = project.machine;
  const patch = (key: string, fn: (m: MachineProfile) => void) =>
    mutate((p) => fn(p.machine), `machine-${key}`);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Machine settings" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Machine &amp; view</h2>

        <div className="grid wide">
          <label>Preset</label>
          <select
            value=""
            onChange={(e) => {
              const preset = presets.find((p) => p.id === e.target.value);
              if (preset) patch('preset', (mm) => Object.assign(mm, { ...preset, id: mm.id }));
            }}
          >
            <option value="">Load a machine preset…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
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

          <label>Air assist fitted</label>
          <input type="checkbox" checked={m.air_assist_supported} onChange={(e) => patch('air', (mm) => (mm.air_assist_supported = e.target.checked))} />
        </div>

        <p className="hint">
          Check the bed size against your own machine: the “outside the bed” safety check uses these numbers. Max S
          must match GRBL's <code>$30</code>.
        </p>

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
