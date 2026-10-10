import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  boundsToClientRect,
  buildShapeObject,
  buildTextObject,
  centredBox,
  changeShapeKind,
  defaultTextForm,
  dimensionLabel,
  evalExpression,
  formatNumber,
  gestureBox,
  isDragGesture,
  overlayPlacement,
  patchShape,
  pickLayerId,
  placeInside,
  readShapeField,
  shapeFields,
  wrapTab,
  type NewObjectContext,
  type TextRenderer,
} from '../src/lib/inlineEdit';
import { SHAPE_KINDS, SHAPE_MAX_MM, SHAPE_MIN_MM, defaultShape } from '../src/lib/shapes';
import type { Layer } from '../src/types/domain';

const layer = (id: string, kind: Layer['kind'], name = id): Layer => ({ id, kind, name }) as unknown as Layer;
const LAYERS = [layer('T-score', 'score', 'TEST score'), layer('score', 'score'), layer('fill', 'fill'), layer('cut', 'cut')];
const CTX: NewObjectContext = { id: 'new-1', layers: LAYERS, nextZ: 7, bed: { width: 300, height: 200 }, testPrefix: 'TEST' };

describe('isDragGesture', () => {
  it('is a click until the pointer has moved a few screen pixels', () => {
    expect(isDragGesture({ x: 10, y: 10 }, { x: 10, y: 10 }, 4)).toBe(false);
    expect(isDragGesture({ x: 10, y: 10 }, { x: 10.5, y: 10 }, 4)).toBe(false); // 2 px
    expect(isDragGesture({ x: 10, y: 10 }, { x: 11, y: 10 }, 4)).toBe(true); // 4 px
    expect(DRAG_THRESHOLD_PX).toBe(4);
  });

  it('depends on the zoom: the same mm is more pixels when zoomed in', () => {
    expect(isDragGesture({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 2)).toBe(false);
    expect(isDragGesture({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 20)).toBe(true);
  });
});

describe('gestureBox', () => {
  it('is the same box whichever way the drag goes', () => {
    const expected = { x: 10, y: 20, w: 30, h: 15 };
    expect(gestureBox({ x: 10, y: 20 }, { x: 40, y: 35 }, false)).toEqual(expected);
    expect(gestureBox({ x: 40, y: 35 }, { x: 10, y: 20 }, false)).toEqual(expected);
    expect(gestureBox({ x: 40, y: 20 }, { x: 10, y: 35 }, false)).toEqual(expected);
    expect(gestureBox({ x: 10, y: 35 }, { x: 40, y: 20 }, false)).toEqual(expected);
  });

  it('rounds to 0.1 mm so dragged shapes have clean numbers', () => {
    const b = gestureBox({ x: 0, y: 0 }, { x: 37.4837, y: 12.0449 }, false);
    expect(b.w).toBe(37.5);
    expect(b.h).toBe(12);
  });

  it('keeps a minimum size', () => {
    const b = gestureBox({ x: 5, y: 5 }, { x: 5.001, y: 5 }, false);
    expect(b.w).toBe(SHAPE_MIN_MM);
    expect(b.h).toBe(SHAPE_MIN_MM);
  });

  it('makes a square from the longer side and keeps the corner under the start in every direction', () => {
    expect(gestureBox({ x: 10, y: 10 }, { x: 40, y: 25 }, true)).toEqual({ x: 10, y: 10, w: 30, h: 30 });
    expect(gestureBox({ x: 40, y: 40 }, { x: 25, y: 10 }, true)).toEqual({ x: 10, y: 10, w: 30, h: 30 });
    expect(gestureBox({ x: 40, y: 10 }, { x: 35, y: 40 }, true)).toEqual({ x: 10, y: 10, w: 30, h: 30 });
  });
});

describe('centredBox and placeInside', () => {
  it('centres a default-sized box on the click', () => {
    expect(centredBox({ x: 100, y: 50 }, 40, 20)).toEqual({ x: 80, y: 40, w: 40, h: 20 });
  });

  it('leaves a box that fits alone', () => {
    const box = { x: 10, y: 10, w: 40, h: 20 };
    expect(placeInside(box, { width: 300, height: 200 })).toEqual(box);
  });

  it('pulls a box back onto the bed from every side', () => {
    const bed = { width: 300, height: 200 };
    expect(placeInside({ x: -20, y: -5, w: 40, h: 20 }, bed)).toEqual({ x: 0, y: 0, w: 40, h: 20 });
    expect(placeInside({ x: 290, y: 195, w: 40, h: 20 }, bed)).toEqual({ x: 260, y: 180, w: 40, h: 20 });
  });

  it('lines up a box that is bigger than the bed with the top-left corner', () => {
    expect(placeInside({ x: 50, y: 50, w: 500, h: 400 }, { width: 300, height: 200 })).toEqual({ x: 0, y: 0, w: 500, h: 400 });
  });
});

describe('dimensionLabel', () => {
  it('shows both sizes with a multiplication sign', () => {
    expect(dimensionLabel(40, 20)).toBe('40 \u00d7 20 mm');
    expect(dimensionLabel(37.5, 12.345)).toBe('37.5 \u00d7 12.35 mm');
  });
});

describe('evalExpression', () => {
  it('reads plain numbers', () => {
    expect(evalExpression('40')).toBe(40);
    expect(evalExpression(' 12.5 ')).toBe(12.5);
    expect(evalExpression('.5')).toBe(0.5);
    expect(evalExpression('7.')).toBe(7);
  });

  it('does sums with the usual order and brackets', () => {
    expect(evalExpression('10+5')).toBe(15);
    expect(evalExpression('10 + 5 * 2')).toBe(20);
    expect(evalExpression('(10 + 5) * 2')).toBe(30);
    expect(evalExpression('100/4/5')).toBe(5);
    expect(evalExpression('12.5*2')).toBe(25);
    expect(evalExpression('(40-4)/3')).toBe(12);
    expect(evalExpression('2*(3+(4-1))')).toBe(12);
  });

  it('handles a sign in front of a number', () => {
    expect(evalExpression('-5')).toBe(-5);
    expect(evalExpression('+5')).toBe(5);
    expect(evalExpression('10--5')).toBe(15);
    expect(evalExpression('-(2+3)')).toBe(-5);
  });

  it('gives nothing for text, unfinished sums and anything that is not a finite number', () => {
    for (const bad of ['', '  ', 'abc', '10+', '*5', '(5', '5)', '5 5', '1e3', '1,5', '10/0', '0/0', '2**3', '()', '5+*2', 'alert(1)', '1+1;1']) {
      expect(evalExpression(bad)).toBeNull();
    }
  });

  it('refuses very long input', () => {
    expect(evalExpression('1+'.repeat(40) + '1')).toBeNull();
    expect(evalExpression('('.repeat(70) + '1' + ')'.repeat(70))).toBeNull();
  });

  it('is never fooled into running code', () => {
    const g = globalThis as unknown as { __ran?: boolean };
    g.__ran = false;
    expect(evalExpression('(g.__ran=true)')).toBeNull();
    expect(g.__ran).toBe(false);
  });
});

describe('formatNumber', () => {
  it('shows at most three decimals without trailing zeros', () => {
    expect(formatNumber(40)).toBe('40');
    expect(formatNumber(12.5)).toBe('12.5');
    expect(formatNumber(1 / 3)).toBe('0.333');
    expect(formatNumber(0)).toBe('0');
  });

  it('shows nothing for a number that is not finite', () => {
    expect(formatNumber(Number.NaN)).toBe('');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('wrapTab', () => {
  it('goes from the last box back to the first, and from the first back to the last', () => {
    expect(wrapTab(2, 3, false)).toBe(0);
    expect(wrapTab(0, 3, true)).toBe(2);
  });

  it('leaves the ordinary steps to the browser', () => {
    expect(wrapTab(0, 3, false)).toBeNull();
    expect(wrapTab(1, 3, false)).toBeNull();
    expect(wrapTab(2, 3, true)).toBeNull();
    expect(wrapTab(1, 3, true)).toBeNull();
  });

  it('copes with focus being outside the list, and with an empty list', () => {
    expect(wrapTab(-1, 3, true)).toBe(2);
    expect(wrapTab(-1, 3, false)).toBeNull();
    expect(wrapTab(0, 0, false)).toBeNull();
    expect(wrapTab(0, 1, false)).toBe(0);
  });
});

describe('boundsToClientRect', () => {
  it('maps workspace mm to screen pixels with the pan, zoom and canvas position', () => {
    const r = boundsToClientRect({ minX: 10, minY: 20, maxX: 50, maxY: 40 }, { x: 36, y: 12, scale: 2 }, { left: 100, top: 60 }, 4);
    // 4 px per mm times a zoom of 2 = 8 px per mm
    expect(r).toEqual({ left: 100 + 36 + 80, top: 60 + 12 + 160, width: 320, height: 160 });
  });
});

describe('overlayPlacement', () => {
  const container = { left: 100, top: 50, width: 800, height: 500 };
  const overlay = { width: 300, height: 100 };

  it('goes below the object when there is room', () => {
    const p = overlayPlacement({ left: 200, top: 100, width: 50, height: 40 }, overlay, container);
    expect(p).toEqual({ left: 200, top: 148 });
  });

  it('goes above the object when there is no room below', () => {
    const p = overlayPlacement({ left: 200, top: 450, width: 50, height: 60 }, overlay, container);
    expect(p).toEqual({ left: 200, top: 450 - 8 - 100 });
  });

  it('goes along the bottom of the canvas when it fits neither above nor below', () => {
    const tall = { left: 200, top: 60, width: 50, height: 480 };
    const p = overlayPlacement(tall, overlay, container);
    expect(p.top).toBe(50 + 500 - 100 - 8);
  });

  it('stays inside the canvas sideways', () => {
    expect(overlayPlacement({ left: 10, top: 100, width: 50, height: 40 }, overlay, container).left).toBe(108);
    expect(overlayPlacement({ left: 880, top: 100, width: 50, height: 40 }, overlay, container).left).toBe(100 + 800 - 300 - 8);
  });

  it('copes with an editor wider than the canvas', () => {
    expect(overlayPlacement({ left: 300, top: 100, width: 50, height: 40 }, { width: 2000, height: 100 }, container).left).toBe(108);
  });
});

describe('shapeFields', () => {
  it('lists the boxes of each shape in Tab order, always starting with the width and height', () => {
    expect(shapeFields('rectangle').map((f) => f.key)).toEqual(['width_mm', 'height_mm', 'corner_radius_mm']);
    expect(shapeFields('ellipse').map((f) => f.key)).toEqual(['width_mm', 'height_mm']);
    expect(shapeFields('polygon').map((f) => f.key)).toEqual(['width_mm', 'height_mm', 'sides']);
    expect(shapeFields('star').map((f) => f.key)).toEqual(['width_mm', 'height_mm', 'sides', 'inner_percent']);
  });

  it('labels stars by points and polygons by sides', () => {
    expect(shapeFields('star')[2]?.label).toBe('Points');
    expect(shapeFields('polygon')[2]?.label).toBe('Sides');
  });
});

describe('readShapeField and patchShape', () => {
  const star = { ...defaultShape('star'), width_mm: 50, height_mm: 40, sides: 7, inner_ratio: 0.45 };

  it('read back what is in each box', () => {
    expect(readShapeField(star, 'width_mm')).toBe(50);
    expect(readShapeField(star, 'height_mm')).toBe(40);
    expect(readShapeField(star, 'sides')).toBe(7);
    expect(readShapeField(star, 'inner_percent')).toBe(45);
    expect(readShapeField({ ...star, corner_radius_mm: 3 }, 'corner_radius_mm')).toBe(3);
  });

  it('change one box and leave the others alone', () => {
    const next = patchShape(star, 'width_mm', 80);
    expect(next).toEqual({ ...star, width_mm: 80 });
    expect(patchShape(star, 'inner_percent', 60).inner_ratio).toBe(0.6);
  });

  it('always give a valid shape, whatever is typed', () => {
    expect(patchShape(star, 'width_mm', 0).width_mm).toBe(SHAPE_MIN_MM);
    expect(patchShape(star, 'width_mm', -5).width_mm).toBe(SHAPE_MIN_MM);
    expect(patchShape(star, 'width_mm', 1e9).width_mm).toBe(SHAPE_MAX_MM);
    expect(patchShape(star, 'sides', 2.6).sides).toBe(3);
    expect(patchShape(star, 'sides', 1000).sides).toBe(64);
    expect(patchShape(star, 'inner_percent', 0).inner_ratio).toBe(0.1);
    expect(patchShape(star, 'inner_percent', 500).inner_ratio).toBe(0.95);
  });

  it('keep the corner radius inside the shape', () => {
    const rect = { ...defaultShape('rectangle'), width_mm: 40, height_mm: 20, corner_radius_mm: 4 };
    expect(patchShape(rect, 'corner_radius_mm', 99).corner_radius_mm).toBe(10);
    expect(patchShape(rect, 'height_mm', 6).corner_radius_mm).toBe(3);
  });

  it('change the kind of shape and keep the size', () => {
    const rect = { ...defaultShape('rectangle'), width_mm: 40, height_mm: 20 };
    for (const kind of SHAPE_KINDS) {
      const changed = changeShapeKind(rect, kind);
      expect(changed.shape).toBe(kind);
      expect(changed.width_mm).toBe(40);
      expect(changed.height_mm).toBe(20);
    }
  });
});

describe('pickLayerId', () => {
  it('picks the first layer of the mode that is not a test-grid layer', () => {
    expect(pickLayerId(LAYERS, 'score', 'TEST')).toBe('score');
    expect(pickLayerId(LAYERS, 'fill', 'TEST')).toBe('fill');
    expect(pickLayerId(LAYERS, 'cut', 'TEST')).toBe('cut');
  });

  it('gives null when there is no such layer', () => {
    expect(pickLayerId([layer('x', 'cut')], 'fill', 'TEST')).toBeNull();
    expect(pickLayerId([layer('T', 'score', 'TEST a')], 'score', 'TEST')).toBeNull();
  });
});

describe('buildShapeObject', () => {
  it('makes an object with its top-left corner where it was put, on the score layer by default', () => {
    const o = buildShapeObject({ ...defaultShape('rectangle'), width_mm: 40, height_mm: 20 }, { x: 80, y: 40 }, CTX, true);
    expect(o.id).toBe('new-1');
    expect(o.name).toBe('Rectangle');
    expect(o.layer_id).toBe('score');
    expect(o.z_index).toBe(7);
    expect(o.visible).toBe(true);
    expect(o.locked).toBe(false);
    expect([o.transform.e, o.transform.f]).toEqual([80, 40]);
    expect(o.kind.type === 'vector' && o.kind.source?.type).toBe('shape');
  });

  it('moves a clicked shape onto the bed, but leaves a dragged one where it was drawn', () => {
    const source = { ...defaultShape('rectangle'), width_mm: 40, height_mm: 20 };
    const clicked = buildShapeObject(source, { x: -10, y: 190 }, CTX, true);
    expect([clicked.transform.e, clicked.transform.f]).toEqual([0, 180]);
    const dragged = buildShapeObject(source, { x: -10, y: 190 }, CTX, false);
    expect([dragged.transform.e, dragged.transform.f]).toEqual([-10, 190]);
  });

  it('keeps the settings it was made from, made valid', () => {
    const o = buildShapeObject({ ...defaultShape('star'), width_mm: 0, height_mm: 30 }, { x: 0, y: 0 }, CTX, true);
    expect(o.kind.type === 'vector' && o.kind.source).toMatchObject({ width_mm: SHAPE_MIN_MM, height_mm: 30 });
  });

  it('can go on another layer', () => {
    expect(buildShapeObject(defaultShape('ellipse'), { x: 0, y: 0 }, CTX, true, 'cut').layer_id).toBe('cut');
    expect(buildShapeObject(defaultShape('ellipse'), { x: 0, y: 0 }, { ...CTX, layers: [] }, true).layer_id).toBeNull();
  });
});

describe('buildTextObject', () => {
  const render: TextRenderer = (form) =>
    form.text.trim() === '' ? null : { paths: [{ points: [{ x: 0, y: 0 }], closed: true }], widthMm: 30, heightMm: 10 };

  it('makes a text object at the click on the fill layer, keeping its settings', () => {
    const o = buildTextObject(defaultTextForm('Arial'), { x: 100, y: 50 }, CTX, render);
    expect(o).not.toBeNull();
    expect(o?.name).toBe('Text: Text');
    expect(o?.layer_id).toBe('fill');
    expect([o?.transform.e, o?.transform.f]).toEqual([100, 50]);
    expect(o?.kind.type === 'vector' && o.kind.source).toMatchObject({ type: 'text', text: 'Text', font_family: 'Arial', cap_height_mm: 10 });
  });

  it('moves text onto the bed when it is placed near an edge', () => {
    const o = buildTextObject(defaultTextForm('Arial'), { x: 295, y: 195 }, CTX, render);
    expect([o?.transform.e, o?.transform.f]).toEqual([270, 190]);
  });

  it('gives nothing when there is nothing to draw', () => {
    expect(buildTextObject({ ...defaultTextForm('Arial'), text: '  ' }, { x: 0, y: 0 }, CTX, render)).toBeNull();
  });

  it('starts with sensible defaults', () => {
    expect(defaultTextForm('Arial')).toEqual({
      text: 'Text',
      fontFamily: 'Arial',
      bold: false,
      italic: false,
      capHeight: '10',
      align: 'left',
      lineSpacing: '1.2',
    });
  });
});
