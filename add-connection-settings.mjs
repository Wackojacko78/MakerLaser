#!/usr/bin/env node
// Adds the machine "connection" setting (USB serial, WebSocket or Telnet) to MakerLaser.
// Run from the repo root (the folder with package.json):  node add-connection-settings.mjs
//
// It works out EVERY edit in memory first, and only writes if all of them succeed, so it
// never half-applies. Running it twice changes nothing the second time.
import fs from 'node:fs';
import path from 'node:path';

const FILES = {"apps/desktop-ui/src/lib/connectionSettings.ts":"// How MakerLaser reaches a machine: a USB serial port (how it works today), or a network\n// address for controllers that speak the GRBL protocol over WebSocket or Telnet (FluidNC).\n//\n// Pure TypeScript (no React, Konva or Tauri imports), so it is unit-tested in plain Node\n// (tests/connectionSettings.test.ts). The address rules mirror `host_problem` in\n// packages/common/src/machine.rs: keep the two in step.\n//\n// Only USB serial can connect for now. A machine set to a network connection is stored,\n// validated, saved and exported, and MakerLaser says plainly that it cannot connect yet.\n\nimport type { ConnectionKind, ConnectionSettings } from '@/types/domain';\n\nexport const CONNECTION_KINDS: readonly ConnectionKind[] = ['serial', 'websocket', 'telnet'];\n\n/** FluidNC's usual ports: the WebSocket port is the HTTP port plus one; Telnet is 23. */\nexport const DEFAULT_PORT: Readonly<Record<ConnectionKind, number | null>> = { serial: null, websocket: 81, telnet: 23 };\n\nexport const KIND_LABEL: Readonly<Record<ConnectionKind, string>> = {\n  serial: 'USB serial',\n  websocket: 'WebSocket (FluidNC)',\n  telnet: 'Telnet / raw TCP',\n};\n\n/** Same wording as the refusal in apps/rust-core (machine_connect). */\nexport const NETWORK_NOT_READY =\n  'This machine is set to connect over the network, which MakerLaser cannot do yet. Choose USB serial in the Machine window, or use the simulator.';\n\ntype Obj = Record<string, unknown>;\nconst isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);\n\n/** The connection of a machine with any gaps filled in. Older files have none: that means USB serial. */\nexport function connectionOf(m: { connection?: Partial<ConnectionSettings> | null }): ConnectionSettings {\n  const c = m.connection;\n  const kind = c && CONNECTION_KINDS.includes(c.kind as ConnectionKind) ? (c.kind as ConnectionKind) : 'serial';\n  return {\n    kind,\n    host: typeof c?.host === 'string' ? c.host : '',\n    port: typeof c?.port === 'number' && Number.isFinite(c.port) ? c.port : 0,\n  };\n}\n\nexport const isNetwork = (m: { connection?: Partial<ConnectionSettings> | null }): boolean => connectionOf(m).kind !== 'serial';\n\n/** The port that will be used: the typed one, else the usual one for the kind. Null for USB serial. */\nexport function effectivePort(c: ConnectionSettings): number | null {\n  if (c.kind === 'serial') return null;\n  return c.port > 0 ? c.port : DEFAULT_PORT[c.kind];\n}\n\n/** Why `raw` cannot be a machine address, or null when it can. IPv4 addresses and host names only. */\nexport function hostProblem(raw: string): string | null {\n  const host = raw.trim();\n  if (host === '') return \"Enter the machine's address, for example 192.168.1.50 or fluidnc.local.\";\n  if (host.length > 253) return 'The address is too long.';\n  if (!/^[A-Za-z0-9.-]+$/.test(host)) {\n    return 'The address may only contain letters, digits, hyphens and dots. Leave out http://, spaces, paths and the port number: enter the port separately.';\n  }\n  const labels = host.split('.');\n  if (labels.some((l) => l === '')) return 'The address has an empty part (two dots in a row, or a dot at the start or end).';\n  if (labels.some((l) => l.length > 63)) return 'Each part of the address must be 63 characters or fewer.';\n  if (labels.some((l) => l.startsWith('-') || l.endsWith('-'))) return 'A part of the address cannot start or end with a hyphen.';\n  if (labels.every((l) => /^[0-9]+$/.test(l))) {\n    const valid = labels.length === 4 && labels.every((l) => l.length <= 3 && Number(l) <= 255);\n    if (!valid) return 'That looks like an IP address but is not a valid one: it needs four numbers from 0 to 255, like 192.168.1.50.';\n  }\n  return null;\n}\n\n/** Problems with a connection (empty when fine). USB serial has nothing to check. */\nexport function connectionProblems(c: ConnectionSettings): string[] {\n  if (c.kind === 'serial') return [];\n  const problems: string[] = [];\n  const h = hostProblem(c.host);\n  if (h) problems.push(h);\n  if (!Number.isInteger(c.port) || c.port < 0 || c.port > 65535) {\n    problems.push('The port must be a whole number from 1 to 65535, or 0 to use the usual port.');\n  }\n  return problems;\n}\n\n/** \"USB serial\", or \"WebSocket (FluidNC) fluidnc.local:81\". */\nexport function describeConnection(c: ConnectionSettings): string {\n  if (c.kind === 'serial') return KIND_LABEL.serial;\n  const port = effectivePort(c);\n  return `${KIND_LABEL[c.kind]} ${c.host.trim() || '(no address)'}${port ? `:${port}` : ''}`;\n}\n\n/**\n * Reads the `connection` part of a machine file. `value` is null when there is nothing to keep\n * (absent, or USB serial: its address and port are ignored); the machine then uses USB serial.\n */\nexport function parseConnection(raw: unknown): { value: ConnectionSettings | null; problems: string[] } {\n  if (raw === undefined || raw === null) return { value: null, problems: [] };\n  if (!isObj(raw)) return { value: null, problems: ['connection must be an object'] };\n  const kind = raw.kind ?? 'serial';\n  if (typeof kind !== 'string' || !CONNECTION_KINDS.includes(kind as ConnectionKind)) {\n    return { value: null, problems: ['connection.kind must be one of serial, websocket, telnet'] };\n  }\n  if (kind === 'serial') return { value: null, problems: [] };\n\n  const problems: string[] = [];\n  const host = raw.host ?? '';\n  const port = raw.port ?? 0;\n  if (typeof host !== 'string') problems.push('connection.host must be text');\n  else {\n    const h = hostProblem(host);\n    if (h) problems.push(`connection.host: ${h}`);\n  }\n  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535) {\n    problems.push('connection.port must be a whole number from 0 to 65535 (0 means the usual port)');\n  }\n  if (problems.length > 0) return { value: null, problems };\n  return { value: { kind: kind as ConnectionKind, host: (host as string).trim(), port: port as number }, problems };\n}\n\n/** What a file or saved preset keeps: nothing for USB serial, the trimmed settings otherwise. */\nexport function connectionToEntry(c: Partial<ConnectionSettings> | null | undefined): ConnectionSettings | undefined {\n  const full = connectionOf({ connection: c });\n  if (full.kind === 'serial') return undefined;\n  return { kind: full.kind, host: full.host.trim(), port: full.port };\n}\n","apps/desktop-ui/src/components/MachineConnectionFields.tsx":"import { NumberField } from '@/components/NumberField';\nimport {\n  CONNECTION_KINDS,\n  KIND_LABEL,\n  NETWORK_NOT_READY,\n  connectionOf,\n  connectionProblems,\n  describeConnection,\n} from '@/lib/connectionSettings';\nimport { useProjectStore } from '@/state/projectStore';\nimport type { ConnectionKind } from '@/types/domain';\n\n/**\n * The Connection rows of the Machine window: USB serial, or a network address for FluidNC.\n * Rendered inside the window's two-column grid, so everything here is a label and a control.\n */\nexport function MachineConnectionFields() {\n  const project = useProjectStore((s) => s.project);\n  const mutate = useProjectStore((s) => s.mutate);\n  if (!project) return null;\n  const c = connectionOf(project.machine);\n  const network = c.kind !== 'serial';\n\n  const setKind = (kind: ConnectionKind) =>\n    mutate((p) => {\n      if (kind === 'serial') {\n        delete p.machine.connection;\n        return;\n      }\n      const current = connectionOf(p.machine);\n      p.machine.connection = { kind, host: current.host, port: current.port };\n    }, 'machine-connection-kind');\n\n  const setHost = (host: string) =>\n    mutate((p) => {\n      const current = connectionOf(p.machine);\n      if (current.kind !== 'serial') p.machine.connection = { ...current, host };\n    }, 'machine-connection-host');\n\n  const setPort = (port: number) =>\n    mutate((p) => {\n      const current = connectionOf(p.machine);\n      if (current.kind !== 'serial') p.machine.connection = { ...current, port };\n    }, 'machine-connection-port');\n\n  const problems = network ? connectionProblems(c) : [];\n\n  return (\n    <>\n      <label>Connection</label>\n      <select value={c.kind} onChange={(e) => setKind(e.target.value as ConnectionKind)}>\n        {CONNECTION_KINDS.map((k) => (\n          <option key={k} value={k}>{KIND_LABEL[k]}</option>\n        ))}\n      </select>\n      {network && (\n        <>\n          <label>Address</label>\n          <input value={c.host} placeholder=\"192.168.1.50 or fluidnc.local\" onChange={(e) => setHost(e.target.value)} />\n          <label>Port</label>\n          <NumberField\n            value={c.port}\n            min={0}\n            max={65535}\n            onCommit={(v) => setPort(Math.round(v))}\n            title=\"0 means the usual port: 81 for WebSocket, 23 for Telnet\"\n          />\n          <span />\n          <span className=\"hint\">{problems.length > 0 ? problems.join(' ') : `${describeConnection(c)}. ${NETWORK_NOT_READY}`}</span>\n        </>\n      )}\n    </>\n  );\n}\n","apps/desktop-ui/tests/connectionSettings.test.ts":"import { describe, expect, it } from 'vitest';\nimport {\n  CONNECTION_KINDS,\n  connectionOf,\n  connectionProblems,\n  connectionToEntry,\n  describeConnection,\n  effectivePort,\n  hostProblem,\n  isNetwork,\n  parseConnection,\n} from '@/lib/connectionSettings';\n\ndescribe('connectionOf', () => {\n  it('treats a machine with no connection as USB serial', () => {\n    expect(connectionOf({})).toEqual({ kind: 'serial', host: '', port: 0 });\n    expect(connectionOf({ connection: null })).toEqual({ kind: 'serial', host: '', port: 0 });\n    expect(isNetwork({})).toBe(false);\n  });\n  it('keeps a network connection and fills in gaps', () => {\n    expect(connectionOf({ connection: { kind: 'websocket', host: 'fluidnc.local' } })).toEqual({ kind: 'websocket', host: 'fluidnc.local', port: 0 });\n    expect(isNetwork({ connection: { kind: 'telnet', host: 'x', port: 23 } })).toBe(true);\n  });\n  it('falls back to USB serial for an unknown kind or junk values', () => {\n    expect(connectionOf({ connection: { kind: 'bluetooth' as never } }).kind).toBe('serial');\n    expect(connectionOf({ connection: { kind: 'telnet', host: 5 as never, port: Number.NaN } })).toEqual({ kind: 'telnet', host: '', port: 0 });\n  });\n  it('does not change what it was given', () => {\n    const src = { connection: { kind: 'telnet' as const, host: 'a', port: 5 } };\n    connectionOf(src).host = 'changed';\n    expect(src.connection.host).toBe('a');\n  });\n});\n\ndescribe('effectivePort', () => {\n  it('uses the usual port for the kind unless one is typed', () => {\n    expect(effectivePort({ kind: 'websocket', host: 'x', port: 0 })).toBe(81);\n    expect(effectivePort({ kind: 'telnet', host: 'x', port: 0 })).toBe(23);\n    expect(effectivePort({ kind: 'websocket', host: 'x', port: 80 })).toBe(80);\n  });\n  it('is null for USB serial, whatever the port field says', () => {\n    expect(effectivePort({ kind: 'serial', host: '', port: 0 })).toBeNull();\n    expect(effectivePort({ kind: 'serial', host: 'x', port: 81 })).toBeNull();\n  });\n});\n\ndescribe('hostProblem', () => {\n  it('accepts IP addresses and host names', () => {\n    for (const h of ['192.168.1.50', '0.0.0.0', '255.255.255.255', 'fluidnc.local', 'laser-1', 'FluidNC', '3dprinter.local', '10.0.0.x', '  192.168.1.5  ']) {\n      expect(hostProblem(h)).toBeNull();\n    }\n  });\n  it('rejects empty addresses', () => {\n    expect(hostProblem('')).toMatch(/Enter the machine/);\n    expect(hostProblem('   ')).toMatch(/Enter the machine/);\n  });\n  it('rejects a scheme, a port, a path and spaces, and says to enter the port separately', () => {\n    for (const h of ['http://fluidnc.local', 'fluidnc.local:81', 'a b', 'host/path', 'user@host', 'ho_st', '[::1]']) {\n      expect(hostProblem(h)).toMatch(/may only contain/);\n    }\n    expect(hostProblem('fluidnc.local:81')).toMatch(/port separately/);\n  });\n  it('rejects malformed names', () => {\n    expect(hostProblem('a..b')).toMatch(/empty part/);\n    expect(hostProblem('.a')).toMatch(/empty part/);\n    expect(hostProblem('a.')).toMatch(/empty part/);\n    expect(hostProblem('-a')).toMatch(/hyphen/);\n    expect(hostProblem('a-.b')).toMatch(/hyphen/);\n    expect(hostProblem('a'.repeat(64))).toMatch(/63/);\n    expect(hostProblem('a.'.repeat(130) + 'a')).toMatch(/too long/);\n  });\n  it('rejects things that look like an IP address but are not one', () => {\n    for (const h of ['256.1.1.1', '1.2.3', '1.2.3.4.5', '1234', '0007.1.1.1', '1.2.3.999']) expect(hostProblem(h)).toMatch(/IP address/);\n  });\n});\n\ndescribe('connectionProblems', () => {\n  it('has nothing to say about USB serial', () => {\n    expect(connectionProblems({ kind: 'serial', host: '', port: 0 })).toEqual([]);\n    expect(connectionProblems({ kind: 'serial', host: 'rubbish!', port: -5 })).toEqual([]);\n  });\n  it('checks the address and the port of a network connection', () => {\n    expect(connectionProblems({ kind: 'websocket', host: 'fluidnc.local', port: 0 })).toEqual([]);\n    expect(connectionProblems({ kind: 'telnet', host: '10.0.0.5', port: 65535 })).toEqual([]);\n    expect(connectionProblems({ kind: 'websocket', host: '', port: 81 })).toHaveLength(1);\n    expect(connectionProblems({ kind: 'websocket', host: 'x', port: 65536 })).toHaveLength(1);\n    expect(connectionProblems({ kind: 'websocket', host: 'x', port: -1 })).toHaveLength(1);\n    expect(connectionProblems({ kind: 'websocket', host: 'x', port: 80.5 })).toHaveLength(1);\n    expect(connectionProblems({ kind: 'websocket', host: '', port: -1 })).toHaveLength(2);\n  });\n});\n\ndescribe('describeConnection', () => {\n  it('names the connection', () => {\n    expect(describeConnection({ kind: 'serial', host: '', port: 0 })).toBe('USB serial');\n    expect(describeConnection({ kind: 'websocket', host: 'fluidnc.local', port: 0 })).toBe('WebSocket (FluidNC) fluidnc.local:81');\n    expect(describeConnection({ kind: 'telnet', host: ' 10.0.0.5 ', port: 2323 })).toBe('Telnet / raw TCP 10.0.0.5:2323');\n    expect(describeConnection({ kind: 'websocket', host: '', port: 0 })).toBe('WebSocket (FluidNC) (no address):81');\n  });\n});\n\ndescribe('parseConnection', () => {\n  it('has nothing to keep when absent or USB serial', () => {\n    expect(parseConnection(undefined)).toEqual({ value: null, problems: [] });\n    expect(parseConnection(null)).toEqual({ value: null, problems: [] });\n    expect(parseConnection({})).toEqual({ value: null, problems: [] });\n    expect(parseConnection({ kind: 'serial', host: 'ignored', port: 99999 })).toEqual({ value: null, problems: [] });\n  });\n  it('reads a network connection and trims the address', () => {\n    expect(parseConnection({ kind: 'websocket', host: ' fluidnc.local ', port: 81 })).toEqual({ value: { kind: 'websocket', host: 'fluidnc.local', port: 81 }, problems: [] });\n    expect(parseConnection({ kind: 'telnet', host: '10.0.0.5' }).value).toEqual({ kind: 'telnet', host: '10.0.0.5', port: 0 });\n  });\n  it('rejects bad kinds, shapes, addresses and ports, with a readable reason', () => {\n    expect(parseConnection('serial').problems[0]).toMatch(/must be an object/);\n    expect(parseConnection([]).problems[0]).toMatch(/must be an object/);\n    expect(parseConnection({ kind: 'bluetooth' }).problems[0]).toMatch(/kind must be one of/);\n    expect(parseConnection({ kind: 7 }).problems[0]).toMatch(/kind must be one of/);\n    expect(parseConnection({ kind: 'websocket' }).problems[0]).toMatch(/connection\\.host: Enter the machine/);\n    expect(parseConnection({ kind: 'websocket', host: 5 }).problems[0]).toMatch(/host must be text/);\n    expect(parseConnection({ kind: 'telnet', host: 'x', port: '23' }).problems[0]).toMatch(/port must be a whole number/);\n    expect(parseConnection({ kind: 'telnet', host: 'x', port: 70000 }).problems[0]).toMatch(/port must be/);\n    expect(parseConnection({ kind: 'telnet', host: 'x', port: 1.5 }).problems[0]).toMatch(/port must be/);\n    expect(parseConnection({ kind: 'telnet', host: '', port: -1 }).problems).toHaveLength(2);\n    expect(parseConnection({ kind: 'telnet', host: 'bad host' }).value).toBeNull();\n  });\n});\n\ndescribe('connectionToEntry', () => {\n  it('keeps nothing for USB serial and the trimmed settings otherwise', () => {\n    expect(connectionToEntry(undefined)).toBeUndefined();\n    expect(connectionToEntry({ kind: 'serial', host: 'x', port: 5 })).toBeUndefined();\n    expect(connectionToEntry({ kind: 'websocket', host: ' h ', port: 80 })).toEqual({ kind: 'websocket', host: 'h', port: 80 });\n  });\n  it('knows exactly three kinds', () => {\n    expect([...CONNECTION_KINDS]).toEqual(['serial', 'websocket', 'telnet']);\n  });\n});\n","apps/desktop-ui/tests/configFormatConnection.test.ts":"import { describe, expect, it } from 'vitest';\nimport {\n  MACHINE_FORMAT,\n  machineToEntry,\n  parseMachineFile,\n  parseSavedMachines,\n  serializeMachineFile,\n  serializeSavedMachines,\n  validateMachineEntry,\n} from '@/lib/configFormat';\nimport type { MachineProfile } from '@/types/domain';\n\nconst mach = (over: Record<string, unknown> = {}) => ({\n  name: 'My laser', controller: 'grbl1_1', bed_width_mm: 300, bed_height_mm: 300, origin: 'bottom_left',\n  max_feed_rate_mm_min: 10000, max_spindle_value: 1000, homing_supported: false, air_assist_supported: true, baud_rate: 115200, ...over,\n});\nconst machFile = (machine: unknown) => JSON.stringify({ format: MACHINE_FORMAT, version: 1, machine });\nconst profile = (over: Record<string, unknown> = {}): MachineProfile => ({ id: 'secret-id', ...(mach(over) as Omit<MachineProfile, 'id'>) });\n\ndescribe('machine files with a connection', () => {\n  it('reads a WebSocket connection and trims the address', () => {\n    const r = parseMachineFile(machFile(mach({ connection: { kind: 'websocket', host: ' fluidnc.local ', port: 81 } })));\n    expect(r.machine.connection).toEqual({ kind: 'websocket', host: 'fluidnc.local', port: 81 });\n  });\n  it('treats a missing, empty or null connection as USB serial and keeps nothing', () => {\n    expect(parseMachineFile(machFile(mach())).machine.connection).toBeUndefined();\n    expect(parseMachineFile(machFile(mach({ connection: {} }))).machine.connection).toBeUndefined();\n    expect(parseMachineFile(machFile(mach({ connection: null }))).machine.connection).toBeUndefined();\n  });\n  it('drops the address and port of a USB serial connection', () => {\n    expect(parseMachineFile(machFile(mach({ connection: { kind: 'serial', host: 'ignored', port: 99999 } }))).machine.connection).toBeUndefined();\n  });\n  it('ignores fields it does not know inside the connection', () => {\n    const r = parseMachineFile(machFile(mach({ connection: { kind: 'telnet', host: '10.0.0.5', tls: true } })));\n    expect(r.machine.connection).toEqual({ kind: 'telnet', host: '10.0.0.5', port: 0 });\n  });\n  it('rejects a bad connection with a reason that names the field', () => {\n    expect(() => parseMachineFile(machFile(mach({ connection: { kind: 'websocket' } })))).toThrow(/connection\\.host: Enter the machine/);\n    expect(() => parseMachineFile(machFile(mach({ connection: { kind: 'telnet', host: 'http://x' } })))).toThrow(/connection\\.host/);\n    expect(() => parseMachineFile(machFile(mach({ connection: { kind: 'telnet', host: 'x', port: 70000 } })))).toThrow(/connection\\.port/);\n    expect(() => parseMachineFile(machFile(mach({ connection: { kind: 'bluetooth' } })))).toThrow(/connection\\.kind/);\n    expect(() => parseMachineFile(machFile(mach({ connection: 'serial' })))).toThrow(/connection must be an object/);\n  });\n  it('reports connection problems together with other problems', () => {\n    const r = validateMachineEntry(mach({ bed_width_mm: 5, connection: { kind: 'websocket', host: '' } }));\n    expect(r.entry).toBeNull();\n    expect(r.problems).toHaveLength(2);\n  });\n});\n\ndescribe('writing a machine with a connection', () => {\n  it('leaves the connection out for USB serial, so files stay exactly as they were', () => {\n    expect(serializeMachineFile(profile())).not.toContain('connection');\n    expect(serializeMachineFile(profile({ connection: { kind: 'serial', host: 'x', port: 5 } }))).not.toContain('connection');\n    expect(machineToEntry(profile()).connection).toBeUndefined();\n  });\n  it('writes a network connection last, and round-trips it', () => {\n    const p = profile({ connection: { kind: 'websocket', host: 'fluidnc.local', port: 0 } });\n    const text = serializeMachineFile(p);\n    const json = JSON.parse(text) as { machine: Record<string, unknown> };\n    expect(Object.keys(json.machine).pop()).toBe('connection');\n    expect(text).not.toContain('secret-id');\n    expect(parseMachineFile(text).machine).toEqual(machineToEntry(p));\n  });\n  it('keeps the connection in saved machine presets', () => {\n    const entry = validateMachineEntry(mach({ connection: { kind: 'telnet', host: '10.0.0.5', port: 23 } })).entry;\n    expect(entry?.connection).toEqual({ kind: 'telnet', host: '10.0.0.5', port: 23 });\n    const back = parseSavedMachines(serializeSavedMachines(entry ? [entry] : []));\n    expect(back).toHaveLength(1);\n    expect(back[0]?.connection).toEqual({ kind: 'telnet', host: '10.0.0.5', port: 23 });\n  });\n  it('drops a saved preset whose stored connection has become invalid', () => {\n    const stored = JSON.stringify([mach({ name: 'Good' }), mach({ name: 'Bad', connection: { kind: 'websocket', host: 'a b' } })]);\n    expect(parseSavedMachines(stored).map((m) => m.name)).toEqual(['Good']);\n  });\n  it('a machine with no connection is exactly what the old code produced', () => {\n    const entry = validateMachineEntry(mach()).entry;\n    expect(Object.keys(entry ?? {})).toEqual(['name', 'controller', 'bed_width_mm', 'bed_height_mm', 'origin', 'max_feed_rate_mm_min', 'max_spindle_value', 'homing_supported', 'air_assist_supported', 'baud_rate']);\n  });\n});\n","docs/connection.md":"# Machine connection setting\n\nA machine profile can say how MakerLaser reaches the machine:\n\n| Kind | Meaning | Address | Port |\n|---|---|---|---|\n| `serial` | USB serial port (the default, and how it has always worked) | not used | not used |\n| `websocket` | WebSocket to a network controller such as FluidNC | host name or IPv4 address | `0` = usual port, 81 |\n| `telnet` | Raw TCP (Telnet) to a network controller such as FluidNC | host name or IPv4 address | `0` = usual port, 23 |\n\n**Only USB serial can connect today.** A machine set to `websocket` or `telnet` is stored, validated, saved in the\nproject, in saved presets and in machine files, but pressing Connect says so and does nothing. (The simulator still\nworks.) Network connections are the next step.\n\n## Where to set it\n\nMachine window, **Connection**. Choosing a preset or importing a machine file that has no connection sets the machine back\nto USB serial.\n\n## In files\n\nA machine file ({\"format\": \"makerlaser.machine\", \"version\": 1, ...}) gets an optional `connection` as its last field:\n\n```json\n\"connection\": { \"kind\": \"websocket\", \"host\": \"fluidnc.local\", \"port\": 0 }\n```\n\n- Left out entirely for USB serial, so existing files are unchanged and old files open as USB serial.\n- `host`: letters, digits, hyphens and dots only. No `http://`, no spaces, no path and no `:port`: the port is separate.\n  An all-number address must be a valid IPv4 address (four numbers from 0 to 255).\n- `port`: a whole number from 0 to 65535; `0` means the usual port for the kind.\n- A bad `connection` makes the whole machine file fail to import, with a message that names the field.\n- Fields it does not know inside `connection` are ignored.\n\nIn the project (`.mlp`) the same object is `machine.connection`, and is also left out for USB serial.\n\n## FluidNC ports\n\nFluidNC accepts raw TCP on port 23 by default and WebSocket on port 81, which is the HTTP port plus one. FluidNC v4.0.0 and\nv4.0.1 used port 80 for WebSockets, so type the port if you have one of those:\nhttp://wiki.fluidnc.com/en/support/interface/websockets\n\n## Rust\n\n`ConnectionKind`, `ConnectionSettings` and `host_problem` are in `packages/common/src/machine.rs`, with\n`MachineProfile::uses_network()`. `machine_connect` in `apps/rust-core` refuses a network machine unless the simulator is\nused. `host_problem` and `hostProblem` (`apps/desktop-ui/src/lib/connectionSettings.ts`) must stay in step.\n"};

// Edits to existing files for the connection setting. Every function takes a file's text and
// returns the new text, or throws an Error that says which edit point was not found. Each one
// does nothing if its edit is already there, and keeps the file's line endings.

const eolOf = (t) => (t.includes('\r\n') ? '\r\n' : '\n');
const toLf = (t) => t.replace(/\r\n/g, '\n');
const withEol = (t, eol) => (eol === '\r\n' ? t.replace(/\n/g, '\r\n') : t);

function indexOnce(text, find, what, file) {
  const first = text.indexOf(find);
  if (first < 0) throw new Error(`${file}: could not find ${what}.`);
  if (text.indexOf(find, first + find.length) >= 0) throw new Error(`${file}: found ${what} more than once, so it is not clear which to edit.`);
  return first;
}
const insertAfter = (text, find, add, what, file) => {
  const i = indexOnce(text, find, what, file) + find.length;
  return text.slice(0, i) + add + text.slice(i);
};
const insertBefore = (text, find, add, what, file) => {
  const i = indexOnce(text, find, what, file);
  return text.slice(0, i) + add + text.slice(i);
};
const replaceOnce = (text, find, repl, what, file) => {
  const i = indexOnce(text, find, what, file);
  return text.slice(0, i) + repl + text.slice(i + find.length);
};

function edit(source, file, alreadyDone, fn) {
  if (alreadyDone(source)) return { text: source, changed: false };
  const eol = eolOf(source);
  const out = fn(toLf(source));
  return { text: withEol(out, eol), changed: true };
}

// ---- TypeScript -------------------------------------------------------------------------

function patchDomain(source) {
  const F = 'apps/desktop-ui/src/types/domain.ts';
  return edit(source, F, (t) => t.includes('ConnectionSettings'), (t) => {
    t = insertAfter(
      t,
      "export type MachineOrigin = 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';\n",
      [
        '',
        '/** How MakerLaser reaches a machine. USB serial is the default; WebSocket and Telnet are for FluidNC. */',
        "export type ConnectionKind = 'serial' | 'websocket' | 'telnet';",
        '',
        'export interface ConnectionSettings {',
        '  kind: ConnectionKind;',
        '  /** Host name or IPv4 address for websocket and telnet. Ignored for serial. */',
        '  host: string;',
        '  /** TCP port. 0 means the usual port for the kind (81 for WebSocket, 23 for Telnet). */',
        '  port: number;',
        '}',
        '',
      ].join('\n'),
      'the MachineOrigin type',
      F,
    );
    return replaceOnce(
      t,
      '  baud_rate: number;\n}',
      '  baud_rate: number;\n  /** How to reach the machine. Absent in older files, which means USB serial. */\n  connection?: ConnectionSettings;\n}',
      'the baud_rate field of MachineProfile',
      F,
    );
  });
}

function patchConfigFormat(source) {
  const F = 'apps/desktop-ui/src/lib/configFormat.ts';
  return edit(source, F, (t) => t.includes("'@/lib/connectionSettings'"), (t) => {
    t = insertAfter(
      t,
      "import type { LayerKind, MachineOrigin, MachineProfile, MaterialPreset } from '@/types/domain';\n",
      "import { connectionToEntry, parseConnection } from '@/lib/connectionSettings';\n",
      'the types import at the top',
      F,
    );
    t = insertAfter(
      t,
      "  if (!isInt(baud) || baud < 300) bad('baud_rate must be a whole number of at least 300');\n",
      '\n  const connection = parseConnection(raw.connection);\n  problems.push(...connection.problems);\n',
      'the baud_rate check in validateMachineEntry',
      F,
    );
    t = insertAfter(
      t,
      '      baud_rate: baud as number,\n',
      '      ...(connection.value ? { connection: connection.value } : {}),\n',
      'the baud_rate line of the validated entry',
      F,
    );
    t = insertBefore(
      t,
      '  return {\n    name: m.name,\n    controller: m.controller,',
      '  const connection = connectionToEntry(m.connection);\n',
      'the start of machineToEntry',
      F,
    );
    return replaceOnce(
      t,
      '    baud_rate: m.baud_rate,\n  };',
      '    baud_rate: m.baud_rate,\n    ...(connection ? { connection } : {}),\n  };',
      'the end of machineToEntry',
      F,
    );
  });
}

function patchDialog(source) {
  const F = 'apps/desktop-ui/src/components/MachineSettingsDialog.tsx';
  return edit(source, F, (t) => t.includes('MachineConnectionFields'), (t) => {
    t = insertAfter(
      t,
      "import { NumberField } from '@/components/NumberField';\n",
      "import { MachineConnectionFields } from '@/components/MachineConnectionFields';\n",
      'the NumberField import',
      F,
    );
    // Loading a preset or a file replaces the whole machine. A preset with no connection means
    // USB serial, so forget the old connection first or a network setting would stick.
    t = replaceOnce(
      t,
      '  const patch = (key: string, fn: (m: MachineProfile) => void) =>\n    mutate((p) => fn(p.machine), `machine-${key}`);',
      [
        '  const patch = (key: string, fn: (m: MachineProfile) => void) =>',
        '    mutate((p) => {',
        '      // Loading a preset or a file replaces the whole machine, and one with no connection',
        '      // means USB serial: forget the old connection first so a network setting cannot stick.',
        "      if (key === 'preset' || key === 'import') delete p.machine.connection;",
        '      fn(p.machine);',
        '    }, `machine-${key}`);',
      ].join('\n'),
      'the patch helper',
      F,
    );
    return insertAfter(
      t,
      "<NumberField value={m.baud_rate} min={300} onCommit={(v) => patch('baud', (mm) => (mm.baud_rate = Math.round(v)))} />\n",
      '          <MachineConnectionFields />\n',
      'the Baud rate row',
      F,
    );
  });
}

// ---- Rust -------------------------------------------------------------------------------

const RUST_TYPES = `/// How MakerLaser reaches the machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionKind {
    /// A USB serial port: the default, and the only kind that can connect today.
    #[default]
    Serial,
    /// A WebSocket to a network controller such as FluidNC (usually port 81).
    Websocket,
    /// Raw TCP (Telnet) to a network controller such as FluidNC (usually port 23).
    Telnet,
}

/// Where and how to reach the machine. A network connection is stored, validated and saved, but
/// MakerLaser refuses to connect with one for now (see \`machine_connect\`).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ConnectionSettings {
    #[serde(default)]
    pub kind: ConnectionKind,
    /// Host name or IPv4 address for the network kinds. Ignored for USB serial.
    #[serde(default)]
    pub host: String,
    /// TCP port. \`0\` means the usual port for the kind (81 for WebSocket, 23 for Telnet).
    #[serde(default)]
    pub port: u16,
}

impl ConnectionSettings {
    pub fn is_network(&self) -> bool {
        self.kind != ConnectionKind::Serial
    }

    /// Problems with the address (none for USB serial, which has nothing to check).
    pub fn problems(&self) -> Vec<String> {
        if !self.is_network() {
            return Vec::new();
        }
        host_problem(&self.host)
            .map(|p| format!("Machine address: {p}"))
            .into_iter()
            .collect()
    }
}

/// Why \`raw\` cannot be a machine address, or \`None\` when it can. IPv4 addresses and host names
/// only. Mirrors \`hostProblem\` in apps/desktop-ui/src/lib/connectionSettings.ts: keep the two in step.
pub fn host_problem(raw: &str) -> Option<String> {
    let host = raw.trim();
    if host.is_empty() {
        return Some(
            "Enter the machine's address, for example 192.168.1.50 or fluidnc.local.".to_string(),
        );
    }
    if host.len() > 253 {
        return Some("The address is too long.".to_string());
    }
    if !host
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return Some(
            "The address may only contain letters, digits, hyphens and dots. Leave out http://, spaces, paths and the port number: enter the port separately."
                .to_string(),
        );
    }
    let labels: Vec<&str> = host.split('.').collect();
    if labels.iter().any(|l| l.is_empty()) {
        return Some(
            "The address has an empty part (two dots in a row, or a dot at the start or end)."
                .to_string(),
        );
    }
    if labels.iter().any(|l| l.len() > 63) {
        return Some("Each part of the address must be 63 characters or fewer.".to_string());
    }
    if labels
        .iter()
        .any(|l| l.starts_with('-') || l.ends_with('-'))
    {
        return Some("A part of the address cannot start or end with a hyphen.".to_string());
    }
    if labels
        .iter()
        .all(|l| l.bytes().all(|b| b.is_ascii_digit()))
    {
        let valid = labels.len() == 4
            && labels
                .iter()
                .all(|l| l.len() <= 3 && l.parse::<u16>().is_ok_and(|n| n <= 255));
        if !valid {
            return Some(
                "That looks like an IP address but is not a valid one: it needs four numbers from 0 to 255, like 192.168.1.50."
                    .to_string(),
            );
        }
    }
    None
}

`;

const RUST_TESTS = `    fn network(kind: ConnectionKind, host: &str) -> ConnectionSettings {
        ConnectionSettings {
            kind,
            host: host.to_string(),
            port: 0,
        }
    }

    #[test]
    fn a_machine_without_a_connection_is_usb_serial_and_is_saved_without_one() {
        let m = MachineProfile::tts55_pro();
        assert!(m.connection.is_none());
        assert!(!m.uses_network());
        let json = serde_json::to_string(&m).unwrap();
        assert!(!json.contains("connection"), "{json}");
    }

    #[test]
    fn older_machine_json_without_a_connection_still_loads() {
        let json = r#"{"id":"00000000-0000-0000-0000-000000000000","name":"Old","controller":"grbl1_1","bed_width_mm":300.0,"bed_height_mm":300.0,"origin":"bottom_left","max_feed_rate_mm_min":10000.0,"max_spindle_value":1000,"homing_supported":false,"air_assist_supported":true,"baud_rate":115200}"#;
        let m: MachineProfile = serde_json::from_str(json).unwrap();
        assert!(m.connection.is_none());
        assert!(!m.uses_network());
    }

    #[test]
    fn a_network_connection_round_trips_through_json() {
        let mut m = MachineProfile::tts55_pro();
        m.connection = Some(ConnectionSettings {
            kind: ConnectionKind::Websocket,
            host: "fluidnc.local".to_string(),
            port: 81,
        });
        assert!(m.uses_network());
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains(r#""kind":"websocket""#), "{json}");
        let back: MachineProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(back, m);
    }

    #[test]
    fn connection_kinds_use_the_names_the_frontend_expects() {
        for (kind, name) in [
            (ConnectionKind::Serial, "serial"),
            (ConnectionKind::Websocket, "websocket"),
            (ConnectionKind::Telnet, "telnet"),
        ] {
            assert_eq!(serde_json::to_string(&kind).unwrap(), format!("\\"{name}\\""));
        }
    }

    #[test]
    fn usb_serial_ignores_any_address() {
        let c = network(ConnectionKind::Serial, "not an address!");
        assert!(!c.is_network());
        assert!(c.problems().is_empty());
    }

    #[test]
    fn good_addresses_are_accepted() {
        for h in [
            "192.168.1.50",
            "0.0.0.0",
            "255.255.255.255",
            "fluidnc.local",
            "laser-1",
            "FluidNC",
            "3dprinter.local",
            "10.0.0.x",
            "  192.168.1.5  ",
        ] {
            assert_eq!(host_problem(h), None, "{h:?}");
        }
    }

    #[test]
    fn bad_addresses_are_refused() {
        for h in [
            "",
            "   ",
            "http://fluidnc.local",
            "fluidnc.local:81",
            "a b",
            "host/path",
            "a..b",
            ".a",
            "a.",
            "-a",
            "a-.b",
            "256.1.1.1",
            "1.2.3",
            "1.2.3.4.5",
            "1234",
            "0007.1.1.1",
        ] {
            assert!(host_problem(h).is_some(), "{h:?}");
        }
        assert!(host_problem(&"a".repeat(64)).is_some());
    }

    #[test]
    fn a_bad_network_address_is_a_machine_problem_but_only_for_network_machines() {
        let mut m = MachineProfile::tts55_pro();
        m.connection = Some(network(ConnectionKind::Telnet, "bad host"));
        assert!(m.validate().iter().any(|p| p.contains("Machine address")));
        m.connection = Some(network(ConnectionKind::Telnet, "10.0.0.5"));
        assert!(m.validate().is_empty());
        m.connection = Some(network(ConnectionKind::Serial, "bad host"));
        assert!(m.validate().is_empty());
    }

`;

/** machine.rs: the connection types, the new field, validation, `uses_network` and tests. */
function patchMachineRs(source) {
  const F = 'packages/common/src/machine.rs';
  return edit(source, F, (t) => t.includes('pub connection: Option<ConnectionSettings>'), (t) => {
    t = insertBefore(
      t,
      '#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\npub struct MachineProfile {',
      RUST_TYPES,
      'the MachineProfile struct',
      F,
    );
    t = replaceOnce(
      t,
      '    pub baud_rate: u32,\n}',
      '    pub baud_rate: u32,\n    /// How to reach the machine. Absent in older files, which means USB serial.\n    #[serde(default, skip_serializing_if = "Option::is_none")]\n    pub connection: Option<ConnectionSettings>,\n}',
      'the baud_rate field of MachineProfile',
      F,
    );
    t = replaceOnce(
      t,
      '            problems.push("Machine maximum S value ($30) must be greater than zero".to_string());\n        }\n        problems\n    }\n',
      [
        '            problems.push("Machine maximum S value ($30) must be greater than zero".to_string());',
        '        }',
        '        if let Some(connection) = &self.connection {',
        '            problems.extend(connection.problems());',
        '        }',
        '        problems',
        '    }',
        '',
        '    /// True when the machine is reached over the network rather than a USB serial port.',
        '    pub fn uses_network(&self) -> bool {',
        '        self.connection',
        '            .as_ref()',
        '            .is_some_and(ConnectionSettings::is_network)',
        '    }',
        '',
      ].join('\n'),
      'the end of MachineProfile::validate',
      F,
    );
    return insertAfter(t, 'mod tests {\n    use super::*;\n\n', RUST_TESTS, 'the start of the tests module', F);
  });
}

/** machine_cmds.rs: refuse to connect a machine that is set to a network connection. */
function patchMachineCmds(source) {
  const F = 'apps/rust-core/src/commands/machine_cmds.rs';
  return edit(source, F, (t) => t.includes('uses_network()'), (t) => {
    const find = '    if is_running(&state) {\n        return Err("A job is running. Stop it before reconnecting.".to_string());\n    }\n';
    return insertAfter(
      t,
      find,
      [
        '    // Only USB serial can connect for now. Say so plainly instead of trying a serial port.',
        '    if !simulate && lock(&state.project)?.machine.uses_network() {',
        '        return Err(',
        '            "This machine is set to connect over the network, which MakerLaser cannot do yet. Choose USB serial in the Machine window, or use the simulator."',
        '                .to_string(),',
        '        );',
        '    }',
        '',
      ].join('\n'),
      'the "Stop it before reconnecting" check in machine_connect',
      F,
    );
  });
}

// ---- finding every place a MachineProfile is built in Rust --------------------------------

/** Same-length copy of Rust source with comments, strings and char literals blanked out. */
function mask(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (src[j] === '/' && src[j + 1] === '*') { depth++; j += 2; }
        else if (src[j] === '*' && src[j + 1] === '/') { depth--; j += 2; }
        else j++;
      }
      blank(i, j);
      i = j;
      continue;
    }
    if (c === 'r' && (d === '"' || d === '#') && !/[A-Za-z0-9_]/.test(src[i - 1] ?? ' ')) {
      const m = /^r(#*)"/.exec(src.slice(i, i + 40));
      if (m) {
        const close = '"' + m[1];
        let j = src.indexOf(close, i + m[0].length);
        j = j < 0 ? n : j + close.length;
        blank(i, j);
        i = j;
        continue;
      }
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\') j++;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    if (c === "'") {
      const m = /^'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)|[^\\'\n])'/.exec(src.slice(i, i + 14));
      if (m) {
        blank(i, i + m[0].length);
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return out.join('');
}

function matchBrace(m, open) {
  let depth = 0;
  for (let k = open; k < m.length; k++) {
    if (m[k] === '{') depth++;
    else if (m[k] === '}' && --depth === 0) return k;
  }
  return -1;
}

/** The body with everything inside nested brackets blanked: only its own tokens are left. */
function topLevel(body) {
  let depth = 0;
  let out = '';
  for (const ch of body) {
    if ('([{'.includes(ch)) { out += depth === 0 ? ch : ' '; depth++; }
    else if (')]}'.includes(ch)) { depth--; out += depth === 0 ? ch : ' '; }
    else out += depth === 0 ? ch : (ch === '\n' ? '\n' : ' ');
  }
  return out;
}

const NOT_A_LITERAL_AFTER = new Set(['struct', 'impl', 'for', 'enum', 'trait', 'let', 'mod', 'use', 'type', 'dyn', 'as', 'where']);

/**
 * Adds `connection: None,` to every full MachineProfile struct literal (`MachineProfile { .. }`,
 * or `Self { .. }` inside an `impl MachineProfile`). It leaves alone: the struct definition and impl
 * headers, patterns, update syntax (`..base`), literals that already set connection, and other types.
 * Returns the new text and what it did.
 */
function patchMachineLiterals(source) {
  const eol = eolOf(source);
  const text = toLf(source);
  if (!text.includes('MachineProfile')) return { text: source, patched: 0, updates: 0 };
  const m = mask(text);

  const impls = [];
  for (const h of m.matchAll(/\bimpl\b[^{};]*?\bMachineProfile\b\s*\{/g)) {
    const open = h.index + h[0].length - 1;
    const close = matchBrace(m, open);
    if (close > 0) impls.push([open, close]);
  }

  const edits = new Map(); // position -> text to insert there, in the order it must appear
  const add = (pos, piece) => edits.set(pos, (edits.get(pos) ?? '') + piece);
  let patched = 0;
  let updates = 0;
  for (const h of m.matchAll(/\b(MachineProfile|Self)\s*\{/g)) {
    const open = h.index + h[0].length - 1;
    if (h[1] === 'Self' && !impls.some(([a, b]) => h.index > a && h.index < b)) continue;
    const before = m.slice(0, h.index).trimEnd();
    if (before.endsWith('->')) continue;
    const prevWord = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(before)?.[1];
    if (prevWord && NOT_A_LITERAL_AFTER.has(prevWord)) continue;
    const close = matchBrace(m, open);
    if (close < 0) continue;
    const top = topLevel(m.slice(open + 1, close));
    if (/(^|[,\s])\.\.(?!=)/.test(top)) { updates++; continue; }
    if (/(^|[\s,])connection\s*(:|,|$)/.test(top)) continue;
    if (!/\b[a-z_][a-z0-9_]*\s*:(?!:)/.test(top)) continue;

    const inner = m.slice(open + 1, close);
    const lastRel = inner.replace(/\s+$/, '').length - 1;
    if (lastRel < 0) continue;
    const last = open + 1 + lastRel;
    const trailing = text[last] === ',';
    const lineEnd = text.indexOf('\n', last);
    if (lineEnd < 0 || lineEnd > close) {
      // everything on one line: { a: 1, b: 2 }
      add(last + 1, trailing ? ' connection: None,' : ', connection: None');
      patched++;
    } else {
      const indent = /\n([ \t]+)\S/.exec(text.slice(open + 1, close))?.[1] ?? '    ';
      if (!trailing) add(last + 1, ',');
      add(lineEnd, `\n${indent}connection: None${trailing ? ',' : ''}`);
      patched++;
    }
  }

  let out = text;
  for (const [pos, piece] of [...edits].sort((a, b) => b[0] - a[0])) out = out.slice(0, pos) + piece + out.slice(pos);
  return { text: withEol(out, eol), patched, updates };
}

/** True when every (), [] and {} in the code (not strings or comments) is closed. */
function bracketsBalance(rustSource) {
  const m = mask(toLf(rustSource));
  for (const [o, c] of ['()', '[]', '{}']) {
    if (m.split(o).length !== m.split(c).length) return false;
  }
  return true;
}

const root = process.cwd();
const fail = (m) => { console.error('\n' + m + '\n\nNothing was changed.'); process.exit(1); };
const abs = (rel) => path.join(root, rel);
const read = (rel) => fs.readFileSync(abs(rel), 'utf8');

const TARGETS = {
  domain: 'apps/desktop-ui/src/types/domain.ts',
  config: 'apps/desktop-ui/src/lib/configFormat.ts',
  dialog: 'apps/desktop-ui/src/components/MachineSettingsDialog.tsx',
  machine: 'packages/common/src/machine.rs',
  commands: 'apps/rust-core/src/commands/machine_cmds.rs',
};

if (!fs.existsSync(abs('package.json')) || !fs.existsSync(abs('apps/desktop-ui/src'))) {
  fail('Run this from the MakerLaser repo root (the folder with package.json and apps/desktop-ui).');
}
for (const rel of Object.values(TARGETS)) {
  if (!fs.existsSync(abs(rel))) {
    fail(rel + ' is missing.' + (rel.endsWith('configFormat.ts') ? ' The machine and material file formats must be installed first.' : ''));
  }
}

const plan = []; // { rel, text, was }
const add = (rel, text, was) => { if (text !== was) plan.push({ rel, text, was }); };
try {
  for (const [key, fn] of [['domain', patchDomain], ['config', patchConfigFormat], ['dialog', patchDialog], ['commands', patchMachineCmds]]) {
    const was = read(TARGETS[key]);
    add(TARGETS[key], fn(was).text, was);
  }
  // machine.rs: the connection types and field, then every full MachineProfile literal in it
  const machineWas = read(TARGETS.machine);
  const machineNew = patchMachineLiterals(patchMachineRs(machineWas).text).text;
  add(TARGETS.machine, machineNew, machineWas);

  // any other Rust file that builds a whole MachineProfile (other crates, tests)
  const skip = new Set(['target', 'node_modules', '.git', 'dist']);
  const walk = (dir) => {
    for (const e of fs.readdirSync(abs(dir), { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const rel = dir + '/' + e.name;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith('.rs') && rel !== TARGETS.machine) {
        const was = read(rel);
        if (!was.includes('MachineProfile')) continue;
        const r = patchMachineLiterals(was);
        if (r.patched > 0) add(rel, r.text, was);
      }
    }
  };
  for (const top of ['apps', 'packages']) if (fs.existsSync(abs(top))) walk(top);
  for (const p of plan) if (p.rel.endsWith('.rs') && !bracketsBalance(p.text)) throw new Error(p.rel + ': the edit would leave unbalanced brackets, so it was not applied.');
} catch (e) {
  fail(e.message);
}

const eol = read(TARGETS.config).includes('\r\n') ? '\r\n' : '\n'; // new files match the repo
for (const [rel, text] of Object.entries(FILES)) {
  const body = eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
  if (fs.existsSync(abs(rel)) && read(rel) === body) { console.log('already ' + rel); continue; }
  fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
  fs.writeFileSync(abs(rel), body);
  console.log('wrote   ' + rel);
}
for (const p of plan) {
  fs.writeFileSync(abs(p.rel), p.text);
  const added = p.text.split('\n').length - p.was.split('\n').length;
  console.log('edited  ' + p.rel + ' (' + (added >= 0 ? '+' : '') + added + ' lines)');
}
if (plan.length === 0) console.log('(the existing files already have the connection setting)');
console.log('\nDone. Next:');
console.log('  cargo fmt --all');
console.log('  cargo test --workspace      <- I could not compile the Rust here: please tell me about any error');
console.log('  npm run ui:typecheck');
console.log('  npm run ui:test');
console.log('  npm run dev                 <- Machine window > Connection');
