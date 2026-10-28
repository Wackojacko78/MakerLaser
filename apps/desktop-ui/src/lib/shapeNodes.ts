// Node editing, stage 2: what an ellipse or a rectangle with rounded corners is as nodes. Pure TypeScript (no React, Konva
// or Tauri imports), so it is unit-tested in plain Node (tests/shapeNodes.test.ts).
//
// A shape is kept as a recipe plus its outline, and the outline is hundreds of straight pieces for a circle. When a shape
// is converted to outlines it is far better to get the few curve nodes a person would draw: 4 smooth nodes for a circle
// or ellipse (8 for a large one), and for a rounded rectangle 8 nodes with the corners as curves. Polygons, stars and
// sharp rectangles have no curves, so they are left to the usual one corner node per point (see convertToOutlines in
// lib/nodePath.ts).
//
// A cubic Bezier with handles of length (4/3) * tan(step / 4) * r makes a circular arc of `step` radians to within a
// small fraction of r: 4 pieces (a quarter turn each) are within 0.027 % of the radius, 8 pieces within 0.0004 %. Stretching
// the circle into an ellipse is an affine map, and Beziers keep their shape under those, so the same rule serves ellipses.
import { clampShape } from '@/lib/shapes';
import type { NodePath, Path2D, PathNode, ShapeSource } from '@/types/domain';

/** A circle or ellipse bigger than this (the larger radius, mm) gets 8 nodes instead of 4, which keeps the error under about 0.01 mm. */
export const EIGHT_NODE_RADIUS_MM = 36;
/** How far the nodes' box may be from the outline's box (mm) before the recipe is not trusted to describe the outline. */
export const SHAPE_BOX_TOLERANCE_MM = 0.05;
const EPS = 1e-9;

const round3 = (v: number): number => Math.round(v * 1000) / 1000 + 0; // + 0 turns -0 into 0

/** Handle length for a circular arc of `stepRad` radians on a circle of radius 1. */
export const arcHandle = (stepRad: number): number => (4 / 3) * Math.tan(stepRad / 4);

/** The nodes of an ellipse filling the box 0..width x 0..height, starting at the top and running clockwise on screen. */
export function ellipseNodes(widthMm: number, heightMm: number): NodePath {
  const rx = widthMm / 2;
  const ry = heightMm / 2;
  const count = Math.max(rx, ry) > EIGHT_NODE_RADIUS_MM ? 8 : 4;
  const step = (2 * Math.PI) / count;
  const k = arcHandle(step);
  const nodes: PathNode[] = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + i * step;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const out = { x: round3(-rx * sin * k), y: round3(ry * cos * k) };
    nodes.push({
      x: round3(rx + rx * cos),
      y: round3(ry + ry * sin),
      in: { x: round3(-out.x), y: round3(-out.y) },
      out,
      mode: 'smooth',
    });
  }
  return { closed: true, nodes };
}

const close = (a: PathNode, b: PathNode): boolean => Math.hypot(a.x - b.x, a.y - b.y) < EPS;

/** Two nodes in the same place become one that keeps the first one's in handle and the second one's out handle. */
function join(a: PathNode, b: PathNode): PathNode {
  const node: PathNode = { x: a.x, y: a.y, mode: 'smooth' };
  if (a.in) node.in = a.in;
  if (b.out) node.out = b.out;
  return node;
}

/** Nodes that sit on top of the next one (a side as long as the corner radius is) are merged into one. */
function mergeCoincident(nodes: PathNode[]): PathNode[] {
  const out: PathNode[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (last && close(last, n)) out[out.length - 1] = join(last, n);
    else out.push(n);
  }
  while (out.length > 1) {
    const first = out[0] as PathNode;
    const last = out[out.length - 1] as PathNode;
    if (!close(first, last)) break;
    out.pop();
    out[0] = join(last, first);
  }
  return out;
}

/**
 * The nodes of a rectangle with rounded corners, starting where the outline does (the top edge, at the start of the top right
 * corner) and running clockwise on screen. Null when the corners are sharp: that is four plain corner nodes, and the outline
 * already says so.
 */
export function roundedRectangleNodes(widthMm: number, heightMm: number, radiusMm: number): NodePath | null {
  const r = Math.max(0, Math.min(radiusMm, widthMm / 2, heightMm / 2));
  if (r <= EPS) return null;
  const w = widthMm;
  const h = heightMm;
  const k = round3(arcHandle(Math.PI / 2) * r);
  const at = (x: number, y: number, inH?: { x: number; y: number }, outH?: { x: number; y: number }): PathNode => {
    const n: PathNode = { x: round3(x), y: round3(y) };
    if (inH) n.in = inH;
    if (outH) n.out = outH;
    return n;
  };
  const nodes = [
    at(w - r, 0, undefined, { x: k, y: 0 }),
    at(w, r, { x: 0, y: -k }),
    at(w, h - r, undefined, { x: 0, y: k }),
    at(w - r, h, { x: k, y: 0 }),
    at(r, h, undefined, { x: -k, y: 0 }),
    at(0, h - r, { x: 0, y: k }),
    at(0, r, undefined, { x: 0, y: -k }),
    at(r, 0, { x: -k, y: 0 }),
  ];
  return { closed: true, nodes: mergeCoincident(nodes) };
}

/** The box round the node positions (not the handles). */
function nodeBox(path: NodePath): { minX: number; minY: number; maxX: number; maxY: number } {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const n of path.nodes) {
    box.minX = Math.min(box.minX, n.x);
    box.minY = Math.min(box.minY, n.y);
    box.maxX = Math.max(box.maxX, n.x);
    box.maxY = Math.max(box.maxY, n.y);
  }
  return box;
}

function outlineBox(paths: readonly Path2D[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (const p of paths) {
    for (const q of p.points) {
      if (!box) box = { minX: q.x, minY: q.y, maxX: q.x, maxY: q.y };
      else {
        box.minX = Math.min(box.minX, q.x);
        box.minY = Math.min(box.minY, q.y);
        box.maxX = Math.max(box.maxX, q.x);
        box.maxY = Math.max(box.maxY, q.y);
      }
    }
  }
  return box;
}

/**
 * The curve nodes for a shape, or null when it has no curves (a sharp rectangle, a polygon, a star), or when its recipe does
 * not describe the outline it is stored with. That second check is a safeguard: the nodes are made from the recipe, and the
 * outline must be what the recipe makes (to a few hundredths of a millimetre) or the object would jump when converted.
 */
export function shapeNodes(source: ShapeSource, paths: readonly Path2D[]): NodePath | null {
  const s = clampShape(source);
  let nodes: NodePath | null = null;
  if (s.shape === 'ellipse') nodes = ellipseNodes(s.width_mm, s.height_mm);
  else if (s.shape === 'rectangle') nodes = roundedRectangleNodes(s.width_mm, s.height_mm, s.corner_radius_mm);
  if (!nodes) return null;
  const wanted = outlineBox(paths);
  if (!wanted || paths.length !== 1) return null;
  const got = nodeBox(nodes);
  const t = SHAPE_BOX_TOLERANCE_MM;
  const same =
    Math.abs(got.minX - wanted.minX) <= t &&
    Math.abs(got.minY - wanted.minY) <= t &&
    Math.abs(got.maxX - wanted.maxX) <= t &&
    Math.abs(got.maxY - wanted.maxY) <= t;
  return same ? nodes : null;
}
