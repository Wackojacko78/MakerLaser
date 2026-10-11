import { describe, expect, it } from 'vitest';
import { traceGray } from '@/lib/bitmapTrace';
import {
  DEFAULT_TRACE_SETTINGS,
  MAX_TRACE_PATHS,
  MAX_TRACE_POINTS,
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
  type TraceSettings,
} from '@/lib/traceObject';
import { translation, worldBounds } from '@/lib/transform';
import type { Layer, LayerKind, Path2D, Transform2D, WorkspaceObject } from '@/types/domain';

const identity: Transform2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const picture = (id: string, over: Partial<WorkspaceObject> = {}): WorkspaceObject => ({
  id,
  name: id,
  kind: { type: 'image', asset_id: `asset-${id}`, format: 'png', source_path: null, width_px: 200, height_px: 100, dpi: 254 },
  transform: { ...identity },
  layer_id: 'IMG',
  visible: true,
  locked: false,
  z_index: 0,
  ...over,
});

const vector = (id: string): WorkspaceObject => ({
  id,
  name: id,
  kind: { type: 'vector', paths: [] },
  transform: { ...identity },
  layer_id: null,
  visible: true,
  locked: false,
  z_index: 0,
});

const layer = (id: string, kind: LayerKind, z: number, name = id): Layer =>
  ({ id, name, kind, z_order: z }) as unknown as Layer;

const settings = (over: Partial<TraceSettings> = {}): TraceSettings => ({ ...DEFAULT_TRACE_SETTINGS, ...over });
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const ring = (n: number): Path2D => ({ points: Array.from({ length: n }, (_, i) => ({ x: i, y: i % 2 })), closed: true });

describe('planTrace', () => {
  it('finds the one picture in the selection', () => {
    const plan = planTrace([picture('P'), vector('V')], ['P']);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.object.id).toBe('P');
    expect(plan.picture.asset_id).toBe('asset-P');
    expect(plan.picture.width_px).toBe(200);
  });
  it('ignores other selected objects', () => {
    const plan = planTrace([picture('P'), vector('V')], ['V', 'P']);
    expect(plan.ok && plan.object.id).toBe('P');
  });
  it('asks for a picture when there is none', () => {
    for (const ids of [[], ['V']]) {
      const plan = planTrace([picture('P'), vector('V')], ids);
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.message).toContain('Select a picture');
    }
  });
  it('asks for just one when there are several, and says how many', () => {
    const plan = planTrace([picture('A'), picture('B'), picture('C')], ['A', 'B', 'C']);
    expect(plan.ok === false && plan.message).toBe('Select just one picture to trace: 3 are selected.');
  });
  it('traces a picture even when it is hidden or locked', () => {
    expect(planTrace([picture('P', { visible: false, locked: true })], ['P']).ok).toBe(true);
  });
});

describe('layers', () => {
  const layers = [layer('IMG', 'image', 3), layer('CUT', 'cut', 2), layer('SCORE', 'score', 1), layer('FILL', 'fill', 0)];
  it('lists the layers outlines can go on, in the order of the Layers list, and leaves out picture layers', () => {
    expect(traceLayerChoices(layers).map((c) => c.id)).toEqual(['FILL', 'SCORE', 'CUT']);
    expect(traceLayerChoices([layer('IMG', 'image', 0)])).toEqual([]);
  });
  it('starts on a Score layer, then Cut, then Fill', () => {
    expect(chosenTraceLayer(traceLayerChoices(layers), null)).toBe('SCORE');
    expect(chosenTraceLayer(traceLayerChoices(layers.filter((l) => l.kind !== 'score')), null)).toBe('CUT');
    expect(chosenTraceLayer(traceLayerChoices(layers.filter((l) => l.kind === 'fill')), null)).toBe('FILL');
    expect(chosenTraceLayer([], null)).toBeNull();
  });
  it('keeps the layer you pick while it exists', () => {
    const choices = traceLayerChoices(layers);
    expect(chosenTraceLayer(choices, 'CUT')).toBe('CUT');
    expect(chosenTraceLayer(choices, 'GONE')).toBe('SCORE');
    expect(chosenTraceLayer(choices, 'IMG')).toBe('SCORE');
  });
});

describe('traceScale and the settings in pixels', () => {
  it('is the natural size over the pixels, times the scale on the bed', () => {
    // A 50 x 25 mm picture traced at 1000 x 500 pixels: 0.05 mm a pixel.
    expect(traceScale([50, 25], identity, 1000, 500)).toEqual({ mmPerPxX: 0.05, mmPerPxY: 0.05, mmPerPx: 0.05 });
    const half: Transform2D = { a: 0.5, b: 0, c: 0, d: 0.5, e: 10, f: 10 };
    expect(near(traceScale([50, 25], half, 1000, 500).mmPerPx, 0.025, 1e-12)).toBe(true);
  });
  it('allows for a picture that is turned or squashed', () => {
    const turned: Transform2D = { a: 0, b: 2, c: -2, d: 0, e: 0, f: 0 }; // 90 degrees and twice the size
    expect(near(traceScale([50, 25], turned, 1000, 500).mmPerPx, 0.1, 1e-12)).toBe(true);
    const squashed: Transform2D = { a: 2, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const s = traceScale([50, 25], squashed, 1000, 500);
    expect(near(s.mmPerPxX, 0.1, 1e-12) && near(s.mmPerPxY, 0.05, 1e-12)).toBe(true);
    expect(near(s.mmPerPx, Math.sqrt(0.005), 1e-12)).toBe(true);
  });
  it('says it does not know when it cannot work it out', () => {
    expect(traceScale([50, 25], identity, 0, 500).mmPerPx).toBe(0);
    expect(traceScale([50, 25], { ...identity, a: 0, b: 0 }, 1000, 500).mmPerPx).toBe(0);
    expect(traceScale([Number.NaN, 25], identity, 1000, 500).mmPerPx).toBe(0);
  });
  it('turns millimetres into pixels', () => {
    const scale = traceScale([50, 25], identity, 1000, 500); // 0.05 mm a pixel
    const o = traceOptionsFor(settings({ ignoreSpecksMm2: 0.25, simplifyMm: 0.1, threshold: 90, invert: true, smoothing: 4 }), scale);
    expect(near(o.minAreaPx, 100, 1e-9)).toBe(true);
    expect(near(o.tolerancePx, 2, 1e-9)).toBe(true);
    expect(o).toMatchObject({ threshold: 90, invert: true, smoothing: 4 });
  });
  it('passes on how much the picture was enlarged, as the blur scale', () => {
    const scale = traceScale([50, 25], identity, 1000, 500);
    expect(traceOptionsFor(settings(), scale, 12.5).blurScale).toBe(12.5);
    for (const v of [1, 0.4, 0, -2, Number.NaN, Infinity]) expect(traceOptionsFor(settings(), scale, v).blurScale).toBe(1);
    expect(traceOptionsFor(settings(), scale).blurScale).toBe(1);
  });
  it('leaves the size settings off when the size of a pixel is not known, or they are zero or not numbers', () => {
    const unknown = traceOptionsFor(settings(), { mmPerPxX: 0, mmPerPxY: 0, mmPerPx: 0 });
    expect(unknown.minAreaPx).toBe(0);
    expect(unknown.tolerancePx).toBe(0);
    const scale = traceScale([50, 25], identity, 1000, 500);
    const off = traceOptionsFor(settings({ ignoreSpecksMm2: 0, simplifyMm: Number.NaN }), scale);
    expect(off.minAreaPx).toBe(0);
    expect(off.tolerancePx).toBe(0);
  });
  it('checks the settings', () => {
    expect(validateTraceSettings(settings())).toEqual([]);
    expect(validateTraceSettings(settings({ threshold: 300 }))[0]).toContain('threshold');
    expect(validateTraceSettings(settings({ smoothing: 11 }))[0]).toContain('Smoothing');
    expect(validateTraceSettings(settings({ ignoreSpecksMm2: -1 }))[0]).toContain('Ignore specks');
    expect(validateTraceSettings(settings({ simplifyMm: 11 }))[0]).toContain('Simplify');
    expect(validateTraceSettings(settings({ simplifyMm: Number.NaN }))).toHaveLength(1);
    expect(validateTraceSettings(settings({ threshold: -1, smoothing: -1, simplifyMm: -1 }))).toHaveLength(3);
  });
});

describe('traceObject', () => {
  const spec = (over: Partial<{ transform: Transform2D; layerId: string | null }> = {}) => ({
    name: 'P (trace)',
    layerId: 'SCORE' as string | null,
    zIndex: 7,
    transform: identity,
    ...over,
  });
  it('puts the outlines in the picture\'s millimetres with the picture\'s transform', () => {
    const t: Transform2D = { a: 0.5, b: 0, c: 0, d: 0.5, e: 12, f: 8 };
    const o = traceObject([{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }], closed: true }], spec({ transform: t }), [50, 25], 100, 50, () => 'new');
    expect(o).not.toBeNull();
    if (!o || o.kind.type !== 'vector') throw new Error('no object');
    expect(o.id).toBe('new');
    expect(o.name).toBe('P (trace)');
    expect(o.layer_id).toBe('SCORE');
    expect(o.z_index).toBe(7);
    expect(o.visible).toBe(true);
    expect(o.locked).toBe(false);
    expect(o.transform).toEqual(t);
    expect(o.transform).not.toBe(t);
    expect(o.kind.source).toBeUndefined();
    expect(o.kind.paths[0]?.points[1]).toEqual({ x: 50, y: 0 });
    expect(o.kind.paths[0]?.points[2]).toEqual({ x: 50, y: 25 });
    expect(o.kind.paths.every((p) => p.closed)).toBe(true);
  });
  it('lies exactly over the picture when the whole picture is traced', () => {
    const pic = picture('P', { transform: { a: 0.6, b: 0, c: 0, d: 0.6, e: 15, f: 20 } });
    // A picture that is all ink traces to its own outline.
    const w = 200;
    const h = 100;
    const paths = traceGray(new Uint8Array(w * h), w, h, { threshold: 128, invert: false, smoothing: 0, minAreaPx: 0, tolerancePx: 0 });
    expect(paths).toHaveLength(1);
    const o = traceObject(paths, spec({ transform: pic.transform }), [20, 10], w, h);
    expect(o).not.toBeNull();
    const a = worldBounds(pic);
    const b = worldBounds(o!);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) expect(near(a![k], b![k], 0.01)).toBe(true);
  });
  it('follows a picture that is moved by a plain translation', () => {
    const pic = picture('P', { transform: translation(33, 44) });
    const o = traceObject([{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: true }], spec({ transform: pic.transform }), [20, 10], 20, 10);
    const b = worldBounds(o!);
    expect(near(b!.minX, 33, 1e-9) && near(b!.minY, 44, 1e-9)).toBe(true);
  });
  it('rounds to a thousandth of a millimetre and drops tiny rings', () => {
    const o = traceObject(
      [
        { points: [{ x: 0.123456, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], closed: true },
        { points: [{ x: 5, y: 5 }, { x: 6, y: 6 }], closed: true },
      ],
      spec(),
      [10, 10],
      10,
      10,
    );
    if (!o || o.kind.type !== 'vector') throw new Error('no object');
    expect(o.kind.paths).toHaveLength(1);
    expect(o.kind.paths[0]?.points[0]?.x).toBe(0.123);
  });
  it('makes nothing from nothing', () => {
    expect(traceObject([], spec(), [10, 10], 10, 10)).toBeNull();
    expect(traceObject([ring(2)], spec(), [10, 10], 10, 10)).toBeNull();
    expect(traceObject([ring(5)], spec(), [10, 10], 0, 10)).toBeNull();
  });
});

describe('what happens to the picture', () => {
  it('does what was asked, except to a locked picture', () => {
    expect(pictureAfterTrace('hide', false)).toBe('hide');
    expect(pictureAfterTrace('delete', false)).toBe('delete');
    expect(pictureAfterTrace('keep', false)).toBe('keep');
    expect(pictureAfterTrace('hide', true)).toBe('left');
    expect(pictureAfterTrace('delete', true)).toBe('left');
    expect(pictureAfterTrace('keep', true)).toBe('keep');
  });
});

describe('limits and messages', () => {
  it('refuses a result with too many outlines or points, and says the numbers', () => {
    expect(traceProblem([ring(10), ring(20)])).toBeNull();
    const many = Array.from({ length: MAX_TRACE_PATHS + 1 }, () => ring(3));
    expect(traceProblem(many)).toContain(`${MAX_TRACE_PATHS + 1}`.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    const heavy = [ring(MAX_TRACE_POINTS), ring(10)];
    expect(traceProblem(heavy)).toContain('Raise Ignore specks');
    expect(traceProblem([ring(MAX_TRACE_POINTS)])).toBeNull();
  });
  it('sums up what was traced, with its size on the bed', () => {
    const paths: Path2D[] = [
      { points: [{ x: 100, y: 50 }, { x: 300, y: 50 }, { x: 300, y: 150 }, { x: 100, y: 150 }], closed: true },
      { points: [{ x: 110, y: 60 }, { x: 120, y: 60 }, { x: 120, y: 70 }], closed: true },
    ];
    const scale = traceScale([50, 25], identity, 1000, 500); // 0.05 mm a pixel
    expect(traceSummary(paths, scale)).toBe('2 outlines, 7 points, 10 \u00d7 5 mm.');
    expect(traceSummary([paths[0]!], scale)).toBe('1 outline, 4 points, 10 \u00d7 5 mm.');
    expect(traceSummary(paths, { mmPerPxX: 0, mmPerPxY: 0, mmPerPx: 0 })).toBe('2 outlines, 7 points.');
  });
  it('says what to do when nothing was traced', () => {
    expect(traceSummary([], traceScale([50, 25], identity, 1000, 500))).toContain('Raise Threshold');
  });
  it('writes thousands with commas', () => {
    const paths = Array.from({ length: 1234 }, () => ring(3));
    expect(traceSummary(paths, { mmPerPxX: 0, mmPerPxY: 0, mmPerPx: 0 })).toBe('1,234 outlines, 3,702 points.');
  });
});
