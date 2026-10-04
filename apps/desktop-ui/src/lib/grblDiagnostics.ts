// Decodes raw GRBL `error:n` / `ALARM:n` text for the console. The Rust side already
// decodes errors raised during a job (packages/machine/src/grbl_codes.rs); this covers
// anything pasted or echoed into the console.

export interface Diagnostic {
  kind: 'error' | 'alarm';
  code: number;
  title: string;
  raw: string;
}

const ERRORS: Record<number, string> = {
  1: 'Expected command letter',
  2: 'Bad number format',
  3: 'Invalid system command',
  5: 'Homing not enabled',
  8: 'Machine not idle',
  9: 'G-code locked out (clear the alarm first)',
  11: 'Line overflow',
  13: 'Safety door open',
  15: 'Travel exceeded',
  20: 'Unsupported G-code command',
  21: 'Modal group violation',
  22: 'Feed rate undefined',
  24: 'Invalid target',
  33: 'Invalid motion target',
};

const ALARMS: Record<number, string> = {
  1: 'Hard limit triggered',
  2: 'Soft limit: target beyond machine travel',
  3: 'Reset while moving: position lost, re-home',
  4: 'Probe fail',
  5: 'Probe fail',
  6: 'Homing failed: cycle reset',
  7: 'Homing failed: door opened',
  8: 'Homing failed: pull-off',
  9: 'Homing failed: no switch found',
};

export function decodeGrblMessage(raw: string): Diagnostic | null {
  const m = raw.trim().match(/^(error:|ALARM:)(\d+)/i);
  if (!m) return null;
  const kind = m[1].toLowerCase().startsWith('alarm') ? 'alarm' : 'error';
  const code = Number(m[2]);
  const table = kind === 'alarm' ? ALARMS : ERRORS;
  return { kind, code, title: table[code] ?? `Unknown GRBL ${kind}`, raw };
}
