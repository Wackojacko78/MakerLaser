# Machine connection setting

A machine profile can say how MakerLaser reaches the machine:

| Kind | Meaning | Address | Port |
|---|---|---|---|
| `serial` | USB serial port (the default, and how it has always worked) | not used | not used |
| `websocket` | WebSocket to a network controller such as FluidNC | host name or IPv4 address | `0` = usual port, 81 |
| `telnet` | Raw TCP (Telnet) to a network controller such as FluidNC | host name or IPv4 address | `0` = usual port, 23 |

**Only USB serial can connect today.** A machine set to `websocket` or `telnet` is stored, validated, saved in the
project, in saved presets and in machine files, but pressing Connect says so and does nothing. (The simulator still
works.) Network connections are the next step.

## Where to set it

Machine window, **Connection**. Choosing a preset or importing a machine file that has no connection sets the machine back
to USB serial.

## In files

A machine file ({"format": "makerlaser.machine", "version": 1, ...}) gets an optional `connection` as its last field:

```json
"connection": { "kind": "websocket", "host": "fluidnc.local", "port": 0 }
```

- Left out entirely for USB serial, so existing files are unchanged and old files open as USB serial.
- `host`: letters, digits, hyphens and dots only. No `http://`, no spaces, no path and no `:port`: the port is separate.
  An all-number address must be a valid IPv4 address (four numbers from 0 to 255).
- `port`: a whole number from 0 to 65535; `0` means the usual port for the kind.
- A bad `connection` makes the whole machine file fail to import, with a message that names the field.
- Fields it does not know inside `connection` are ignored.

In the project (`.mlp`) the same object is `machine.connection`, and is also left out for USB serial.

## FluidNC ports

FluidNC accepts raw TCP on port 23 by default and WebSocket on port 81, which is the HTTP port plus one. FluidNC v4.0.0 and
v4.0.1 used port 80 for WebSockets, so type the port if you have one of those:
http://wiki.fluidnc.com/en/support/interface/websockets

## Rust

`ConnectionKind`, `ConnectionSettings` and `host_problem` are in `packages/common/src/machine.rs`, with
`MachineProfile::uses_network()`. `machine_connect` in `apps/rust-core` refuses a network machine unless the simulator is
used. `host_problem` and `hostProblem` (`apps/desktop-ui/src/lib/connectionSettings.ts`) must stay in step.
