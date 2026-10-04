//! Shared control flags and progress events for a running job.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum JobEvent<'a> {
    /// `done` of `total` program lines have been acknowledged by the controller.
    Progress {
        done: usize,
        total: usize,
    },
    /// A message from the controller (e.g. `[MSG:...]`).
    Message(&'a str),
    Paused,
    Resumed,
    Completed,
    Aborted,
}

/// Cloneable handle shared between the thread running a job and the thread handling the
/// UI's Pause / Resume / Stop buttons. Clones share the same flags.
#[derive(Debug, Clone, Default)]
pub struct JobControl {
    abort: Arc<AtomicBool>,
    paused: Arc<AtomicBool>,
}

impl JobControl {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn request_abort(&self) {
        self.abort.store(true, Ordering::SeqCst);
    }
    pub fn is_aborted(&self) -> bool {
        self.abort.load(Ordering::SeqCst)
    }
    pub fn request_pause(&self) {
        self.paused.store(true, Ordering::SeqCst);
    }
    pub fn request_resume(&self) {
        self.paused.store(false, Ordering::SeqCst);
    }
    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }
    /// Clears both flags so the handle can be reused for the next job.
    pub fn reset(&self) {
        self.abort.store(false, Ordering::SeqCst);
        self.paused.store(false, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_round_trip_and_reset() {
        let c = JobControl::new();
        c.request_abort();
        c.request_pause();
        assert!(c.is_aborted() && c.is_paused());
        c.reset();
        assert!(!c.is_aborted() && !c.is_paused());
    }

    #[test]
    fn clones_share_state() {
        let c = JobControl::new();
        let d = c.clone();
        d.request_pause();
        assert!(c.is_paused());
    }
}
