# Machine layer

## `Controller` trait (`packages/machine/src/controller.rs`)

```rust
connect · disconnect · is_connected · query_status
jog · home · unlock · set_origin · frame
run_program(lines, &JobControl, on_event) -> Result<()>
send_command(line, &JobControl) -> Result<Vec<String>>   // one typed line; the reply lines
realtime_handle() -> Option<Arc<dyn RealtimeControl>>   // pause / resume / stop
```

All coordinates passed to a controller are **machine** coordinates. `GrblController` and
`Simulator` implement the trait; the app only ever holds a `Box<dyn Controller>`. A future Ruida
or galvo driver is another implementation, with no change to the UI or CAM code.

## GRBL streaming

Programs use GRBL's **character-counting protocol**: a line is sent while the total length of
lines not yet acknowledged (including newlines) stays within 120 bytes of GRBL's 128-byte RX
buffer; each `ok` or `error:n` frees the oldest line. This keeps the planner fed; the simpler
send-one-wait-for-`ok` approach starves it on dense raster jobs. A single line longer than the
budget is allowed through alone so it can never deadlock.

* Comments (`;…`, `(…)`) are stripped before sending.
* An `error:n` or `ALARM:n` response stops the job, names the program line, decodes the code,
  and sends a soft reset.
* After the last `ok` the driver polls status until GRBL reports **Idle**, then emits
  `Completed`; the final planner moves are still executing at that point.
* Read timeouts keep partial lines (bytes of a half-received line are never discarded).
* A move can legitimately take minutes; acknowledgements may wait that long, and abort is
  checked on every read slice.

### Real-time commands

`!` feed hold, `~` resume, `0x18` soft reset are single bytes that GRBL handles immediately.
They are sent through `RealtimeControl`, which only owns the serial writer, so they work while a
job holds the controller. **Stop** flags the job to stop sending first, then resets.

### Pre-flight state checks

Jobs, framing and set-origin require `Idle`. `Alarm`, `Hold`, `Door` and `Check` states are
refused with the state name.

### Connecting

Opening the port usually resets the board, which prints `Grbl 1.1x [...]`; the driver waits up
to 4 s for it. Boards that do not reset are probed with a `?` status query instead. No answer
yields "the machine on COMx did not answer" and the port is released.

### Typed commands

`send_command` sends one line (the console command box, `docs/console.md`) and collects what the
controller prints before its `ok`: for `$$`, the settings. An `error:` or `ALARM:` answer is an
error, and STOP ends the wait. Homing (`$H`) waits up to the homing timeout, other `$` commands
for a short one, and anything else (a move, say) up to 60 seconds. The default implementation says
typed commands are not available, which is what the simulator answers. The line is checked before
it gets here (`apps/rust-core/src/console.rs`).

### Framing

`frame` traces the job's rectangle with the laser off. Frames that start from the head's position
(Start From relative) or that use the laser at low power (docs/framing.md) are short programs built
in `apps/rust-core/src/placement.rs` and sent through `run_program`, so STOP, errors and the
real-time channel behave as they do for a job.

## Testing without hardware

`grbl.rs` is written against a small `Link` trait. The tests drive the real streaming code with
a **fake GRBL** that enforces the 128-byte RX buffer and acknowledges one line per read. They
check no-overflow streaming, comment stripping, error handling (line named, soft reset sent),
state checks, abort, pause/resume and oversized lines.

## Simulator

`Simulator` implements the same trait: it replays the program with a time scale (default 20×
faster than the estimate), honours pause and abort, emits the same events and tracks position.
`estimate_runtime` integrates distance ÷ feed over every `G0`/`G1`, split into laser-off travel
and laser-on work.
