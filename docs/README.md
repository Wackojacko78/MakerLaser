# Documentation

Start with the [user guide](user-guide.md). Read [`../SAFETY.md`](../SAFETY.md) before the first
powered job. [`../VERIFICATION.md`](../VERIFICATION.md) says what has and has not been tried on a
real laser.

## Using MakerLaser

| Document | What it covers |
|---|---|
| [user-guide.md](user-guide.md) | From an empty window to a finished job, step by step |
| [canvas-interactions.md](canvas-interactions.md) | Every mouse action and keyboard shortcut |
| [shapes-and-text.md](shapes-and-text.md) | Drawing shapes and text on the canvas, and editing them later |
| [fonts.md](fonts.md) | The 35 built-in fonts, installed fonts, adding a font |
| [import.md](import.md) | What SVG and DXF files import, including `<use>` and `INSERT` blocks |
| [measure.md](measure.md) | The Measure tool |
| [preview.md](preview.md) | The toolpath preview: colours, replay, the Travel switch |
| [overscan.md](overscan.md) | Overscan: clean edges on fills and photos |
| [fill-and-ramp.md](fill-and-ramp.md) | The fill outline pass and ramped power on score lines |
| [start-from.md](start-from.md) | Start From and Job Origin: where the job runs on the machine |
| [framing.md](framing.md) | Frame, and Frame with the laser on |
| [console.md](console.md) | The console command box: `$$`, `$32=1` and other settings |
| [catalog.md](catalog.md) | The machine catalogue and the starter material presets |

## Machines and connections

| Document | What it covers |
|---|---|
| [connection.md](connection.md) | USB serial, WebSocket and Telnet (FluidNC) settings |
| [config-formats.md](config-formats.md) | The machine and material file formats |
| [machine-layer.md](machine-layer.md) | How MakerLaser talks to GRBL, and the simulator |
| [linux.md](linux.md) | Building and running on Linux |

## For developers

| Document | What it covers |
|---|---|
| [architecture.md](architecture.md) | The layers, the pipeline, state, threading, safety layers |
| [api.md](api.md) | The Tauri commands |
| [project-format.md](project-format.md) | The `.mlp` project file |
| [lasergrbl-review.md](lasergrbl-review.md) | What was taken as a lesson from LaserGRBL, and the licence boundary |
| [roadmap.md](roadmap.md) | What is done, what is next, what is deliberately left out |

## At the top of the repository

[`README`](../README.md) · [`INSTALL`](../INSTALL.md) · [`SAFETY`](../SAFETY.md) ·
[`VERIFICATION`](../VERIFICATION.md) · [`CHANGELOG`](../CHANGELOG.md) ·
[`CONTRIBUTING`](../CONTRIBUTING.md) · [`THIRD_PARTY_NOTICES`](../THIRD_PARTY_NOTICES.md)

## Keeping the documents right

`node scripts/check-docs.mjs` checks that links, file names, the command table in `api.md` and the
version numbers still match the code. Run it before merging a change that touches behaviour
(CONTRIBUTING.md).
