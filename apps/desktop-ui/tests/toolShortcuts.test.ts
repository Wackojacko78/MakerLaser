import { describe, expect, it } from 'vitest';
import { TOOL_SHORTCUTS, shortcutHint, toolForKey, type KeyLike } from '../src/lib/toolShortcuts';

const key = (k: string, patch: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  ...patch,
});
const page = { tag: 'DIV', contentEditable: false };

describe('the tool keys', () => {
  it('pick each drawing tool', () => {
    expect(toolForKey(key('r'), page, false)).toBe('rectangle');
    expect(toolForKey(key('e'), page, false)).toBe('ellipse');
    expect(toolForKey(key('p'), page, false)).toBe('polygon');
    expect(toolForKey(key('s'), page, false)).toBe('star');
    expect(toolForKey(key('t'), page, false)).toBe('text');
  });

  it('work with Caps Lock on, and when nothing in the page has the focus', () => {
    expect(toolForKey(key('R'), page, false)).toBe('rectangle');
    expect(toolForKey(key('t'), null, false)).toBe('text');
    expect(toolForKey(key('s'), { tag: 'BODY', contentEditable: false }, false)).toBe('star');
    expect(toolForKey(key('e'), { tag: 'canvas', contentEditable: false }, false)).toBe('ellipse');
  });

  it('are different for every tool, and are single letters', () => {
    const keys = Object.values(TOOL_SHORTCUTS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(/^[a-z]$/.test(k)).toBe(true);
  });

  it('leave the keys the app already uses alone', () => {
    // M picks Measure and V picks Select elsewhere; a drawing tool must never take them.
    expect(Object.values(TOOL_SHORTCUTS).includes('m')).toBe(false);
    expect(Object.values(TOOL_SHORTCUTS).includes('v')).toBe(false);
  });

  it('ignore every other key', () => {
    for (const k of ['a', 'm', 'v', 'x', '1', ' ', 'Enter', 'Escape', 'Delete', 'ArrowUp', 'Tab', 'F2', 'Dead', '']) {
      expect(toolForKey(key(k), page, false)).toBeNull();
    }
  });
});

describe('when a tool key is left alone', () => {
  it('with Ctrl, Alt, Shift or the Windows key held, because those are other shortcuts (Ctrl+S saves)', () => {
    for (const patch of [{ ctrlKey: true }, { altKey: true }, { shiftKey: true }, { metaKey: true }]) {
      expect(toolForKey(key('s', patch), page, false)).toBeNull();
    }
  });

  it('while typing in a box, so the letters go into the box', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'input', 'textarea']) {
      expect(toolForKey(key('r'), { tag, contentEditable: false }, false)).toBeNull();
    }
    expect(toolForKey(key('r'), { tag: 'DIV', contentEditable: true }, false)).toBeNull();
  });

  it('when the key is held down, so a tool is not picked and put down again and again', () => {
    expect(toolForKey(key('r', { repeat: true }), page, false)).toBeNull();
  });

  it('while an input method is composing text', () => {
    expect(toolForKey(key('r', { isComposing: true }), page, false)).toBeNull();
  });

  it('while a dialog is open', () => {
    expect(toolForKey(key('r'), page, true)).toBeNull();
  });

  it('still works with a button focused, because a letter does nothing to a button', () => {
    expect(toolForKey(key('r'), { tag: 'BUTTON', contentEditable: false }, false)).toBe('rectangle');
  });
});

describe('shortcutHint', () => {
  it('shows the key in capitals for the tooltips', () => {
    expect(shortcutHint('rectangle')).toBe('R');
    expect(shortcutHint('ellipse')).toBe('E');
    expect(shortcutHint('polygon')).toBe('P');
    expect(shortcutHint('star')).toBe('S');
    expect(shortcutHint('text')).toBe('T');
  });
});
