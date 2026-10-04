//! Offline machine simulator. Implements the same [`Controller`] trait as the real GRBL
//! driver so the whole UI (jog, frame, start, pause, stop, progress) works with no hardware.
//! Also provides [`estimate_runtime`], used by the UI for the "estimated time" readout.

use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::controller::{strip_comments, Controller, RealtimeControl};
use crate::error::{MachineError, Result};
use crate::job_control::{JobControl, JobEvent};
use crate::status::{GrblStatus, MachineState, Position3};

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct RuntimeEstimate {
    pub travel_seconds: f64,
    pub cut_seconds: f64,
}

impl RuntimeEstimate {
    pub fn total_seconds(&self) -> f64 {
        self.travel_seconds + self.cut_seconds
    }
}

fn tokenize(line: &str) -> Vec<(char, f64)> {
    let b = line.as_bytes();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i].is_ascii_alphabetic() {
            let letter = (b[i] as char).to_ascii_uppercase();
            let start = i + 1;
            let mut j = start;
            if j < b.len() && (b[j] == b'-' || b[j] == b'+') {
                j += 1;
            }
            while j < b.len() && (b[j].is_ascii_digit() || b[j] == b'.') {
                j += 1;
            }
            if let Ok(v) = line[start..j].parse::<f64>() {
                tokens.push((letter, v));
            }
            i = j.max(i + 1);
        } else {
            i += 1;
        }
    }
    tokens
}

/// Estimates run time of a G-code program by integrating `distance / feed` over every
/// `G0`/`G1` move, split into laser-off travel and laser-on work.
pub fn estimate_runtime(lines: &[String], rapid_feed_mm_min: f64) -> RuntimeEstimate {
    let rapid = rapid_feed_mm_min.max(1.0);
    let mut est = RuntimeEstimate::default();
    let (mut x, mut y) = (0.0_f64, 0.0_f64);
    let mut feed = rapid;
    let mut laser_on = false;

    for raw in lines {
        let line = strip_comments(raw);
        if line.is_empty() {
            continue;
        }
        let (mut nx, mut ny) = (x, y);
        let (mut is_rapid, mut is_move) = (false, false);
        for (letter, value) in tokenize(&line) {
            match letter {
                'G' => match value as i32 {
                    0 => {
                        is_rapid = true;
                        is_move = true;
                    }
                    1 => is_move = true,
                    _ => {}
                },
                'M' => match value as i32 {
                    3 | 4 => laser_on = true,
                    5 => laser_on = false,
                    _ => {}
                },
                'S' if value <= 0.0 => laser_on = false,
                'X' => nx = value,
                'Y' => ny = value,
                'F' => feed = value.max(1.0),
                _ => {}
            }
        }
        if is_move {
            let dist = ((nx - x).powi(2) + (ny - y).powi(2)).sqrt();
            let speed = if is_rapid { rapid } else { feed };
            let seconds = dist / speed * 60.0;
            if laser_on && !is_rapid {
                est.cut_seconds += seconds;
            } else {
                est.travel_seconds += seconds;
            }
            x = nx;
            y = ny;
        }
    }
    est
}

struct SimulatorRealtime;

impl RealtimeControl for SimulatorRealtime {
    fn pause(&self) -> Result<()> {
        Ok(())
    }
    fn resume(&self) -> Result<()> {
        Ok(())
    }
    fn stop(&self) -> Result<()> {
        Ok(())
    }
}

pub struct Simulator {
    connected: bool,
    position: Position3,
    /// How much faster than real time a job is replayed.
    pub speed_multiplier: f64,
}

impl Default for Simulator {
    fn default() -> Self {
        Simulator {
            connected: false,
            position: Position3 {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            speed_multiplier: 20.0,
        }
    }
}

impl Simulator {
    pub fn new() -> Self {
        Self::default()
    }

    fn require_connected(&self) -> Result<()> {
        if self.connected {
            Ok(())
        } else {
            Err(MachineError::NotConnected)
        }
    }
}

impl Controller for Simulator {
    fn connect(&mut self, _port_name: &str, _baud_rate: u32) -> Result<()> {
        self.connected = true;
        Ok(())
    }

    fn disconnect(&mut self) -> Result<()> {
        self.connected = false;
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected
    }

    fn query_status(&mut self) -> Result<GrblStatus> {
        self.require_connected()?;
        Ok(GrblStatus {
            state: MachineState::Idle,
            position: self.position,
            is_machine_position: true,
            feed_rate_mm_min: 0.0,
            spindle_value: 0.0,
        })
    }

    fn jog(&mut self, dx_mm: f64, dy_mm: f64, _feed_mm_min: f64) -> Result<()> {
        self.require_connected()?;
        if !(dx_mm.is_finite() && dy_mm.is_finite()) {
            return Err(MachineError::InvalidRequest(
                "jog distances must be finite".into(),
            ));
        }
        self.position.x += dx_mm;
        self.position.y += dy_mm;
        Ok(())
    }

    fn home(&mut self) -> Result<()> {
        self.require_connected()?;
        self.position = Position3 {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        };
        Ok(())
    }

    fn unlock(&mut self) -> Result<()> {
        self.require_connected()
    }

    fn set_origin(&mut self) -> Result<()> {
        self.require_connected()?;
        self.position = Position3 {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        };
        Ok(())
    }

    fn frame(&mut self, min: (f64, f64), max: (f64, f64), _feed_mm_min: f64) -> Result<()> {
        self.require_connected()?;
        if min.0 > max.0 || min.1 > max.1 {
            return Err(MachineError::InvalidRequest(
                "invalid frame rectangle".into(),
            ));
        }
        self.position.x = min.0;
        self.position.y = min.1;
        Ok(())
    }

    fn run_program(
        &mut self,
        lines: &[String],
        control: &JobControl,
        on_event: &mut dyn FnMut(JobEvent<'_>),
    ) -> Result<()> {
        self.require_connected()?;
        let program: Vec<String> = lines
            .iter()
            .map(|l| strip_comments(l))
            .filter(|l| !l.is_empty())
            .collect();
        let total = program.len();
        let estimate = estimate_runtime(&program, 6000.0).total_seconds();
        let per_line = if total == 0 {
            0.0
        } else {
            estimate / self.speed_multiplier.max(0.001) / total as f64
        };
        let per_line = Duration::from_secs_f64(if per_line.is_finite() {
            per_line.clamp(0.0, 0.25)
        } else {
            0.0
        });

        let mut was_paused = false;
        let mut last_progress = Instant::now();
        for (index, line) in program.iter().enumerate() {
            loop {
                if control.is_aborted() {
                    on_event(JobEvent::Aborted);
                    return Err(MachineError::Aborted);
                }
                if control.is_paused() {
                    if !was_paused {
                        on_event(JobEvent::Paused);
                        was_paused = true;
                    }
                    std::thread::sleep(Duration::from_millis(30));
                    continue;
                }
                if was_paused {
                    on_event(JobEvent::Resumed);
                    was_paused = false;
                }
                break;
            }
            std::thread::sleep(per_line);
            for (letter, value) in tokenize(line) {
                match letter {
                    'X' => self.position.x = value,
                    'Y' => self.position.y = value,
                    _ => {}
                }
            }
            let done = index + 1;
            if done == total || last_progress.elapsed() >= Duration::from_millis(50) {
                on_event(JobEvent::Progress { done, total });
                last_progress = Instant::now();
            }
        }
        on_event(JobEvent::Completed);
        Ok(())
    }

    fn realtime_handle(&self) -> Option<Arc<dyn RealtimeControl>> {
        if self.connected {
            Some(Arc::new(SimulatorRealtime))
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn estimate_splits_travel_and_work() {
        let program = lines(&[
            "G21",
            "G90",
            "G0 X10 Y0", // 10 mm rapid at 3000 mm/min = 0.2 s
            "M4 S800",
            "G1 X10 Y10 F300", // 10 mm at 300 mm/min = 2 s of work
            "M5",
        ]);
        let e = estimate_runtime(&program, 3000.0);
        assert!((e.travel_seconds - 0.2).abs() < 1e-9, "{e:?}");
        assert!((e.cut_seconds - 2.0).abs() < 1e-9, "{e:?}");
    }

    #[test]
    fn a_laser_off_g1_counts_as_travel() {
        let e = estimate_runtime(&lines(&["M5", "G1 X60 F600"]), 6000.0);
        assert_eq!(e.cut_seconds, 0.0);
        assert!((e.travel_seconds - 6.0).abs() < 1e-9);
    }

    #[test]
    fn comments_do_not_confuse_the_estimate() {
        let e = estimate_runtime(&lines(&["G1 X10 F600 ; slow (really)"]), 6000.0);
        assert!((e.travel_seconds - 1.0).abs() < 1e-9);
    }

    #[test]
    fn simulator_requires_an_explicit_connection() {
        let mut sim = Simulator::new();
        assert!(matches!(sim.home(), Err(MachineError::NotConnected)));
        assert!(matches!(
            sim.query_status(),
            Err(MachineError::NotConnected)
        ));
        sim.connect("SIM", 115_200).unwrap();
        assert!(sim.home().is_ok());
    }

    #[test]
    fn simulator_completes_a_program_and_tracks_position() {
        let mut sim = Simulator::new();
        sim.speed_multiplier = 1.0e6;
        sim.connect("SIM", 115_200).unwrap();
        let mut events = Vec::new();
        sim.run_program(
            &lines(&["G0 X5 Y6", "G1 X7 Y8 F500"]),
            &JobControl::new(),
            &mut |e| events.push(format!("{e:?}")),
        )
        .unwrap();
        assert_eq!(events.last().unwrap(), "Completed");
        let pos = sim.query_status().unwrap().position;
        assert_eq!((pos.x, pos.y), (7.0, 8.0));
    }

    #[test]
    fn simulator_honours_abort() {
        let mut sim = Simulator::new();
        sim.connect("SIM", 115_200).unwrap();
        let control = JobControl::new();
        control.request_abort();
        let r = sim.run_program(&lines(&["G0 X1"]), &control, &mut |_| {});
        assert!(matches!(r, Err(MachineError::Aborted)));
    }
}
