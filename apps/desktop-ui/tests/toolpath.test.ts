import { describe, expect, it } from 'vitest';
import { drawnCount, outsideBed, pathStartMarkers, prepareToolpath } from '@/lib/toolpath';
import { originInfo } from '@/lib/transform';
import type { PreviewSegment } from '@/types/domain';

// two squares: travel, 4 cut moves, travel, 4 cut moves
const SQUARE = (x: number, y: number): PreviewSegment[] => [
  [x, y, x + 10, y, 1],
  [x + 10, y, x + 10, y + 10, 1],
  [x + 10, y + 10, x, y + 10, 1],
  [x, y + 10, x, y, 1],
];
const SEGMENTS: PreviewSegment[] = [
  [0, 300, 20, 20, 0],
  ...SQUARE(20, 20),
  [20, 20, 100, 100, 0],
  ...SQUARE(100, 100),
];

describe('toolpath preparation', () => {
  it('packs segments into typed arrays', () => {
    const p = prepareToolpath(SEGMENTS);
    expect(p.count).toBe(10);
    expect(p.kinds[0]).toBe(0);
    expect(p.kinds[1]).toBe(1);
    expect(p.coords[0 * 4 + 1]).toBe(300);
  });

  it('computes how many segments a replay fraction shows', () => {
    const p = prepareToolpath(SEGMENTS);
    expect(drawnCount(p, 0)).toBe(0);
    expect(drawnCount(p, 0.5)).toBe(5);
    expect(drawnCount(p, 1)).toBe(10);
    expect(drawnCount(p, 7)).toBe(10);
    expect(drawnCount(p, -1)).toBe(0);
  });

  it('numbers cut paths in execution order, one marker per path', () => {
    const m = pathStartMarkers(prepareToolpath(SEGMENTS));
    expect(m.map((x) => x.n)).toEqual([1, 2]);
    expect([m[0].x, m[0].y]).toEqual([20, 20]);
    expect([m[1].x, m[1].y]).toEqual([100, 100]);
  });

  it('caps the number of markers', () => {
    const many: PreviewSegment[] = [];
    for (let i = 0; i < 50; i++) many.push(...SQUARE(i * 12, 0));
    expect(pathStartMarkers(prepareToolpath(many), 10)).toHaveLength(10);
  });

  it('finds moves that leave the bed', () => {
    const bad: PreviewSegment[] = [...SEGMENTS, [100, 100, 305, 100, 1]];
    expect(outsideBed(prepareToolpath(SEGMENTS), 300, 300)).toEqual([]);
    expect(outsideBed(prepareToolpath(bad), 300, 300)).toEqual([10]);
  });
});

describe('machine origin on screen', () => {
  const bed = { bed_width_mm: 300, bed_height_mm: 200 };
  it('bottom-left: origin at the bottom-left corner, +Y points up the screen', () => {
    expect(originInfo({ ...bed, origin: 'bottom_left' })).toEqual({ x: 0, y: 200, xDir: 1, yDir: -1 });
  });
  it('top-right: origin at the top-right corner, +X points left', () => {
    expect(originInfo({ ...bed, origin: 'top_right' })).toEqual({ x: 300, y: 0, xDir: -1, yDir: 1 });
  });
});
