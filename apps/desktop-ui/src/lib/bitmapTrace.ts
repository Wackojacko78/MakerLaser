// Turns a grey picture into outlines ("trace"). Pure TypeScript (no React, Konva, canvas or Tauri
// imports), so it is unit-tested in plain Node (tests/bitmapTrace.test.ts). The browser side that
// decodes a picture into grey values is in lib/traceImage.ts.
//
// How it works:
//   1. The grey values are blurred a little (the Smoothing setting, measured in the picture's own
//      pixels). This is what rounds off the stair-steps of a small or low-resolution picture.
//   2. Every pixel gets a number: positive where it is "ink" (darker than the Threshold, or lighter
//      when Invert is on), zero or negative where it is not. A one-pixel border of "not ink" is added so
//      every outline closes, even where the ink touches the edge of the picture.
//   3. Marching squares finds the line where that number crosses zero. It interpolates between the
//      pixels, so the outline sits between them instead of along pixel edges.
//   4. Outlines smaller than the Ignore-specks size are dropped, and the rest are simplified
//      (Ramer-Douglas-Peucker) to the Simplify tolerance.
//
// All sizes in here are in pixels of the grey picture; lib/traceObject.ts converts millimetres.
// Pixel i covers [i, i + 1), so the picture is the rectangle (0, 0) to (width, height).
import type { Path2D, Point2 } from '@/types/domain';

export interface TraceOptions {
  /** 0 to 255: grey values below this are ink (a pixel exactly at the threshold is not). */
  threshold: number;
  /** Trace the light parts of the picture instead of the dark parts. */
  invert: boolean;
  /** 0 (none) to 10: how much the picture is blurred before it is traced. */
  smoothing: number;
  /**
   * How many times bigger the picture was made before tracing (1 when it was not enlarged). The blur is
   * measured in the picture's own pixels, so an enlarged picture is blurred this many times more:
   * that is what takes the steps out of a small picture. Missing, below 1 or not a number counts as 1.
   */
  blurScale?: number;
  /** Outlines enclosing less than this many square pixels are dropped. 0 keeps everything. */
  minAreaPx: number;
  /** Outlines are simplified so they stay within this many pixels of the true line. 0 keeps every point. */
  tolerancePx: number;
}

export const MAX_SMOOTHING = 10;
/** The blur (a Gaussian sigma, in pixels of the picture's own) for each step of Smoothing. */
export const BLUR_PX_PER_STEP = 0.4;
/** The blur never goes above this many pixels (it would take too long, and nothing is left of the picture). */
export const MAX_BLUR_PX = 40;

/** The longest side of the grey picture is brought to between these many pixels. */
export const ANALYSIS_MIN_SIDE = 800;
export const ANALYSIS_MAX_SIDE = 1400;
/** A tiny picture is enlarged at most this many times before it is traced. */
export const ANALYSIS_MAX_UPSCALE = 16;

export const DEFAULT_TRACE_OPTIONS: Readonly<TraceOptions> = {
  threshold: 128,
  invert: false,
  smoothing: 3,
  minAreaPx: 0,
  tolerancePx: 0,
};

/** Problems with the settings (empty when valid). */
export function validateTraceOptions(o: TraceOptions): string[] {
  const problems: string[] = [];
  if (!Number.isFinite(o.threshold) || o.threshold < 0 || o.threshold > 255) problems.push('The threshold must be from 0 to 255.');
  if (!Number.isFinite(o.smoothing) || o.smoothing < 0 || o.smoothing > MAX_SMOOTHING) problems.push(`Smoothing must be from 0 to ${MAX_SMOOTHING}.`);
  if (!Number.isFinite(o.minAreaPx) || o.minAreaPx < 0) problems.push('Ignore specks must be 0 or more.');
  if (!Number.isFinite(o.tolerancePx) || o.tolerancePx < 0) problems.push('Simplify must be 0 or more.');
  return problems;
}

/** The size the picture is traced at: enlarged if it is small, shrunk if it is big, otherwise as it is. */
export function analysisSize(width: number, height: number): { width: number; height: number; scale: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0, scale: 1 };
  const longest = Math.max(width, height);
  let scale = 1;
  if (longest < ANALYSIS_MIN_SIDE) scale = Math.min(ANALYSIS_MIN_SIDE / longest, ANALYSIS_MAX_UPSCALE);
  else if (longest > ANALYSIS_MAX_SIDE) scale = ANALYSIS_MAX_SIDE / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

/**
 * Grey values (0 black to 255 white) from RGBA pixels, the way the engraver reads a picture: a
 * transparent pixel counts as white, so a transparent background is never traced as ink.
 */
export function grayFromRGBA(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const r = rgba[i * 4] ?? 0;
    const g = rgba[i * 4 + 1] ?? 0;
    const b = rgba[i * 4 + 2] ?? 0;
    const alpha = (rgba[i * 4 + 3] ?? 255) / 255;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const v = luma * alpha + 255 * (1 - alpha);
    out[i] = Math.min(255, Math.max(0, Math.round(v)));
  }
  return out;
}

/** A Gaussian blur of a grey picture (the picture's edge carries on outwards). Sigma 0 is a plain copy. */
export function gaussianBlur(gray: ArrayLike<number>, width: number, height: number, sigma: number): Float32Array {
  const n = width * height;
  const out = new Float32Array(n);
  if (!(sigma > 0.05) || n === 0) {
    for (let i = 0; i < n; i++) out[i] = gray[i] ?? 255;
    return out;
  }
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel[k + radius] = w;
    sum += w;
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] = (kernel[k] ?? 0) / sum;
  const tmp = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        acc += (kernel[k + radius] ?? 0) * (gray[row + xx] ?? 255);
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        acc += (kernel[k + radius] ?? 0) * (tmp[yy * width + x] ?? 255);
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

// ---- marching squares -------------------------------------------------------------------------

const TOP = 0;
const RIGHT = 1;
const BOTTOM = 2;
const LEFT = 3;
// A cell has four corners a (top left), b (top right), c (bottom right), d (bottom left).
const CORNER: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const EDGE_MID: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
];
/** The two edges that meet at each corner. */
const CORNER_EDGES: ReadonlyArray<readonly [number, number]> = [
  [TOP, LEFT],
  [TOP, RIGHT],
  [RIGHT, BOTTOM],
  [BOTTOM, LEFT],
];
/** The two corners at the ends of each edge. */
const EDGE_ENDS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [3, 2],
  [0, 3],
];

type Segment = readonly [from: number, to: number];

/** A directed segment between two edge crossings, turned so that the ink is on its left (screen left, y down). */
function directed(e1: number, e2: number, ink: readonly [number, number]): Segment {
  const p = EDGE_MID[e1] as readonly [number, number];
  const q = EDGE_MID[e2] as readonly [number, number];
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const side = dy * (ink[0] - p[0]) + -dx * (ink[1] - p[1]);
  return side > 0 ? [e1, e2] : [e2, e1];
}

/** The segments of one cell, for every pattern of ink corners. Saddles (two opposite ink corners) have two readings. */
function buildTable(): Segment[][][] {
  const table: Segment[][][] = [];
  for (let index = 0; index < 16; index++) {
    const bits = [(index >> 3) & 1, (index >> 2) & 1, (index >> 1) & 1, index & 1];
    const variants: Segment[][] = [];
    for (const centreInk of [false, true]) {
      const segs: Segment[] = [];
      const inkCount = bits[0]! + bits[1]! + bits[2]! + bits[3]!;
      if (inkCount === 0 || inkCount === 4) {
        // nothing crosses this cell
      } else if (index === 5 || index === 10) {
        // A saddle: the ink is joined through the middle, or split into two. Either way each segment
        // cuts one corner off.
        for (let k = 0; k < 4; k++) {
          const isInk = bits[k] === 1;
          const cutsThisCorner = centreInk ? !isInk : isInk;
          if (!cutsThisCorner) continue;
          const edges = CORNER_EDGES[k] as readonly [number, number];
          segs.push(directed(edges[0], edges[1], isInk ? (CORNER[k] as readonly [number, number]) : [0.5, 0.5]));
        }
      } else {
        const crossing: number[] = [];
        for (let e = 0; e < 4; e++) {
          const ends = EDGE_ENDS[e] as readonly [number, number];
          if (bits[ends[0]] !== bits[ends[1]]) crossing.push(e);
        }
        const inkCorner = CORNER[bits.indexOf(1)] as readonly [number, number];
        segs.push(directed(crossing[0]!, crossing[1]!, inkCorner));
      }
      variants.push(segs);
    }
    table.push(variants);
  }
  return table;
}

const TABLE = buildTable();

/**
 * The outlines of the ink in a field of numbers (positive = ink) on a width x height grid whose
 * outer ring of samples is not ink. Each outline is a flat list [x0, y0, x1, y1, ...] in grid units,
 * with the ink on its left. Outer outlines and the outlines of holes run in opposite directions.
 */
export function contoursOf(field: Float32Array, width: number, height: number): number[][] {
  const cellsX = width - 1;
  const cellsY = height - 1;
  const rings: number[][] = [];
  if (cellsX < 1 || cellsY < 1) return rings;
  const used = new Uint8Array(cellsX * cellsY);

  const segmentsAt = (i: number, j: number): Segment[] => {
    const a = field[j * width + i]!;
    const b = field[j * width + i + 1]!;
    const c = field[(j + 1) * width + i + 1]!;
    const d = field[(j + 1) * width + i]!;
    const index = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
    const reading = (index === 5 || index === 10) && (a + b + c + d) / 4 > 0 ? 1 : 0;
    return (TABLE[index] as Segment[][])[reading] as Segment[];
  };

  /** Where the outline crosses an edge of a cell, as grid units. */
  const crossing = (i: number, j: number, edge: number, into: number[]): void => {
    if (edge === TOP) {
      const fa = field[j * width + i]!;
      const fb = field[j * width + i + 1]!;
      into.push(i + fa / (fa - fb), j);
    } else if (edge === RIGHT) {
      const fb = field[j * width + i + 1]!;
      const fc = field[(j + 1) * width + i + 1]!;
      into.push(i + 1, j + fb / (fb - fc));
    } else if (edge === BOTTOM) {
      const fd = field[(j + 1) * width + i]!;
      const fc = field[(j + 1) * width + i + 1]!;
      into.push(i + fd / (fd - fc), j + 1);
    } else {
      const fa = field[j * width + i]!;
      const fd = field[(j + 1) * width + i]!;
      into.push(i, j + fa / (fa - fd));
    }
  };

  const limit = cellsX * cellsY * 2 + 8;
  for (let j = 0; j < cellsY; j++) {
    for (let i = 0; i < cellsX; i++) {
      const first = segmentsAt(i, j);
      for (let s = 0; s < first.length; s++) {
        if ((used[j * cellsX + i]! & (1 << s)) !== 0) continue;
        const ring: number[] = [];
        let ci = i;
        let cj = j;
        let cs = s;
        let steps = 0;
        for (;;) {
          used[cj * cellsX + ci] = used[cj * cellsX + ci]! | (1 << cs);
          const segs = segmentsAt(ci, cj);
          const seg = segs[cs] as Segment;
          crossing(ci, cj, seg[0], ring);
          // Step into the cell on the far side of the edge the outline leaves by.
          let ni = ci;
          let nj = cj;
          let entering: number;
          if (seg[1] === TOP) {
            nj -= 1;
            entering = BOTTOM;
          } else if (seg[1] === RIGHT) {
            ni += 1;
            entering = LEFT;
          } else if (seg[1] === BOTTOM) {
            nj += 1;
            entering = TOP;
          } else {
            ni -= 1;
            entering = RIGHT;
          }
          if (ni < 0 || nj < 0 || ni >= cellsX || nj >= cellsY) break; // cannot happen: the border is never ink
          const next = segmentsAt(ni, nj);
          const k = next.findIndex((n) => n[0] === entering);
          if (k < 0) break; // cannot happen: the segments of neighbouring cells always meet
          ci = ni;
          cj = nj;
          cs = k;
          if ((ci === i && cj === j && cs === s) || ++steps > limit) break;
        }
        if (ring.length >= 6) rings.push(ring);
      }
    }
  }
  return rings;
}

// ---- simplifying ------------------------------------------------------------------------------

/** The signed area of a ring (shoelace). Its sign says which way round it runs; outer outlines and holes differ. */
export function ringArea(points: readonly Point2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer-Douglas-Peucker on an open line: keeps the ends and every point that is more than `tol` from the line. */
function simplifyLine(points: readonly Point2[], tol: number): Point2[] {
  const n = points.length;
  if (n < 3) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop() as [number, number];
    let worst = -1;
    let worstDistance = tol;
    for (let k = lo + 1; k < hi; k++) {
      const d = distanceToSegment(points[k]!, points[lo]!, points[hi]!);
      if (d > worstDistance) {
        worstDistance = d;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([lo, worst], [worst, hi]);
    }
  }
  return points.filter((_, k) => keep[k] === 1);
}

/** Simplifies a closed ring: it is split in two at the point farthest from its start, and each half is simplified. */
export function simplifyRing(points: readonly Point2[], tol: number): Point2[] {
  if (!(tol > 0) || points.length < 4) return points.slice();
  const start = points[0]!;
  let far = 0;
  let farDistance = -1;
  for (let k = 1; k < points.length; k++) {
    const d = Math.hypot(points[k]!.x - start.x, points[k]!.y - start.y);
    if (d > farDistance) {
      farDistance = d;
      far = k;
    }
  }
  const first = simplifyLine(points.slice(0, far + 1), tol);
  const second = simplifyLine([...points.slice(far), start], tol);
  return [...first, ...second.slice(1, -1)];
}

// ---- the whole trace --------------------------------------------------------------------------

/**
 * Traces a grey picture (`gray` has `width * height` values, row by row) into closed outlines in
 * picture pixels. An outline of a hole runs the opposite way to an outline of ink, and holes are
 * found by the filled shapes they are inside, so engraving a result fills it correctly (even-odd).
 * Settings that are not numbers fall back to the defaults. Never changes `gray`.
 */
export function traceGray(gray: ArrayLike<number>, width: number, height: number, options: TraceOptions): Path2D[] {
  if (!(width > 0) || !(height > 0) || gray.length < width * height) return [];
  const num = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
  const threshold = Math.min(255, Math.max(0, num(options.threshold, 128)));
  const grow = Math.max(1, num(options.blurScale ?? 1, 1));
  const sigma = Math.min(MAX_BLUR_PX, Math.min(MAX_SMOOTHING, Math.max(0, num(options.smoothing, 0))) * BLUR_PX_PER_STEP * grow);
  const minArea = Math.max(0, num(options.minAreaPx, 0));
  const tolerance = Math.max(0, num(options.tolerancePx, 0));

  const blurred = gaussianBlur(gray, width, height, sigma);
  // The field is positive where there is ink, with a border of "not ink" all the way round.
  const w = width + 2;
  const h = height + 2;
  const field = new Float32Array(w * h).fill(-1);
  const lift = options.invert ? threshold - 255 : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = blurred[y * width + x]!;
      field[(y + 1) * w + x + 1] = options.invert ? v + lift : threshold - v;
    }
  }

  const out: Path2D[] = [];
  for (const flat of contoursOf(field, w, h)) {
    // Grid units to picture pixels (sample (1, 1) is the middle of pixel (0, 0)), kept inside the picture.
    const points: Point2[] = [];
    for (let k = 0; k < flat.length; k += 2) {
      const x = Math.min(width, Math.max(0, flat[k]! - 0.5));
      const y = Math.min(height, Math.max(0, flat[k + 1]! - 0.5));
      const last = points[points.length - 1];
      if (!last || last.x !== x || last.y !== y) points.push({ x, y });
    }
    while (points.length > 1 && points[0]!.x === points[points.length - 1]!.x && points[0]!.y === points[points.length - 1]!.y) points.pop();
    if (points.length < 3) continue;
    if (Math.abs(ringArea(points)) < minArea) continue;
    const simple = simplifyRing(points, tolerance);
    if (simple.length < 3 || Math.abs(ringArea(simple)) <= 0) continue;
    out.push({ points: simple, closed: true });
  }
  return out;
}

/** How many outlines and points a result has. */
export function traceStats(paths: readonly Path2D[]): { paths: number; points: number } {
  let points = 0;
  for (const p of paths) points += p.points.length;
  return { paths: paths.length, points };
}

/** SVG path data ("M x y L x y ... Z" for each outline) for drawing a preview. */
export function pathsToSvgData(paths: readonly Path2D[], decimals = 1): string {
  const f = (v: number) => String(Number(v.toFixed(decimals)));
  const parts: string[] = [];
  for (const p of paths) {
    if (p.points.length < 2) continue;
    parts.push(`M${p.points.map((q) => `${f(q.x)} ${f(q.y)}`).join('L')}Z`);
  }
  return parts.join('');
}
