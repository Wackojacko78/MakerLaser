import { describe, expect, it } from 'vitest';
import {
  CONNECTION_KINDS,
  connectionOf,
  connectionProblems,
  connectionToEntry,
  describeConnection,
  effectivePort,
  hostProblem,
  isNetwork,
  parseConnection,
} from '@/lib/connectionSettings';

describe('connectionOf', () => {
  it('treats a machine with no connection as USB serial', () => {
    expect(connectionOf({})).toEqual({ kind: 'serial', host: '', port: 0 });
    expect(connectionOf({ connection: null })).toEqual({ kind: 'serial', host: '', port: 0 });
    expect(isNetwork({})).toBe(false);
  });
  it('keeps a network connection and fills in gaps', () => {
    expect(connectionOf({ connection: { kind: 'websocket', host: 'fluidnc.local' } })).toEqual({ kind: 'websocket', host: 'fluidnc.local', port: 0 });
    expect(isNetwork({ connection: { kind: 'telnet', host: 'x', port: 23 } })).toBe(true);
  });
  it('falls back to USB serial for an unknown kind or junk values', () => {
    expect(connectionOf({ connection: { kind: 'bluetooth' as never } }).kind).toBe('serial');
    expect(connectionOf({ connection: { kind: 'telnet', host: 5 as never, port: Number.NaN } })).toEqual({ kind: 'telnet', host: '', port: 0 });
  });
  it('does not change what it was given', () => {
    const src = { connection: { kind: 'telnet' as const, host: 'a', port: 5 } };
    connectionOf(src).host = 'changed';
    expect(src.connection.host).toBe('a');
  });
});

describe('effectivePort', () => {
  it('uses the usual port for the kind unless one is typed', () => {
    expect(effectivePort({ kind: 'websocket', host: 'x', port: 0 })).toBe(81);
    expect(effectivePort({ kind: 'telnet', host: 'x', port: 0 })).toBe(23);
    expect(effectivePort({ kind: 'websocket', host: 'x', port: 80 })).toBe(80);
  });
  it('is null for USB serial, whatever the port field says', () => {
    expect(effectivePort({ kind: 'serial', host: '', port: 0 })).toBeNull();
    expect(effectivePort({ kind: 'serial', host: 'x', port: 81 })).toBeNull();
  });
});

describe('hostProblem', () => {
  it('accepts IP addresses and host names', () => {
    for (const h of ['192.168.1.50', '0.0.0.0', '255.255.255.255', 'fluidnc.local', 'laser-1', 'FluidNC', '3dprinter.local', '10.0.0.x', '  192.168.1.5  ']) {
      expect(hostProblem(h)).toBeNull();
    }
  });
  it('rejects empty addresses', () => {
    expect(hostProblem('')).toMatch(/Enter the machine/);
    expect(hostProblem('   ')).toMatch(/Enter the machine/);
  });
  it('rejects a scheme, a port, a path and spaces, and says to enter the port separately', () => {
    for (const h of ['http://fluidnc.local', 'fluidnc.local:81', 'a b', 'host/path', 'user@host', 'ho_st', '[::1]']) {
      expect(hostProblem(h)).toMatch(/may only contain/);
    }
    expect(hostProblem('fluidnc.local:81')).toMatch(/port separately/);
  });
  it('rejects malformed names', () => {
    expect(hostProblem('a..b')).toMatch(/empty part/);
    expect(hostProblem('.a')).toMatch(/empty part/);
    expect(hostProblem('a.')).toMatch(/empty part/);
    expect(hostProblem('-a')).toMatch(/hyphen/);
    expect(hostProblem('a-.b')).toMatch(/hyphen/);
    expect(hostProblem('a'.repeat(64))).toMatch(/63/);
    expect(hostProblem('a.'.repeat(130) + 'a')).toMatch(/too long/);
  });
  it('rejects things that look like an IP address but are not one', () => {
    for (const h of ['256.1.1.1', '1.2.3', '1.2.3.4.5', '1234', '0007.1.1.1', '1.2.3.999']) expect(hostProblem(h)).toMatch(/IP address/);
  });
});

describe('connectionProblems', () => {
  it('has nothing to say about USB serial', () => {
    expect(connectionProblems({ kind: 'serial', host: '', port: 0 })).toEqual([]);
    expect(connectionProblems({ kind: 'serial', host: 'rubbish!', port: -5 })).toEqual([]);
  });
  it('checks the address and the port of a network connection', () => {
    expect(connectionProblems({ kind: 'websocket', host: 'fluidnc.local', port: 0 })).toEqual([]);
    expect(connectionProblems({ kind: 'telnet', host: '10.0.0.5', port: 65535 })).toEqual([]);
    expect(connectionProblems({ kind: 'websocket', host: '', port: 81 })).toHaveLength(1);
    expect(connectionProblems({ kind: 'websocket', host: 'x', port: 65536 })).toHaveLength(1);
    expect(connectionProblems({ kind: 'websocket', host: 'x', port: -1 })).toHaveLength(1);
    expect(connectionProblems({ kind: 'websocket', host: 'x', port: 80.5 })).toHaveLength(1);
    expect(connectionProblems({ kind: 'websocket', host: '', port: -1 })).toHaveLength(2);
  });
});

describe('describeConnection', () => {
  it('names the connection', () => {
    expect(describeConnection({ kind: 'serial', host: '', port: 0 })).toBe('USB serial');
    expect(describeConnection({ kind: 'websocket', host: 'fluidnc.local', port: 0 })).toBe('WebSocket (FluidNC) fluidnc.local:81');
    expect(describeConnection({ kind: 'telnet', host: ' 10.0.0.5 ', port: 2323 })).toBe('Telnet / raw TCP 10.0.0.5:2323');
    expect(describeConnection({ kind: 'websocket', host: '', port: 0 })).toBe('WebSocket (FluidNC) (no address):81');
  });
});

describe('parseConnection', () => {
  it('has nothing to keep when absent or USB serial', () => {
    expect(parseConnection(undefined)).toEqual({ value: null, problems: [] });
    expect(parseConnection(null)).toEqual({ value: null, problems: [] });
    expect(parseConnection({})).toEqual({ value: null, problems: [] });
    expect(parseConnection({ kind: 'serial', host: 'ignored', port: 99999 })).toEqual({ value: null, problems: [] });
  });
  it('reads a network connection and trims the address', () => {
    expect(parseConnection({ kind: 'websocket', host: ' fluidnc.local ', port: 81 })).toEqual({ value: { kind: 'websocket', host: 'fluidnc.local', port: 81 }, problems: [] });
    expect(parseConnection({ kind: 'telnet', host: '10.0.0.5' }).value).toEqual({ kind: 'telnet', host: '10.0.0.5', port: 0 });
  });
  it('rejects bad kinds, shapes, addresses and ports, with a readable reason', () => {
    expect(parseConnection('serial').problems[0]).toMatch(/must be an object/);
    expect(parseConnection([]).problems[0]).toMatch(/must be an object/);
    expect(parseConnection({ kind: 'bluetooth' }).problems[0]).toMatch(/kind must be one of/);
    expect(parseConnection({ kind: 7 }).problems[0]).toMatch(/kind must be one of/);
    expect(parseConnection({ kind: 'websocket' }).problems[0]).toMatch(/connection\.host: Enter the machine/);
    expect(parseConnection({ kind: 'websocket', host: 5 }).problems[0]).toMatch(/host must be text/);
    expect(parseConnection({ kind: 'telnet', host: 'x', port: '23' }).problems[0]).toMatch(/port must be a whole number/);
    expect(parseConnection({ kind: 'telnet', host: 'x', port: 70000 }).problems[0]).toMatch(/port must be/);
    expect(parseConnection({ kind: 'telnet', host: 'x', port: 1.5 }).problems[0]).toMatch(/port must be/);
    expect(parseConnection({ kind: 'telnet', host: '', port: -1 }).problems).toHaveLength(2);
    expect(parseConnection({ kind: 'telnet', host: 'bad host' }).value).toBeNull();
  });
});

describe('connectionToEntry', () => {
  it('keeps nothing for USB serial and the trimmed settings otherwise', () => {
    expect(connectionToEntry(undefined)).toBeUndefined();
    expect(connectionToEntry({ kind: 'serial', host: 'x', port: 5 })).toBeUndefined();
    expect(connectionToEntry({ kind: 'websocket', host: ' h ', port: 80 })).toEqual({ kind: 'websocket', host: 'h', port: 80 });
  });
  it('knows exactly three kinds', () => {
    expect([...CONNECTION_KINDS]).toEqual(['serial', 'websocket', 'telnet']);
  });
});
