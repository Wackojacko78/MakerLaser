import { describe, expect, it } from 'vitest';
import { decodeGrblMessage } from '@/lib/grblDiagnostics';

describe('GRBL diagnostics', () => {
  it('decodes alarm 2 as a soft limit', () => {
    const d = decodeGrblMessage('ALARM:2');
    expect(d?.kind).toBe('alarm');
    expect(d?.title).toContain('Soft limit');
  });

  it('decodes errors and tolerates trailing text', () => {
    expect(decodeGrblMessage('error:22')?.title).toBe('Feed rate undefined');
    expect(decodeGrblMessage('error:20 (line 5)')?.code).toBe(20);
  });

  it('reports unknown codes without throwing', () => {
    expect(decodeGrblMessage('error:250')?.title).toContain('Unknown');
  });

  it('ignores normal output', () => {
    expect(decodeGrblMessage('ok')).toBeNull();
    expect(decodeGrblMessage('<Idle|MPos:0,0,0>')).toBeNull();
  });
});
