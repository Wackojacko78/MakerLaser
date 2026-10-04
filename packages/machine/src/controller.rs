//! The `Controller` trait: the boundary between "something that can run a job" and the UI
//! and CAM layers above it. Implemented by [`crate::grbl::GrblController`] (real hardware)
//! and [`crate::simulator::Simulator`] (no hardware needed).

use std::sync::Arc;

use crate::error::Result;
use crate::job_control::{JobControl, JobEvent};
use crate::status::GrblStatus;

/// Real-time commands that must work *while a job is streaming*. The controller itself is
/// busy (and locked) inside `run_program`, so these go through a separate handle that only
/// owns the serial writer.
pub trait RealtimeControl: Send + Sync {
    /// Feed hold.
    fn pause(&self) -> Result<()>;
    /// Cycle start / resume.
    fn resume(&self) -> Result<()>;
    /// Soft reset: stops motion immediately and turns the laser off.
    fn stop(&self) -> Result<()>;
}

/// All coordinates passed to a `Controller` are **machine** coordinates (already converted
/// from workspace coordinates by `MachineProfile::workspace_to_machine`).
pub trait Controller: Send {
    fn connect(&mut self, port_name: &str, baud_rate: u32) -> Result<()>;
    fn disconnect(&mut self) -> Result<()>;
    fn is_connected(&self) -> bool;
    fn query_status(&mut self) -> Result<GrblStatus>;
    /// Relative jog (`$J=`), which GRBL can cancel mid-move.
    fn jog(&mut self, dx_mm: f64, dy_mm: f64, feed_mm_min: f64) -> Result<()>;
    /// Homing cycle (`$H`).
    fn home(&mut self) -> Result<()>;
    /// Clears an alarm lock (`$X`).
    fn unlock(&mut self) -> Result<()>;
    /// Declares the head's current position to be the work origin (X0 Y0). Jobs are
    /// absolute, so on machines without homing this is how the bed corner is defined.
    fn set_origin(&mut self) -> Result<()>;
    /// Traces the rectangle with the laser **off**.
    fn frame(&mut self, min: (f64, f64), max: (f64, f64), feed_mm_min: f64) -> Result<()>;
    /// Streams a program. Returns once the machine has actually finished (Idle), not merely
    /// when the last line was accepted.
    fn run_program(
        &mut self,
        lines: &[String],
        control: &JobControl,
        on_event: &mut dyn FnMut(JobEvent<'_>),
    ) -> Result<()>;
    fn realtime_handle(&self) -> Option<Arc<dyn RealtimeControl>>;
}

/// Removes `; ...` and `( ... )` comments and surrounding whitespace.
pub fn strip_comments(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut depth = 0u32;
    for ch in line.chars() {
        match ch {
            ';' if depth == 0 => break,
            '(' => depth += 1,
            ')' if depth > 0 => depth -= 1,
            c if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comments_are_removed() {
        assert_eq!(strip_comments("G21 ; millimetres"), "G21");
        assert_eq!(strip_comments("G1 X1 (move) Y2"), "G1 X1  Y2");
        assert_eq!(strip_comments("; whole line"), "");
        assert_eq!(strip_comments("   M5  "), "M5");
    }
}
