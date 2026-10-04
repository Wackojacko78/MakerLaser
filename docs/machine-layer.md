# Machine layer

## `Controller` trait (`packages/machine/src/controller.rs`)

```rust
connect · disconnect · is_connected · query_status
jog · home · unlock · set_origin · frame
run_program(lines, &JobControl, on_event) -> Result<()>
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
