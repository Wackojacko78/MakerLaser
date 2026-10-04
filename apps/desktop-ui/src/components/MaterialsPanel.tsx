import { open, save } from '@tauri-apps/plugin-dialog';
import { NumberField } from '@/components/NumberField';
import { errorMessage } from '@/lib/format';
import { api } from '@/lib/tauri';
import { useNoticeStore } from '@/state/noticeStore';
import { useProjectStore } from '@/state/projectStore';
import type { MaterialPreset } from '@/types/domain';

const JSON_FILTER = [{ name: 'Material library', extensions: ['json'] }];

export function MaterialsPanel() {
  const project = useProjectStore((s) => s.project);
  const mutate = useProjectStore((s) => s.mutate);
  const notify = useNoticeStore((s) => s.show);
  if (!project) return null;

  const importLibrary = async () => {
    try {
      const path = await open({ multiple: false, directory: false, filters: JSON_FILTER });
      if (typeof path !== 'string') return;
      const library = await api.importMaterials(path);
      mutate((p) => {
        // Imported presets are added; ids are regenerated so nothing collides.
        for (const preset of library.presets) p.materials.presets.push({ ...preset, id: crypto.randomUUID() });
      });
      notify('info', `Imported ${library.presets.length} presets.`);
    } catch (e) {
      notify('error', `Import failed: ${errorMessage(e)}`);
    }
  };

  const exportLibrary = async () => {
    try {
      const path = await save({ defaultPath: 'materials.json', filters: JSON_FILTER });
      if (!path) return;
      await api.exportMaterials(path, project.materials);
      notify('info', 'Material library exported.');
    } catch (e) {
      notify('error', `Export failed: ${errorMessage(e)}`);
    }
  };

  const patch = (id: string, key: string, fn: (p: MaterialPreset) => void) =>
    mutate((p) => {
      const preset = p.materials.presets.find((x) => x.id === id);
      if (preset) fn(preset);
    }, `material-${id}-${key}`);

  return (
    <section className="panel">
      <details>
        <summary>
          <h3 className="inline">Material library ({project.materials.presets.length})</h3>
        </summary>
        <p className="hint">Presets are starting points. Always test on scrap first.</p>
        <ul className="materials">
          {project.materials.presets.map((m) => (
            <li key={m.id}>
              <input
                className="name"
                value={m.name}
                onChange={(e) => patch(m.id, 'name', (p) => (p.name = e.target.value))}
              />
              <span className="kind">{m.for_layer_kind}</span>
              <NumberField value={m.speed_mm_min} min={1} onCommit={(v) => patch(m.id, 'speed', (p) => (p.speed_mm_min = v))} title="Speed (mm/min)" />
              <NumberField value={m.power_percent} min={0.1} max={100} onCommit={(v) => patch(m.id, 'power', (p) => (p.power_percent = v))} title="Power (%)" />
              <NumberField value={m.passes} min={1} max={100} onCommit={(v) => patch(m.id, 'passes', (p) => (p.passes = Math.round(v)))} title="Passes" />
              <button
                className="mini"
                title="Delete preset"
                onClick={() =>
                  mutate((p) => {
                    p.materials.presets = p.materials.presets.filter((x) => x.id !== m.id);
                  })
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="preset-row">
          <button onClick={() => void importLibrary()}>Import…</button>
          <button onClick={() => void exportLibrary()}>Export…</button>
        </div>
      </details>
    </section>
  );
}
