// Planning for the Trace window: which picture is traced, how millimetres become picture pixels, which
// layer the outlines go on, and how the result becomes an object that sits exactly over the picture.
// Pure TypeScript (no React, Konva, canvas or Tauri imports), so it is unit-tested in plain Node
// (tests/traceObject.test.ts). The tracing itself is in lib/bitmapTrace.ts.
import { validateTraceOptions, type TraceOptions } from '@/lib/bitmapTrace';
import type { ImageObjectData, Layer, LayerKind, Path2D, Transform2D, WorkspaceObject } from '@/types/domain';

/** The most outlines and points one trace may make (a photograph traced at full detail would make far more). */
export const MAX_TRACE_PATHS = 50_000;
export const MAX_TRACE_POINTS = 300_000;
/** The preview is only drawn up to this many points. */
export const MAX_PREVIEW_POINTS = 120_000;
export const MAX_SIMPLIFY_MM = 10;
export const MAX_SPECKS_MM2 = 100_000;

// ---- which picture ----------------------------------------------------------------------------

export type TracePlan =
  | { ok: false; message: string }
  | {
      ok: true;
      /** The picture object. */
      object: WorkspaceObject;
      /** What the picture is made of (size, asset). */
      picture: ImageObjectData;
    };

/** The one picture in the selection. Other selected objects are ignored. */
export function planTrace(objects: readonly WorkspaceObject[], ids: readonly string[]): TracePlan {
  const wanted = new Set(ids);
  const pictures: Array<{ object: WorkspaceObject; picture: ImageObjectData }> = [];
  for (const o of objects) {
    if (wanted.has(o.id) && o.kind.type === 'image') pictures.push({ object: o, picture: o.kind });
  }
  const only = pictures[0];
  if (!only) return { ok: false, message: 'Select a picture (JPG, PNG or BMP) to trace it.' };
  if (pictures.length > 1) return { ok: false, message: `Select just one picture to trace: ${pictures.length} are selected.` };
  return { ok: true, object: only.object, picture: only.picture };
}

// ---- which layer ------------------------------------------------------------------------------

export interface LayerChoice {
  id: string;
  name: string;
  kind: LayerKind;
}

/** The layers outlines can go on (a picture layer cannot hold them), in the order of the Layers list. */
export function traceLayerChoices(layers: readonly Layer[]): LayerChoice[] {
  return layers
    .map((l, index) => ({ l, index }))
    .filter(({ l }) => l.kind !== 'image')
    .sort((a, b) => a.l.z_order - b.l.z_order || a.index - b.index)
    .map(({ l }) => ({ id: l.id, name: l.name, kind: l.kind }));
}

/** The layer to use: the one picked while it still exists, otherwise a Score layer (it marks without cutting through), then Cut, then Fill. */
export function chosenTraceLayer(choices: readonly LayerChoice[], picked: string | null): string | null {
  if (picked && choices.some((c) => c.id === picked)) return picked;
  for (const kind of ['score', 'cut', 'fill'] as const) {
    const found = choices.find((c) => c.kind === kind);
    if (found) return found.id;
  }
  return choices[0]?.id ?? null;
}

// ---- millimetres and pixels -------------------------------------------------------------------

export interface TraceScale {
  /** Millimetres on the bed for one pixel of the traced picture, across and down. */
  mmPerPxX: number;
  mmPerPxY: number;
  /** The same for both ways together (the geometric mean). Zero when it cannot be worked out. */
  mmPerPx: number;
}

/**
 * How big a pixel of the traced picture is on the bed: the picture's natural size in mm, divided by
 * the pixels it was traced at, times how much the picture is scaled on the bed.
 */
export function traceScale(natural: readonly [number, number], transform: Transform2D, width: number, height: number): TraceScale {
  const sx = Math.hypot(transform.a, transform.b);
  const sy = Math.hypot(transform.c, transform.d);
  const x = width > 0 ? (natural[0] / width) * sx : 0;
  const y = height > 0 ? (natural[1] / height) * sy : 0;
  const mean = Math.sqrt(x * y);
  const ok = Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0 && Number.isFinite(mean);
  return ok ? { mmPerPxX: x, mmPerPxY: y, mmPerPx: mean } : { mmPerPxX: 0, mmPerPxY: 0, mmPerPx: 0 };
}

/** The settings as the user sees them: sizes in millimetres on the bed. */
export interface TraceSettings {
  threshold: number;
  invert: boolean;
  smoothing: number;
  /** Outlines enclosing less than this many square millimetres are dropped. */
  ignoreSpecksMm2: number;
  /** Outlines are simplified to within this many millimetres. */
  simplifyMm: number;
}

export const DEFAULT_TRACE_SETTINGS: Readonly<TraceSettings> = {
  threshold: 128,
  invert: false,
  smoothing: 3,
  ignoreSpecksMm2: 0.2,
  simplifyMm: 0.05,
};

/** Problems with the settings (empty when valid). */
export function validateTraceSettings(s: TraceSettings): string[] {
  const problems = validateTraceOptions({ threshold: s.threshold, invert: s.invert, smoothing: s.smoothing, minAreaPx: 0, tolerancePx: 0 });
  if (!Number.isFinite(s.ignoreSpecksMm2) || s.ignoreSpecksMm2 < 0 || s.ignoreSpecksMm2 > MAX_SPECKS_MM2) {
    problems.push(`Ignore specks must be from 0 to ${MAX_SPECKS_MM2} mm\u00b2.`);
  }
  if (!Number.isFinite(s.simplifyMm) || s.simplifyMm < 0 || s.simplifyMm > MAX_SIMPLIFY_MM) problems.push(`Simplify must be from 0 to ${MAX_SIMPLIFY_MM} mm.`);
  return problems;
}

/**
 * The settings in picture pixels, for the tracer. When the size of a pixel is not known the size settings
 * are left off. `enlarged` is how many times bigger the picture was made before tracing (see
 * TraceOptions.blurScale).
 */
export function traceOptionsFor(s: TraceSettings, scale: TraceScale, enlarged = 1): TraceOptions {
  const known = scale.mmPerPx > 0;
  const finite = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  return {
    threshold: s.threshold,
    invert: s.invert,
    smoothing: s.smoothing,
    blurScale: Number.isFinite(enlarged) && enlarged > 1 ? enlarged : 1,
    minAreaPx: known ? finite(s.ignoreSpecksMm2) / (scale.mmPerPx * scale.mmPerPx) : 0,
    tolerancePx: known ? finite(s.simplifyMm) / scale.mmPerPx : 0,
  };
}

// ---- the result -------------------------------------------------------------------------------

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export interface TraceObjectSpec {
  name: string;
  layerId: string | null;
  zIndex: number;
  /** The picture's own transform: the outlines get the same size, place and turn as the picture. */
  transform: Transform2D;
}

/**
 * A vector object from outlines in picture pixels. The outlines are put in the picture's own
 * millimetres and given the picture's transform, so they lie exactly over it, whatever its size, place
 * or rotation. Null when there is nothing to make.
 */
export function traceObject(
  paths: readonly Path2D[],
  spec: TraceObjectSpec,
  natural: readonly [number, number],
  width: number,
  height: number,
  newId: () => string = () => globalThis.crypto.randomUUID(),
): WorkspaceObject | null {
  if (!(width > 0) || !(height > 0)) return null;
  const kx = natural[0] / width;
  const ky = natural[1] / height;
  const rings = paths.filter((p) => p.points.length >= 3).map((p) => ({ points: p.points.map((q) => ({ x: round3(q.x * kx), y: round3(q.y * ky) })), closed: true }));
  if (rings.length === 0) return null;
  return {
    id: newId(),
    name: spec.name,
    kind: { type: 'vector', paths: rings },
    transform: { ...spec.transform },
    layer_id: spec.layerId,
    visible: true,
    locked: false,
    z_index: spec.zIndex,
  };
}

/** What happens to the picture once it is traced. */
export type PictureAfter = 'hide' | 'keep' | 'delete';
export const PICTURE_AFTER_LABELS: Record<PictureAfter, string> = {
  hide: 'Hide the picture',
  keep: 'Leave the picture as it is',
  delete: 'Delete the picture',
};

/** What is really done to the picture: a locked picture is never touched. */
export function pictureAfterTrace(choice: PictureAfter, locked: boolean): PictureAfter | 'left' {
  return locked && choice !== 'keep' ? 'left' : choice;
}

// ---- messages ---------------------------------------------------------------------------------

const withCommas = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A problem with a result that stops it being made (too much detail), or null. */
export function traceProblem(paths: readonly Path2D[]): string | null {
  let points = 0;
  for (const p of paths) points += p.points.length;
  if (paths.length > MAX_TRACE_PATHS || points > MAX_TRACE_POINTS) {
    return `That is ${withCommas(paths.length)} outlines and ${withCommas(points)} points, more than the limit of ${withCommas(MAX_TRACE_PATHS)} and ${withCommas(MAX_TRACE_POINTS)}. Raise Ignore specks or Simplify, or lower Threshold.`;
  }
  return null;
}

/** "12 outlines, 3,120 points, 85.2 x 60.1 mm." */
export function traceSummary(paths: readonly Path2D[], scale: TraceScale): string {
  if (paths.length === 0) return 'No outlines: nothing is darker than the threshold. Raise Threshold (or turn Invert on or off).';
  let points = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of paths) {
    points += p.points.length;
    for (const q of p.points) {
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
    }
  }
  const outlines = `${withCommas(paths.length)} ${paths.length === 1 ? 'outline' : 'outlines'}, ${withCommas(points)} points`;
  if (scale.mmPerPx <= 0) return `${outlines}.`;
  const one = (v: number) => String(Number(v.toFixed(1)));
  return `${outlines}, ${one((maxX - minX) * scale.mmPerPxX)} \u00d7 ${one((maxY - minY) * scale.mmPerPxY)} mm.`;
}
