import { useEffect, useMemo, useRef, useState } from 'react';
import { FloatingWindow, WindowField, WindowGroup, WindowSlider, WindowTick, fullWidth, hintStyle, twoColumns } from '@/components/FloatingWindow';
import { NumberField } from '@/components/NumberField';
import { MAX_SMOOTHING, pathsToSvgData, traceGray, traceStats, type TraceOptions } from '@/lib/bitmapTrace';
import { selectionKey } from '@/lib/selectionKeys';
import { failure } from '@/lib/shapeOps';
import { loadPicture, type LoadedPicture } from '@/lib/traceImage';
import {
  DEFAULT_TRACE_SETTINGS,
  MAX_PREVIEW_POINTS,
  MAX_SIMPLIFY_MM,
  MAX_SPECKS_MM2,
  PICTURE_AFTER_LABELS,
  chosenTraceLayer,
  pictureAfterTrace,
  planTrace,
  traceLayerChoices,
  traceObject,
  traceOptionsFor,
  traceProblem,
  traceScale,
  traceSummary,
  validateTraceSettings,
  type PictureAfter,
  type TraceSettings,
} from '@/lib/traceObject';
import { imageSizeMm } from '@/lib/transform';
import { useProjectStore } from '@/state/projectStore';
import { useTraceStore } from '@/state/traceStore';
import type { Path2D } from '@/types/domain';

/** What the window says after an action: green when it worked, red when it did not. It belongs to the selection it was about. */
type Say = { ok: boolean; text: string; key: string } | null;

/**
 * Trace: turns the selected picture into outlines (vector paths) you can cut, score or engrave as a
 * fill, and combine or offset with Shape tools. It is a window you bring up from the toolbar
 * ("Trace...") and it stays up, whatever is selected, until you close it. A preview shows the
 * outlines over the picture and follows every setting as you change it; "Make outlines" adds them as
 * one new object, placed exactly over the picture, in one undo step.
 *
 * It is mounted once, in App.tsx, and draws nothing while it is closed, so its settings are kept. The
 * tracing is in lib/bitmapTrace.ts, the planning in lib/traceObject.ts and the picture decoding in
 * lib/traceImage.ts. It runs in the window, not in Rust, so it needs no new command.
 */
export function TracePanel() {
  const open = useTraceStore((s) => s.open);
  const setOpen = useTraceStore((s) => s.setOpen);
  const project = useProjectStore((s) => s.project);
  const selected = useProjectStore((s) => s.selected);
  const mutate = useProjectStore((s) => s.mutate);
  const setSelection = useProjectStore((s) => s.setSelection);
  const [settings, setSettings] = useState<TraceSettings>({ ...DEFAULT_TRACE_SETTINGS });
  const [layerPick, setLayerPick] = useState<string | null>(null);
  const [after, setAfter] = useState<PictureAfter>('hide');
  const [loaded, setLoaded] = useState<{ assetId: string; picture: LoadedPicture } | null>(null);
  const [loadFailed, setLoadFailed] = useState<{ assetId: string; text: string } | null>(null);
  const [traced, setTraced] = useState<{ key: string; paths: Path2D[] } | null>(null);
  const [say, setSay] = useState<Say>(null);

  const plan = open && project ? planTrace(project.objects, selected) : null;
  const assetId = plan && plan.ok ? plan.picture.asset_id : null;

  // Decode the picture when one is selected (and the window is open).
  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    loadPicture(assetId)
      .then((picture) => {
        if (!cancelled) setLoaded({ assetId, picture });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadFailed({ assetId, text: failure(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  const picture = loaded && loaded.assetId === assetId ? loaded.picture : null;
  const failedText = loadFailed && loadFailed.assetId === assetId ? loadFailed.text : null;
  const natural = plan && plan.ok ? imageSizeMm(plan.picture) : null;
  const scale = picture && plan && plan.ok && natural ? traceScale(natural, plan.object.transform, picture.width, picture.height) : null;
  const problems = validateTraceSettings(settings);
  const options: TraceOptions | null = scale && picture && problems.length === 0 ? traceOptionsFor(settings, scale, picture.scale) : null;
  const traceKey = picture && options ? JSON.stringify([assetId, picture.width, picture.height, options]) : null;

  // Trace again a moment after the last change, so dragging a slider stays smooth.
  const latest = useRef<{ picture: LoadedPicture | null; options: TraceOptions | null }>({ picture: null, options: null });
  useEffect(() => {
    latest.current = { picture, options };
  });
  useEffect(() => {
    if (!open || traceKey === null) return;
    const timer = setTimeout(() => {
      const { picture: p, options: o } = latest.current;
      if (p && o) setTraced({ key: traceKey, paths: traceGray(p.gray, p.width, p.height, o) });
    }, 120);
    return () => clearTimeout(timer);
  }, [open, traceKey]);

  const fresh = traced && traceKey !== null && traced.key === traceKey ? traced : null;
  const stats = fresh ? traceStats(fresh.paths) : null;
  const tooMuchToDraw = stats !== null && stats.points > MAX_PREVIEW_POINTS;
  const previewPath = useMemo(() => (fresh && !tooMuchToDraw ? pathsToSvgData(fresh.paths) : ''), [fresh, tooMuchToDraw]);

  // Every hook is above this line: the window can be closed without losing its settings.
  if (!open || !project) return null;

  const choices = traceLayerChoices(project.layers);
  const layerId = chosenTraceLayer(choices, layerPick);
  const tell = (ok: boolean, text: string) => setSay({ ok, text, key: selectionKey(useProjectStore.getState().selected) });
  const shown = say && say.key === selectionKey(selected) ? say : null;
  const set = <K extends keyof TraceSettings>(key: K, value: TraceSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));
  const limitProblem = fresh ? traceProblem(fresh.paths) : null;
  const canMake = !!(plan && plan.ok && picture && scale && fresh && fresh.paths.length > 0 && !limitProblem && layerId);

  const make = () => {
    if (!plan || !plan.ok || !picture || !scale || !natural) return;
    const first = validateTraceSettings(settings)[0];
    if (first) {
      tell(false, first);
      return;
    }
    if (!layerId) {
      tell(false, 'There is no layer for the outlines. Add a Cut, Score or Fill layer first.');
      return;
    }
    const paths = fresh ? fresh.paths : traceGray(picture.gray, picture.width, picture.height, traceOptionsFor(settings, scale, picture.scale));
    if (paths.length === 0) {
      tell(false, traceSummary(paths, scale));
      return;
    }
    const tooMuch = traceProblem(paths);
    if (tooMuch) {
      tell(false, tooMuch);
      return;
    }
    const made = traceObject(
      paths,
      { name: `${plan.object.name} (trace)`, layerId, zIndex: useProjectStore.getState().nextZIndex(), transform: plan.object.transform },
      natural,
      picture.width,
      picture.height,
    );
    if (!made) {
      tell(false, 'Nothing was made.');
      return;
    }
    const picId = plan.object.id;
    const what = pictureAfterTrace(after, plan.object.locked);
    mutate((p) => {
      if (what === 'delete') {
        p.objects = p.objects.filter((o) => o.id !== picId);
      } else if (what === 'hide') {
        const target = p.objects.find((o) => o.id === picId);
        if (target) target.visible = false;
      }
      p.objects.push(made);
    });
    setSelection([made.id]);
    const layerName = choices.find((c) => c.id === layerId)?.name ?? 'the layer';
    const note =
      what === 'hide'
        ? ' The picture is hidden: show it again with the eye beside it in the Objects list.'
        : what === 'delete'
          ? ' The picture was deleted.'
          : what === 'left'
            ? ' The picture is locked, so it was left as it is.'
            : ' The picture is still there, under the outlines.';
    tell(true, `Made ${paths.length} ${paths.length === 1 ? 'outline' : 'outlines'} on the layer "${layerName}".${note}`);
  };

  const status = plan && plan.ok ? plan.object.name : 'no picture selected';

  return (
    <FloatingWindow title="Trace picture" status={status} onClose={() => setOpen(false)} rightExtra={344}>
      <WindowGroup title="Preview" first>
        {plan && !plan.ok && (
          <p className="hint" style={hintStyle}>
            {plan.message}
          </p>
        )}
        {plan && plan.ok && failedText && (
          <p className="hint" style={{ ...hintStyle, color: 'var(--danger, #ff6b6b)' }}>
            {failedText}
          </p>
        )}
        {plan && plan.ok && !failedText && !picture && (
          <p className="hint" style={hintStyle}>
            Reading the picture…
          </p>
        )}
        {picture && (
          <>
            <svg
              role="img"
              aria-label="Preview of the outlines over the picture"
              viewBox={`0 0 ${picture.width} ${picture.height}`}
              preserveAspectRatio="xMidYMid meet"
              style={{ display: 'block', width: '100%', maxHeight: 220, aspectRatio: `${picture.width} / ${picture.height}`, background: '#070d12', borderRadius: 6, opacity: fresh ? 1 : 0.6 }}
            >
              <image href={picture.thumbUrl} x={0} y={0} width={picture.width} height={picture.height} preserveAspectRatio="none" opacity={0.4} />
              <path d={previewPath} fill="rgba(54, 216, 237, 0.2)" fillRule="evenodd" stroke="#36d8ed" strokeWidth={1.3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
            <p className="hint" role="status" style={hintStyle}>
              {problems[0] ?? (fresh && scale ? (tooMuchToDraw ? `${traceSummary(fresh.paths, scale)} Too much detail to draw: raise Ignore specks or Simplify.` : traceSummary(fresh.paths, scale)) : 'Tracing…')}
            </p>
          </>
        )}
      </WindowGroup>

      <WindowGroup title="Settings">
        <WindowSlider
          label="Threshold"
          title="Greys darker than this are traced. Raise it to trace more of the picture, lower it to trace less."
          value={settings.threshold}
          min={0}
          max={255}
          onChange={(v) => set('threshold', v)}
        />
        <WindowTick checked={settings.invert} onChange={(v) => set('invert', v)} title="Trace the light parts of the picture instead of the dark parts (for a light logo on a dark background)">
          Invert (trace the light parts)
        </WindowTick>
        <WindowSlider
          label="Smoothing"
          title="Blurs the picture a little before it is traced, which rounds corners and takes the steps out of a small or low-resolution picture. It is measured in the picture's own pixels, so a smaller picture is smoothed more. 0 is none."
          value={settings.smoothing}
          min={0}
          max={MAX_SMOOTHING}
          onChange={(v) => set('smoothing', v)}
        />
        <div style={twoColumns}>
          <WindowField label="Ignore specks (mm²)" title="Outlines that enclose less than this area are left out, and so are holes that small. 0 keeps everything.">
            <NumberField value={settings.ignoreSpecksMm2} min={0} max={MAX_SPECKS_MM2} title="Outlines smaller than this area are left out" onCommit={(v) => set('ignoreSpecksMm2', v)} />
          </WindowField>
          <WindowField label="Simplify (mm)" title="Takes points off the outlines while keeping them within this distance of the traced line. 0 keeps every point.">
            <NumberField value={settings.simplifyMm} min={0} max={MAX_SIMPLIFY_MM} title="How far the simplified outline may stray" onCommit={(v) => set('simplifyMm', v)} />
          </WindowField>
        </div>
      </WindowGroup>

      <WindowGroup title="Make outlines">
        <WindowField label="Put the outlines on layer" title="Outlines are cut or scored, or engraved as a fill, on the layer you choose. A Score layer marks without cutting through.">
          <select value={layerId ?? ''} onChange={(e) => setLayerPick(e.target.value)} style={fullWidth} disabled={choices.length === 0}>
            {choices.length === 0 && <option value="">(no layer)</option>}
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </WindowField>
        <WindowField label="Afterwards" title="What to do with the picture once its outlines are made. A hidden picture does not run and can be shown again from the Objects list.">
          <select value={after} onChange={(e) => setAfter(e.target.value as PictureAfter)} style={fullWidth}>
            {(Object.keys(PICTURE_AFTER_LABELS) as PictureAfter[]).map((k) => (
              <option key={k} value={k}>
                {PICTURE_AFTER_LABELS[k]}
              </option>
            ))}
          </select>
        </WindowField>
        {limitProblem && (
          <p className="hint" style={{ ...hintStyle, color: 'var(--danger, #ff6b6b)' }}>
            {limitProblem}
          </p>
        )}
        <button className="primary" disabled={!canMake} style={fullWidth} onClick={make}>
          Make outlines
        </button>
        {shown && (
          <p className="hint" role="status" style={{ ...hintStyle, marginTop: 2, color: shown.ok ? 'var(--ok)' : 'var(--danger, #ff6b6b)' }}>
            {shown.text}
          </p>
        )}
      </WindowGroup>
    </FloatingWindow>
  );
}
