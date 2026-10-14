// Offset with "Border only" made repeatedly: each click steps the frame on to the next band, measured from the
// shape the frame came from. Pure TypeScript (no React, Konva or Tauri imports), so it is unit-tested in plain Node
// (tests/borderChain.test.ts).
//
// Why this is needed: a frame is a ring (an outline with a hole). Offsetting the ring as an ordinary shape moves its
// hole the other way, so a second click on a frame also made a band INSIDE the original shape, and a third made
// another one further in. Instead, the panel remembers the shape each frame was made from (the "base") and where its
// band lies, as signed distances from the base: 0 to 2 is the first band outside it, -2 to 0 the first band inside it.
// Outward steps to the band beyond (2 to 4), Inward steps to the band nearer the base (or the next one inside it).
// The memory lives in the panel, not in the project file: it is lost when the app closes, and a frame that has been
// edited or moved since is treated as an ordinary shape again (see chainEntryFor).
import type { Path2D, WorkspaceObject } from '@/types/domain';

/** How far a band reaches from the base shape, as signed distances in mm: positive is outside it, negative inside. */
export interface Band {
  lo: number;
  hi: number;
}

/** What is remembered about one frame. */
export interface ChainEntry extends Band {
  /** The shape the frame is a band of, in workspace mm (the closed paths the first click was made from). */
  base: Path2D[];
  /** The name of that shape. */
  baseName: string;
  /** What the frame looked like when it was made, so a frame that was edited or moved is not trusted. */
  sig: string;
}

/** Frames made by Border only, by the id of the frame's object. */
export type BorderChain = ReadonlyMap<string, ChainEntry>;

/** The most frames remembered (the oldest are forgotten first). Kept generous so Undo can bring one back. */
export const MAX_CHAIN_ENTRIES = 100;

/** The farthest a band may reach from its base, in mm (the same limit as one offset). */
export const MAX_BAND_MM = 1000;

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** A text that changes whenever the outline or the placement of a vector object does. Empty for anything else. */
export function objectSignature(o: WorkspaceObject): string {
  return o.kind.type === 'vector' ? JSON.stringify([o.kind.paths, o.transform]) : '';
}

/** What is remembered about this frame, or null when it is not a frame made by Border only, or has been edited or moved since. */
export function chainEntryFor(chain: BorderChain, o: WorkspaceObject): ChainEntry | null {
  const entry = chain.get(o.id);
  if (!entry) return null;
  const sig = objectSignature(o);
  return sig !== '' && sig === entry.sig ? entry : null;
}

/**
 * The band the next click makes. With no frame behind it, Outward is the band from the shape out to the distance and
 * Inward the band from the distance inside up to the shape. With one, Outward steps to the band beyond the frame and
 * Inward to the band on the other side of it (nearer the base, or on inside it).
 */
export function nextBand(entry: Band | null, direction: 1 | -1, distanceMm: number): Band {
  if (entry === null) return direction > 0 ? { lo: 0, hi: round6(distanceMm) } : { lo: round6(-distanceMm), hi: 0 };
  return direction > 0
    ? { lo: round6(entry.hi), hi: round6(entry.hi + distanceMm) }
    : { lo: round6(entry.lo - distanceMm), hi: round6(entry.lo) };
}

/** A reason a band cannot be made (it reaches too far from the base), or null. */
export function bandProblem(band: Band): string | null {
  if (!Number.isFinite(band.lo) || !Number.isFinite(band.hi) || Math.abs(band.lo) > MAX_BAND_MM || Math.abs(band.hi) > MAX_BAND_MM) {
    return `A frame can reach at most ${MAX_BAND_MM} mm from the shape it came from.`;
  }
  return null;
}

export type BandPlan =
  /** The outer edge is gone (a shape shrunk away): there is no frame. */
  | { kind: 'none' }
  /** The inner edge is gone (it shrunk away): the frame is the whole of the outer shape. */
  | { kind: 'whole'; paths: Path2D[] }
  /** Cut the second shape out of the first: `shapes` is what to send to `boolean_paths("subtract", ...)`. */
  | { kind: 'subtract'; shapes: Path2D[][] };

/** The frame between an outer and an inner outline of the base (each already offset by its distance). Nothing is changed. */
export function planBand(outer: readonly Path2D[], inner: readonly Path2D[]): BandPlan {
  if (outer.length === 0) return { kind: 'none' };
  if (inner.length === 0) return { kind: 'whole', paths: [...outer] };
  return { kind: 'subtract', shapes: [[...outer], [...inner]] };
}

const trim = (v: number): string => String(Number(v.toFixed(3)));

/** "Square (border +2 to +4 mm)" or "Square (border -2 to 0 mm)". */
export function bandName(baseName: string, band: Band): string {
  const sign = (v: number): string => (v > 0 ? `+${trim(v)}` : trim(v));
  return `${baseName} (border ${sign(band.lo)} to ${sign(band.hi)} mm)`;
}

/** Said under the buttons when a frame was stepped on from an earlier one: where the new band lies. */
export function bandNote(band: Band): string {
  if (band.lo >= 0) return `The frame is ${trim(band.lo)} to ${trim(band.hi)} mm outside the shape it came from.`;
  if (band.hi <= 0) return `The frame is ${trim(-band.hi)} to ${trim(-band.lo)} mm inside the shape it came from.`;
  return `The frame reaches from ${trim(-band.lo)} mm inside to ${trim(band.hi)} mm outside the shape it came from.`;
}

/** The memory after new frames are added: an id that is already there is replaced, and the oldest are dropped past the limit. */
export function chainAfter(old: BorderChain, added: ReadonlyArray<readonly [string, ChainEntry]>): Map<string, ChainEntry> {
  const next = new Map(old);
  for (const [id, entry] of added) {
    next.delete(id);
    next.set(id, entry);
  }
  while (next.size > MAX_CHAIN_ENTRIES) {
    const oldest = next.keys().next();
    if (oldest.done) break;
    next.delete(oldest.value);
  }
  return next;
}
