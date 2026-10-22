import { describe, expect, it } from 'vitest';
import { PLANNER_OPTIONS, plannerOnCount, plannerValue, type PlannerKey } from '@/lib/cutPlanner';

describe('the path planning choices', () => {
  it('use the names the Rust project settings are saved under, in the order they are shown', () => {
    expect(PLANNER_OPTIONS.map((o) => o.key)).toEqual(['order_fills_by_distance', 'cut_part_by_part', 'cut_shared_lines_once']);
  });

  it('each have a label and an explanation, and no two share a key or a label', () => {
    for (const o of PLANNER_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(5);
      expect(o.help.length).toBeGreaterThan(40);
    }
    expect(new Set(PLANNER_OPTIONS.map((o) => o.key)).size).toBe(PLANNER_OPTIONS.length);
    expect(new Set(PLANNER_OPTIONS.map((o) => o.label)).size).toBe(PLANNER_OPTIONS.length);
  });

  it('say which kind of layer they are for, and that shared lines are not removed under kerf', () => {
    const help = (key: PlannerKey) => PLANNER_OPTIONS.find((o) => o.key === key)?.help ?? '';
    expect(help('order_fills_by_distance')).toContain('Fill layers');
    expect(help('cut_part_by_part')).toContain('Cut and Score layers');
    expect(help('cut_shared_lines_once')).toContain('Kerf');
  });
});

describe('plannerValue', () => {
  it('is off for a project saved before the choices existed', () => {
    for (const o of PLANNER_OPTIONS) expect(plannerValue({}, o.key)).toBe(false);
  });
  it('follows what is saved', () => {
    const on = { order_fills_by_distance: true, cut_part_by_part: false, cut_shared_lines_once: true };
    expect(plannerValue(on, 'order_fills_by_distance')).toBe(true);
    expect(plannerValue(on, 'cut_part_by_part')).toBe(false);
    expect(plannerValue(on, 'cut_shared_lines_once')).toBe(true);
  });
});

describe('plannerOnCount', () => {
  it('counts the choices that are on', () => {
    expect(plannerOnCount({})).toBe(0);
    expect(plannerOnCount({ cut_part_by_part: true })).toBe(1);
    expect(plannerOnCount({ order_fills_by_distance: true, cut_part_by_part: true, cut_shared_lines_once: true })).toBe(3);
    expect(plannerOnCount({ order_fills_by_distance: false, cut_part_by_part: false, cut_shared_lines_once: false })).toBe(0);
  });
});
