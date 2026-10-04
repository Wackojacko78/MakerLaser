//! Real GRBL 1.1 serial control.
//!
//! * Programs are streamed with GRBL's **character-counting protocol**: lines are sent
//!   while the sum of un-acknowledged line lengths fits GRBL's 128-byte RX buffer, and each
//!   `ok`/`error:n` frees the oldest line. This keeps the planner fed (unlike
//!   send-one-wait-for-ok, which starves it on dense raster jobs).
//! * Real-time bytes (`!` hold, `~` resume, `0x18` reset) are sent through a separate
//!   [`RealtimeControl`] handle so they work while a job holds the controller.
//! * All protocol logic is generic over a [`Link`], so it is unit-tested against a fake
//!   GRBL without hardware (see the tests at the bottom of this file).

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serialport::SerialPort;

use crate::controller::{strip_comments, Controller, RealtimeControl};
use crate::error::{MachineError, Result};
use crate::grbl_codes;
use crate::job_control::{JobControl, JobEvent};
use crate::status::{parse_status_line, GrblStatus, MachineState};

const PORT_READ_TIMEOUT: Duration = Duration::from_millis(100);
const BANNER_WAIT: Duration = Duration::from_secs(4);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
const HOMING_TIMEOUT: Duration = Duration::from_secs(180);
/// A move can legitimately take minutes at cutting speeds; the `ok` for a queued line is
/// only sent once GRBL's planner has room.
const MOTION_ACK_TIMEOUT: Duration = Duration::from_secs(900);
const IDLE_WAIT_TIMEOUT: Duration = Duration::from_secs(1800);
/// GRBL's RX buffer is 128 bytes; stay a little under it.
const RX_BUFFER_BYTES: usize = 120;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

type SharedWriter = Arc<Mutex<Box<dyn SerialPort>>>;

fn lock(writer: &SharedWriter) -> Result<MutexGuard<'_, Box<dyn SerialPort>>> {
    writer
        .lock()
        .map_err(|_| MachineError::InternalState("serial writer lock was poisoned".into()))
}

// ---------------------------------------------------------------------------------------
// Transport abstraction
// ---------------------------------------------------------------------------------------

pub(crate) trait Link {
    fn send(&mut self, bytes: &[u8]) -> Result<()>;
    /// `Ok(None)` means no complete line arrived within the read timeout.
    fn read_line(&mut self) -> Result<Option<String>>;
    /// Drops anything already received but not yet read.
    fn discard_pending(&mut self);
}

struct SerialLink {
    writer: SharedWriter,
    reader: BufReader<Box<dyn SerialPort>>,
    /// Bytes of a line that has started but not finished (kept across read timeouts).
    partial: Vec<u8>,
}

impl Link for SerialLink {
    fn send(&mut self, bytes: &[u8]) -> Result<()> {
        let mut guard = lock(&self.writer)?;
        guard.write_all(bytes)?;
        guard.flush()?;
        Ok(())
    }

    fn read_line(&mut self) -> Result<Option<String>> {
        match self.reader.read_until(b'\n', &mut self.partial) {
            Ok(0) => Err(MachineError::Disconnected),
            Ok(_) => {
                if self.partial.last() == Some(&b'\n') {
                    let line = String::from_utf8_lossy(&self.partial).trim().to_string();
                    self.partial.clear();
                    Ok(Some(line))
                } else {
                    Ok(None)
                }
            }
            Err(e) if matches!(e.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) => Ok(None),
            Err(e) => Err(MachineError::Io(e)),
        }
    }

    fn discard_pending(&mut self) {
        self.partial.clear();
        let mut sink = Vec::new();
        for _ in 0..256 {
            let pending = !self.reader.buffer().is_empty()
                || self.reader.get_ref().bytes_to_read().unwrap_or(0) > 0;
            if !pending {
                break;
            }
            sink.clear();
            if self.reader.read_until(b'\n', &mut sink).is_err() {
                break;
            }
        }
    }
}

struct GrblRealtimeHandle {
    writer: SharedWriter,
}

impl GrblRealtimeHandle {
    fn send(&self, byte: u8) -> Result<()> {
        let mut guard = lock(&self.writer)?;
        guard.write_all(&[byte])?;
        guard.flush()?;
        Ok(())
    }
}

impl RealtimeControl for GrblRealtimeHandle {
    fn pause(&self) -> Result<()> {
        self.send(b'!')
    }
    fn resume(&self) -> Result<()> {
        self.send(b'~')
    }
    fn stop(&self) -> Result<()> {
        self.send(0x18)
    }
}

// ---------------------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------------------

#[derive(Debug, PartialEq, Eq)]
enum Response {
    Ok,
    Error(u8),
    Alarm(u8),
    Status,
    Other,
}

fn classify(line: &str) -> Response {
    if line == "ok" {
        Response::Ok
    } else if let Some(rest) = line.strip_prefix("error:") {
        Response::Error(rest.trim().parse().unwrap_or(0))
    } else if let Some(rest) = line.strip_prefix("ALARM:") {
        Response::Alarm(rest.trim().parse().unwrap_or(0))
    } else if line.starts_with('<') && line.ends_with('>') {
        Response::Status
    } else {
        Response::Other
    }
}

fn grbl_error(code: u8, context: &str) -> MachineError {
    let d = grbl_codes::error(code);
    MachineError::GrblError(format!("error:{code} {}. {}{context}", d.title, d.recovery))
}

fn grbl_alarm(code: u8) -> MachineError {
    let d = grbl_codes::alarm(code);
    MachineError::AlarmActive(format!("ALARM:{code} {}. {}", d.title, d.recovery))
}

fn await_ack<L: Link>(
    link: &mut L,
    timeout: Duration,
    control: Option<&JobControl>,
    on_message: &mut dyn FnMut(&str),
) -> Result<()> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(c) = control {
            if c.is_aborted() {
                return Err(MachineError::Aborted);
            }
        }
        if Instant::now() >= deadline {
            return Err(MachineError::Timeout);
        }
        if let Some(line) = link.read_line()? {
            match classify(&line) {
                Response::Ok => return Ok(()),
                Response::Error(code) => return Err(grbl_error(code, "")),
                Response::Alarm(code) => return Err(grbl_alarm(code)),
                Response::Status => {}
                Response::Other => on_message(&line),
            }
        }
    }
}

fn send_line<L: Link>(link: &mut L, line: &str, timeout: Duration) -> Result<()> {
    link.discard_pending();
    link.send(format!("{line}\n").as_bytes())?;
    await_ack(link, timeout, None, &mut |_| {})
}

fn query_status<L: Link>(link: &mut L, timeout: Duration) -> Result<GrblStatus> {
    link.send(b"?")?;
    let deadline = Instant::now() + timeout;
    loop {
        if Instant::now() >= deadline {
            return Err(MachineError::Timeout);
        }
        if let Some(line) = link.read_line()? {
            if let Some(status) = parse_status_line(&line) {
                return Ok(status);
            }
        }
    }
}

fn require_idle<L: Link>(link: &mut L) -> Result<()> {
    let status = query_status(link, Duration::from_secs(3))?;
    if status.state != MachineState::Idle {
        return Err(MachineError::NotIdle(format!("{:?}", status.state)));
    }
    Ok(())
}

fn wait_until_idle<L: Link>(link: &mut L, control: &JobControl) -> Result<()> {
    let deadline = Instant::now() + IDLE_WAIT_TIMEOUT;
    loop {
        if control.is_aborted() {
            return Err(MachineError::Aborted);
        }
        if Instant::now() >= deadline {
            return Err(MachineError::Timeout);
        }
        match query_status(link, Duration::from_secs(3)) {
            Ok(status) => match status.state {
                MachineState::Idle => return Ok(()),
                MachineState::Alarm => {
                    return Err(MachineError::AlarmActive(
                        "the machine entered an alarm state while finishing the job".into(),
                    ))
                }
                _ => {}
            },
            Err(MachineError::Timeout) => {} // transient; keep polling until the deadline
            Err(e) => return Err(e),
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn stream_program<L: Link>(
    link: &mut L,
    program: &[String],
    control: &JobControl,
    on_event: &mut dyn FnMut(JobEvent<'_>),
) -> Result<()> {
    let total = program.len();
    let mut next = 0usize;
    let mut acked = 0usize;
    let mut in_flight: VecDeque<usize> = VecDeque::new();
    let mut buffered = 0usize;
    let mut was_paused = false;
    let mut last_progress = Instant::now();
    let mut last_activity = Instant::now();

    while acked < total {
        if control.is_aborted() {
            return Err(MachineError::Aborted);
        }
        let paused = control.is_paused();
        if paused && !was_paused {
            on_event(JobEvent::Paused);
            was_paused = true;
        } else if !paused && was_paused {
            on_event(JobEvent::Resumed);
            was_paused = false;
        }
        if paused {
            last_activity = Instant::now();
        }

        // Send while the line fits in GRBL's RX buffer (an oversized line is allowed
        // through on its own so it can never deadlock).
        if next < total && !paused {
            let len = program[next].len() + 1;
            if in_flight.is_empty() || buffered + len <= RX_BUFFER_BYTES {
                link.send(format!("{}\n", program[next]).as_bytes())?;
                in_flight.push_back(len);
                buffered += len;
                next += 1;
                last_activity = Instant::now();
                continue;
            }
        }

        if in_flight.is_empty() {
            // Nothing outstanding and nothing may be sent: we are paused.
            std::thread::sleep(Duration::from_millis(50));
            continue;
        }

        match link.read_line()? {
            None => {
                if !paused && last_activity.elapsed() > MOTION_ACK_TIMEOUT {
                    return Err(MachineError::Timeout);
                }
            }
            Some(line) => match classify(&line) {
                Response::Ok => {
                    let len = in_flight.pop_front().unwrap_or(0);
                    buffered = buffered.saturating_sub(len);
                    acked += 1;
                    last_activity = Instant::now();
                    if acked == total || last_progress.elapsed() >= PROGRESS_INTERVAL {
                        on_event(JobEvent::Progress { done: acked, total });
                        last_progress = Instant::now();
                    }
                }
                Response::Error(code) => {
                    let text = program.get(acked).map(String::as_str).unwrap_or("");
                    let context = format!(" (program line {}: `{text}`)", acked + 1);
                    return Err(grbl_error(code, &context));
                }
                Response::Alarm(code) => return Err(grbl_alarm(code)),
                Response::Status => {}
                Response::Other => on_event(JobEvent::Message(&line)),
            },
        }
    }
    wait_until_idle(link, control)
}

/// Full job run: pre-flight state check, streaming, completion, and stop-on-failure.
fn run_program_on<L: Link>(
    link: &mut L,
    lines: &[String],
    control: &JobControl,
    on_event: &mut dyn FnMut(JobEvent<'_>),
) -> Result<()> {
    require_idle(link)?;
    link.discard_pending();
    let program: Vec<String> = lines
        .iter()
        .map(|l| strip_comments(l))
        .filter(|l| !l.is_empty())
        .collect();

    let outcome = stream_program(link, &program, control, on_event);
    match &outcome {
        Ok(()) => on_event(JobEvent::Completed),
        Err(MachineError::Aborted) => {
            let _ = link.send(&[0x18]);
            on_event(JobEvent::Aborted);
        }
        Err(_) => {
            // Any failure mid-job: stop motion and make sure the laser is off.
            let _ = link.send(&[0x18]);
        }
    }
    outcome
}

fn validate_finite(values: &[f64]) -> Result<()> {
    if values.iter().all(|v| v.is_finite()) {
        Ok(())
    } else {
        Err(MachineError::InvalidRequest(
            "coordinates must be finite numbers".into(),
        ))
    }
}

// ---------------------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------------------

#[derive(Default)]
pub struct GrblController {
    link: Option<SerialLink>,
}

impl GrblController {
    pub fn new() -> Self {
        Self::default()
    }

    fn link(&mut self) -> Result<&mut SerialLink> {
        self.link.as_mut().ok_or(MachineError::NotConnected)
    }
}

impl Controller for GrblController {
    fn connect(&mut self, port_name: &str, baud_rate: u32) -> Result<()> {
        if self.link.is_some() {
            return Err(MachineError::AlreadyConnected);
        }
        let port = serialport::new(port_name, baud_rate)
            .timeout(PORT_READ_TIMEOUT)
            .open()?;
        let reader_port = port.try_clone()?;
        let mut link = SerialLink {
            writer: Arc::new(Mutex::new(port)),
            reader: BufReader::new(reader_port),
            partial: Vec::new(),
        };

        // Most boards reset when the port opens and print "Grbl 1.1x ['$' for help]".
        let deadline = Instant::now() + BANNER_WAIT;
        let mut saw_banner = false;
        while !saw_banner && Instant::now() < deadline {
            if let Some(line) = link.read_line()? {
                saw_banner = line.to_ascii_lowercase().contains("grbl");
            }
        }
        // Boards that do not reset on connect: probe with a status query instead.
        if !saw_banner && query_status(&mut link, Duration::from_secs(2)).is_err() {
            return Err(MachineError::NoResponse(port_name.to_string()));
        }
        log::info!("connected to GRBL on {port_name} at {baud_rate} baud");
        self.link = Some(link);
        Ok(())
    }

    fn disconnect(&mut self) -> Result<()> {
        self.link = None;
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.link.is_some()
    }

    fn query_status(&mut self) -> Result<GrblStatus> {
        let link = self.link()?;
        query_status(link, Duration::from_secs(2))
    }

    fn jog(&mut self, dx_mm: f64, dy_mm: f64, feed_mm_min: f64) -> Result<()> {
        validate_finite(&[dx_mm, dy_mm, feed_mm_min])?;
        if feed_mm_min <= 0.0 {
            return Err(MachineError::InvalidRequest(
                "jog feed must be positive".into(),
            ));
        }
        let link = self.link()?;
        send_line(
            link,
            &format!("$J=G91 G21 X{dx_mm:.3} Y{dy_mm:.3} F{feed_mm_min:.0}"),
            COMMAND_TIMEOUT,
        )
    }

    fn home(&mut self) -> Result<()> {
        let link = self.link()?;
        send_line(link, "$H", HOMING_TIMEOUT)
    }

    fn unlock(&mut self) -> Result<()> {
        let link = self.link()?;
        send_line(link, "$X", COMMAND_TIMEOUT)
    }

    fn set_origin(&mut self) -> Result<()> {
        let link = self.link()?;
        require_idle(link)?;
        // Sets the G54 work offset so the current position reads X0 Y0.
        send_line(link, "G10 L20 P1 X0 Y0", COMMAND_TIMEOUT)
    }

    fn frame(&mut self, min: (f64, f64), max: (f64, f64), feed_mm_min: f64) -> Result<()> {
        validate_finite(&[min.0, min.1, max.0, max.1, feed_mm_min])?;
        if feed_mm_min <= 0.0 || min.0 > max.0 || min.1 > max.1 {
            return Err(MachineError::InvalidRequest(
                "invalid frame rectangle".into(),
            ));
        }
        let link = self.link()?;
        require_idle(link)?;
        send_line(link, "G90 G21 M5", COMMAND_TIMEOUT)?; // absolute, mm, laser off
        let corners = [
            (min.0, min.1),
            (max.0, min.1),
            (max.0, max.1),
            (min.0, max.1),
            (min.0, min.1),
        ];
        for (x, y) in corners {
            send_line(
                link,
                &format!("G1 X{x:.3} Y{y:.3} F{feed_mm_min:.0}"),
                MOTION_ACK_TIMEOUT,
            )?;
        }
        Ok(())
    }

    fn run_program(
        &mut self,
        lines: &[String],
        control: &JobControl,
        on_event: &mut dyn FnMut(JobEvent<'_>),
    ) -> Result<()> {
        let link = self.link()?;
        run_program_on(link, lines, control, on_event)
    }

    fn realtime_handle(&self) -> Option<Arc<dyn RealtimeControl>> {
        self.link.as_ref().map(|l| {
            Arc::new(GrblRealtimeHandle {
                writer: l.writer.clone(),
            }) as Arc<dyn RealtimeControl>
        })
    }
}

// ---------------------------------------------------------------------------------------
// Tests: a fake GRBL stands in for the serial port
// ---------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal GRBL: accepts lines into a 128-byte RX buffer, acknowledges one per read.
    struct FakeGrbl {
        incoming: VecDeque<String>,
        rx: VecDeque<usize>,
        rx_used: usize,
        max_rx_used: usize,
        written_lines: Vec<String>,
        realtime_bytes: Vec<u8>,
        fail_on_line: Option<usize>,
        lines_processed: usize,
        state: &'static str,
        overflowed: bool,
    }

    impl FakeGrbl {
        fn new() -> Self {
            FakeGrbl {
                incoming: VecDeque::new(),
                rx: VecDeque::new(),
                rx_used: 0,
                max_rx_used: 0,
                written_lines: Vec::new(),
                realtime_bytes: Vec::new(),
                fail_on_line: None,
                lines_processed: 0,
                state: "Idle",
                overflowed: false,
            }
        }
    }

    impl Link for FakeGrbl {
        fn send(&mut self, bytes: &[u8]) -> Result<()> {
            if bytes.len() == 1 {
                match bytes[0] {
                    b'?' => {
                        self.incoming
                            .push_back(format!("<{}|MPos:0.000,0.000,0.000|FS:0,0>", self.state));
                        return Ok(());
                    }
                    b'!' | b'~' | 0x18 => {
                        self.realtime_bytes.push(bytes[0]);
                        return Ok(());
                    }
                    _ => {}
                }
            }
            let text = String::from_utf8_lossy(bytes).to_string();
            for line in text.split_inclusive('\n') {
                self.rx.push_back(line.len());
                self.rx_used += line.len();
                self.max_rx_used = self.max_rx_used.max(self.rx_used);
                if self.rx_used > 128 {
                    self.overflowed = true;
                }
                self.written_lines.push(line.trim().to_string());
            }
            Ok(())
        }

        fn read_line(&mut self) -> Result<Option<String>> {
            if let Some(l) = self.incoming.pop_front() {
                return Ok(Some(l));
            }
            if let Some(len) = self.rx.pop_front() {
                self.rx_used -= len;
                let idx = self.lines_processed;
                self.lines_processed += 1;
                if self.fail_on_line == Some(idx) {
                    return Ok(Some("error:22".to_string()));
                }
                return Ok(Some("ok".to_string()));
            }
            std::thread::sleep(Duration::from_millis(1));
            Ok(None)
        }

        fn discard_pending(&mut self) {
            self.incoming.clear();
        }
    }

    fn program(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("G1 X{i}.5 Y{i}.25 F1000")).collect()
    }

    fn run(
        link: &mut FakeGrbl,
        lines: &[String],
        control: &JobControl,
    ) -> (Result<()>, Vec<String>) {
        let mut events = Vec::new();
        let result = run_program_on(link, lines, control, &mut |e| events.push(format!("{e:?}")));
        (result, events)
    }

    #[test]
    fn classification() {
        assert_eq!(classify("ok"), Response::Ok);
        assert_eq!(classify("error:22"), Response::Error(22));
        assert_eq!(classify("ALARM:2"), Response::Alarm(2));
        assert_eq!(classify("<Idle|MPos:0,0,0>"), Response::Status);
        assert_eq!(classify("[MSG:Reset to continue]"), Response::Other);
    }

    #[test]
    fn streaming_never_overflows_the_rx_buffer_and_acknowledges_every_line() {
        let mut grbl = FakeGrbl::new();
        let lines = program(400);
        let (result, events) = run(&mut grbl, &lines, &JobControl::new());
        assert!(result.is_ok(), "{result:?}");
        assert!(
            !grbl.overflowed,
            "RX buffer overflowed (max {})",
            grbl.max_rx_used
        );
        assert_eq!(grbl.written_lines.len(), 400);
        assert_eq!(grbl.written_lines[0], lines[0]);
        assert_eq!(grbl.written_lines[399], lines[399]);
        assert!(events.contains(&"Progress { done: 400, total: 400 }".to_string()));
        assert_eq!(events.last().unwrap(), "Completed");
    }

    #[test]
    fn comments_and_blank_lines_are_never_sent() {
        let mut grbl = FakeGrbl::new();
        let lines = vec![
            "; header".to_string(),
            "G21 ; mm".to_string(),
            "".to_string(),
            "G90".to_string(),
        ];
        let (result, _) = run(&mut grbl, &lines, &JobControl::new());
        assert!(result.is_ok());
        assert_eq!(
            grbl.written_lines,
            vec!["G21".to_string(), "G90".to_string()]
        );
    }

    #[test]
    fn an_error_response_stops_the_job_names_the_line_and_resets_the_machine() {
        let mut grbl = FakeGrbl::new();
        grbl.fail_on_line = Some(4);
        let (result, events) = run(&mut grbl, &program(50), &JobControl::new());
        let message = result.unwrap_err().to_string();
        assert!(message.contains("error:22"), "{message}");
        assert!(message.contains("program line 5"), "{message}");
        assert!(
            grbl.realtime_bytes.contains(&0x18),
            "soft reset must be sent"
        );
        assert!(!events.contains(&"Completed".to_string()));
    }

    #[test]
    fn a_job_will_not_start_unless_the_machine_is_idle() {
        let mut grbl = FakeGrbl::new();
        grbl.state = "Alarm";
        let (result, _) = run(&mut grbl, &program(3), &JobControl::new());
        assert!(matches!(result, Err(MachineError::NotIdle(_))));
        assert!(grbl.written_lines.is_empty());
    }

    #[test]
    fn abort_resets_the_machine_and_reports_it() {
        let mut grbl = FakeGrbl::new();
        let control = JobControl::new();
        control.request_abort();
        let (result, events) = run(&mut grbl, &program(10), &control);
        assert!(matches!(result, Err(MachineError::Aborted)));
        assert!(grbl.realtime_bytes.contains(&0x18));
        assert_eq!(events.last().unwrap(), "Aborted");
    }

    #[test]
    fn pause_stops_sending_and_resume_continues() {
        let mut grbl = FakeGrbl::new();
        let control = JobControl::new();
        control.request_pause();
        let resumer = control.clone();
        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            resumer.request_resume();
        });
        let (result, events) = run(&mut grbl, &program(30), &control);
        handle.join().unwrap();
        assert!(result.is_ok(), "{result:?}");
        let paused = events
            .iter()
            .position(|e| e == "Paused")
            .expect("paused event");
        let resumed = events
            .iter()
            .position(|e| e == "Resumed")
            .expect("resumed event");
        assert!(paused < resumed);
        assert_eq!(grbl.written_lines.len(), 30);
    }

    #[test]
    fn an_oversized_line_cannot_deadlock_the_stream() {
        let mut grbl = FakeGrbl::new();
        let long = format!("G1 {}", "X1 ".repeat(60));
        assert!(long.len() > RX_BUFFER_BYTES);
        let (result, _) = run(&mut grbl, &[long, "G0 X0".to_string()], &JobControl::new());
        assert!(result.is_ok(), "{result:?}");
    }

    #[test]
    fn disconnected_controller_returns_errors_instead_of_panicking() {
        let mut c = GrblController::new();
        assert!(matches!(c.home(), Err(MachineError::NotConnected)));
        assert!(matches!(
            c.jog(1.0, 0.0, 500.0),
            Err(MachineError::NotConnected)
        ));
        assert!(matches!(c.query_status(), Err(MachineError::NotConnected)));
        assert!(!c.is_connected());
        assert!(c.realtime_handle().is_none());
    }

    #[test]
    fn jog_rejects_non_finite_input() {
        let mut c = GrblController::new();
        assert!(matches!(
            c.jog(f64::NAN, 0.0, 500.0),
            Err(MachineError::InvalidRequest(_))
        ));
    }
}
