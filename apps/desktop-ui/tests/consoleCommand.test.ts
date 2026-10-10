import { describe, expect, it } from 'vitest';
import {
  COMMAND_HISTORY_LIMIT,
  addToHistory,
  commandPlaceholder,
  laserModeNote,
  laserModeSetting,
  normaliseCommand,
  stepHistory,
} from '../src/lib/consoleCommand';

describe('normaliseCommand', () => {
  it('trims the spaces around a command and nothing else', () => {
    expect(normaliseCommand('  $$  ')).toBe('$$');
    expect(normaliseCommand('G0  X1')).toBe('G0  X1');
    expect(normaliseCommand('   ')).toBe('');
  });
});

describe('addToHistory', () => {
  it('adds commands oldest to newest', () => {
    expect(addToHistory(addToHistory([], '$$'), '$I')).toEqual(['$$', '$I']);
  });

  it('keeps nothing for empty input and an immediate repeat', () => {
    expect(addToHistory(['$$'], '   ')).toEqual(['$$']);
    expect(addToHistory(['$$'], ' $$ ')).toEqual(['$$']);
    expect(addToHistory(['$$', '$I'], '$$')).toEqual(['$$', '$I', '$$']);
  });

  it('does not change the history it is given', () => {
    const before = ['$$'];
    const after = addToHistory(before, '$I');
    expect(before).toEqual(['$$']);
    expect(after).not.toBe(before);
  });

  it('forgets the oldest commands past the limit', () => {
    let history: string[] = [];
    for (let i = 0; i < COMMAND_HISTORY_LIMIT + 5; i += 1) history = addToHistory(history, `G0 X${i}`);
    expect(history.length).toBe(COMMAND_HISTORY_LIMIT);
    expect(history[history.length - 1]).toBe(`G0 X${COMMAND_HISTORY_LIMIT + 4}`);
    expect(history[0]).toBe('G0 X5');
  });
});

describe('stepHistory', () => {
  const history = ['$$', '$I', 'G0 X1'];

  it('does nothing with an empty history', () => {
    expect(stepHistory([], null, 'older')).toEqual({ index: null, text: null });
    expect(stepHistory([], null, 'newer')).toEqual({ index: null, text: null });
  });

  it('goes back from the newest command with the up arrow, and stops at the oldest', () => {
    const first = stepHistory(history, null, 'older');
    expect(first).toEqual({ index: 2, text: 'G0 X1' });
    const second = stepHistory(history, first.index, 'older');
    expect(second).toEqual({ index: 1, text: '$I' });
    const third = stepHistory(history, second.index, 'older');
    expect(third).toEqual({ index: 0, text: '$$' });
    expect(stepHistory(history, third.index, 'older')).toEqual({ index: 0, text: '$$' });
  });

  it('comes forward with the down arrow and ends on a fresh empty line', () => {
    expect(stepHistory(history, 0, 'newer')).toEqual({ index: 1, text: '$I' });
    expect(stepHistory(history, 1, 'newer')).toEqual({ index: 2, text: 'G0 X1' });
    expect(stepHistory(history, 2, 'newer')).toEqual({ index: null, text: '' });
  });

  it('leaves a line that is being typed alone when the down arrow is pressed', () => {
    expect(stepHistory(history, null, 'newer')).toEqual({ index: null, text: null });
  });

  it('copes with an index left over from a shorter history', () => {
    expect(stepHistory(['$$'], 7, 'older')).toEqual({ index: 0, text: '$$' });
  });
});

describe('laser mode in a $$ reply', () => {
  const replies = ['$0=10', '$1=25', '$30=1000', '$31=0', '$32=1', '$100=80.000'];

  it('finds $32', () => {
    expect(laserModeSetting(replies)).toBe(1);
    expect(laserModeSetting(['$32=0'])).toBe(0);
    expect(laserModeSetting(['$32 = 1'])).toBe(1);
  });

  it('is not fooled by other settings that start with the same digits', () => {
    expect(laserModeSetting(['$320=1', '$3=2'])).toBeNull();
    expect(laserModeSetting(['$132=300.000'])).toBeNull();
  });

  it('gives nothing when there is no $32 or it is not a mode', () => {
    expect(laserModeSetting([])).toBeNull();
    expect(laserModeSetting(['ok'])).toBeNull();
    expect(laserModeSetting(['$32=7'])).toBeNull();
  });

  it('says what to do when laser mode is off, and says nothing when there is nothing to say', () => {
    expect(laserModeNote(replies)).toContain('is ON');
    const off = laserModeNote(['$32=0']);
    expect(off).toContain('OFF');
    expect(off).toContain('$32=1');
    expect(laserModeNote(['$100=80'])).toBeNull();
  });
});

describe('commandPlaceholder', () => {
  it('explains each state the box can be in', () => {
    expect(commandPlaceholder({ connected: false, simulated: false, running: false })).toContain('Connect');
    expect(commandPlaceholder({ connected: true, simulated: true, running: false })).toContain('simulator');
    expect(commandPlaceholder({ connected: true, simulated: false, running: true })).toContain('STOP');
    expect(commandPlaceholder({ connected: true, simulated: false, running: false })).toContain('$$');
  });
});
