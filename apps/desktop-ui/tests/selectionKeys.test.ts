import { describe, expect, it } from 'vitest';
import { isAdditiveSelect, selectionKey } from '@/lib/selectionKeys';

const keys = (over: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...over,
});

describe('isAdditiveSelect', () => {
  it('is true with Shift held', () => {
    expect(isAdditiveSelect(keys({ shiftKey: true }))).toBe(true);
  });
  it('is true with Ctrl held', () => {
    expect(isAdditiveSelect(keys({ ctrlKey: true }))).toBe(true);
  });
  it('is true with Cmd held (Mac)', () => {
    expect(isAdditiveSelect(keys({ metaKey: true }))).toBe(true);
  });
  it('is true with several held', () => {
    expect(isAdditiveSelect(keys({ shiftKey: true, ctrlKey: true }))).toBe(true);
  });
  it('is false with no modifier: a plain click replaces the selection', () => {
    expect(isAdditiveSelect(keys())).toBe(false);
  });
});

describe('selectionKey', () => {
  it('is the same for the same ids in any order', () => {
    expect(selectionKey(['b', 'a', 'c'])).toBe(selectionKey(['c', 'b', 'a']));
  });
  it('ignores a repeated id', () => {
    expect(selectionKey(['a', 'b', 'a'])).toBe(selectionKey(['a', 'b']));
  });
  it('differs when the set differs', () => {
    expect(selectionKey(['a', 'b'])).not.toBe(selectionKey(['a']));
    expect(selectionKey(['a', 'b'])).not.toBe(selectionKey(['a', 'c']));
  });
  it('does not mix up ids that run together', () => {
    expect(selectionKey(['ab', 'c'])).not.toBe(selectionKey(['a', 'bc']));
  });
  it('is empty for nothing selected, and does not change what it is given', () => {
    expect(selectionKey([])).toBe('');
    const ids = ['b', 'a'];
    selectionKey(ids);
    expect(ids).toEqual(['b', 'a']);
  });
});
