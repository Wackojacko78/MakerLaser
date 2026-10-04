import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  applyToPoint,
  boundsHeight,
  boundsWidth,
  compose,
  decompose,
  fitView,
  objectsInBox,
  rotateAbout,
  rotation,
  scaleAbout,
  scaling,
  chain,
  translation,
  worldBounds,
} from '@/lib/transform';
import type { Transform2D, WorkspaceObject } from '@/types/domain';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const sameMatrix = (a: Transform2D, b: Transform2D) =>
  (['a', 'b', 'c', 'd', 'e', 'f'] as const).every((k) => close(a[k], b[k], 1e-9));

function square(id: string, x: number, y: number, size: number): WorkspaceObject {
  return {
    id,
    name: id,
    kind: {
      type: 'vector',
      paths: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: size, y: 0 },
            { x: size, y: size },
            { x: 0, y: size },
          ],
        },
      ],
    },
    transform: translation(x, y),
    layer_id: null,
    visible: true,
    locked: false,
    z_index: 0,
  };
}

describe('matrix composition', () => {
  it('applies the first transform first', () => {
    const t = chain(translation(10, 0), scaling(2, 2));
    const p = applyToPoint(t, { x: 1, y: 1 });
    expect(p).toEqual({ x: 22, y: 2 });
  });

  it('rotates clockwise on screen (Y-down), matching the Rust side', () => {
    const p = applyToPoint(rotation(90), { x: 1, y: 0 });
    expect(close(p.x, 0) && close(p.y, 1)).toBe(true);
  });

  it('identity is neutral', () => {
    const t = chain(rotation(33), translation(4, 5));
    expect(sameMatrix(chain(IDENTITY, t), t)).toBe(true);
    expect(sameMatrix(chain(t, IDENTITY), t)).toBe(true);
  });
});

describe('decompose / compose (rotation persistence)', () => {
  const cases: Array<[string, Transform2D]> = [
    ['plain translation', translation(12, -7)],
    ['uniform scale', chain(scaling(2, 2), translation(3, 4))],
    ['rotation', chain(rotation(37), translation(10, 20))],
    ['non-uniform scale then rotation', chain(chain(scaling(3, 0.5), rotation(-120)), translation(1, 2))],
    ['mirrored in Y', chain(chain(scaling(1, -1), rotation(15)), translation(5, 5))],
    ['mirrored in X', chain(chain(scaling(-2, 1), rotation(200)), translation(5, 5))],
    ['rotation of exactly 180', chain(rotation(180), translation(0, 0))],
  ];
  for (const [name, t] of cases) {
    it(`round-trips: ${name}`, () => {
      expect(sameMatrix(compose(decompose(t)), t)).toBe(true);
    });
  }

  it('recovers the rotation angle a Konva node would report', () => {
    const d = decompose(chain(scaling(2, 2), chain(rotation(30), translation(5, 6))));
    expect(close(d.rotationDeg, 30, 1e-9)).toBe(true);
    expect(close(d.scaleX, 2) && close(d.scaleY, 2)).toBe(true);
    expect(d.x).toBe(5);
    expect(d.y).toBe(6);
  });

  it('a degenerate matrix does not produce NaN', () => {
    const d = decompose({ a: 0, b: 0, c: 0, d: 0, e: 1, f: 2 });
    expect(Number.isFinite(d.scaleX) && Number.isFinite(d.scaleY) && Number.isFinite(d.rotationDeg)).toBe(true);
  });
});

describe('scale / rotate about a point', () => {
  it('scaling about a corner keeps that corner fixed', () => {
    const o = square('a', 10, 20, 10);
    const t = scaleAbout(o.transform, 2, 3, 10, 20);
    expect(applyToPoint(t, { x: 0, y: 0 })).toEqual({ x: 10, y: 20 });
    const far = applyToPoint(t, { x: 10, y: 10 });
    expect(close(far.x, 30) && close(far.y, 50)).toBe(true);
  });

  it('rotating about the centre keeps the centre fixed', () => {
    const o = square('a', 0, 0, 10);
    const t = rotateAbout(o.transform, 90, 5, 5);
    const c = applyToPoint(t, { x: 5, y: 5 });
    expect(close(c.x, 5) && close(c.y, 5)).toBe(true);
    const corner = applyToPoint(t, { x: 0, y: 0 });
    expect(close(corner.x, 10) && close(corner.y, 0)).toBe(true);
  });
});

describe('bounds and rubber-band selection', () => {
  it('computes world bounds with the transform applied', () => {
    const b = worldBounds(square('a', 5, 6, 10))!;
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([5, 6, 15, 16]);
  });

  it('bounds of a rotated square grow to the diagonal', () => {
    const o = square('a', 0, 0, 10);
    o.transform = rotateAbout(o.transform, 45, 5, 5);
    const b = worldBounds(o)!;
    expect(close(boundsWidth(b), 10 * Math.SQRT2, 1e-9)).toBe(true);
    expect(close(boundsHeight(b), 10 * Math.SQRT2, 1e-9)).toBe(true);
  });

  it('image bounds use the physical size from the dpi', () => {
    const img: WorkspaceObject = {
      ...square('img', 0, 0, 1),
      kind: { type: 'image', asset_id: 'x', format: 'png', source_path: null, width_px: 254, height_px: 127, dpi: 254 },
    };
    const b = worldBounds(img)!;
    expect(close(boundsWidth(b), 25.4) && close(boundsHeight(b), 12.7)).toBe(true);
  });

  it('selects exactly the objects the box touches, in millimetres', () => {
    const objects = [square('left', 0, 0, 10), square('mid', 50, 0, 10), square('far', 200, 200, 10)];
    expect(objectsInBox(objects, { minX: -5, minY: -5, maxX: 5, maxY: 5 })).toEqual(['left']);
    expect(objectsInBox(objects, { minX: 0, minY: 0, maxX: 60, maxY: 10 })).toEqual(['left', 'mid']);
    expect(objectsInBox(objects, { minX: 100, minY: 100, maxX: 120, maxY: 120 })).toEqual([]);
  });

  it('ignores hidden objects', () => {
    const hidden = { ...square('h', 0, 0, 10), visible: false };
    expect(objectsInBox([hidden], { minX: -1, minY: -1, maxX: 20, maxY: 20 })).toEqual([]);
  });
});

describe('fitView', () => {
  it('centres the bed and never produces a zero or negative scale', () => {
    const v = fitView(1000, 800, 300, 300, 2);
    expect(v.scale).toBeGreaterThan(0);
    const bedPxW = 300 * 2 * v.scale;
    expect(close(v.x, (1000 - bedPxW) / 2)).toBe(true);
    const tiny = fitView(10, 10, 300, 300, 2);
    expect(tiny.scale).toBeGreaterThan(0);
  });
});
