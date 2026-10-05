import { describe, expect, it } from 'vitest';
import {
  alphaFromRGBA,
  alphaToShape,
  shapePathData,
  signedArea,
  simplifyClosed,
  traceAlpha,
  type Pt,
} from '@/lib/textTrace';

/** Antialiased bitmap (4 x 4 supersampling) of a shape given as a hit-test, 0-255 per pixel. */
function bitmap(w: number, h: number, inside: (x: number, y: number) => boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) n++;
      out[y * w + x] = Math.round((n / 16) * 255);
    }
  }
  return out;
}

const rect = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) => x >= x0 && x < x1 && y >= y0 && y < y1;
const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const area = (l: Pt[]) => Math.abs(signedArea(l));
const bounds = (loops: Pt[][]) => {
  const xs = loops.flat().map((p) => p.x);
  const ys = loops.flat().map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

describe('traceAlpha', () => {
  it('traces a rectangle as one loop with the right area and position', () => {
    const loops = traceAlpha(bitmap(60, 40, rect(10, 8, 50, 28)), 60, 40);
    expect(loops).toHaveLength(1);
    expect(area(loops[0] as Pt[])).toBeGreaterThan(800 * 0.97);
    expect(area(loops[0] as Pt[])).toBeLessThan(800 * 1.03);
    const b = bounds(loops);
    expect(b.x0).toBeCloseTo(10, 0);
    expect(b.x1).toBeCloseTo(50, 0);
    expect(b.y0).toBeCloseTo(8, 0);
    expect(b.y1).toBeCloseTo(28, 0);
  });

  it('traces a ring as an outer loop and a hole', () => {
    const ring = (x: number, y: number) => disc(30, 30, 20)(x, y) && !disc(30, 30, 10)(x, y);
    const loops = traceAlpha(bitmap(60, 60, ring), 60, 60);
    expect(loops).toHaveLength(2);
    const [big, small] = [...loops].sort((a, b) => area(b) - area(a)) as [Pt[], Pt[]];
    expect(area(big)).toBeGreaterThan(Math.PI * 400 * 0.97);
    expect(area(big)).toBeLessThan(Math.PI * 400 * 1.03);
    expect(area(small)).toBeGreaterThan(Math.PI * 100 * 0.93);
    expect(area(small)).toBeLessThan(Math.PI * 100 * 1.07);
    // the hole sits inside the outer loop
    const hb = bounds([small]);
    const ob = bounds([big]);
    expect(hb.x0).toBeGreaterThan(ob.x0);
    expect(hb.x1).toBeLessThan(ob.x1);
  });

  it('keeps separate shapes separate', () => {
    const two = (x: number, y: number) => disc(15, 15, 8)(x, y) || disc(45, 15, 8)(x, y);
    expect(traceAlpha(bitmap(60, 30, two), 60, 30)).toHaveLength(2);
  });

  it('closes loops for a shape that touches the edge of the bitmap', () => {
    const loops = traceAlpha(bitmap(20, 20, () => true), 20, 20);
    expect(loops).toHaveLength(1);
    expect(area(loops[0] as Pt[])).toBeGreaterThan(19 * 19);
  });

  it('returns nothing for an empty or zero-size bitmap', () => {
    expect(traceAlpha(new Uint8Array(100), 10, 10)).toEqual([]);
    expect(traceAlpha(new Uint8Array(0), 0, 0)).toEqual([]);
  });

  it('survives the diagonal (saddle) pixel pattern without hanging', () => {
    const px = new Uint8Array(16);
    px[1 * 4 + 1] = 255;
    px[2 * 4 + 2] = 255;
    const loops = traceAlpha(px, 4, 4);
    expect(loops.length).toBeGreaterThanOrEqual(1);
    for (const l of loops) expect(l.length).toBeGreaterThanOrEqual(3);
  });
});

describe('simplifyClosed', () => {
  const circle = Array.from({ length: 2000 }, (_, i) => ({
    x: 50 + 40 * Math.cos((i / 2000) * 2 * Math.PI),
    y: 50 + 40 * Math.sin((i / 2000) * 2 * Math.PI),
  }));

  it('drops points but stays within the tolerance', () => {
    const tol = 0.05;
    const s = simplifyClosed(circle, tol);
    expect(s.length).toBeLessThan(200);
    expect(s.length).toBeGreaterThan(20);
    const dist = (p: Pt) => {
      let best = Infinity;
      for (let i = 0; i < s.length; i++) {
        const a = s[i] as Pt;
        const b = s[(i + 1) % s.length] as Pt;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
        best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
      }
      return best;
    };
    for (const p of circle) expect(dist(p)).toBeLessThan(tol + 1e-9);
  });

  it('leaves tiny loops alone', () => {
    const tri = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }];
    expect(simplifyClosed(tri, 1)).toEqual(tri);
  });
});

describe('alphaToShape', () => {
  it('scales to mm and moves the shape to the origin', () => {
    const s = alphaToShape(bitmap(100, 60, rect(20, 10, 60, 30)), 100, 60, 10);
    expect(s).not.toBeNull();
    expect(s!.widthMm).toBeCloseTo(4, 1);
    expect(s!.heightMm).toBeCloseTo(2, 1);
    const xs = s!.paths.flatMap((p) => p.points.map((pt) => pt.x));
    const ys = s!.paths.flatMap((p) => p.points.map((pt) => pt.y));
    expect(Math.min(...xs)).toBe(0);
    expect(Math.min(...ys)).toBe(0);
    expect(s!.paths.every((p) => p.closed)).toBe(true);
  });

  it('keeps holes as separate loops', () => {
    const ring = (x: number, y: number) => disc(30, 30, 20)(x, y) && !disc(30, 30, 10)(x, y);
    expect(alphaToShape(bitmap(60, 60, ring), 60, 60, 10)!.paths).toHaveLength(2);
  });

  it('drops specks smaller than a laser dot', () => {
    const speck = (x: number, y: number) => rect(5, 5, 25, 25)(x, y) || rect(40, 40, 41, 41)(x, y);
    expect(alphaToShape(bitmap(60, 60, speck), 60, 60, 16)!.paths).toHaveLength(1);
  });

  it('returns null for a blank bitmap', () => {
    expect(alphaToShape(new Uint8Array(400), 20, 20, 10)).toBeNull();
  });
});

describe('helpers', () => {
  it('extracts the alpha channel of RGBA data', () => {
    expect(Array.from(alphaFromRGBA([1, 2, 3, 10, 4, 5, 6, 20], 2, 1))).toEqual([10, 20]);
  });
  it('writes SVG path data with one subpath per loop', () => {
    const d = shapePathData([
      { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], closed: true },
      { points: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }], closed: true },
    ]);
    expect(d).toBe('M0 0L1 0L1 1ZM2 2L3 2L3 3Z');
  });
});
