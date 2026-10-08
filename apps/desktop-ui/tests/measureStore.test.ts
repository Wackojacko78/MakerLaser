import { beforeEach, describe, expect, it } from 'vitest';
import { freePoint } from '@/lib/measure';
import { useMeasureStore } from '@/state/measureStore';

const store = () => useMeasureStore.getState();
const a = freePoint({ x: 1, y: 1 });
const b = freePoint({ x: 2, y: 2 });
const c = freePoint({ x: 3, y: 3 });

beforeEach(() => {
  useMeasureStore.setState({ tool: 'select', picks: [], hover: null, cursor: null });
});

describe('measure store', () => {
  it('starts in the Select tool with nothing picked', () => {
    expect(store().tool).toBe('select');
    expect(store().picks).toEqual([]);
    expect(store().hover).toBeNull();
    expect(store().cursor).toBeNull();
  });
  it('switches tool, and picks accumulate to two and then start again', () => {
    store().setTool('measure');
    expect(store().tool).toBe('measure');
    store().addPick(a);
    store().addPick(b);
    expect(store().picks).toEqual([a, b]);
    store().addPick(c);
    expect(store().picks).toEqual([c]);
  });
  it('leaving the Measure tool drops the measurement; entering it keeps nothing over', () => {
    store().setTool('measure');
    store().addPick(a);
    store().setHover(b);
    store().setTool('select');
    expect(store().picks).toEqual([]);
    expect(store().hover).toBeNull();
    store().setTool('measure');
    expect(store().picks).toEqual([]);
  });
  it('clear empties the measurement but stays in the Measure tool', () => {
    store().setTool('measure');
    store().addPick(a);
    store().clear();
    expect(store().picks).toEqual([]);
    expect(store().tool).toBe('measure');
  });
  it('does not announce a change when nothing changed', () => {
    let changes = 0;
    const stop = useMeasureStore.subscribe(() => {
      changes++;
    });
    store().clear();
    store().setHover(null);
    store().setCursor(null);
    store().setTool('select');
    expect(changes).toBe(0);
    store().setCursor({ x: 1, y: 2 });
    expect(changes).toBe(1);
    stop();
  });
  it('remembers the pointer position', () => {
    store().setCursor({ x: 12.5, y: 7 });
    expect(store().cursor).toEqual({ x: 12.5, y: 7 });
    store().setCursor(null);
    expect(store().cursor).toBeNull();
  });
});
