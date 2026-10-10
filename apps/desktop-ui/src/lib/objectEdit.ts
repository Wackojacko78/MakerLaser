// Editing text and shapes after they have been made. Text and shape objects keep the settings they
// were made from (the object's `source`) next to their outlines, so they can be opened again and
// changed. Pure TypeScript (no React, Konva or Tauri imports), so it is unit-tested in plain Node
// (tests/objectEdit.test.ts).

import { shapeName, clampShape } from '@/lib/shapes';
import { compose, decompose } from '@/lib/transform';
import type {
  Layer,
  ObjectSource,
  Path2D,
  ShapeSource,
  TextAlignment,
  TextSource,
  Transform2D,
  UUID,
  WorkspaceObject,
} from '@/types/domain';

export type LaserMode = 'fill' | 'score' | 'cut';

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const MAX_NAME_CHARS = 24;

/** The name a new text object gets: its first line, shortened. */
export function textObjectName(text: string): string {
  const firstLine = text.trim().split(/\r?\n/)[0] ?? '';
  return `Text: ${firstLine.length > MAX_NAME_CHARS ? firstLine.slice(0, MAX_NAME_CHARS) + '\u2026' : firstLine}`;
}

/** The name an object gets automatically from its settings. */
export function autoName(source: ObjectSource): string {
  return source.type === 'text' ? textObjectName(source.text) : shapeName(source);
}

/** What the object was made from, or null for imported artwork and images. */
export function objectSource(object: WorkspaceObject): ObjectSource | null {
  return object.kind.type === 'vector' ? (object.kind.source ?? null) : null;
}

/** How much the transform stretches along each axis (always positive, 1 when it cannot be told). */
export function axisScales(t: Transform2D): { sx: number; sy: number } {
  const d = decompose(t);
  const ok = (v: number): number => (Number.isFinite(v) && Math.abs(v) > 1e-9 ? Math.abs(v) : 1);
  return { sx: ok(d.scaleX), sy: ok(d.scaleY) };
}

/**
 * The same position and rotation (and mirroring) with the size reset to 1:1. Used after an edit,
 * when the new outlines are built at the size typed in the box and nothing is left to stretch.
 */
export function withoutStretch(t: Transform2D): Transform2D {
  const d = decompose(t);
  return compose({ x: d.x, y: d.y, rotationDeg: d.rotationDeg, scaleX: 1, scaleY: d.scaleY < 0 ? -1 : 1 });
}

/** The laser mode of the layer an object is on, or the fallback when it is on none of the three. */
export function layerMode(object: WorkspaceObject, layers: readonly Layer[], fallback: LaserMode): LaserMode {
  const kind = layers.find((l) => l.id === object.layer_id)?.kind;
  return kind === 'fill' || kind === 'score' || kind === 'cut' ? kind : fallback;
}

/** The values the Edit text box starts with. */
export interface TextForm {
  text: string;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  /** Letter height in mm, as typed. Any resizing done on the canvas is already included. */
  capHeight: string;
  align: TextAlignment;
  lineSpacing: string;
  mode: LaserMode;
}

const positive = (v: number, fallback: number): number => (Number.isFinite(v) && v > 0 ? v : fallback);

/**
 * The settings to keep with a text object, from what is typed in the box. The sizes are made safe
 * here: a blank or broken number would otherwise be saved as null, which the project file cannot hold.
 */
export function makeTextSource(form: Omit<TextForm, 'mode'>): TextSource {
  return {
    type: 'text',
    text: form.text,
    font_family: form.fontFamily,
    bold: form.bold,
    italic: form.italic,
    cap_height_mm: round3(positive(Number(form.capHeight), 10)),
    align: form.align,
    line_spacing: round3(positive(Number(form.lineSpacing), 1.2)),
  };
}

/** The Edit text box's starting values for a text object, or null when it is not one. */
export function textFromObject(object: WorkspaceObject, layers: readonly Layer[]): TextForm | null {
  const source = objectSource(object);
  if (!source || source.type !== 'text') return null;
  const { sx, sy } = axisScales(object.transform);
  const scale = Math.sqrt(sx * sy); // text is resized as a whole: use the overall stretch
  return {
    text: source.text,
    fontFamily: source.font_family,
    bold: source.bold,
    italic: source.italic,
    capHeight: String(round3(source.cap_height_mm * scale)),
    align: source.align === 'center' || source.align === 'right' ? source.align : 'left',
    lineSpacing: String(source.line_spacing > 0 ? source.line_spacing : 1.2),
    mode: layerMode(object, layers, 'fill'),
  };
}

/** The Edit shape box's starting values for a shape object, or null when it is not one. */
export function shapeFromObject(
  object: WorkspaceObject,
  layers: readonly Layer[],
): { source: ShapeSource; mode: LaserMode } | null {
  const source = objectSource(object);
  if (!source || source.type !== 'shape') return null;
  const { sx, sy } = axisScales(object.transform);
  return {
    // Stretching with the handles is folded into the size, so the numbers in the box are the real ones.
    source: clampShape({
      ...source,
      width_mm: source.width_mm * sx,
      height_mm: source.height_mm * sy,
      corner_radius_mm: source.corner_radius_mm * Math.min(sx, sy),
    }),
    mode: layerMode(object, layers, 'score'),
  };
}

/**
 * The object after an edit: new outlines and settings, the same place, rotation, layer, flags and
 * stacking. The size is exactly what the new outlines are (stretching is reset). The name follows
 * the text or shape unless it was changed by hand. `layerId` moves it to another layer; leave it
 * undefined to keep the layer it is on.
 */
export function applyEdit(
  object: WorkspaceObject,
  source: ObjectSource,
  paths: Path2D[],
  layerId?: UUID | null,
): WorkspaceObject {
  const old = objectSource(object);
  const keepsAutoName = old === null || object.name === autoName(old);
  return {
    ...object,
    name: keepsAutoName ? autoName(source) : object.name,
    kind: { type: 'vector', paths, source },
    transform: withoutStretch(object.transform),
    layer_id: layerId === undefined ? object.layer_id : layerId,
  };
}
