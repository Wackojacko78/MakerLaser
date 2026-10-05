// Turns a coverage bitmap (text drawn by the browser) into closed outline polylines in mm.
// Pure TypeScript with no DOM, React or Tauri imports, so it is unit-tested in plain Node
// (tests/textTrace.test.ts).
//
// Method: marching squares on the antialiased alpha channel (sub-pixel accurate), the
// segments are stitched into closed loops, then simplified with Ramer-Douglas-Peucker.
// Letters and their holes (the inside of an "o") both come out as closed loops. The
// planner works out which loops are holes from their nesting, as it does for imported SVGs.

import type { Path2D } from '@/types/domain';

export interface Pt {
  x: number;
  y: number;
}

/** The alpha channel of RGBA pixel data, as one byte per pixel. */
export function alphaFromRGBA(rgba: ArrayLike<number>, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3] ?? 0;
  return out;
}

/** Signed area (shoelace). The sign only tells the direction the loop runs in. */
export function signedArea(pts: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Pt;
    const q = pts[(i + 1) % pts.length] as Pt;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Closed outlines of everything at or above `threshold` (0-1) in an 8-bit coverage bitmap.
 * Returned in pixel units, with (0,0) at the top-left corner of the bitmap.
 */
export function traceAlpha(alpha: ArrayLike<number>, w: number, h: number, threshold = 0.5): Pt[][] {
  if (w <= 0 || h <= 0) return [];
  // One pixel of empty border all round, so every outline closes.
  const W = w + 2;
  const H = h + 2;
  const g = new Float32Array(W * H);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) g[(y + 1) * W + (x + 1)] = (alpha[y * w + x] ?? 0) / 255;
  }
  const at = (i: number) => g[i] ?? 0;

  // Every crossing sits on a grid edge, named by a key: (index * 2) for the edge from
  // (x,y) to (x+1,y), and (index * 2 + 1) for the edge from (x,y) to (x,y+1).
  // Every crossing is joined to exactly two others, so the segments form closed loops.
  const n1 = new Int32Array(W * H * 2).fill(-1);
  const n2 = new Int32Array(W * H * 2).fill(-1);
  const link = (a: number, b: number) => {
    if (n1[a] === -1) n1[a] = b;
    else n2[a] = b;
    if (n1[b] === -1) n1[b] = a;
    else n2[b] = a;
  };

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const i = y * W + x;
      const vtl = at(i);
      const vtr = at(i + 1);
      const vbr = at(i + W + 1);
      const vbl = at(i + W);
      const code =
        (vtl >= threshold ? 8 : 0) | (vtr >= threshold ? 4 : 0) | (vbr >= threshold ? 2 : 0) | (vbl >= threshold ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const T = i * 2;
      const B = (i + W) * 2;
      const L = i * 2 + 1;
      const R = (i + 1) * 2 + 1;
      switch (code) {
        case 1:
        case 14:
          link(L, B);
          break;
        case 2:
        case 13:
          link(B, R);
          break;
        case 3:
        case 12:
          link(L, R);
          break;
        case 4:
        case 11:
          link(T, R);
          break;
        case 6:
        case 9:
          link(T, B);
          break;
        case 7:
        case 8:
          link(T, L);
          break;
        case 5:
        case 10: {
          // Saddle: decide from the centre whether the two inside corners are joined.
          const joined = (vtl + vtr + vbr + vbl) / 4 >= threshold;
          if (code === 5) {
            if (joined) {
              link(T, L);
              link(B, R);
            } else {
              link(T, R);
              link(L, B);
            }
          } else if (joined) {
            link(T, R);
            link(L, B);
          } else {
            link(T, L);
            link(B, R);
          }
          break;
        }
      }
    }
  }

  const frac = (a: number, b: number) => (b === a ? 0.5 : (threshold - a) / (b - a));
  // Grid point (gx, gy) is the centre of pixel (gx-1, gy-1), hence the 0.5 offsets.
  const pointOf = (key: number): Pt => {
    const idx = key >> 1;
    const gx = idx % W;
    const gy = (idx - gx) / W;
    const v0 = at(idx);
    if (key & 1) return { x: gx - 0.5, y: gy + frac(v0, at(idx + W)) - 0.5 };
    return { x: gx + frac(v0, at(idx + 1)) - 0.5, y: gy - 0.5 };
  };

  const seen = new Uint8Array(n1.length);
  const loops: Pt[][] = [];
  for (let start = 0; start < n1.length; start++) {
    if (n1[start] === -1 || seen[start] === 1) continue;
    const pts: Pt[] = [];
    let prev = -1;
    let cur = start;
    do {
      seen[cur] = 1;
      pts.push(pointOf(cur));
      const a = n1[cur] as number;
      const b = n2[cur] as number;
      const next = a !== prev ? a : b;
      prev = cur;
      cur = next;
    } while (cur !== start && cur !== -1 && seen[cur] === 0);
    if (pts.length >= 3) loops.push(pts);
  }
  return loops;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer-Douglas-Peucker on an open chain; every dropped point is within `tol` of the result. */
function simplifyOpen(pts: readonly Pt[], tol: number): Pt[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    let worst = -1;
    let worstD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i] as Pt, pts[a] as Pt, pts[b] as Pt);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/** Simplifies a closed loop (the first point is not repeated at the end). */
export function simplifyClosed(pts: readonly Pt[], tol: number): Pt[] {
  if (pts.length < 4) return pts.slice();
  const first = pts[0] as Pt;
  let far = 1;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] as Pt;
    const d = Math.hypot(p.x - first.x, p.y - first.y);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = simplifyOpen(pts.slice(0, far + 1), tol);
  const b = simplifyOpen([...pts.slice(far), first], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

export interface TextShape {
  /** Closed outlines in mm, with the top-left of the shape's bounding box at (0, 0). */
  paths: Path2D[];
  widthMm: number;
  heightMm: number;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Bitmap to outlines in mm. Returns null when nothing is drawn in the bitmap. */
export function alphaToShape(
  alpha: ArrayLike<number>,
  w: number,
  h: number,
  pxPerMm: number,
  toleranceMm = 0.02,
): TextShape | null {
  const tol = toleranceMm * pxPerMm;
  const minArea = Math.max(2, (0.05 * pxPerMm) ** 2); // drops antialiasing specks
  const loops = traceAlpha(alpha, w, h)
    .map((l) => simplifyClosed(l, tol))
    .filter((l) => l.length >= 3 && Math.abs(signedArea(l)) >= minArea);
  if (loops.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of loops) {
    for (const p of l) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const paths: Path2D[] = loops.map((l) => ({
    points: l.map((p) => ({ x: round3((p.x - minX) / pxPerMm), y: round3((p.y - minY) / pxPerMm) })),
    closed: true,
  }));
  return { paths, widthMm: round3((maxX - minX) / pxPerMm), heightMm: round3((maxY - minY) / pxPerMm) };
}

/** SVG path data for previews. Draw it with fill-rule="evenodd" so holes stay open. */
export function shapePathData(paths: readonly Path2D[]): string {
  return paths
    .map((p) => p.points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x} ${pt.y}`).join('') + 'Z')
    .join('');
}
