import { describe, expect, it } from 'vitest';
import {
  BUTTON_ZOOM_STEP,
  MAX_ZOOM,
  MIN_ZOOM,
  PIXEL_VIEW_SCALE,
  actualSizeZoom,
  clampView,
  fitScale,
  fitView,
  isMagnified,
  panBy,
  pictureAt,
  screenPercent,
  viewBoxAttr,
  viewBoxOf,
  wheelFactor,
  zoomAt,
  type PreviewView,
} from '@/lib/previewView';

const W = 800;
const H = 600;
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
/** Where the picture point (px, py) sits across and down the view, from 0 to 1. */
const placeOf = (v: PreviewView, px: number, py: number) => {
  const b = viewBoxOf(v, W, H);
  return { u: (px - b.x) / b.w, t: (py - b.y) / b.h };
};

describe('fitView and viewBoxOf', () => {
  it('the fit view shows the whole picture', () => {
    expect(fitView(W, H)).toEqual({ zoom: 1, cx: 400, cy: 300 });
    expect(viewBoxOf(fitView(W, H), W, H)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });
  it('zoom 4 shows a quarter of the width and height', () => {
    const b = viewBoxOf({ zoom: 4, cx: 400, cy: 300 }, W, H);
    expect(b).toEqual({ x: 300, y: 225, w: 200, h: 150 });
  });
  it('writes the SVG attribute with the numbers trimmed', () => {
    expect(viewBoxAttr({ x: 0, y: 0, w: 800, h: 600 })).toBe('0 0 800 600');
    expect(viewBoxAttr({ x: 1 / 3, y: 2 / 3, w: 100.123456, h: 50 })).toBe('0.3333 0.6667 100.1235 50');
  });
});

describe('clampView', () => {
  it('keeps the zoom between 1 and 64', () => {
    expect(clampView({ zoom: 0.2, cx: 400, cy: 300 }, W, H).zoom).toBe(MIN_ZOOM);
    expect(clampView({ zoom: 500, cx: 400, cy: 300 }, W, H).zoom).toBe(MAX_ZOOM);
    expect(clampView({ zoom: 3, cx: 400, cy: 300 }, W, H).zoom).toBe(3);
  });
  it('keeps what is shown inside the picture', () => {
    const v = clampView({ zoom: 4, cx: -50, cy: 9999 }, W, H);
    expect(v).toEqual({ zoom: 4, cx: 100, cy: 525 });
    const b = viewBoxOf(v, W, H);
    expect(b.x).toBe(0);
    expect(b.y + b.h).toBe(H);
  });
  it('at zoom 1 the view is always the whole picture', () => {
    expect(clampView({ zoom: 1, cx: 10, cy: 10 }, W, H)).toEqual(fitView(W, H));
  });
  it('copes with numbers that are not numbers and with a picture that has no size', () => {
    expect(clampView({ zoom: Number.NaN, cx: Number.NaN, cy: Infinity }, W, H)).toEqual({ zoom: 1, cx: 400, cy: 300 });
    expect(clampView({ zoom: 2, cx: 1, cy: 1 }, 0, 0)).toEqual({ zoom: 1, cx: 0, cy: 0 });
    expect(clampView({ zoom: 2, cx: 1, cy: 1 }, W, Number.NaN)).toEqual({ zoom: 1, cx: 0, cy: 0 });
  });
});

describe('zoomAt: zoom towards the mouse', () => {
  it('keeps the point under the mouse exactly where it is', () => {
    const start: PreviewView = { zoom: 2, cx: 350, cy: 280 };
    for (const [px, py] of [[300, 250], [450, 330], [400, 300]] as const) {
      const before = placeOf(start, px, py);
      for (const f of [1.2, 1.5, 0.8]) {
        const after = placeOf(zoomAt(start, f, px, py, W, H), px, py);
        expect(near(after.u, before.u, 1e-9) && near(after.t, before.t, 1e-9)).toBe(true);
      }
    }
  });
  it('zooming in at a corner keeps that corner in the corner', () => {
    const v = zoomAt(fitView(W, H), 4, 0, 0, W, H);
    expect(v.zoom).toBe(4);
    expect(viewBoxOf(v, W, H)).toEqual({ x: 0, y: 0, w: 200, h: 150 });
    const far = zoomAt(fitView(W, H), 4, W, H, W, H);
    expect(viewBoxOf(far, W, H)).toEqual({ x: 600, y: 450, w: 200, h: 150 });
  });
  it('zooming in at the middle stays in the middle', () => {
    expect(zoomAt(fitView(W, H), 2, 400, 300, W, H)).toEqual({ zoom: 2, cx: 400, cy: 300 });
  });
  it('zooming in then out by the same factor goes back where it was', () => {
    const start: PreviewView = { zoom: 2, cx: 500, cy: 280 };
    const there = zoomAt(start, 1.5, 420, 260, W, H);
    const back = zoomAt(there, 1 / 1.5, 420, 260, W, H);
    expect(near(back.zoom, start.zoom) && near(back.cx, start.cx) && near(back.cy, start.cy)).toBe(true);
  });
  it('stops at the limits, and zooming right out shows the whole picture again', () => {
    expect(zoomAt({ zoom: 60, cx: 400, cy: 300 }, 10, 400, 300, W, H).zoom).toBe(MAX_ZOOM);
    expect(zoomAt({ zoom: 1.2, cx: 500, cy: 200 }, 0.01, 10, 10, W, H)).toEqual(fitView(W, H));
  });
  it('at the zoom limit the point under the mouse still does not move', () => {
    const start: PreviewView = { zoom: 50, cx: 333, cy: 222 };
    const before = placeOf(start, 340, 230);
    const out = zoomAt(start, 5, 340, 230, W, H);
    expect(out.zoom).toBe(MAX_ZOOM);
    const after = placeOf(out, 340, 230);
    expect(near(after.u, before.u, 1e-9) && near(after.t, before.t, 1e-9)).toBe(true);
  });
  it('a factor that is not a number, or not above zero, changes nothing', () => {
    const start: PreviewView = { zoom: 3, cx: 300, cy: 200 };
    for (const f of [Number.NaN, 0, -2, Infinity, -Infinity]) {
      expect(zoomAt(start, f, 100, 100, W, H)).toEqual(start);
    }
  });
  it('a point that is not a number zooms about the middle of the view', () => {
    const start: PreviewView = { zoom: 2, cx: 300, cy: 200 };
    expect(zoomAt(start, 2, Number.NaN, Number.NaN, W, H)).toEqual({ zoom: 4, cx: 300, cy: 200 });
  });
  it('does not change the view it is given', () => {
    const start: PreviewView = { zoom: 2, cx: 300, cy: 200 };
    zoomAt(start, 2, 100, 100, W, H);
    expect(start).toEqual({ zoom: 2, cx: 300, cy: 200 });
  });
  it('the zoom buttons step by one and a half', () => {
    expect(BUTTON_ZOOM_STEP).toBe(1.5);
    expect(zoomAt(fitView(W, H), BUTTON_ZOOM_STEP, 400, 300, W, H).zoom).toBe(1.5);
  });
});

describe('pictureAt: which picture point is under the screen point', () => {
  // A box the same shape as the picture: 320 x 240 on the screen, at (100, 50).
  const box = { left: 100, top: 50, width: 320, height: 240 };
  it('with the whole picture showing, the corners of the box are the corners of the picture', () => {
    expect(pictureAt(fitView(W, H), W, H, box, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(pictureAt(fitView(W, H), W, H, box, 420, 290)).toEqual({ x: 800, y: 600 });
    expect(pictureAt(fitView(W, H), W, H, box, 260, 170)).toEqual({ x: 400, y: 300 });
  });
  it('when zoomed in, the corners of the box are the corners of the part shown', () => {
    const view: PreviewView = { zoom: 4, cx: 300, cy: 200 };
    const vb = viewBoxOf(view, W, H);
    const a = pictureAt(view, W, H, box, 100, 50);
    const b = pictureAt(view, W, H, box, 420, 290);
    expect(near(a!.x, vb.x) && near(a!.y, vb.y)).toBe(true);
    expect(near(b!.x, vb.x + vb.w) && near(b!.y, vb.y + vb.h)).toBe(true);
  });
  it('allows for the bars when the box is a different shape (the picture is centred)', () => {
    const wide = { left: 0, top: 0, width: 800, height: 300 }; // the 800 x 600 picture fits at half size, 400 wide in the middle
    expect(pictureAt(fitView(W, H), W, H, wide, 200, 0)).toEqual({ x: 0, y: 0 });
    expect(pictureAt(fitView(W, H), W, H, wide, 600, 300)).toEqual({ x: 800, y: 600 });
    const bar = pictureAt(fitView(W, H), W, H, wide, 100, 150)!; // in the bar at the left: outside the picture
    expect(bar.x).toBeLessThan(0);
  });
  it('is the opposite of drawing: zooming at that point keeps it under the pointer', () => {
    let view: PreviewView = { zoom: 2, cx: 350, cy: 280 };
    const screen = { x: 180, y: 120 };
    const first = pictureAt(view, W, H, box, screen.x, screen.y)!;
    // Several wheel clicks in a row, each using the newest view, as the preview does.
    for (let i = 0; i < 6; i++) {
      const at = pictureAt(view, W, H, box, screen.x, screen.y)!;
      view = zoomAt(view, 1.22, at.x, at.y, W, H);
    }
    const last = pictureAt(view, W, H, box, screen.x, screen.y)!;
    expect(near(first.x, last.x, 1e-6) && near(first.y, last.y, 1e-6)).toBe(true);
  });
  it('is null when the box or the picture has no size, and when a number is not a number', () => {
    expect(pictureAt(fitView(W, H), W, H, { left: 0, top: 0, width: 0, height: 10 }, 5, 5)).toBeNull();
    expect(pictureAt(fitView(W, H), 0, 0, box, 5, 5)).toBeNull();
    expect(pictureAt(fitView(W, H), W, H, box, Number.NaN, 5)).toBeNull();
  });
});

describe('panBy', () => {
  it('moves the view', () => {
    const v = panBy({ zoom: 4, cx: 400, cy: 300 }, 30, -20, W, H);
    expect(v).toEqual({ zoom: 4, cx: 430, cy: 280 });
  });
  it('stops at the edge of the picture', () => {
    expect(panBy({ zoom: 4, cx: 400, cy: 300 }, 5000, 5000, W, H)).toEqual({ zoom: 4, cx: 700, cy: 525 });
    expect(panBy({ zoom: 4, cx: 400, cy: 300 }, -5000, -5000, W, H)).toEqual({ zoom: 4, cx: 100, cy: 75 });
  });
  it('does nothing when the whole picture is shown', () => {
    expect(panBy(fitView(W, H), 100, 100, W, H)).toEqual(fitView(W, H));
  });
  it('ignores a distance that is not a number', () => {
    expect(panBy({ zoom: 4, cx: 400, cy: 300 }, Number.NaN, Infinity, W, H)).toEqual({ zoom: 4, cx: 400, cy: 300 });
  });
});

describe('wheelFactor', () => {
  it('wheel up zooms in and wheel down zooms out', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(0)).toBe(1);
  });
  it('one notch of a normal wheel zooms by a bit over a fifth, and one notch back undoes it', () => {
    expect(near(wheelFactor(-100), Math.exp(0.2), 1e-12)).toBe(true);
    expect(near(wheelFactor(-100) * wheelFactor(100), 1, 1e-12)).toBe(true);
  });
  it('a wheel that counts in lines or pages zooms more per click', () => {
    expect(wheelFactor(-3, 1)).toBeGreaterThan(wheelFactor(-3, 0));
    expect(wheelFactor(-1, 2)).toBeGreaterThan(wheelFactor(-1, 1));
  });
  it('one very fast spin never zooms by more than a step of about 1.8', () => {
    expect(wheelFactor(-100000)).toBeCloseTo(Math.exp(0.6), 12);
    expect(wheelFactor(100000)).toBeCloseTo(Math.exp(-0.6), 12);
  });
  it('a wheel that is not a number does nothing', () => {
    expect(wheelFactor(Number.NaN)).toBe(1);
    expect(wheelFactor(Infinity)).toBe(1);
  });
});

describe('sizes on the screen', () => {
  // An 800 x 600 picture in a 320 x 240 box: 0.4 screen pixels for each picture pixel.
  it('works out the size of a picture pixel when the picture fits', () => {
    expect(fitScale(W, H, 320, 240)).toBe(0.4);
    expect(fitScale(W, H, 320, 120)).toBe(0.2);
    expect(fitScale(W, H, 0, 240)).toBe(0);
    expect(fitScale(0, H, 320, 240)).toBe(0);
    expect(fitScale(W, H, Number.NaN, 240)).toBe(0);
  });
  it('1:1 is the zoom that shows one picture pixel for each screen pixel', () => {
    expect(actualSizeZoom(W, H, 320, 240)).toBe(2.5);
    const view = { zoom: actualSizeZoom(W, H, 320, 240), cx: 400, cy: 300 };
    expect(screenPercent(view, W, H, 320, 240)).toBe(100);
  });
  it('1:1 is kept within the limits and is 1 when the box has no size', () => {
    expect(actualSizeZoom(W, H, 1, 1)).toBe(MAX_ZOOM);
    expect(actualSizeZoom(100, 100, 400, 400)).toBe(MIN_ZOOM);
    expect(actualSizeZoom(W, H, 0, 0)).toBe(1);
  });
  it('shows the zoom as a percentage of the real pixels', () => {
    expect(screenPercent(fitView(W, H), W, H, 320, 240)).toBe(40);
    expect(screenPercent({ zoom: 5, cx: 400, cy: 300 }, W, H, 320, 240)).toBe(200);
    expect(screenPercent(fitView(W, H), W, H, 0, 0)).toBe(0);
  });
  it('draws the picture as sharp squares only when each pixel is big on the screen', () => {
    expect(PIXEL_VIEW_SCALE).toBe(2);
    expect(isMagnified(fitView(W, H), W, H, 320, 240)).toBe(false);
    expect(isMagnified({ zoom: 4, cx: 400, cy: 300 }, W, H, 320, 240)).toBe(false); // 1.6
    expect(isMagnified({ zoom: 5, cx: 400, cy: 300 }, W, H, 320, 240)).toBe(true); // 2.0
    expect(isMagnified({ zoom: 50, cx: 400, cy: 300 }, W, H, 0, 0)).toBe(false);
  });
});
