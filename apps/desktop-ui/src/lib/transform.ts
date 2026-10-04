// Pure 2D affine maths and object bounds. No React, Konva or Tauri imports, so everything
// here is unit-tested in plain Node (tests/transform.test.ts).
//
// Convention (identical to packages/common `Transform2D`): a transform maps
//   x' = a*x + c*y + e ;  y' = b*x + d*y + f
// in a Y-down workspace measured in millimetres. Positive rotation is clockwise on screen.

import type { ImageObjectData, Point2, Transform2D, WorkspaceObject } from '@/types/domain';

export const IDENTITY: Transform2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const translation = (tx: number, ty: number): Transform2D => ({ ...IDENTITY, e: tx, f: ty });
export const scaling = (sx: number, sy: number): Transform2D => ({ ...IDENTITY, a: sx, d: sy });

export function rotation(deg: number): Transform2D {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** Composition: a point is transformed by `first`, then by `second`. */
export function chain(first: Transform2D, second: Transform2D): Transform2D {
  return {
    a: second.a * first.a + second.c * first.b,
    b: second.b * first.a + second.d * first.b,
    c: second.a * first.c + second.c * first.d,
    d: second.b * first.c + second.d * first.d,
    e: second.a * first.e + second.c * first.f + second.e,
    f: second.b * first.e + second.d * first.f + second.f,
  };
}

export function applyToPoint(t: Transform2D, p: Point2): Point2 {
  return { x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f };
}

/** Rotation + independent scales + translation: what Konva nodes expose. */
export interface Decomposed {
  x: number;
  y: number;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Splits a matrix of the form `Translate * Rotate * Scale(sx, sy)` into those parts.
 * `scaleY` is negative for mirrored objects. Shear is not representable (importers bake
 * shear into the geometry, so object transforms never contain any).
 */
export function decompose(t: Transform2D): Decomposed {
  const scaleX = Math.hypot(t.a, t.b) || 1;
  const rotationDeg = (Math.atan2(t.b, t.a) * 180) / Math.PI;
  const scaleY = (t.a * t.d - t.b * t.c) / scaleX;
  return { x: t.e, y: t.f, rotationDeg, scaleX, scaleY };
}

/** Inverse of {@link decompose}. */
export function compose(d: Decomposed): Transform2D {
  const r = (d.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return {
    a: d.scaleX * cos,
    b: d.scaleX * sin,
    c: -d.scaleY * sin,
    d: d.scaleY * cos,
    e: d.x,
    f: d.y,
  };
}

/** Applies `scale` about the world point (ox, oy) after the existing transform. */
export function scaleAbout(t: Transform2D, sx: number, sy: number, ox: number, oy: number): Transform2D {
  return chain(chain(chain(t, translation(-ox, -oy)), scaling(sx, sy)), translation(ox, oy));
}

/** Rotates by `deg` about the world point (cx, cy) after the existing transform. */
export function rotateAbout(t: Transform2D, deg: number, cx: number, cy: number): Transform2D {
  return chain(chain(chain(t, translation(-cx, -cy)), rotation(deg)), translation(cx, cy));
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const boundsWidth = (b: Bounds) => b.maxX - b.minX;
export const boundsHeight = (b: Bounds) => b.maxY - b.minY;

export function boundsOf(points: Iterable<Point2>): Bounds | null {
  let b: Bounds | null = null;
  for (const p of points) {
    if (b === null) b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    else {
      if (p.x < b.minX) b.minX = p.x;
      if (p.y < b.minY) b.minY = p.y;
      if (p.x > b.maxX) b.maxX = p.x;
      if (p.y > b.maxY) b.maxY = p.y;
    }
  }
  return b;
}

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

export function imageSizeMm(img: ImageObjectData): [number, number] {
  const dpi = img.dpi > 0 ? img.dpi : 96;
  return [(img.width_px / dpi) * 25.4, (img.height_px / dpi) * 25.4];
}

/** Axis-aligned bounds of an object in workspace millimetres (transform applied). */
export function worldBounds(o: WorkspaceObject): Bounds | null {
  if (o.kind.type === 'image') {
    const [w, h] = imageSizeMm(o.kind);
    const corners = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ].map((p) => applyToPoint(o.transform, p));
    return boundsOf(corners);
  }
  let result: Bounds | null = null;
  for (const path of o.kind.paths) {
    result = unionBounds(result, boundsOf(path.points.map((p) => applyToPoint(o.transform, p))));
  }
  return result;
}

/** Ids of the visible objects whose bounds touch `box` (workspace mm): rubber-band select. */
export function objectsInBox(objects: WorkspaceObject[], box: Bounds): string[] {
  const ids: string[] = [];
  for (const o of objects) {
    if (!o.visible) continue;
    const b = worldBounds(o);
    if (b && boundsIntersect(b, box)) ids.push(o.id);
  }
  return ids;
}

/** Pan and zoom that centre a `bedW` x `bedH` mm bed in a `viewW` x `viewH` px viewport. */
export function fitView(
  viewW: number,
  viewH: number,
  bedW: number,
  bedH: number,
  pxPerMm: number,
  marginPx = 36,
): { x: number; y: number; scale: number } {
  const contentW = bedW * pxPerMm;
  const contentH = bedH * pxPerMm;
  const scale = Math.max(
    0.05,
    Math.min((viewW - 2 * marginPx) / contentW, (viewH - 2 * marginPx) / contentH),
  );
  return { scale, x: (viewW - contentW * scale) / 2, y: (viewH - contentH * scale) / 2 };
}

/** Where the machine's (0,0) is on the Y-down workspace, and which way its axes point. */
export function originInfo(machine: { bed_width_mm: number; bed_height_mm: number; origin: string }): {
  x: number;
  y: number;
  /** Screen direction of machine +X: +1 right, -1 left. */
  xDir: 1 | -1;
  /** Screen direction of machine +Y: +1 down, -1 up. */
  yDir: 1 | -1;
} {
  const right = machine.origin === 'top_right' || machine.origin === 'bottom_right';
  const bottom = machine.origin === 'bottom_left' || machine.origin === 'bottom_right';
  return {
    x: right ? machine.bed_width_mm : 0,
    y: bottom ? machine.bed_height_mm : 0,
    xDir: right ? -1 : 1,
    yDir: bottom ? -1 : 1,
  };
}
