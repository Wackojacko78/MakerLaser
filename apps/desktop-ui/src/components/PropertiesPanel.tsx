import { NumberField } from '@/components/NumberField';
import { SelectionStats } from '@/components/SelectionStats';
import { boundsHeight, boundsWidth, unionBounds, worldBounds } from '@/lib/transform';
import { useEditStore } from '@/state/editStore';
import { useProjectStore } from '@/state/projectStore';
import type { Bounds } from '@/lib/transform';

export function PropertiesPanel() {
  const project = useProjectStore((s) => s.project);
  const selected = useProjectStore((s) => s.selected);
  const mutate = useProjectStore((s) => s.mutate);
  const select = useProjectStore((s) => s.select);
  const nudge = useProjectStore((s) => s.nudgeSelected);
  const resize = useProjectStore((s) => s.scaleSelectedAbout);
  const rotate = useProjectStore((s) => s.rotateSelected);
  const openEdit = useEditStore((s) => s.open);

  if (!project) return null;

  const chosen = project.objects.filter((o) => selected.includes(o.id));
  // One text or shape object selected: it can be opened and edited again.
  const only = chosen.length === 1 ? chosen[0] : undefined;
  const editSource = only && only.kind.type === 'vector' ? only.kind.source : undefined;
  let box: Bounds | null = null;
  for (const o of chosen) box = unionBounds(box, worldBounds(o));
  const sharedLayer = chosen.length > 0 && chosen.every((o) => o.layer_id === chosen[0].layer_id) ? chosen[0].layer_id : undefined;

  const assignLayer = (layerId: string | null) =>
    mutate((p) => {
      for (const o of p.objects) if (selected.includes(o.id)) o.layer_id = layerId;
    });

  const setFlag = (key: 'locked' | 'visible', value: boolean) =>
    mutate((p) => {
      for (const o of p.objects) if (selected.includes(o.id)) o[key] = value;
    });

  return (
    <section className="panel">
      <h3>Selection</h3>
      {chosen.length === 0 || !box ? (
        <p className="hint">Select artwork to edit its position, size and layer.</p>
      ) : (
        <div className="props">
          <div className="field-row">
            <label>X</label>
            <NumberField value={box.minX} onCommit={(v) => nudge(v - box!.minX, 0)} />
            <label>Y</label>
            <NumberField value={box.minY} onCommit={(v) => nudge(0, v - box!.minY)} />
          </div>
          <div className="field-row">
            <label>W</label>
            <NumberField
              value={boundsWidth(box)}
              min={0.1}
              onCommit={(v) => boundsWidth(box!) > 1e-9 && resize(v / boundsWidth(box!), 1)}
            />
            <label>H</label>
            <NumberField
              value={boundsHeight(box)}
              min={0.1}
              onCommit={(v) => boundsHeight(box!) > 1e-9 && resize(1, v / boundsHeight(box!))}
            />
          </div>
          <SelectionStats objects={chosen} units={project.settings.units} />
          {only && editSource && (
            <div className="field-row wide">
              <button
                disabled={only.locked}
                onClick={() => openEdit(only.id)}
                title={only.locked ? 'Unlock it to edit it' : 'Change the text or the shape settings (or double-click it)'}
              >
                {editSource.type === 'text' ? 'Edit text…' : 'Edit shape…'}
              </button>
            </div>
          )}
          <div className="field-row wide">
            <button onClick={() => rotate(-90)} title="Rotate 90° anticlockwise">⟲ 90°</button>
            <button onClick={() => rotate(90)} title="Rotate 90° clockwise">⟳ 90°</button>
          </div>
          <div className="field-row wide">
            <label>Layer</label>
            <select
              value={sharedLayer ?? ''}
              onChange={(e) => assignLayer(e.target.value === '' ? null : e.target.value)}
            >
              {sharedLayer === undefined && <option value="">(mixed)</option>}
              <option value="">(none: will not run)</option>
              {project.layers.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="field-row wide">
            <label className="check">
              <input type="checkbox" checked={chosen.every((o) => o.locked)} onChange={(e) => setFlag('locked', e.target.checked)} />
              Locked
            </label>
          </div>
        </div>
      )}

      <h3>Objects</h3>
      <ul className="objects">
        {[...project.objects]
          .sort((a, b) => b.z_index - a.z_index)
          .map((o) => {
            const layer = project.layers.find((l) => l.id === o.layer_id);
            return (
              <li
                key={o.id}
                className={selected.includes(o.id) ? 'selected' : ''}
                onClick={(e) => select(o.id, e.shiftKey)}
              >
                <i style={{ background: layer?.color ?? '#6b7885' }} title={layer ? layer.name : 'No layer: will not run'} />
                <span className="name">{o.name}</span>
                <button
                  className="mini"
                  title={o.visible ? 'Hide' : 'Show'}
                  onClick={(e) => {
                    e.stopPropagation();
                    mutate((p) => {
                      const t = p.objects.find((x) => x.id === o.id);
                      if (t) t.visible = !t.visible;
                    });
                  }}
                >
                  {o.visible ? '👁' : '—'}
                </button>
                <button
                  className="mini"
                  title={o.locked ? 'Unlock' : 'Lock'}
                  onClick={(e) => {
                    e.stopPropagation();
                    mutate((p) => {
                      const t = p.objects.find((x) => x.id === o.id);
                      if (t) t.locked = !t.locked;
                    });
                  }}
                >
                  {o.locked ? '🔒' : '🔓'}
                </button>
              </li>
            );
          })}
        {project.objects.length === 0 && <li className="hint">Drop an SVG, DXF or image anywhere on the window.</li>}
      </ul>
    </section>
  );
}
