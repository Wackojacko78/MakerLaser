import { describe, expect, it } from 'vitest';
import {
  EDIT_SLACK_PX,
  editAccess,
  editBlockedMessage,
  opensEditorOnKey,
  pointInBounds,
  type EditableLike,
  type KeyLike,
} from '../src/lib/editAccess';

const vector = (patch: Partial<EditableLike> = {}, withSource = true): EditableLike => ({
  locked: false,
  kind: withSource ? { type: 'vector', source: { type: 'shape' } } : { type: 'vector' },
  ...patch,
});

describe('editAccess', () => {
  it('lets text and shapes with saved settings be edited', () => {
    expect(editAccess(vector())).toBe('editable');
  });

  it('says a locked one is locked', () => {
    expect(editAccess(vector({ locked: true }))).toBe('locked');
  });

  it('says artwork without saved settings has none, whether or not it is locked', () => {
    expect(editAccess(vector({}, false))).toBe('no-settings');
    expect(editAccess(vector({ locked: true }, false))).toBe('no-settings');
    expect(editAccess({ locked: false, kind: { type: 'vector', source: undefined } })).toBe('no-settings');
    expect(editAccess({ locked: false, kind: { type: 'vector', source: null } })).toBe('no-settings');
  });

  it('says an image cannot be edited this way', () => {
    expect(editAccess({ locked: false, kind: { type: 'image' } })).toBe('not-editable');
  });
});

describe('pointInBounds', () => {
  const box = { minX: 10, minY: 20, maxX: 50, maxY: 40 };

  it('is true inside the box and on its edges', () => {
    expect(pointInBounds({ x: 30, y: 30 }, box)).toBe(true);
    expect(pointInBounds({ x: 10, y: 20 }, box)).toBe(true);
    expect(pointInBounds({ x: 50, y: 40 }, box)).toBe(true);
  });

  it('is false outside the box', () => {
    expect(pointInBounds({ x: 9.9, y: 30 }, box)).toBe(false);
    expect(pointInBounds({ x: 30, y: 40.1 }, box)).toBe(false);
  });

  it('counts the slack around the box', () => {
    expect(pointInBounds({ x: 8, y: 30 }, box, 2)).toBe(true);
    expect(pointInBounds({ x: 7.9, y: 30 }, box, 2)).toBe(false);
    expect(pointInBounds({ x: 52, y: 42 }, box, 2)).toBe(true);
  });

  it('is false for a point that is not a number', () => {
    expect(pointInBounds({ x: Number.NaN, y: 30 }, box)).toBe(false);
    expect(pointInBounds({ x: 30, y: Number.POSITIVE_INFINITY }, box, 1e9)).toBe(false);
  });

  it('has a sensible slack in screen pixels', () => {
    expect(EDIT_SLACK_PX).toBeGreaterThan(0);
    expect(EDIT_SLACK_PX).toBeLessThan(20);
  });
});

describe('editBlockedMessage', () => {
  it('explains a locked object', () => {
    expect(editBlockedMessage('locked')).toContain('Unlock');
  });

  it('explains an object with no saved settings and says what to do about it', () => {
    const message = editBlockedMessage('no-settings') ?? '';
    expect(message).toContain('no saved settings');
    expect(message).toContain('Add it again');
  });

  it('says nothing when the object is editable or is not artwork', () => {
    expect(editBlockedMessage('editable')).toBeNull();
    expect(editBlockedMessage('not-editable')).toBeNull();
  });
});

describe('opensEditorOnKey', () => {
  const key = (k: string, patch: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...patch });
  const body = { tag: 'BODY', contentEditable: false };

  it('opens on Enter and F2 for an editable object', () => {
    expect(opensEditorOnKey(key('Enter'), body, 'editable')).toBe(true);
    expect(opensEditorOnKey(key('F2'), body, 'editable')).toBe(true);
    expect(opensEditorOnKey(key('Enter'), null, 'editable')).toBe(true);
    expect(opensEditorOnKey(key('Enter'), { tag: 'canvas', contentEditable: false }, 'editable')).toBe(true);
  });

  it('ignores other keys', () => {
    for (const k of ['a', 'Escape', 'Delete', 'Tab', 'ArrowUp', ' ', 'F1', 'F3']) {
      expect(opensEditorOnKey(key(k), body, 'editable')).toBe(false);
    }
  });

  it('ignores a key pressed with a modifier', () => {
    for (const patch of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
      expect(opensEditorOnKey(key('Enter', patch), body, 'editable')).toBe(false);
    }
  });

  it('never fires while typing, or on a button or link', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'input', 'BUTTON', 'A', 'SUMMARY']) {
      expect(opensEditorOnKey(key('Enter'), { tag, contentEditable: false }, 'editable')).toBe(false);
    }
    expect(opensEditorOnKey(key('Enter'), { tag: 'DIV', contentEditable: true }, 'editable')).toBe(false);
  });

  it('needs an editable object', () => {
    for (const access of ['locked', 'no-settings', 'not-editable', null] as const) {
      expect(opensEditorOnKey(key('Enter'), body, access)).toBe(false);
    }
  });
});
