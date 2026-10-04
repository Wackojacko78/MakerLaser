import { describe, expect, it } from 'vitest';
import {
  type TestGridOptions,
  MAX_STEPS_PER_AXIS,
  TEST_PREFIX,
  buildTestGrid,
  formatValue,
  ramp,
  removeTestGrid,
  textPaths,
  textWidth,
} from '@/lib/testGrid';

const limits = { bedWidthMm: 300, bedHeightMm: 300, maxFeedMmMin: 10000, maxPowerPercent: 100 };

let counter = 0;
const id = () => `id-${++counter}`;

describe('ramp / formatValue', () => {
  it('includes both ends and is evenly spaced', () => {
    expect(ramp(10, 50, 5)).toEqual([10, 20, 30, 40, 50]);
  });
  it('a single step is just the start value', () => {
    expect(ramp(7, 99, 1)).toEqual([7]);
  });
  it('formats without trailing zeros', () => {
    expect(formatValue(40)).toBe('40');
    expect(formatValue(12.5)).toBe('12.5');
    expect(formatValue(3.0000001)).toBe('3');
  });
});

describe('label font', () => {
  it('draws an 8 with all seven strokes and a 1 with two', () => {
    expect(textPaths('8', 0, 0)).toHaveLength(7);
    expect(textPaths('1', 0, 0)).toHaveLength(2);
  });
  it('draws a decimal point as one short stroke', () => {
    expect(textPaths('.', 0, 0)).toHaveLength(1);
  });
  it('stays inside its measured width and height', () => {
    const text = '3000';
    const xs = textPaths(text, 5, 5).flatMap((p) => p.points.map((pt) => pt.x));
    const ys = textPaths(text, 5, 5).flatMap((p) => p.points.map((pt) => pt.y));
    expect(Math.min(...xs)).toBeCloseTo(5);
    expect(Math.max(...xs)).toBeCloseTo(5 + textWidth(text));
    expect(Math.min(...ys)).toBeCloseTo(5);
    expect(Math.max(...ys)).toBeCloseTo(8);
  });
  it('rejects characters it has no glyph for', () => {
    expect(() => textPaths('A', 0, 0)).toThrow();
  });
});

describe('buildTestGrid (defaults)', () => {
  const g = buildTestGrid({ limits }, id);

  it('makes one layer and one object per square, plus one label layer and object', () => {
    expect(g.layers).toHaveLength(26);
    expect(g.objects).toHaveLength(26);
    expect(g.cells).toHaveLength(25);
  });

  it('every object points at an existing layer, and ids are unique', () => {
    const layerIds = new Set(g.layers.map((l) => l.id));
    expect(layerIds.size).toBe(g.layers.length);
    for (const o of g.objects) expect(layerIds.has(o.layer_id as string)).toBe(true);
    expect(new Set(g.objects.map((o) => o.id)).size).toBe(g.objects.length);
  });

  it('speed rises left to right and power rises top to bottom', () => {
    const at = (row: number, col: number) => g.cells.find((c) => c.row === row && c.col === col)!;
    expect(at(0, 0).speedMmMin).toBe(1000);
    expect(at(0, 4).speedMmMin).toBe(5000);
    expect(at(0, 0).powerPercent).toBe(10);
    expect(at(4, 0).powerPercent).toBe(50);
    expect(at(2, 3).speedMmMin).toBe(4000);
    expect(at(2, 3).powerPercent).toBe(30);
  });

  it("each square's layer carries that square's own settings", () => {
    for (const c of g.cells) {
      const layer = g.layers.find((l) => l.id === c.layerId)!;
      expect(layer.speed_mm_min).toBe(c.speedMmMin);
      expect(layer.power_percent).toBe(c.powerPercent);
      expect(layer.kind).toBe('fill');
      expect(layer.name.startsWith(TEST_PREFIX)).toBe(true);
    }
  });

  it('all layers pass the same rules as the Rust validator', () => {
    for (const l of g.layers) {
      expect(l.power_percent).toBeGreaterThan(0);
      expect(l.power_percent).toBeLessThanOrEqual(100);
      expect(l.speed_mm_min).toBeGreaterThan(0);
      expect(l.speed_mm_min).toBeLessThanOrEqual(10000);
      expect(l.passes).toBeGreaterThanOrEqual(1);
      expect(l.line_spacing_mm).toBeGreaterThanOrEqual(0.01);
    }
  });

  it('z_order is unique and starts at the base, in row-major order', () => {
    const z = g.layers.map((l) => l.z_order);
    expect(z[0]).toBe(100);
    expect(new Set(z).size).toBe(z.length);
    expect([...z].sort((a, b) => a - b)).toEqual(z);
  });

  it('places squares on the pitch and reports the size', () => {
    const first = g.objects[0]!.transform;
    const second = g.objects[1]!.transform;
    const nextRow = g.objects[5]!.transform;
    expect(first.e).toBe(20);
    expect(first.f).toBe(20);
    expect(second.e - first.e).toBe(14);
    expect(nextRow.f - first.f).toBe(14);
    expect(g.widthMm).toBe(66);
    expect(g.heightMm).toBe(66);
  });

  it('squares are closed 10 mm paths', () => {
    const k = g.objects[0]!.kind;
    expect(k.type).toBe('vector');
    if (k.type === 'vector') {
      expect(k.paths).toHaveLength(1);
      expect(k.paths[0]!.closed).toBe(true);
      expect(k.paths[0]!.points).toHaveLength(4);
    }
  });

  it('labels sit above and left of the squares, inside the bed, with no warnings', () => {
    expect(g.bounds.x0).toBeGreaterThan(0);
    expect(g.bounds.y0).toBeGreaterThan(0);
    expect(g.bounds.y0).toBeLessThan(20);
    expect(g.bounds.x0).toBeLessThan(20);
    expect(g.warnings).toEqual([]);
  });

  it('the label layer is a score layer with the label settings', () => {
    const l = g.layers[g.layers.length - 1]!;
    expect(l.name).toBe('TEST labels');
    expect(l.kind).toBe('score');
    expect(l.speed_mm_min).toBe(1000);
    expect(l.power_percent).toBe(20);
  });
});

describe('buildTestGrid (options)', () => {
  it('no labels means no label layer and no label object', () => {
    const g = buildTestGrid({ limits, labels: false }, id);
    expect(g.layers).toHaveLength(25);
    expect(g.objects).toHaveLength(25);
    expect(g.bounds).toEqual({ x0: 20, y0: 20, x1: 86, y1: 86 });
  });

  it('a single step on both axes gives one square', () => {
    const g = buildTestGrid({ limits, speedSteps: 1, powerSteps: 1, labels: false, speedEnd: 2000 }, id);
    expect(g.cells).toHaveLength(1);
    expect(g.cells[0]!.speedMmMin).toBe(1000);
    expect(g.cells[0]!.powerPercent).toBe(10);
  });

  it('cut and score modes use that layer kind', () => {
    expect(buildTestGrid({ limits, kind: 'score', labels: false }, id).layers.every((l) => l.kind === 'score')).toBe(true);
    const cut = buildTestGrid({ limits, kind: 'cut', labels: false }, id);
    expect(cut.layers.every((l) => l.kind === 'cut')).toBe(true);
    expect(cut.warnings.some((w) => w.includes('cut through'))).toBe(true);
  });

  it('keeps one decimal for fine power steps and labels them', () => {
    const g = buildTestGrid({ limits, powerStart: 1, powerEnd: 2.5, powerSteps: 4, speedSteps: 1, speedEnd: 3000 }, id);
    expect(g.cells.map((c) => c.powerPercent)).toEqual([1, 1.5, 2, 2.5]);
    expect(g.layers[1]!.name).toBe('TEST 1000 mm/min 1.5%');
  });

  it('honours base z values and position', () => {
    const g = buildTestGrid({ limits, baseLayerZ: 7, baseObjectZ: 50, x: 30, y: 40, labels: false }, id);
    expect(g.layers[0]!.z_order).toBe(7);
    expect(g.objects[0]!.z_index).toBe(50);
    expect(g.objects[0]!.transform.e).toBe(30);
    expect(g.objects[0]!.transform.f).toBe(40);
  });

  it('warns when the grid does not fit the bed', () => {
    const g = buildTestGrid({ limits: { ...limits, bedWidthMm: 60, bedHeightMm: 60 } }, id);
    expect(g.warnings.some((w) => w.includes('does not fit'))).toBe(true);
  });

  it('warns when the labels would go off the bed', () => {
    const g = buildTestGrid({ limits, x: 2, y: 2 }, id);
    expect(g.warnings.some((w) => w.includes('does not fit'))).toBe(true);
  });
});

describe('buildTestGrid (validation)', () => {
  const bad = (o: Partial<TestGridOptions>) => () => buildTestGrid({ limits, ...o }, id);
  it('rejects zero or over-limit power and speed', () => {
    expect(bad({ powerStart: 0 })).toThrow(/Power start/);
    expect(bad({ powerEnd: 101 })).toThrow(/Power end/);
    expect(bad({ speedStart: 0 })).toThrow(/Speed start/);
    expect(bad({ speedEnd: 20000 })).toThrow(/Speed end/);
  });
  it('rejects bad step counts', () => {
    expect(bad({ speedSteps: 0 })).toThrow(/Speed steps/);
    expect(bad({ powerSteps: MAX_STEPS_PER_AXIS + 1 })).toThrow(/Power steps/);
    expect(bad({ powerSteps: 2.5 })).toThrow(/Power steps/);
  });
  it('rejects NaN and equal start/end with several steps', () => {
    expect(bad({ x: Number.NaN })).toThrow(/numbers/);
    expect(bad({ speedStart: 2000, speedEnd: 2000 })).toThrow(/equal/);
  });
  it('rejects silly sizes', () => {
    expect(bad({ cellMm: 1 })).toThrow(/Square size/);
    expect(bad({ gapMm: -1 })).toThrow(/Gap/);
  });
});

describe('removeTestGrid', () => {
  it('removes only the generated layers and their objects', () => {
    const g = buildTestGrid({ limits }, id);
    const keepLayer = { id: 'keep', name: 'Cut' };
    const layers = [keepLayer, ...g.layers];
    const keepObj = { layer_id: 'keep', name: 'mine' };
    const loose = { layer_id: null, name: 'loose' };
    const objects = [keepObj, loose, ...g.objects];
    const out = removeTestGrid(layers, objects);
    expect(out.layers).toEqual([keepLayer]);
    expect(out.objects).toEqual([keepObj, loose]);
    expect(out.removedLayers).toBe(26);
    expect(out.removedObjects).toBe(26);
  });
  it('does nothing when there is no test grid', () => {
    const out = removeTestGrid([{ id: 'a', name: 'Cut' }], [{ layer_id: 'a' }]);
    expect(out.removedLayers).toBe(0);
    expect(out.removedObjects).toBe(0);
  });
});
