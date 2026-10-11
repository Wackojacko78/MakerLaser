// The zoom and pan of the Trace preview. Pure TypeScript (no React, Konva or DOM imports), so it is
// unit-tested in plain Node (tests/previewView.test.ts). The interactive preview that uses it is
// components/ZoomPreview.tsx.
//
// The view is the part of the picture you are looking at: `zoom` times (1 = the whole picture fits)
// and the picture point `cx`, `cy` at the middle of what is shown. Everything is in pixels of the
// picture that was traced, so the outlines and the picture zoom together.

export interface PreviewView {
  /** 1 shows the whole picture; 2 shows half the width and half the height of it, and so on. */
  zoom: number;
  /** The picture point at the middle of the view. */
  cx: number;
  cy: number;
}

/** The part of the picture that is shown, in picture pixels (an SVG viewBox). */
export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 64;
/** One step of the zoom buttons. */
export const BUTTON_ZOOM_STEP = 1.5;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

/** The view that shows the whole picture. */
export function fitView(width: number, height: number): PreviewView {
  return { zoom: 1, cx: width / 2, cy: height / 2 };
}

/** The view kept within its limits: zoom from 1 to 64, and the part shown never leaves the picture. */
export function clampView(view: PreviewView, width: number, height: number): PreviewView {
  if (!(width > 0) || !(height > 0)) return { zoom: 1, cx: 0, cy: 0 };
  const zoom = clamp(finite(view.zoom, 1), MIN_ZOOM, MAX_ZOOM);
  const w = width / zoom;
  const h = height / zoom;
  return {
    zoom,
    cx: clamp(finite(view.cx, width / 2), w / 2, width - w / 2),
    cy: clamp(finite(view.cy, height / 2), h / 2, height - h / 2),
  };
}

/** The part of the picture the view shows. */
export function viewBoxOf(view: PreviewView, width: number, height: number): ViewBox {
  const v = clampView(view, width, height);
  const w = width / v.zoom;
  const h = height / v.zoom;
  return { x: v.cx - w / 2, y: v.cy - h / 2, w, h };
}

/** The text of an SVG viewBox attribute. */
export function viewBoxAttr(box: ViewBox): string {
  const f = (n: number) => String(Number(n.toFixed(4)));
  return `${f(box.x)} ${f(box.y)} ${f(box.w)} ${f(box.h)}`;
}

/** The preview's box on the screen (what getBoundingClientRect gives). */
export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The picture point under the screen point (x, y), for a view drawn with "meet" (the part shown is fitted
 * into the box and centred, with bars at the sides or the top if the shapes differ). It works from the VIEW,
 * not from what is drawn, so it is right even when several wheel clicks arrive before the screen is redrawn.
 * Null when the box has no size.
 */
export function pictureAt(view: PreviewView, width: number, height: number, box: ScreenBox, x: number, y: number): { x: number; y: number } | null {
  if (!(box.width > 0) || !(box.height > 0) || !(width > 0) || !(height > 0)) return null;
  const vb = viewBoxOf(view, width, height);
  const scale = Math.min(box.width / vb.w, box.height / vb.h);
  const offsetX = (box.width - vb.w * scale) / 2;
  const offsetY = (box.height - vb.h * scale) / 2;
  const px = vb.x + (x - box.left - offsetX) / scale;
  const py = vb.y + (y - box.top - offsetY) / scale;
  return Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null;
}

/**
 * Zooms by `factor` (above 1 zooms in) so that the picture point (px, py) stays exactly where it is on
 * the screen: zoom towards the mouse. A point that is not a number zooms about the middle of the view.
 */
export function zoomAt(view: PreviewView, factor: number, px: number, py: number, width: number, height: number): PreviewView {
  const start = clampView(view, width, height);
  if (!(width > 0) || !(height > 0)) return start;
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const before = viewBoxOf(start, width, height);
  const x = Number.isFinite(px) ? px : start.cx;
  const y = Number.isFinite(py) ? py : start.cy;
  const zoom = clamp(start.zoom * f, MIN_ZOOM, MAX_ZOOM);
  const w = width / zoom;
  const h = height / zoom;
  // Where the point sits across and down the view (0 to 1): it must sit in the same place afterwards.
  const u = (x - before.x) / before.w;
  const t = (y - before.y) / before.h;
  return clampView({ zoom, cx: x - u * w + w / 2, cy: y - t * h + h / 2 }, width, height);
}

/** Moves the view by (dx, dy) picture pixels, but never off the picture. */
export function panBy(view: PreviewView, dx: number, dy: number, width: number, height: number): PreviewView {
  const v = clampView(view, width, height);
  return clampView({ zoom: v.zoom, cx: v.cx + finite(dx, 0), cy: v.cy + finite(dy, 0) }, width, height);
}

/**
 * How much one turn of the mouse wheel zooms. Wheel up (a negative `deltaY`) zooms in. `deltaMode` is the
 * browser's: 0 pixels, 1 lines, 2 pages. One notch of a normal wheel is a bit over a fifth.
 */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY)) return 1;
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-clamp(pixels, -300, 300) * 0.002);
}

// ---- sizes on the screen ----------------------------------------------------------------------

/** Screen (CSS) pixels for one picture pixel when the whole picture fits the box. 0 when the box has no size. */
export function fitScale(width: number, height: number, boxW: number, boxH: number): number {
  if (!(width > 0) || !(height > 0) || !(boxW > 0) || !(boxH > 0)) return 0;
  return Math.min(boxW / width, boxH / height);
}

/** The zoom that shows one picture pixel for each screen pixel ("1:1"), kept within the limits. */
export function actualSizeZoom(width: number, height: number, boxW: number, boxH: number): number {
  const s = fitScale(width, height, boxW, boxH);
  return s > 0 ? clamp(1 / s, MIN_ZOOM, MAX_ZOOM) : 1;
}

/** The zoom as shown to the user: 100 means one picture pixel for each screen pixel. */
export function screenPercent(view: PreviewView, width: number, height: number, boxW: number, boxH: number): number {
  return Math.round(fitScale(width, height, boxW, boxH) * clampView(view, width, height).zoom * 100);
}

/** True when each picture pixel is drawn at least this many screen pixels wide: the picture is then drawn as sharp squares. */
export const PIXEL_VIEW_SCALE = 2;
export function isMagnified(view: PreviewView, width: number, height: number, boxW: number, boxH: number): boolean {
  return fitScale(width, height, boxW, boxH) * clampView(view, width, height).zoom >= PIXEL_VIEW_SCALE;
}
