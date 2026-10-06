import { describe, expect, it } from 'vitest';
import {
  MACHINE_FORMAT,
  machineToEntry,
  parseMachineFile,
  parseSavedMachines,
  serializeMachineFile,
  serializeSavedMachines,
  validateMachineEntry,
} from '@/lib/configFormat';
import type { MachineProfile } from '@/types/domain';

const mach = (over: Record<string, unknown> = {}) => ({
  name: 'My laser', controller: 'grbl1_1', bed_width_mm: 300, bed_height_mm: 300, origin: 'bottom_left',
  max_feed_rate_mm_min: 10000, max_spindle_value: 1000, homing_supported: false, air_assist_supported: true, baud_rate: 115200, ...over,
});
const machFile = (machine: unknown) => JSON.stringify({ format: MACHINE_FORMAT, version: 1, machine });
const profile = (over: Record<string, unknown> = {}): MachineProfile => ({ id: 'secret-id', ...(mach(over) as Omit<MachineProfile, 'id'>) });

describe('machine files with a connection', () => {
  it('reads a WebSocket connection and trims the address', () => {
    const r = parseMachineFile(machFile(mach({ connection: { kind: 'websocket', host: ' fluidnc.local ', port: 81 } })));
    expect(r.machine.connection).toEqual({ kind: 'websocket', host: 'fluidnc.local', port: 81 });
  });
  it('treats a missing, empty or null connection as USB serial and keeps nothing', () => {
    expect(parseMachineFile(machFile(mach())).machine.connection).toBeUndefined();
    expect(parseMachineFile(machFile(mach({ connection: {} }))).machine.connection).toBeUndefined();
    expect(parseMachineFile(machFile(mach({ connection: null }))).machine.connection).toBeUndefined();
  });
  it('drops the address and port of a USB serial connection', () => {
    expect(parseMachineFile(machFile(mach({ connection: { kind: 'serial', host: 'ignored', port: 99999 } }))).machine.connection).toBeUndefined();
  });
  it('ignores fields it does not know inside the connection', () => {
    const r = parseMachineFile(machFile(mach({ connection: { kind: 'telnet', host: '10.0.0.5', tls: true } })));
    expect(r.machine.connection).toEqual({ kind: 'telnet', host: '10.0.0.5', port: 0 });
  });
  it('rejects a bad connection with a reason that names the field', () => {
    expect(() => parseMachineFile(machFile(mach({ connection: { kind: 'websocket' } })))).toThrow(/connection\.host: Enter the machine/);
    expect(() => parseMachineFile(machFile(mach({ connection: { kind: 'telnet', host: 'http://x' } })))).toThrow(/connection\.host/);
    expect(() => parseMachineFile(machFile(mach({ connection: { kind: 'telnet', host: 'x', port: 70000 } })))).toThrow(/connection\.port/);
    expect(() => parseMachineFile(machFile(mach({ connection: { kind: 'bluetooth' } })))).toThrow(/connection\.kind/);
    expect(() => parseMachineFile(machFile(mach({ connection: 'serial' })))).toThrow(/connection must be an object/);
  });
  it('reports connection problems together with other problems', () => {
    const r = validateMachineEntry(mach({ bed_width_mm: 5, connection: { kind: 'websocket', host: '' } }));
    expect(r.entry).toBeNull();
    expect(r.problems).toHaveLength(2);
  });
});

describe('writing a machine with a connection', () => {
  it('leaves the connection out for USB serial, so files stay exactly as they were', () => {
    expect(serializeMachineFile(profile())).not.toContain('connection');
    expect(serializeMachineFile(profile({ connection: { kind: 'serial', host: 'x', port: 5 } }))).not.toContain('connection');
    expect(machineToEntry(profile()).connection).toBeUndefined();
  });
  it('writes a network connection last, and round-trips it', () => {
    const p = profile({ connection: { kind: 'websocket', host: 'fluidnc.local', port: 0 } });
    const text = serializeMachineFile(p);
    const json = JSON.parse(text) as { machine: Record<string, unknown> };
    expect(Object.keys(json.machine).pop()).toBe('connection');
    expect(text).not.toContain('secret-id');
    expect(parseMachineFile(text).machine).toEqual(machineToEntry(p));
  });
  it('keeps the connection in saved machine presets', () => {
    const entry = validateMachineEntry(mach({ connection: { kind: 'telnet', host: '10.0.0.5', port: 23 } })).entry;
    expect(entry?.connection).toEqual({ kind: 'telnet', host: '10.0.0.5', port: 23 });
    const back = parseSavedMachines(serializeSavedMachines(entry ? [entry] : []));
    expect(back).toHaveLength(1);
    expect(back[0]?.connection).toEqual({ kind: 'telnet', host: '10.0.0.5', port: 23 });
  });
  it('drops a saved preset whose stored connection has become invalid', () => {
    const stored = JSON.stringify([mach({ name: 'Good' }), mach({ name: 'Bad', connection: { kind: 'websocket', host: 'a b' } })]);
    expect(parseSavedMachines(stored).map((m) => m.name)).toEqual(['Good']);
  });
  it('a machine with no connection is exactly what the old code produced', () => {
    const entry = validateMachineEntry(mach()).entry;
    expect(Object.keys(entry ?? {})).toEqual(['name', 'controller', 'bed_width_mm', 'bed_height_mm', 'origin', 'max_feed_rate_mm_min', 'max_spindle_value', 'homing_supported', 'air_assist_supported', 'baud_rate']);
  });
});
