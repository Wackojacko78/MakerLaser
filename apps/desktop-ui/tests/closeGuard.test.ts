import { describe, expect, it } from 'vitest';
import { nextCloseStep, saveQuestion, stepAfterStop } from '@/lib/closeGuard';

describe('nextCloseStep', () => {
  it('lets a clean, idle window close', () => {
    expect(nextCloseStep(false, false)).toBe('close');
  });
  it('asks to save when there are unsaved changes', () => {
    expect(nextCloseStep(false, true)).toBe('save');
  });
  it('asks about the running job first, whether or not there are unsaved changes', () => {
    expect(nextCloseStep(true, false)).toBe('stop-job');
    expect(nextCloseStep(true, true)).toBe('stop-job');
  });
});

describe('stepAfterStop', () => {
  it('goes on to the save question only when there is something to save', () => {
    expect(stepAfterStop(true)).toBe('save');
    expect(stepAfterStop(false)).toBe('close');
  });
});

describe('saveQuestion', () => {
  it('names the project', () => {
    expect(saveQuestion('Coaster set')).toBe('Save changes to \u201cCoaster set\u201d?');
  });
  it('trims, shortens long names and copes with an empty name', () => {
    expect(saveQuestion('  Box  ')).toBe('Save changes to \u201cBox\u201d?');
    expect(saveQuestion('x'.repeat(60))).toBe(`Save changes to \u201c${'x'.repeat(40)}\u2026\u201d?`);
    expect(saveQuestion('   ')).toBe('Save changes to this project?');
  });
});
