// How MakerLaser reaches a machine: a USB serial port (how it works today), or a network
// address for controllers that speak the GRBL protocol over WebSocket or Telnet (FluidNC).
//
// Pure TypeScript (no React, Konva or Tauri imports), so it is unit-tested in plain Node
// (tests/connectionSettings.test.ts). The address rules mirror `host_problem` in
// packages/common/src/machine.rs: keep the two in step.
//
// Only USB serial can connect for now. A machine set to a network connection is stored,
// validated, saved and exported, and MakerLaser says plainly that it cannot connect yet.

import type { ConnectionKind, ConnectionSettings } from '@/types/domain';

export const CONNECTION_KINDS: readonly ConnectionKind[] = ['serial', 'websocket', 'telnet'];

/** FluidNC's usual ports: the WebSocket port is the HTTP port plus one; Telnet is 23. */
export const DEFAULT_PORT: Readonly<Record<ConnectionKind, number | null>> = { serial: null, websocket: 81, telnet: 23 };

export const KIND_LABEL: Readonly<Record<ConnectionKind, string>> = {
  serial: 'USB serial',
  websocket: 'WebSocket (FluidNC)',
  telnet: 'Telnet / raw TCP',
};

/** Same wording as the refusal in apps/rust-core (machine_connect). */
export const NETWORK_NOT_READY =
  'This machine is set to connect over the network, which MakerLaser cannot do yet. Choose USB serial in the Machine window, or use the simulator.';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The connection of a machine with any gaps filled in. Older files have none: that means USB serial. */
export function connectionOf(m: { connection?: Partial<ConnectionSettings> | null }): ConnectionSettings {
  const c = m.connection;
  const kind = c && CONNECTION_KINDS.includes(c.kind as ConnectionKind) ? (c.kind as ConnectionKind) : 'serial';
  return {
    kind,
    host: typeof c?.host === 'string' ? c.host : '',
    port: typeof c?.port === 'number' && Number.isFinite(c.port) ? c.port : 0,
  };
}

export const isNetwork = (m: { connection?: Partial<ConnectionSettings> | null }): boolean => connectionOf(m).kind !== 'serial';

/** The port that will be used: the typed one, else the usual one for the kind. Null for USB serial. */
export function effectivePort(c: ConnectionSettings): number | null {
  if (c.kind === 'serial') return null;
  return c.port > 0 ? c.port : DEFAULT_PORT[c.kind];
}

/** Why `raw` cannot be a machine address, or null when it can. IPv4 addresses and host names only. */
export function hostProblem(raw: string): string | null {
  const host = raw.trim();
  if (host === '') return "Enter the machine's address, for example 192.168.1.50 or fluidnc.local.";
  if (host.length > 253) return 'The address is too long.';
  if (!/^[A-Za-z0-9.-]+$/.test(host)) {
    return 'The address may only contain letters, digits, hyphens and dots. Leave out http://, spaces, paths and the port number: enter the port separately.';
  }
  const labels = host.split('.');
  if (labels.some((l) => l === '')) return 'The address has an empty part (two dots in a row, or a dot at the start or end).';
  if (labels.some((l) => l.length > 63)) return 'Each part of the address must be 63 characters or fewer.';
  if (labels.some((l) => l.startsWith('-') || l.endsWith('-'))) return 'A part of the address cannot start or end with a hyphen.';
  if (labels.every((l) => /^[0-9]+$/.test(l))) {
    const valid = labels.length === 4 && labels.every((l) => l.length <= 3 && Number(l) <= 255);
    if (!valid) return 'That looks like an IP address but is not a valid one: it needs four numbers from 0 to 255, like 192.168.1.50.';
  }
  return null;
}

/** Problems with a connection (empty when fine). USB serial has nothing to check. */
export function connectionProblems(c: ConnectionSettings): string[] {
  if (c.kind === 'serial') return [];
  const problems: string[] = [];
  const h = hostProblem(c.host);
  if (h) problems.push(h);
  if (!Number.isInteger(c.port) || c.port < 0 || c.port > 65535) {
    problems.push('The port must be a whole number from 1 to 65535, or 0 to use the usual port.');
  }
  return problems;
}

/** "USB serial", or "WebSocket (FluidNC) fluidnc.local:81". */
export function describeConnection(c: ConnectionSettings): string {
  if (c.kind === 'serial') return KIND_LABEL.serial;
  const port = effectivePort(c);
  return `${KIND_LABEL[c.kind]} ${c.host.trim() || '(no address)'}${port ? `:${port}` : ''}`;
}

/**
 * Reads the `connection` part of a machine file. `value` is null when there is nothing to keep
 * (absent, or USB serial: its address and port are ignored); the machine then uses USB serial.
 */
export function parseConnection(raw: unknown): { value: ConnectionSettings | null; problems: string[] } {
  if (raw === undefined || raw === null) return { value: null, problems: [] };
  if (!isObj(raw)) return { value: null, problems: ['connection must be an object'] };
  const kind = raw.kind ?? 'serial';
  if (typeof kind !== 'string' || !CONNECTION_KINDS.includes(kind as ConnectionKind)) {
    return { value: null, problems: ['connection.kind must be one of serial, websocket, telnet'] };
  }
  if (kind === 'serial') return { value: null, problems: [] };

  const problems: string[] = [];
  const host = raw.host ?? '';
  const port = raw.port ?? 0;
  if (typeof host !== 'string') problems.push('connection.host must be text');
  else {
    const h = hostProblem(host);
    if (h) problems.push(`connection.host: ${h}`);
  }
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535) {
    problems.push('connection.port must be a whole number from 0 to 65535 (0 means the usual port)');
  }
  if (problems.length > 0) return { value: null, problems };
  return { value: { kind: kind as ConnectionKind, host: (host as string).trim(), port: port as number }, problems };
}

/** What a file or saved preset keeps: nothing for USB serial, the trimmed settings otherwise. */
export function connectionToEntry(c: Partial<ConnectionSettings> | null | undefined): ConnectionSettings | undefined {
  const full = connectionOf({ connection: c });
  if (full.kind === 'serial') return undefined;
  return { kind: full.kind, host: full.host.trim(), port: full.port };
}
