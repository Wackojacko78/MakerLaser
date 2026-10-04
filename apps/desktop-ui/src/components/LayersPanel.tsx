import { useEffect, useState } from 'react';
import { NumberField } from '@/components/NumberField';
import { errorMessage } from '@/lib/format';
import { api } from '@/lib/tauri';
import { useProjectStore } from '@/state/projectStore';
import type { DitherAlgorithm, Layer, RasterOperation } from '@/types/domain';

const DITHERS: Array<[DitherAlgorithm, string]> = [
  ['floyd_steinberg', 'Floyd-Steinberg'],
  ['jarvis', 'Jarvis'],
  ['stucki', 'Stucki'],
  ['atkinson', 'Atkinson'],
  ['none', 'Threshold (no dither)'],
];

/** A live dithered preview of the first image on the layer, using the layer's settings. */
function RasterPreview({ assetId, params }: { assetId: string; params: RasterOperation }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(params);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .rasterPreview(assetId, JSON.parse(key) as RasterOperation, 360)
        .then((u) => {
          if (!cancelled) {
            setUrl(u);
            setError(null);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(errorMessage(e));
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [assetId, key]);

  if (error) return <p className="hint">Preview unavailable: {error}</p>;
  if (!url) return <p className="hint">Rendering preview…</p>;
  return <img className="raster-preview" src={url} alt="Dithered engraving preview" />;
}

function LayerCard({ layer }: { layer: Layer }) {
  const project = useProjectStore((s) => s.project);
  const mutate = useProjectStore((s) => s.mutate);
  const selected = useProjectStore((s) => s.selected);
  const [presetName, setPresetName] = useState('');

  if (!project) return null;

  const patch = (key: string, fn: (l: Layer) => void) =>
    mutate((p) => {
      const l = p.layers.find((x) => x.id === layer.id);
      if (l) fn(l);
    }, `layer-${layer.id}-${key}`);
  const patchRaster = (key: keyof RasterOperation, value: RasterOperation[keyof RasterOperation]) =>
    patch(`raster-${key}`, (l) => {
      (l.raster as unknown as Record<string, unknown>)[key] = value;
    });

  const objects = project.objects.filter((o) => o.layer_id === layer.id);
  const presets = project.materials.presets.filter((p) => p.for_layer_kind === layer.kind);
  const firstImage = objects.find((o) => o.kind.type === 'image');
  const assign = () =>
    mutate((p) => {
      for (const o of p.objects) if (selected.includes(o.id)) o.layer_id = layer.id;
    });

  return (
    <details className="layer" open={layer.enabled}>
      <summary>
        <input
          type="checkbox"
          checked={layer.enabled}
          title="Enable or disable this layer"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => patch('enabled', (l) => (l.enabled = e.target.checked))}
        />
        <i style={{ background: layer.color }} />
        <b>{layer.name}</b>
        <span className="count">{objects.length}</span>
        <button
          className="mini"
          disabled={selected.length === 0}
          title="Move the selected artwork to this layer"
          onClick={(e) => {
            e.preventDefault();
            assign();
          }}
        >
          Assign
        </button>
      </summary>

      <div className="grid">
        <label>Speed</label>
        <NumberField value={layer.speed_mm_min} min={1} onCommit={(v) => patch('speed', (l) => (l.speed_mm_min = v))} />
        <span className="unit">mm/min</span>
        <label>Power</label>
        <NumberField value={layer.power_percent} min={0.1} max={100} onCommit={(v) => patch('power', (l) => (l.power_percent = v))} />
        <span className="unit">%</span>
        <label>Passes</label>
        <NumberField value={layer.passes} min={1} max={100} onCommit={(v) => patch('passes', (l) => (l.passes = Math.round(v)))} />
        <span className="unit" />
        <label>Air assist</label>
        <input type="checkbox" checked={layer.air_assist} disabled={!project.machine.air_assist_supported} onChange={(e) => patch('air', (l) => (l.air_assist = e.target.checked))} />
        <span className="unit">{project.machine.air_assist_supported ? '' : 'not on this machine'}</span>

        {layer.kind === 'cut' && (
          <>
            <label>Kerf</label>
            <NumberField value={layer.kerf_mm} min={0} max={2} onCommit={(v) => patch('kerf', (l) => (l.kerf_mm = v))} />
            <span className="unit">mm (0 = off)</span>
          </>
        )}

        {layer.kind === 'fill' && (
          <>
            <label>Spacing</label>
            <NumberField value={layer.line_spacing_mm} min={0.01} onCommit={(v) => patch('spacing', (l) => (l.line_spacing_mm = v))} />
            <span className="unit">mm</span>
            <label>Angle</label>
            <NumberField value={layer.fill_angle_deg} onCommit={(v) => patch('angle', (l) => (l.fill_angle_deg = v))} />
            <span className="unit">°</span>
            <label>Cross-hatch</label>
            <input type="checkbox" checked={layer.cross_hatch} onChange={(e) => patch('hatch', (l) => (l.cross_hatch = e.target.checked))} />
            <span className="unit" />
          </>
        )}

        {layer.kind === 'image' && (
          <>
            <label>Resolution</label>
            <NumberField value={layer.raster.dpi} min={25} max={2540} onCommit={(v) => patchRaster('dpi', Math.round(v))} />
            <span className="unit">DPI</span>
            <label>Dither</label>
            <select value={layer.raster.dither} onChange={(e) => patchRaster('dither', e.target.value as DitherAlgorithm)}>
              {DITHERS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <span className="unit" />
            <label>Scan</label>
            <select value={layer.raster.direction} onChange={(e) => patchRaster('direction', e.target.value as RasterOperation['direction'])}>
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Vertical</option>
            </select>
            <span className="unit" />
            <label>Bidirectional</label>
            <input type="checkbox" checked={layer.raster.bidirectional} onChange={(e) => patchRaster('bidirectional', e.target.checked)} />
            <span className="unit" />
            <label>Brightness</label>
            <NumberField value={layer.raster.brightness} min={-100} max={100} onCommit={(v) => patchRaster('brightness', v)} />
            <span className="unit" />
            <label>Contrast</label>
            <NumberField value={layer.raster.contrast} min={-100} max={100} onCommit={(v) => patchRaster('contrast', v)} />
            <span className="unit" />
            <label>Gamma</label>
            <NumberField value={layer.raster.gamma} min={0.1} max={5} onCommit={(v) => patchRaster('gamma', v)} />
            <span className="unit" />
            <label>Invert</label>
            <input type="checkbox" checked={layer.raster.invert} onChange={(e) => patchRaster('invert', e.target.checked)} />
            <span className="unit" />
          </>
        )}
      </div>

      {layer.kind === 'image' && firstImage && firstImage.kind.type === 'image' && (
        <RasterPreview assetId={firstImage.kind.asset_id} params={layer.raster} />
      )}

      <div className="preset-row">
        <select
          value=""
          onChange={(e) => {
            const preset = presets.find((p) => p.id === e.target.value);
            if (!preset) return;
            mutate((p) => {
              const l = p.layers.find((x) => x.id === layer.id);
              if (!l) return;
              l.speed_mm_min = preset.speed_mm_min;
              l.power_percent = preset.power_percent;
              l.passes = preset.passes;
              l.air_assist = preset.air_assist && p.machine.air_assist_supported;
            });
          }}
        >
          <option value="">Apply material preset…</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="preset-row">
        <input
          placeholder="Save these settings as a preset…"
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
        />
        <button
          disabled={presetName.trim() === ''}
          onClick={() => {
            const name = presetName.trim();
            mutate((p) => {
              const l = p.layers.find((x) => x.id === layer.id);
              if (!l) return;
              p.materials.presets.push({
                id: crypto.randomUUID(),
                name,
                for_layer_kind: l.kind,
                speed_mm_min: l.speed_mm_min,
                power_percent: l.power_percent,
                passes: l.passes,
                air_assist: l.air_assist,
                thickness_mm: null,
                notes: null,
              });
            });
            setPresetName('');
          }}
        >
          Save
        </button>
      </div>
    </details>
  );
}

export function LayersPanel() {
  const project = useProjectStore((s) => s.project);
  if (!project) return null;
  return (
    <section className="panel">
      <h3>Layers</h3>
      {project.layers.map((l) => (
        <LayerCard key={l.id} layer={l} />
      ))}
    </section>
  );
}
