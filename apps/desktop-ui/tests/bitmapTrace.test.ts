import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_MAX_SIDE,
  ANALYSIS_MAX_UPSCALE,
  ANALYSIS_MIN_SIDE,
  DEFAULT_TRACE_OPTIONS,
  analysisSize,
  contoursOf,
  gaussianBlur,
  grayFromRGBA,
  pathsToSvgData,
  ringArea,
  simplifyRing,
  traceGray,
  traceStats,
  validateTraceOptions,
  type TraceOptions,
} from '@/lib/bitmapTrace';
import type { Path2D, Point2 } from '@/types/domain';

// ---- helpers: tiny pictures with a known answer ----------------------------------------------

const make = (w: number, h: number, value: (x: number, y: number) => number): Uint8Array => {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = value(x, y);
  return out;
};
/** Black inside the circle, white outside, judged at each pixel's middle. */
const disk = (cx: number, cy: number, r: number) => (x: number, y: number) => (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r ? 0 : 255);
/** The same circle with soft edges: each pixel is as dark as the share of it that is inside (4 x 4 samples). */
const softDisk = (cx: number, cy: number, r: number) => (x: number, y: number) => {
  let inside = 0;
  for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (Math.hypot(x + (sx + 0.5) / 4 - cx, y + (sy + 0.5) / 4 - cy) <= r) inside++;
  return Math.round(255 * (1 - inside / 16));
};
const box = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) => (x >= x0 && x < x1 && y >= y0 && y < y1 ? 0 : 255);

const opts = (over: Partial<TraceOptions> = {}): TraceOptions => ({ ...DEFAULT_TRACE_OPTIONS, smoothing: 0, ...over });
/** The area of what was traced: outer outlines add, holes take away (they run the other way round). */
const netArea = (paths: readonly Path2D[]): number => Math.abs(paths.reduce((sum, p) => sum + ringArea(p.points), 0));
const bounds = (p: Path2D) => ({
  minX: Math.min(...p.points.map((q) => q.x)),
  maxX: Math.max(...p.points.map((q) => q.x)),
  minY: Math.min(...p.points.map((q) => q.y)),
  maxY: Math.max(...p.points.map((q) => q.y)),
});
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
/** The middle of mass of one ring. */
const centroid = (points: readonly Point2[]): Point2 => {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
};

describe('analysisSize', () => {
  it('leaves a picture of a good size alone', () => {
    expect(analysisSize(1000, 600)).toEqual({ width: 1000, height: 600, scale: 1 });
    expect(analysisSize(ANALYSIS_MAX_SIDE, 10)).toEqual({ width: ANALYSIS_MAX_SIDE, height: 10, scale: 1 });
  });
  it('enlarges a small picture to the minimum side, keeping its proportions', () => {
    const s = analysisSize(200, 100);
    expect(s.scale).toBe(4);
    expect(s).toEqual({ width: 800, height: 400, scale: 4 });
  });
  it('never enlarges more than the limit', () => {
    const s = analysisSize(10, 10);
    expect(s.scale).toBe(ANALYSIS_MAX_UPSCALE);
    expect(s.width).toBe(160);
  });
  it('shrinks a big picture to the maximum side', () => {
    const s = analysisSize(4000, 2000);
    expect(s).toEqual({ width: ANALYSIS_MAX_SIDE, height: 700, scale: 0.35 });
    expect(ANALYSIS_MIN_SIDE).toBeLessThan(ANALYSIS_MAX_SIDE);
  });
  it('copes with nothing', () => {
    expect(analysisSize(0, 100)).toEqual({ width: 0, height: 0, scale: 1 });
    expect(analysisSize(-5, 5).width).toBe(0);
    expect(analysisSize(Number.NaN, 5).width).toBe(0);
    expect(analysisSize(1, 1).width).toBeGreaterThanOrEqual(1);
  });
});

describe('grayFromRGBA', () => {
  it('weighs the colours like the engraver does', () => {
    const g = grayFromRGBA([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255], 5, 1);
    expect(Array.from(g)).toEqual([76, 150, 29, 255, 0]);
  });
  it('treats a transparent pixel as white, so a transparent background is not traced', () => {
    const g = grayFromRGBA([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 128], 3, 1);
    expect(g[0]).toBe(255);
    expect(g[1]).toBe(0);
    expect(g[2]).toBe(127);
  });
  it('gives a full-size result for a missing alpha channel too', () => {
    expect(grayFromRGBA([10, 10, 10], 1, 1)[0]).toBe(10);
  });
});

describe('gaussianBlur', () => {
  it('with no blur is a plain copy', () => {
    const g = make(5, 5, (x, y) => x * 10 + y);
    expect(Array.from(gaussianBlur(g, 5, 5, 0))).toEqual(Array.from(g));
    expect(Array.from(gaussianBlur(g, 5, 5, 0.01))).toEqual(Array.from(g));
  });
  it('leaves a flat picture flat, edges included', () => {
    const out = gaussianBlur(make(9, 7, () => 200), 9, 7, 2);
    for (const v of out) expect(near(v, 200, 1e-3)).toBe(true);
  });
  it('spreads a dot out without losing any of it', () => {
    const g = make(41, 41, (x, y) => (x === 20 && y === 20 ? 255 : 0));
    const out = gaussianBlur(g, 41, 41, 2);
    let sum = 0;
    for (const v of out) sum += v;
    expect(near(sum, 255, 0.5)).toBe(true);
    expect(out[20 * 41 + 20]!).toBeLessThan(255);
    expect(out[20 * 41 + 20]!).toBeGreaterThan(out[20 * 41 + 23]!);
    expect(near(out[20 * 41 + 17]!, out[20 * 41 + 23]!, 1e-3)).toBe(true);
  });
  it('copes with an empty picture', () => {
    expect(gaussianBlur(new Uint8Array(0), 0, 0, 3)).toHaveLength(0);
  });
});

describe('validateTraceOptions', () => {
  it('accepts the defaults and the edges of the ranges', () => {
    expect(validateTraceOptions(DEFAULT_TRACE_OPTIONS)).toEqual([]);
    expect(validateTraceOptions(opts({ threshold: 0, smoothing: 0, minAreaPx: 0, tolerancePx: 0 }))).toEqual([]);
    expect(validateTraceOptions(opts({ threshold: 255, smoothing: 10 }))).toEqual([]);
  });
  it('says what is wrong', () => {
    expect(validateTraceOptions(opts({ threshold: 256 }))[0]).toContain('threshold');
    expect(validateTraceOptions(opts({ threshold: -1 }))).toHaveLength(1);
    expect(validateTraceOptions(opts({ smoothing: 11 }))[0]).toContain('Smoothing');
    expect(validateTraceOptions(opts({ minAreaPx: -1 }))[0]).toContain('specks');
    expect(validateTraceOptions(opts({ tolerancePx: Number.NaN }))[0]).toContain('Simplify');
    expect(validateTraceOptions(opts({ threshold: 999, smoothing: -2 }))).toHaveLength(2);
  });
});

describe('traceGray: a filled shape', () => {
  it('traces a square exactly on its edges', () => {
    const r = traceGray(make(100, 100, box(30, 30, 70, 70)), 100, 100, opts());
    expect(r).toHaveLength(1);
    const b = bounds(r[0]!);
    expect(near(b.minX, 30, 0.01) && near(b.maxX, 70, 0.01) && near(b.minY, 30, 0.01) && near(b.maxY, 70, 0.01)).toBe(true);
    expect(near(netArea(r), 1600, 1)).toBe(true);
    expect(r[0]!.closed).toBe(true);
  });
  it('traces a disk to within a tenth of a percent of its area', () => {
    const r = traceGray(make(120, 120, disk(60, 60, 30)), 120, 120, opts());
    expect(r).toHaveLength(1);
    expect(near(netArea(r), Math.PI * 900, Math.PI * 900 * 0.001)).toBe(true);
    const b = bounds(r[0]!);
    expect(near(b.maxX - b.minX, 60, 1)).toBe(true);
  });
  it('finds the edge between the pixels when the edge is soft', () => {
    // A radius that is not a whole number of pixels: the soft edge tells where the edge really is.
    const r = traceGray(make(120, 120, softDisk(60.3, 59.7, 30.37)), 120, 120, opts());
    expect(r).toHaveLength(1);
    const exact = Math.PI * 30.37 * 30.37;
    expect(near(netArea(r), exact, exact * 0.002)).toBe(true);
    const c = centroid(r[0]!.points);
    expect(near(c.x, 60.3, 0.03)).toBe(true);
    expect(near(c.y, 59.7, 0.03)).toBe(true);
  });
  it('does not change the picture it is given', () => {
    const g = make(50, 50, disk(25, 25, 10));
    const before = Array.from(g);
    traceGray(g, 50, 50, opts({ smoothing: 5, tolerancePx: 0.5 }));
    expect(Array.from(g)).toEqual(before);
  });
  it('gives the same answer every time', () => {
    const g = make(80, 80, disk(40, 40, 22));
    expect(traceGray(g, 80, 80, opts())).toEqual(traceGray(g, 80, 80, opts()));
  });
});

describe('traceGray: holes and separate shapes', () => {
  const ring = make(160, 160, (x, y) => {
    const d = Math.hypot(x + 0.5 - 80, y + 0.5 - 80);
    return d <= 50 && d > 25 ? 0 : 255;
  });
  it('makes an outline for the hole and runs it the other way round', () => {
    const r = traceGray(ring, 160, 160, opts());
    expect(r).toHaveLength(2);
    const [a, b] = [ringArea(r[0]!.points), ringArea(r[1]!.points)];
    expect(Math.sign(a)).toBe(-Math.sign(b));
    expect(near(netArea(r), Math.PI * (2500 - 625), 15)).toBe(true);
  });
  it('makes one outline for each separate shape', () => {
    const g = make(120, 60, (x, y) => (box(10, 10, 40, 50)(x, y) === 0 || box(70, 10, 110, 50)(x, y) === 0 ? 0 : 255));
    const r = traceGray(g, 120, 60, opts());
    expect(r).toHaveLength(2);
    expect(near(netArea(r), 30 * 40 + 40 * 40, 2)).toBe(true);
    // Same direction: neither is a hole.
    expect(Math.sign(ringArea(r[0]!.points))).toBe(Math.sign(ringArea(r[1]!.points)));
  });
  it('keeps an island inside a hole', () => {
    const g = make(200, 200, (x, y) => {
      const d = Math.hypot(x + 0.5 - 100, y + 0.5 - 100);
      return (d <= 90 && d > 60) || d <= 30 ? 0 : 255;
    });
    const r = traceGray(g, 200, 200, opts());
    expect(r).toHaveLength(3);
    expect(near(netArea(r), Math.PI * (8100 - 3600 + 900), 40)).toBe(true);
  });
});

describe('traceGray: where the ink meets the edge of the picture', () => {
  it('closes the outline along the edge', () => {
    const r = traceGray(make(60, 60, box(0, 0, 20, 20)), 60, 60, opts());
    expect(r).toHaveLength(1);
    const b = bounds(r[0]!);
    expect(b.minX).toBe(0);
    expect(b.minY).toBe(0);
    expect(near(b.maxX, 20, 0.01) && near(b.maxY, 20, 0.01)).toBe(true);
    expect(near(netArea(r), 400, 1)).toBe(true);
  });
  it('keeps every point inside the picture', () => {
    const g = make(50, 40, (x, y) => (x < 10 || y > 30 || (x > 20 && x < 25) ? 0 : 255));
    for (const p of traceGray(g, 50, 40, opts({ smoothing: 4 }))) {
      for (const q of p.points) expect(q.x >= 0 && q.x <= 50 && q.y >= 0 && q.y <= 40).toBe(true);
    }
  });
  it('traces a picture that is all ink as the whole picture, and one with none as nothing', () => {
    const all = traceGray(make(50, 40, () => 0), 50, 40, opts());
    expect(all).toHaveLength(1);
    expect(near(netArea(all), 2000, 1)).toBe(true);
    expect(traceGray(make(50, 40, () => 255), 50, 40, opts())).toEqual([]);
  });
});

describe('traceGray: threshold and invert', () => {
  const gradient = make(100, 20, (x) => Math.round((x / 99) * 255));
  it('a higher threshold makes more of the picture ink', () => {
    const widths = [64, 128, 192].map((threshold) => {
      const r = traceGray(gradient, 100, 20, opts({ threshold }));
      expect(r).toHaveLength(1);
      return bounds(r[0]!).maxX;
    });
    expect(widths[0]!).toBeLessThan(widths[1]!);
    expect(widths[1]!).toBeLessThan(widths[2]!);
    // The edge is where the grey crosses the threshold: about x = threshold / 255 * 99 + 0.5.
    expect(near(widths[1]!, (128 / 255) * 99 + 0.5, 0.6)).toBe(true);
  });
  it('a pixel exactly at the threshold is not ink', () => {
    const g = make(30, 30, box(10, 10, 20, 20));
    const dark = traceGray(g, 30, 30, opts({ threshold: 0 }));
    expect(dark).toEqual([]);
    const lighter = make(30, 30, (x, y) => (box(10, 10, 20, 20)(x, y) === 0 ? 100 : 255));
    expect(traceGray(lighter, 30, 30, opts({ threshold: 100 }))).toEqual([]);
    expect(traceGray(lighter, 30, 30, opts({ threshold: 101 }))).toHaveLength(1);
  });
  it('invert traces the light parts: a white disk on black is the same as a black disk on white', () => {
    const black = make(100, 100, disk(50, 50, 25));
    const white = make(100, 100, (x, y) => 255 - disk(50, 50, 25)(x, y));
    const a = traceGray(black, 100, 100, opts());
    const b = traceGray(white, 100, 100, opts({ invert: true }));
    expect(b).toHaveLength(1);
    expect(near(netArea(a), netArea(b), 1)).toBe(true);
    expect(traceGray(white, 100, 100, opts()).length).toBeGreaterThan(0);
    // Without invert the black background of that picture is the ink: a frame with a hole.
    expect(traceGray(white, 100, 100, opts())).toHaveLength(2);
  });
  it('treats a setting that is not a number as the default', () => {
    const g = make(60, 60, box(20, 20, 40, 40));
    const plain = traceGray(g, 60, 60, opts());
    expect(traceGray(g, 60, 60, opts({ threshold: Number.NaN }))).toEqual(plain);
    expect(traceGray(g, 60, 60, opts({ smoothing: Number.NaN }))).toEqual(plain);
    expect(traceGray(g, 60, 60, opts({ minAreaPx: Number.NaN, tolerancePx: Number.NaN }))).toEqual(plain);
    expect(traceGray(g, 60, 60, opts({ threshold: 5000 }))).toEqual(traceGray(g, 60, 60, opts({ threshold: 255 })));
  });
});

describe('traceGray: saddles', () => {
  // Two black pixels that touch only at a corner.
  const corner = make(10, 10, (x, y) => ((x === 4 && y === 4) || (x === 5 && y === 5) ? 0 : 255));
  it('joins them into one shape when the middle between them is ink', () => {
    const r = traceGray(corner, 10, 10, opts({ threshold: 128 }));
    expect(r).toHaveLength(1);
  });
  it('keeps them apart when the middle between them is not ink', () => {
    const r = traceGray(corner, 10, 10, opts({ threshold: 127 }));
    expect(r).toHaveLength(2);
  });
  it('gives closed outlines for a checkerboard, whichever way each corner is read', () => {
    for (const threshold of [127, 128]) {
      const board = make(12, 12, (x, y) => ((x + y) % 2 === 0 ? 0 : 255));
      const r = traceGray(board, 12, 12, opts({ threshold }));
      expect(r.length).toBeGreaterThan(0);
      for (const p of r) expect(p.points.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('traceGray: random pictures never break it', () => {
  it('every outline is a closed ring of at least three points inside the picture', () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let round = 0; round < 8; round++) {
      const w = 20 + Math.floor(rnd() * 40);
      const h = 20 + Math.floor(rnd() * 40);
      const g = make(w, h, () => Math.floor(rnd() * 256));
      for (const o of [opts(), opts({ smoothing: 2 }), opts({ invert: true, tolerancePx: 0.3 }), opts({ threshold: 40 })]) {
        const r = traceGray(g, w, h, o);
        for (const p of r) {
          expect(p.closed).toBe(true);
          expect(p.points.length).toBeGreaterThanOrEqual(3);
          for (const q of p.points) expect(q.x >= 0 && q.x <= w && q.y >= 0 && q.y <= h).toBe(true);
        }
      }
    }
  });
  it('the outlines of a smooth blobby picture cover the area of its ink', () => {
    const w = 200;
    const h = 200;
    const g = make(w, h, (x, y) => {
      const v = Math.sin(x / 17) + Math.sin(y / 23) + Math.sin((x + y) / 31) + Math.cos((x - y) / 13);
      return v > 0.4 ? 0 : 255;
    });
    let inkPixels = 0;
    for (const v of g) if (v === 0) inkPixels++;
    const r = traceGray(g, w, h, opts());
    expect(r.length).toBeGreaterThan(1);
    expect(near(netArea(r), inkPixels, inkPixels * 0.02)).toBe(true);
  });
});

describe('traceGray: smoothing', () => {
  it('removes a speck of noise that is only one pixel', () => {
    const g = make(60, 60, (x, y) => (x === 30 && y === 30 ? 0 : 255));
    expect(traceGray(g, 60, 60, opts({ smoothing: 0 }))).toHaveLength(1);
    expect(traceGray(g, 60, 60, opts({ smoothing: 5 }))).toEqual([]);
  });
  it('rounds the corners of a square', () => {
    const g = make(100, 100, box(30, 30, 70, 70));
    const sharp = traceGray(g, 100, 100, opts({ smoothing: 0 }));
    const soft = traceGray(g, 100, 100, opts({ smoothing: 6 }));
    expect(soft).toHaveLength(1);
    expect(netArea(soft)).toBeLessThan(netArea(sharp) - 5);
    expect(netArea(soft)).toBeGreaterThan(1500);
    const corner = soft[0]!.points.reduce((best, q) => Math.min(best, Math.hypot(q.x - 70, q.y - 30)), Infinity);
    expect(corner).toBeGreaterThan(1);
    const flat = soft[0]!.points.reduce((best, q) => Math.min(best, Math.abs(q.x - 70)), Infinity);
    expect(flat).toBeLessThan(0.5);
  });
  it('is the same blur whatever the size of the picture it is given', () => {
    // 4 times the size, so the same blur in pixels rounds a 4 times smaller part of the picture.
    const small = traceGray(make(100, 100, box(30, 30, 70, 70)), 100, 100, opts({ smoothing: 5 }));
    const big = traceGray(make(400, 400, box(120, 120, 280, 280)), 400, 400, opts({ smoothing: 5 }));
    const smallLoss = 1600 - netArea(small);
    const bigLoss = 25600 - netArea(big);
    expect(bigLoss / 16).toBeLessThan(smallLoss);
  });
});

describe('traceGray: ignoring specks and simplifying', () => {
  const twoShapes = make(100, 100, (x, y) => (box(10, 10, 60, 60)(x, y) === 0 || box(80, 80, 83, 83)(x, y) === 0 ? 0 : 255));
  it('drops outlines smaller than the size given', () => {
    expect(traceGray(twoShapes, 100, 100, opts())).toHaveLength(2);
    const r = traceGray(twoShapes, 100, 100, opts({ minAreaPx: 20 }));
    expect(r).toHaveLength(1);
    expect(near(netArea(r), 2500, 1)).toBe(true);
    expect(traceGray(twoShapes, 100, 100, opts({ minAreaPx: 5000 }))).toEqual([]);
  });
  it('also drops a tiny hole, which fills it in', () => {
    const g = make(80, 80, (x, y) => (box(10, 10, 70, 70)(x, y) === 0 && box(40, 40, 42, 42)(x, y) !== 0 ? 0 : 255));
    expect(traceGray(g, 80, 80, opts())).toHaveLength(2);
    const r = traceGray(g, 80, 80, opts({ minAreaPx: 10 }));
    expect(r).toHaveLength(1);
    expect(near(netArea(r), 3600, 2)).toBe(true);
  });
  it('simplifying makes fewer points and keeps the shape within the tolerance', () => {
    const g = make(200, 200, disk(100, 100, 80));
    const full = traceGray(g, 200, 200, opts());
    const simple = traceGray(g, 200, 200, opts({ tolerancePx: 0.5 }));
    expect(simple).toHaveLength(1);
    expect(simple[0]!.points.length).toBeLessThan(full[0]!.points.length / 3);
    for (const q of simple[0]!.points) expect(near(Math.hypot(q.x - 100, q.y - 100), 80, 0.7)).toBe(true);
    expect(near(netArea(simple), netArea(full), netArea(full) * 0.01)).toBe(true);
  });
  it('a square keeps its corners with a small tolerance', () => {
    // Marching squares cuts each corner by half a pixel, so a fine tolerance keeps both ends of every cut.
    const r = traceGray(make(100, 100, box(30, 30, 70, 70)), 100, 100, opts({ tolerancePx: 0.1 }));
    expect(r[0]!.points).toHaveLength(8);
    expect(near(netArea(r), 1600, 1)).toBe(true);
  });
  it('a square is simplified to four points with a bigger tolerance, and stays within it', () => {
    const tolerance = 0.5;
    const r = traceGray(make(100, 100, box(30, 30, 70, 70)), 100, 100, opts({ tolerancePx: tolerance }));
    expect(r[0]!.points).toHaveLength(4);
    // Every side stays within the tolerance of the real square: the area cannot drop by more than the perimeter times it.
    expect(netArea(r)).toBeGreaterThan(1600 - 160 * tolerance);
    expect(netArea(r)).toBeLessThanOrEqual(1600);
  });
});

describe('simplifyRing', () => {
  const square = (n: number): Point2[] => {
    const pts: Point2[] = [];
    for (let i = 0; i < n; i++) pts.push({ x: (i * 10) / n, y: 0 });
    for (let i = 0; i < n; i++) pts.push({ x: 10, y: (i * 10) / n });
    for (let i = 0; i < n; i++) pts.push({ x: 10 - (i * 10) / n, y: 10 });
    for (let i = 0; i < n; i++) pts.push({ x: 0, y: 10 - (i * 10) / n });
    return pts;
  };
  it('takes the extra points off the straight sides', () => {
    const out = simplifyRing(square(10), 0.01);
    expect(out).toHaveLength(4);
    expect(near(Math.abs(ringArea(out)), 100, 1e-9)).toBe(true);
  });
  it('keeps everything with a tolerance of zero, and leaves tiny rings alone', () => {
    expect(simplifyRing(square(5), 0)).toHaveLength(20);
    const tri = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }];
    expect(simplifyRing(tri, 100)).toEqual(tri);
  });
  it('does not change the points it is given', () => {
    const pts = square(6);
    const copy = JSON.stringify(pts);
    simplifyRing(pts, 0.5);
    expect(JSON.stringify(pts)).toBe(copy);
  });
});

describe('contoursOf', () => {
  it('has nothing to follow in a field with no ink or too small a grid', () => {
    expect(contoursOf(new Float32Array(16).fill(-1), 4, 4)).toEqual([]);
    expect(contoursOf(new Float32Array(1), 1, 1)).toEqual([]);
  });
  it('finds one outline round a single sample of ink, with the ink on its left', () => {
    const f = new Float32Array(25).fill(-1);
    f[2 * 5 + 2] = 1;
    const rings = contoursOf(f, 5, 5);
    expect(rings).toHaveLength(1);
    const pts: Point2[] = [];
    for (let k = 0; k < rings[0]!.length; k += 2) pts.push({ x: rings[0]![k]!, y: rings[0]![k + 1]! });
    expect(pts).toHaveLength(4);
    // The outline is a small diamond round the sample at (2, 2).
    for (const p of pts) expect(Math.hypot(p.x - 2, p.y - 2)).toBeLessThan(1);
    expect(ringArea(pts)).toBeLessThan(0);
  });
});

describe('results', () => {
  it('counts outlines and points', () => {
    const r = traceGray(make(100, 100, box(30, 30, 70, 70)), 100, 100, opts({ tolerancePx: 0.5 }));
    expect(traceStats(r).paths).toBe(1);
    expect(traceStats(r).points).toBe(r[0]!.points.length);
    expect(traceStats([])).toEqual({ paths: 0, points: 0 });
  });
  it('writes SVG path data for a preview', () => {
    const d = pathsToSvgData([
      { points: [{ x: 0, y: 0 }, { x: 10.04, y: 0 }, { x: 10, y: 5.56 }], closed: true },
      { points: [{ x: 1, y: 1 }], closed: true },
      { points: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }], closed: true },
    ]);
    expect(d).toBe('M0 0L10 0L10 5.6ZM2 2L3 2L3 3Z');
    expect(pathsToSvgData([])).toBe('');
  });
  it('copes with a picture of the wrong size', () => {
    expect(traceGray(new Uint8Array(10), 20, 20, opts())).toEqual([]);
    expect(traceGray(new Uint8Array(0), 0, 0, opts())).toEqual([]);
  });
});

describe('speed', () => {
  it('traces a 1400 x 1400 picture in a few seconds', () => {
    const w = 1400;
    const h = 1400;
    const g = make(w, h, (x, y) => {
      const d = Math.hypot(x - 700, y - 700);
      return (d < 600 && d > 450) || (d < 300 && d > 200) || (x > 100 && x < 200 && y > 100 && y < 1300) ? 0 : 255;
    });
    const start = Date.now();
    const r = traceGray(g, w, h, opts({ smoothing: 3, tolerancePx: 0.5 }));
    const ms = Date.now() - start;
    // The bar runs into the big ring: that shape and its hole, and the small ring and its hole.
    expect(r).toHaveLength(4);
    expect(ms).toBeLessThan(6000);
  });
});

describe('traceGray: smoothing an enlarged picture', () => {
  // A 64 x 64 picture with a hard-edged disk, enlarged 12 times with smooth (bilinear) filtering, the
  // way the browser enlarges a small picture before it is traced.
  const SRC = 64;
  const K = 12;
  const enlarged = (() => {
    const src = make(SRC, SRC, disk(32, 32, 20));
    const n = SRC * K;
    return make(n, n, (x, y) => {
      const fx = (x + 0.5) / K - 0.5;
      const fy = (y + 0.5) / K - 0.5;
      const x0 = Math.max(0, Math.floor(fx));
      const y0 = Math.max(0, Math.floor(fy));
      const x1 = Math.min(SRC - 1, x0 + 1);
      const y1 = Math.min(SRC - 1, y0 + 1);
      const tx = Math.min(1, Math.max(0, fx - x0));
      const ty = Math.min(1, Math.max(0, fy - y0));
      const at = (a: number, b: number) => src[b * SRC + a]!;
      const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
      const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
      return Math.round(top * (1 - ty) + bottom * ty);
    });
  })();
  /** How far the outline strays from a perfect circle, at the worst. */
  const roughness = (blurScale: number): number => {
    const n = SRC * K;
    const r = traceGray(enlarged, n, n, opts({ smoothing: 3, blurScale }));
    expect(r).toHaveLength(1);
    const pts = r[0]!.points;
    const c = centroid(pts);
    const radii = pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    return Math.max(...radii.map((v) => Math.abs(v - mean)));
  };
  it('smooths the steps of an enlarged picture more when told how much it was enlarged', () => {
    const plain = roughness(1);
    const told = roughness(K);
    expect(plain).toBeGreaterThan(4); // half a source pixel of staircase
    // What is left is the quantising of the 64-pixel source itself: about a fifth of a source pixel.
    expect(told).toBeLessThan(plain / 2);
    expect(told).toBeLessThan(3);
  });
  it('still draws the circle the right size', () => {
    const n = SRC * K;
    const r = traceGray(enlarged, n, n, opts({ smoothing: 3, blurScale: K }));
    const exact = Math.PI * (20 * K) * (20 * K);
    expect(near(netArea(r), exact, exact * 0.01)).toBe(true);
  });
  it('a blur scale that is missing, below 1 or not a number changes nothing', () => {
    const g = make(60, 60, box(20, 20, 40, 40));
    const base = traceGray(g, 60, 60, opts({ smoothing: 4 }));
    expect(traceGray(g, 60, 60, opts({ smoothing: 4, blurScale: 1 }))).toEqual(base);
    expect(traceGray(g, 60, 60, opts({ smoothing: 4, blurScale: 0.2 }))).toEqual(base);
    expect(traceGray(g, 60, 60, opts({ smoothing: 4, blurScale: Number.NaN }))).toEqual(base);
    expect(traceGray(g, 60, 60, opts({ smoothing: 4, blurScale: -3 }))).toEqual(base);
  });
  it('does not blur more than the limit, however big the scale', () => {
    const g = make(120, 120, box(40, 40, 80, 80));
    const huge = traceGray(g, 120, 120, opts({ smoothing: 10, blurScale: 1e9 }));
    expect(Array.isArray(huge)).toBe(true);
    const start = Date.now();
    traceGray(g, 120, 120, opts({ smoothing: 10, blurScale: 1e9 }));
    expect(Date.now() - start).toBeLessThan(5000);
  });
});
