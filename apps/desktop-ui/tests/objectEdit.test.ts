import { describe, expect, it } from 'vitest';
import {
  applyEdit,
  autoName,
  axisScales,
  layerMode,
  makeTextSource,
  objectSource,
  shapeFromObject,
  textFromObject,
  textObjectName,
  withoutStretch,
} from '../src/lib/objectEdit';
import { defaultShape, shapeName, shapePaths } from '../src/lib/shapes';
import { compose, decompose } from '../src/lib/transform';
import type { Layer, ShapeSource, TextSource, Transform2D, WorkspaceObject } from '../src/types/domain';

const layer = (id: string, kind: Layer['kind']): Layer => ({ id, kind }) as unknown as Layer;
const LAYERS: Layer[] = [layer('L-cut', 'cut'), layer('L-score', 'score'), layer('L-fill', 'fill'), layer('L-img', 'image')];

const TEXT: TextSource = {
  type: 'text',
  text: 'Hello',
  font_family: 'Arial',
  bold: true,
  italic: false,
  cap_height_mm: 10,
  align: 'center',
  line_spacing: 1.2,
};

const textObject = (transform: Transform2D, patch: Partial<WorkspaceObject> = {}): WorkspaceObject => ({
  id: 'T1',
  name: textObjectName(TEXT.text),
  kind: { type: 'vector', paths: [{ points: [{ x: 0, y: 0 }], closed: true }], source: TEXT },
  transform,
  layer_id: 'L-fill',
  visible: true,
  locked: false,
  z_index: 3,
  ...patch,
});

const SHAPE: ShapeSource = { ...defaultShape('rectangle'), width_mm: 40, height_mm: 20, corner_radius_mm: 4 };

const shapeObject = (transform: Transform2D, patch: Partial<WorkspaceObject> = {}): WorkspaceObject => ({
  id: 'S1',
  name: shapeName(SHAPE),
  kind: { type: 'vector', paths: shapePaths(SHAPE), source: SHAPE },
  transform,
  layer_id: 'L-score',
  visible: true,
  locked: false,
  z_index: 5,
  ...patch,
});

const at = (e: number, f: number): Transform2D => ({ a: 1, b: 0, c: 0, d: 1, e, f });

describe('names', () => {
  it('names text after its first line, shortened', () => {
    expect(textObjectName('Hello')).toBe('Text: Hello');
    expect(textObjectName('  Line one\nLine two ')).toBe('Text: Line one');
    expect(textObjectName('a'.repeat(30))).toBe(`Text: ${'a'.repeat(24)}\u2026`);
    expect(textObjectName('')).toBe('Text: ');
  });

  it('names an object from whichever source it has', () => {
    expect(autoName(TEXT)).toBe('Text: Hello');
    expect(autoName(SHAPE)).toBe('Rounded rectangle');
  });
});

describe('objectSource', () => {
  it('reads the source of text and shapes, and nothing for other objects', () => {
    expect(objectSource(textObject(at(0, 0)))).toEqual(TEXT);
    expect(objectSource(shapeObject(at(0, 0)))).toEqual(SHAPE);
    const imported = { ...textObject(at(0, 0)), kind: { type: 'vector' as const, paths: [] } };
    expect(objectSource(imported)).toBeNull();
    const image = {
      ...textObject(at(0, 0)),
      kind: { type: 'image' as const, asset_id: 'a', format: 'png' as const, source_path: null, width_px: 1, height_px: 1, dpi: 96 },
    };
    expect(objectSource(image)).toBeNull();
  });
});

describe('axisScales and withoutStretch', () => {
  it('read the stretch along each axis, whatever the rotation or mirroring', () => {
    const t = compose({ x: 5, y: 6, rotationDeg: 30, scaleX: 2, scaleY: -3 });
    const s = axisScales(t);
    expect(s.sx).toBeCloseTo(2, 9);
    expect(s.sy).toBeCloseTo(3, 9);
  });

  it('give 1 when the transform cannot be read', () => {
    expect(axisScales({ a: 0, b: 0, c: 0, d: 0, e: 1, f: 2 })).toEqual({ sx: 1, sy: 1 });
  });

  it('reset the size but keep the position, rotation and mirroring', () => {
    const t = compose({ x: 12, y: 34, rotationDeg: 25, scaleX: 1.5, scaleY: 2 });
    const d = decompose(withoutStretch(t));
    expect(d.x).toBeCloseTo(12, 9);
    expect(d.y).toBeCloseTo(34, 9);
    expect(d.rotationDeg).toBeCloseTo(25, 9);
    expect(d.scaleX).toBeCloseTo(1, 9);
    expect(d.scaleY).toBeCloseTo(1, 9);
    const mirrored = decompose(withoutStretch(compose({ x: 0, y: 0, rotationDeg: 0, scaleX: 2, scaleY: -2 })));
    expect(mirrored.scaleY).toBeCloseTo(-1, 9);
  });
});

describe('layerMode', () => {
  it('reads the laser mode of the layer an object is on', () => {
    expect(layerMode(textObject(at(0, 0), { layer_id: 'L-cut' }), LAYERS, 'fill')).toBe('cut');
    expect(layerMode(textObject(at(0, 0), { layer_id: 'L-score' }), LAYERS, 'fill')).toBe('score');
  });

  it('falls back when the object is on an image layer, no layer, or a missing layer', () => {
    expect(layerMode(textObject(at(0, 0), { layer_id: 'L-img' }), LAYERS, 'fill')).toBe('fill');
    expect(layerMode(textObject(at(0, 0), { layer_id: null }), LAYERS, 'score')).toBe('score');
    expect(layerMode(textObject(at(0, 0), { layer_id: 'gone' }), LAYERS, 'score')).toBe('score');
  });
});

describe('makeTextSource', () => {
  const form = { text: 'Hi', fontFamily: 'Arial', bold: true, italic: false, capHeight: '12.5', align: 'right' as const, lineSpacing: '1.5' };

  it('turns what is typed into the settings that are kept', () => {
    expect(makeTextSource(form)).toEqual({
      type: 'text',
      text: 'Hi',
      font_family: 'Arial',
      bold: true,
      italic: false,
      cap_height_mm: 12.5,
      align: 'right',
      line_spacing: 1.5,
    });
  });

  it('never keeps a blank, broken or non-positive number, which the project file cannot hold', () => {
    for (const bad of ['', '  ', 'abc', '0', '-4', 'Infinity']) {
      const s = makeTextSource({ ...form, capHeight: bad, lineSpacing: bad });
      expect(s.cap_height_mm).toBe(10);
      expect(s.line_spacing).toBe(1.2);
    }
  });

  it('is what the edit box starts from next time', () => {
    const object = textObject(at(0, 0), { kind: { type: 'vector', paths: [], source: makeTextSource(form) } });
    const back = textFromObject(object, LAYERS);
    expect(back?.text).toBe('Hi');
    expect(back?.capHeight).toBe('12.5');
    expect(back?.lineSpacing).toBe('1.5');
    expect(back?.align).toBe('right');
  });
});

describe('textFromObject', () => {
  it('gives the settings the text was made from', () => {
    const form = textFromObject(textObject(at(10, 20)), LAYERS);
    expect(form).toEqual({
      text: 'Hello',
      fontFamily: 'Arial',
      bold: true,
      italic: false,
      capHeight: '10',
      align: 'center',
      lineSpacing: '1.2',
      mode: 'fill',
    });
  });

  it('includes resizing done on the canvas in the letter height', () => {
    const form = textFromObject(textObject(compose({ x: 0, y: 0, rotationDeg: 0, scaleX: 1.5, scaleY: 1.5 })), LAYERS);
    expect(form?.capHeight).toBe('15');
  });

  it('is null for anything that is not text', () => {
    expect(textFromObject(shapeObject(at(0, 0)), LAYERS)).toBeNull();
  });

  it('copes with a source that has odd values', () => {
    const odd = textObject(at(0, 0), {
      kind: { type: 'vector', paths: [], source: { ...TEXT, align: 'justify' as never, line_spacing: 0 } },
    });
    const form = textFromObject(odd, LAYERS);
    expect(form?.align).toBe('left');
    expect(form?.lineSpacing).toBe('1.2');
  });
});

describe('shapeFromObject', () => {
  it('gives the settings the shape was made from', () => {
    const form = shapeFromObject(shapeObject(at(0, 0)), LAYERS);
    expect(form?.source).toEqual(SHAPE);
    expect(form?.mode).toBe('score');
  });

  it('includes stretching done on the canvas in the size, and scales the corner radius with it', () => {
    const form = shapeFromObject(shapeObject(compose({ x: 0, y: 0, rotationDeg: 0, scaleX: 2, scaleY: 1.5 })), LAYERS);
    expect(form?.source.width_mm).toBe(80);
    expect(form?.source.height_mm).toBe(30);
    expect(form?.source.corner_radius_mm).toBe(6);
  });

  it('is null for anything that is not a shape', () => {
    expect(shapeFromObject(textObject(at(0, 0)), LAYERS)).toBeNull();
  });
});

describe('applyEdit', () => {
  const newShape: ShapeSource = { ...defaultShape('star'), width_mm: 50, height_mm: 50 };

  it('swaps in the new outlines and settings', () => {
    const edited = applyEdit(shapeObject(at(10, 20)), newShape, shapePaths(newShape));
    expect(edited.kind).toEqual({ type: 'vector', paths: shapePaths(newShape), source: newShape });
  });

  it('keeps the id, place, layer, flags and stacking', () => {
    const before = shapeObject(at(10, 20), { locked: false, visible: false, z_index: 9 });
    const edited = applyEdit(before, newShape, shapePaths(newShape));
    expect(edited.id).toBe('S1');
    const t = edited.transform;
    expect([t.a, t.b, t.c, t.d, t.e, t.f].map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([1, 0, 0, 1, 10, 20]);
    expect(edited.layer_id).toBe('L-score');
    expect(edited.visible).toBe(false);
    expect(edited.z_index).toBe(9);
  });

  it('keeps the position and rotation and resets stretching', () => {
    const stretched = compose({ x: 10, y: 20, rotationDeg: 90, scaleX: 2, scaleY: 3 });
    const d = decompose(applyEdit(shapeObject(stretched), newShape, shapePaths(newShape)).transform);
    expect(d.x).toBeCloseTo(10, 9);
    expect(d.y).toBeCloseTo(20, 9);
    expect(d.rotationDeg).toBeCloseTo(90, 9);
    expect(d.scaleX).toBeCloseTo(1, 9);
    expect(d.scaleY).toBeCloseTo(1, 9);
  });

  it('renames an object that still has its automatic name', () => {
    expect(applyEdit(shapeObject(at(0, 0)), newShape, shapePaths(newShape)).name).toBe('Star (5 points)');
    const newText: TextSource = { ...TEXT, text: 'Goodbye' };
    expect(applyEdit(textObject(at(0, 0)), newText, []).name).toBe('Text: Goodbye');
  });

  it('leaves a name that was changed by hand alone', () => {
    const named = shapeObject(at(0, 0), { name: 'Lid' });
    expect(applyEdit(named, newShape, shapePaths(newShape)).name).toBe('Lid');
  });

  it('moves to another layer only when asked to', () => {
    const before = shapeObject(at(0, 0));
    expect(applyEdit(before, newShape, [], undefined).layer_id).toBe('L-score');
    expect(applyEdit(before, newShape, [], 'L-cut').layer_id).toBe('L-cut');
    expect(applyEdit(before, newShape, [], null).layer_id).toBeNull();
  });

  it('does not change the object it was given', () => {
    const before = shapeObject(at(10, 20));
    const copy = JSON.stringify(before);
    applyEdit(before, newShape, shapePaths(newShape), 'L-cut');
    expect(JSON.stringify(before)).toBe(copy);
  });

  it('can turn imported artwork into an editable object', () => {
    const imported: WorkspaceObject = { ...shapeObject(at(0, 0)), name: 'drawing.svg', kind: { type: 'vector', paths: [] } };
    const edited = applyEdit(imported, newShape, shapePaths(newShape));
    expect(edited.name).toBe('Star (5 points)');
    expect(objectSource(edited)).toEqual(newShape);
  });
});
