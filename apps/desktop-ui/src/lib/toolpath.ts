// Preparation of the toolpath preview data for fast drawing. Pure and unit-tested.
import type { PreviewSegment } from '@/types/domain';

export const KIND_TRAVEL = 0;
export const KIND_CUT = 1;
export const KIND_SCORE = 2;
export const KIND_FILL = 3;
export const KIND_ENGRAVE = 4;

export interface PreparedToolpath {
  /** x0, y0, x1, y1 per segment, in workspace mm. */
  coords: Float32Array;
  kinds: Uint8Array;
  count: number;
}

export function prepareToolpath(segments: PreviewSegment[]): PreparedToolpath {
  const count = segments.length;
  const coords = new Float32Array(count * 4);
  const kinds = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const s = segments[i];
    coords[i * 4] = s[0];
    coords[i * 4 + 1] = s[1];
    coords[i * 4 + 2] = s[2];
    coords[i * 4 + 3] = s[3];
    kinds[i] = s[4];
  }
  return { coords, kinds, count };
}

/** Number of segments to draw for a replay fraction in [0, 1]. */
export function drawnCount(p: PreparedToolpath, fraction: number): number {
  return Math.max(0, Math.min(p.count, Math.round(p.count * fraction)));
}

/** Indices of segments with an end point outside the bed (safety violations). */
export function outsideBed(p: PreparedToolpath, width: number, height: number, tolerance = 0.05): number[] {
  const out: number[] = [];
  const bad = (x: number, y: number) =>
    x < -tolerance || y < -tolerance || x > width + tolerance || y > height + tolerance;
  for (let i = 0; i < p.count; i++) {
    const o = i * 4;
    if (bad(p.coords[o], p.coords[o + 1]) || bad(p.coords[o + 2], p.coords[o + 3])) out.push(i);
  }
  return out;
}

export interface PathMarker {
  x: number;
  y: number;
  /** 1-based cut order. */
  n: number;
}

/** Start point of every cut/score path, numbered in execution order (capped for speed). */
export function pathStartMarkers(p: PreparedToolpath, cap = 300): PathMarker[] {
  const markers: PathMarker[] = [];
  let n = 0;
  let prevWasWork = false;
  let px = NaN;
  let py = NaN;
  for (let i = 0; i < p.count; i++) {
    const o = i * 4;
    const work = p.kinds[i] === KIND_CUT || p.kinds[i] === KIND_SCORE;
    if (work) {
      const continues = prevWasWork && Math.hypot(p.coords[o] - px, p.coords[o + 1] - py) < 0.02;
      if (!continues) {
        n++;
        if (markers.length < cap) markers.push({ x: p.coords[o], y: p.coords[o + 1], n });
      }
      px = p.coords[o + 2];
      py = p.coords[o + 3];
    }
    prevWasWork = work;
  }
  return markers;
}
