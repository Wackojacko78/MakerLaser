// Planning for the Shape tools panel: combining shapes (union, subtract, intersect, exclude),
// offsetting them, and repeating them around a circle. Pure TypeScript (no React, Konva or Tauri
// imports), so it is unit-tested in plain Node (tests/shapeOps.test.ts).
//
// Combining and offsetting are done by the geometry crate (the `boolean_paths` and `offset_paths`
// commands). This file only decides WHICH paths are sent, checks the selection, and turns what
// comes back into a new object. Circular arrays are plain arithmetic and are done here.
// Nothing here changes its inputs.
import { MAX_ARRAY_COPIES, type Bed } from '@/lib/arrange';
import { applyToPoint, boundsOf, chain, rotateAbout, translation, unionBounds, worldBounds, type Bounds } from '@/lib/transform';
import type { Path2D, Point2, WorkspaceObject } from '@/types/domain';

// ---- boolean operations ----------------------------------------------------------------------

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';
export const BOOLEAN_OPS: readonly BooleanOp[] = ['union', 'subtract', 'intersect', 'exclude'];
export const BOOLEAN_LABELS: Record<BooleanOp, string> = {
  union: 'Union',
  subtract: 'Subtract',
  intersect: 'Intersect',
  exclude: 'Exclude',
};
export const BOOLEAN_HELP: Record<BooleanOp, string> = {
  union: 'Merge the selected shapes into one.',
  subtract: 'Cut the other selected shapes out of the base shape (chosen under "Subtract from").',
  intersect: 'Keep only the part where all the shapes overlap.',
  exclude: 'Keep the parts that are not shared (the overlap is removed).',
};

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** A path that is a real shape: closed, with at least three points. */
const isShape = (p: Path2D): boolean => p.closed && p.points.length >= 3;

/** The closed paths of a vector object in workspace mm (its transform applied). Nothing for pictures. */
export function worldShapePaths(o: WorkspaceObject): Path2D[] {
  if (o.kind.type !== 'vector') return [];
  return o.kind.paths.filter(isShape).map((p) => ({ points: p.points.map((q) => applyToPoint(o.transform, q)), closed: true }));
}

/** True when a vector object has paths that are not closed shapes (lines, or paths of one or two points). */
export function hasLoosePaths(o: WorkspaceObject): boolean {
  return o.kind.type === 'vector' && o.kind.paths.some((p) => !isShape(p));
}

const quoted = (objects: readonly WorkspaceObject[]): string => objects.map((o) => `"${o.name}"`).join(', ');

export type BooleanPlan =
  | { ok: false; message: string }
  | {
      ok: true;
      op: BooleanOp;
      /** Every selected object: they are replaced by the result. */
      sourceIds: string[];
      /** One list of world-space closed paths per shape, the base shape first, then the rest back to front. */
      shapes: Path2D[][];
      /** The layer of the base shape. */
      layerId: string | null;
      /** The name of the base shape. */
      baseName: string;
      /** The names of the other shapes, in the order they are combined with the base. */
      otherNames: string[];
    };

/**
 * Checks that the selection can be combined and lists its shapes. The BASE shape comes first: it is
 * the one Subtract keeps (the others are cut out of it) and the one whose layer the result joins.
 * `baseId` chooses it; when it is missing, or is not one of the selected shapes, the base is the
 * shape furthest back (lowest in the Objects list). The other shapes follow, back to front.
 */
export function planBoolean(
  objects: readonly WorkspaceObject[],
  ids: readonly string[],
  op: BooleanOp,
  baseId: string | null = null,
): BooleanPlan {
  const wanted = new Set(ids);
  const chosen = objects.map((o, index) => ({ o, index })).filter(({ o }) => wanted.has(o.id));
  if (chosen.length < 2) return { ok: false, message: 'Select two or more shapes to combine them.' };
  const pictures = chosen.filter(({ o }) => o.kind.type !== 'vector').map(({ o }) => o);
  if (pictures.length > 0) return { ok: false, message: `Pictures cannot be combined: ${quoted(pictures)}.` };
  const locked = chosen.filter(({ o }) => o.locked).map(({ o }) => o);
  if (locked.length > 0) return { ok: false, message: `Unlock ${quoted(locked)} first: locked shapes are not changed.` };
  const loose = chosen.filter(({ o }) => hasLoosePaths(o) || worldShapePaths(o).length === 0).map(({ o }) => o);
  if (loose.length > 0) {
    return { ok: false, message: `${quoted(loose)} ${loose.length === 1 ? 'has' : 'have'} open lines. Only closed shapes can be combined.` };
  }
  const backToFront = [...chosen].sort((a, b) => a.o.z_index - b.o.z_index || a.index - b.index);
  const base = backToFront.find(({ o }) => o.id === baseId) ?? backToFront[0];
  if (!base) return { ok: false, message: 'Select two or more shapes to combine them.' };
  const ordered = [base, ...backToFront.filter((c) => c !== base)];
  return {
    ok: true,
    op,
    sourceIds: chosen.map(({ o }) => o.id),
    shapes: ordered.map(({ o }) => worldShapePaths(o)),
    layerId: base.o.layer_id,
    baseName: base.o.name,
    otherNames: ordered.slice(1).map(({ o }) => o.name),
  };
}

export interface BaseChoice {
  id: string;
  /** "Rectangle (100 x 80 mm)": the name and the size, so two shapes with the same name can be told apart. */
  label: string;
}

const oneDecimal = (v: number): string => String(Number(v.toFixed(1)));

/** The selected closed shapes that can be the base, back to front (the first is the default base). */
export function booleanChoices(objects: readonly WorkspaceObject[], ids: readonly string[]): BaseChoice[] {
  const wanted = new Set(ids);
  return objects
    .map((o, index) => ({ o, index }))
    .filter(({ o }) => wanted.has(o.id) && o.kind.type === 'vector' && worldShapePaths(o).length > 0)
    .sort((a, b) => a.o.z_index - b.o.z_index || a.index - b.index)
    .map(({ o }) => {
      const box = worldBounds(o);
      const size = box ? ` (${oneDecimal(box.maxX - box.minX)} \u00d7 ${oneDecimal(box.maxY - box.minY)} mm)` : '';
      return { id: o.id, label: `${o.name}${size}` };
    });
}

/** The base to use: the one picked if it is still selected, otherwise the first choice. */
export function chosenBase(choices: readonly BaseChoice[], picked: string | null): string | null {
  if (picked && choices.some((c) => c.id === picked)) return picked;
  return choices[0]?.id ?? null;
}

/** The line under the base picker: what is wrong with the selection, or exactly what Subtract will do. */
export function booleanHint(objects: readonly WorkspaceObject[], ids: readonly string[], baseId: string | null = null): string {
  const plan = planBoolean(objects, ids, 'subtract', baseId);
  if (!plan.ok) return plan.message;
  return `Subtract cuts ${plan.otherNames.map((n) => `"${n}"`).join(', ')} out of "${plan.baseName}". The result goes on the layer of "${plan.baseName}".`;
}

/** What to say when an operation leaves nothing. */
export function emptyResultMessage(op: BooleanOp): string {
  switch (op) {
    case 'intersect':
      return 'Nothing is left: the shapes do not overlap.';
    case 'subtract':
      return 'Nothing is left: the shapes cut out cover the base shape completely.';
    case 'exclude':
      return 'Nothing is left: the shapes are identical.';
    case 'union':
      return 'Nothing is left.';
  }
}

export interface ResultSpec {
  name: string;
  layerId: string | null;
  zIndex: number;
}

/**
 * A new vector object from paths in workspace mm. The paths are moved so the top-left corner of
 * their box is (0, 0) and the object's transform puts them back, like every other imported or
 * drawn object. Null when there is nothing to make.
 */
export function resultObject(paths: readonly Path2D[], spec: ResultSpec, newId: () => string = () => globalThis.crypto.randomUUID()): WorkspaceObject | null {
  const shapes = paths.filter(isShape);
  const box = boundsOf(shapes.flatMap((p) => p.points));
  if (shapes.length === 0 || !box) return null;
  const local = (q: Point2): Point2 => ({ x: round3(q.x - box.minX), y: round3(q.y - box.minY) });
  return {
    id: newId(),
    name: spec.name,
    kind: { type: 'vector', paths: shapes.map((p) => ({ points: p.points.map(local), closed: true })) },
    transform: translation(box.minX, box.minY),
    layer_id: spec.layerId,
    visible: true,
    locked: false,
    z_index: spec.zIndex,
  };
}

// ---- offset -----------------------------------------------------------------------------------

export const MAX_OFFSET_MM = 1000;

export interface OffsetItem {
  id: string;
  name: string;
  layerId: string | null;
  /** The closed paths, in workspace mm. */
  paths: Path2D[];
  /** The object also has open lines or tiny paths, which an offset leaves out. */
  hasLoose: boolean;
  locked: boolean;
}

export type OffsetPlan = { ok: false; message: string } | { ok: true; items: OffsetItem[]; skipped: string[] };

/** The selected shapes to offset (each on its own), and the names of the ones that are left out. */
export function planOffset(objects: readonly WorkspaceObject[], ids: readonly string[]): OffsetPlan {
  const wanted = new Set(ids);
  const chosen = objects.filter((o) => wanted.has(o.id));
  if (chosen.length === 0) return { ok: false, message: 'Select a shape to offset.' };
  const items: OffsetItem[] = [];
  const skipped: string[] = [];
  for (const o of chosen) {
    const paths = worldShapePaths(o);
    if (paths.length === 0) skipped.push(o.name);
    else items.push({ id: o.id, name: o.name, layerId: o.layer_id, paths, hasLoose: hasLoosePaths(o), locked: o.locked });
  }
  if (items.length === 0) {
    return { ok: false, message: `${quoted(chosen)} ${chosen.length === 1 ? 'is' : 'are'} not a closed shape, so there is nothing to offset.` };
  }
  return { ok: true, items, skipped };
}

const trimNumber = (v: number): string => String(Number(v.toFixed(3)));

/** "Square (offset +2 mm)", or "Square (border +2 mm)" for a border. */
export function offsetName(name: string, deltaMm: number, border = false): string {
  return `${name} (${border ? 'border' : 'offset'} ${deltaMm > 0 ? '+' : '-'}${trimNumber(Math.abs(deltaMm))} mm)`;
}

/** Problems with an offset distance typed in the panel (empty when fine). */
export function validateOffset(distanceMm: number): string[] {
  if (!Number.isFinite(distanceMm) || distanceMm <= 0) return ['The offset distance must be more than 0.'];
  if (distanceMm > MAX_OFFSET_MM) return [`The offset distance can be at most ${MAX_OFFSET_MM} mm.`];
  return [];
}

export type BorderPlan =
  /** Cut the second shape out of the first: `shapes` is what to send to `boolean_paths("subtract", ...)`. */
  | { kind: 'subtract'; shapes: Path2D[][] }
  /** No cutting needed: `paths` is the border as it is (empty when there is no border). */
  | { kind: 'direct'; paths: Path2D[] };

/**
 * The BORDER of an offset: the band between the old outline and the new one, with the middle left
 * empty. A shape that is engraved (filled) covers its whole area, so an offset shape on its own
 * would fill the middle as well; a border does not. Growing: the new shape minus the old one.
 * Shrinking: the old shape minus the new one. A shape that is shrunk away leaves no inner outline,
 * so its border is the whole shape.
 */
export function planBorder(original: readonly Path2D[], moved: readonly Path2D[], deltaMm: number): BorderPlan {
  if (moved.length === 0) return { kind: 'direct', paths: deltaMm < 0 ? [...original] : [] };
  return { kind: 'subtract', shapes: deltaMm > 0 ? [[...moved], [...original]] : [[...original], [...moved]] };
}

// ---- circular array ---------------------------------------------------------------------------

export const MAX_CIRCULAR_COUNT = 360;

export interface CircularOptions {
  /** Pieces in the pattern, the original included. */
  count: number;
  /** How far round the pattern goes, in degrees: 360 is a full circle. */
  angleDeg: number;
  /** The point the copies go round, in workspace mm. */
  centerX: number;
  centerY: number;
  /** Turn each copy to face the way it has gone round (like the numbers on a clock face). */
  rotateCopies: boolean;
}

export interface CircularPlan {
  /** The new objects (the originals are not included). Empty when there are errors. */
  copies: WorkspaceObject[];
  /** Box around the whole pattern, originals included. */
  bounds: Bounds | null;
  /** Distance from the centre to the middle of the selection, in mm. */
  radiusMm: number;
  /** The angle between one piece and the next. */
  stepDeg: number;
  errors: string[];
  warnings: string[];
}

/** Problems with the settings (empty when valid). `objectCount` is how many objects are selected. */
export function validateCircularOptions(o: CircularOptions, objectCount: number): string[] {
  if (!Number.isInteger(o.count) || o.count < 2 || o.count > MAX_CIRCULAR_COUNT) {
    return [`The number of pieces must be a whole number from 2 to ${MAX_CIRCULAR_COUNT}.`];
  }
  if (!Number.isFinite(o.angleDeg) || o.angleDeg <= 0 || o.angleDeg > 360) return ['The angle must be more than 0 and at most 360 degrees.'];
  if (![o.centerX, o.centerY].every((v) => Number.isFinite(v) && Math.abs(v) <= 100000)) return ['The centre must be a point on the bed.'];
  const copies = (o.count - 1) * objectCount;
  if (copies > MAX_ARRAY_COPIES) return [`That would make ${copies} copies. The limit is ${MAX_ARRAY_COPIES}.`];
  return [];
}

/** The angle between pieces: a full circle is shared out evenly, an arc runs from the first piece to the last. */
export function circularStep(count: number, angleDeg: number): number {
  return angleDeg >= 360 - 1e-9 ? 360 / count : angleDeg / (count - 1);
}

const none = (errors: string[], radiusMm = 0, stepDeg = 0): CircularPlan => ({ copies: [], bounds: null, radiusMm, stepDeg, errors, warnings: [] });

/**
 * Repeats the selection, as a group, round a centre point. The copies go clockwise on screen. With
 * `rotateCopies` each one is turned as it goes round; without it each keeps facing the way the
 * original does.
 */
export function planCircularArray(
  objects: readonly WorkspaceObject[],
  ids: readonly string[],
  o: CircularOptions,
  bed: Bed,
  newId: () => string = () => globalThis.crypto.randomUUID(),
): CircularPlan {
  const wanted = new Set(ids);
  const items = objects.filter((ob) => wanted.has(ob.id) && worldBounds(ob) !== null);
  const group = items.reduce<Bounds | null>((acc, ob) => unionBounds(acc, worldBounds(ob)), null);
  if (!group) return none(['Select something first.']);
  const errors = validateCircularOptions(o, items.length);
  if (errors.length > 0) return none(errors);
  const gx = (group.minX + group.maxX) / 2;
  const gy = (group.minY + group.maxY) / 2;
  const vx = gx - o.centerX;
  const vy = gy - o.centerY;
  const radiusMm = Math.hypot(vx, vy);
  const stepDeg = circularStep(o.count, o.angleDeg);
  if (radiusMm < 1e-6 && !o.rotateCopies) {
    return none(['The centre is the middle of the selection, so the copies would sit on top of each other. Move the centre, or turn the copies.'], radiusMm, stepDeg);
  }
  let z = objects.reduce((m, ob) => Math.max(m, ob.z_index), -1) + 1;
  const copies: WorkspaceObject[] = [];
  for (let i = 1; i < o.count; i++) {
    const deg = i * stepDeg;
    const rad = (deg * Math.PI) / 180;
    // Where the middle of the group goes: the same turn the rotation matrix makes (clockwise on screen).
    const dx = Math.cos(rad) * vx - Math.sin(rad) * vy - vx;
    const dy = Math.sin(rad) * vx + Math.cos(rad) * vy - vy;
    for (const object of items) {
      copies.push({
        ...object, // the shape itself (paths / image reference) is shared, never edited in place
        id: newId(),
        name: `${object.name} (copy ${i})`,
        transform: o.rotateCopies ? rotateAbout(object.transform, deg, o.centerX, o.centerY) : chain(object.transform, translation(dx, dy)),
        locked: false,
        z_index: z++,
      });
    }
  }
  const bounds = copies.reduce<Bounds | null>((acc, c) => unionBounds(acc, worldBounds(c)), group);
  const warnings: string[] = [];
  if (bounds && (bounds.minX < 0 || bounds.minY < 0 || bounds.maxX > bed.width || bounds.maxY > bed.height)) {
    warnings.push(`The pattern reaches outside the ${bed.width} \u00d7 ${bed.height} mm bed.`);
  }
  return { copies, bounds, radiusMm, stepDeg, errors: [], warnings };
}

/** The text under the array settings: what it will make, or what is wrong. */
export function circularSummary(plan: CircularPlan, objectCount: number): string {
  const first = plan.errors[0];
  if (first) return first;
  const per = objectCount > 1 ? ` (${plan.copies.length / objectCount} of each of the ${objectCount} objects)` : '';
  const text = `Makes ${plan.copies.length} new copies${per}, ${trimNumber(plan.stepDeg)}\u00b0 apart, on a circle of radius ${trimNumber(plan.radiusMm)} mm.`;
  return plan.warnings.length > 0 ? `${text} ${plan.warnings.join(' ')}` : text;
}

/** A message for the panel from whatever a failed command threw (Tauri sends the Rust error text). */
export function failure(e: unknown): string {
  if (typeof e === 'string' && e.length > 0) return e;
  if (e instanceof Error && e.message.length > 0) return e.message;
  return 'Something went wrong.';
}
