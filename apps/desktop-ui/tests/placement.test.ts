import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOB_ORIGIN,
  DEFAULT_START_FROM,
  JOB_ORIGIN_GRID,
  JOB_ORIGIN_LABEL,
  START_FROM_HELP,
  START_FROM_LABEL,
  START_FROM_VALUES,
  describeUserOrigin,
  isRelative,
  jobOriginOf,
  startFromOf,
} from '@/lib/placement';

describe('start from', () => {
  it('has exactly the three modes the Rust side knows, each with a label and help text', () => {
    expect([...START_FROM_VALUES]).toEqual(['absolute', 'current_position', 'user_origin']);
    for (const v of START_FROM_VALUES) {
      expect(START_FROM_LABEL[v].length).toBeGreaterThan(0);
      expect(START_FROM_HELP[v].length).toBeGreaterThan(20);
    }
  });
  it('treats a project from before this feature as absolute', () => {
    expect(startFromOf({})).toBe('absolute');
    expect(isRelative({})).toBe(false);
  });
  it('reads a stored value', () => {
    expect(startFromOf({ start_from: 'current_position' })).toBe('current_position');
    expect(startFromOf({ start_from: 'user_origin' })).toBe('user_origin');
    expect(isRelative({ start_from: 'user_origin' })).toBe(true);
    expect(isRelative({ start_from: 'absolute' })).toBe(false);
  });
  it('falls back to absolute for anything unknown, so a bad file never places a job relative by accident', () => {
    for (const v of ['relative', '', null, 7, undefined, 'CURRENT_POSITION']) expect(startFromOf({ start_from: v })).toBe(DEFAULT_START_FROM);
  });
});

describe('job origin', () => {
  it('lays out nine distinct dots, top row first, covering every value', () => {
    expect(JOB_ORIGIN_GRID).toHaveLength(3);
    const all = JOB_ORIGIN_GRID.flat();
    expect(all).toHaveLength(9);
    expect(new Set(all).size).toBe(9);
    expect(JOB_ORIGIN_GRID[0]).toEqual(['top_left', 'top', 'top_right']);
    expect(JOB_ORIGIN_GRID[1]?.[1]).toBe('center');
    expect(JOB_ORIGIN_GRID[2]).toEqual(['bottom_left', 'bottom', 'bottom_right']);
  });
  it('has a label for every dot', () => {
    for (const o of JOB_ORIGIN_GRID.flat()) expect(JOB_ORIGIN_LABEL[o].length).toBeGreaterThan(0);
  });
  it('defaults to bottom left and falls back to it for unknown values', () => {
    expect(DEFAULT_JOB_ORIGIN).toBe('bottom_left');
    expect(jobOriginOf({})).toBe('bottom_left');
    expect(jobOriginOf({ job_origin: 'middle' })).toBe('bottom_left');
    expect(jobOriginOf({ job_origin: 5 })).toBe('bottom_left');
  });
  it('reads every stored value', () => {
    for (const o of JOB_ORIGIN_GRID.flat()) expect(jobOriginOf({ job_origin: o })).toBe(o);
  });
});

describe('describeUserOrigin', () => {
  it('says when none is set', () => {
    expect(describeUserOrigin(null)).toBe('Not set.');
    expect(describeUserOrigin(undefined)).toBe('Not set.');
  });
  it('shows the position to two decimals', () => {
    expect(describeUserOrigin([120.5, 80])).toBe('X 120.50, Y 80.00 (machine position).');
    expect(describeUserOrigin([0, -3.456])).toBe('X 0.00, Y -3.46 (machine position).');
  });
});
