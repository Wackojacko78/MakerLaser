import { describe, expect, it } from 'vitest';
import { DEFAULT_TAB, RIGHT_TABS, nextTab, toggledTab } from '@/lib/rightTabs';

describe('the tabs', () => {
  it('are Properties, Shape tools and Trace, in that order, and start on Properties', () => {
    expect(RIGHT_TABS.map((t) => t.id)).toEqual(['properties', 'shape', 'trace']);
    expect(RIGHT_TABS.map((t) => t.label)).toEqual(['Properties', 'Shape tools', 'Trace']);
    expect(DEFAULT_TAB).toBe('properties');
    expect(new Set(RIGHT_TABS.map((t) => t.id)).size).toBe(RIGHT_TABS.length);
    for (const t of RIGHT_TABS) expect(t.title.length).toBeGreaterThan(5);
  });
});

describe('nextTab', () => {
  it('the right arrow goes to the next tab and wraps round at the end', () => {
    expect(nextTab('properties', 'ArrowRight')).toBe('shape');
    expect(nextTab('shape', 'ArrowRight')).toBe('trace');
    expect(nextTab('trace', 'ArrowRight')).toBe('properties');
  });
  it('the left arrow goes to the previous tab and wraps round at the start', () => {
    expect(nextTab('trace', 'ArrowLeft')).toBe('shape');
    expect(nextTab('shape', 'ArrowLeft')).toBe('properties');
    expect(nextTab('properties', 'ArrowLeft')).toBe('trace');
  });
  it('Home and End go to the first and the last', () => {
    expect(nextTab('shape', 'Home')).toBe('properties');
    expect(nextTab('shape', 'End')).toBe('trace');
  });
  it('any other key does nothing', () => {
    for (const key of ['Enter', ' ', 'a', 'ArrowUp', 'ArrowDown', 'Tab', 'Escape', '']) expect(nextTab('shape', key)).toBeNull();
  });
});

describe('toggledTab', () => {
  it('shows the tab that was asked for', () => {
    expect(toggledTab('properties', 'shape')).toBe('shape');
    expect(toggledTab('trace', 'shape')).toBe('shape');
    expect(toggledTab('shape', 'trace')).toBe('trace');
  });
  it('asking for the tab that is showing goes back to Properties', () => {
    expect(toggledTab('shape', 'shape')).toBe('properties');
    expect(toggledTab('trace', 'trace')).toBe('properties');
    expect(toggledTab('properties', 'properties')).toBe('properties');
  });
});
