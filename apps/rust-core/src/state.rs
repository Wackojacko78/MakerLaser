//! Application state. The React store is the source of truth while editing; it pushes the
//! whole project here (`sync_project`) before anything that needs the Rust side (generate,
//! save, frame, start). Image bytes live only here, keyed by asset id.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard, TryLockError};

use makerlaser_common::{MachineProfile, ProjectFile};
use makerlaser_machine::{Controller, JobControl, RealtimeControl, Simulator};
use makerlaser_project::SafetyReport;
use uuid::Uuid;

pub const POISONED: &str =
    "An internal lock was poisoned by an earlier error. Please save your work and restart MakerLaser.";

/// The most recently generated job: exactly what `machine_start` will run.
pub struct GeneratedJob {
    pub lines: Vec<String>,
    pub safety: SafetyReport,
    /// Fingerprint of the project the job was generated from.
    pub fingerprint: u64,
}

pub struct AppState {
    pub project: Mutex<ProjectFile>,
    pub assets: Mutex<HashMap<Uuid, Vec<u8>>>,
    pub controller: Arc<Mutex<Box<dyn Controller>>>,
    pub realtime: Mutex<Option<Arc<dyn RealtimeControl>>>,
    pub job_control: JobControl,
    pub job_running: Arc<AtomicBool>,
    pub generated: Mutex<Option<GeneratedJob>>,
    pub project_path: Mutex<Option<PathBuf>>,
    /// Machine position (`MPos`) of the User origin for Start From. Only valid until the
    /// controller is reset or reconnected, so it is never saved with the project.
    pub user_origin: Arc<Mutex<Option<(f64, f64)>>>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            project: Mutex::new(default_project()),
            assets: Mutex::new(HashMap::new()),
            // Not connected until the user connects; this just provides a valid object.
            controller: Arc::new(Mutex::new(Box::new(Simulator::new()) as Box<dyn Controller>)),
            realtime: Mutex::new(None),
            job_control: JobControl::new(),
            job_running: Arc::new(AtomicBool::new(false)),
            generated: Mutex::new(None),
            project_path: Mutex::new(None),
            user_origin: Arc::new(Mutex::new(None)),
        }
    }
}

pub fn default_project() -> ProjectFile {
    ProjectFile::new("Untitled", MachineProfile::tts55_pro())
}

/// Locks a mutex, turning poisoning into a user-visible error instead of a panic.
pub fn lock<T>(m: &Mutex<T>) -> Result<MutexGuard<'_, T>, String> {
    m.lock().map_err(|_| POISONED.to_string())
}

impl AppState {
    /// Forgets the User origin. It is a machine position, so it is only valid until the
    /// controller is reset: connecting, disconnecting, stopping and a failed job all clear it.
    pub fn clear_user_origin(&self) {
        if let Ok(mut origin) = self.user_origin.lock() {
            *origin = None;
        }
    }

    /// Locks the controller without blocking: while a job is streaming the job thread
    /// holds it, and a jog/home/frame request must fail fast rather than freeze or queue.
    pub fn controller(&self) -> Result<MutexGuard<'_, Box<dyn Controller>>, String> {
        match self.controller.try_lock() {
            Ok(guard) => Ok(guard),
            Err(TryLockError::WouldBlock) => {
                Err("The machine is busy (a job is running). Pause or stop it first.".to_string())
            }
            Err(TryLockError::Poisoned(_)) => Err(POISONED.to_string()),
        }
    }
}

/// A fingerprint of everything that influences generated G-code.
pub fn fingerprint(project: &ProjectFile) -> u64 {
    let mut hasher = DefaultHasher::new();
    serde_json::to_string(project)
        .unwrap_or_default()
        .hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_changes_when_the_project_changes() {
        let mut p = default_project();
        let before = fingerprint(&p);
        assert_eq!(before, fingerprint(&p));
        p.layers[0].power_percent += 1.0;
        assert_ne!(before, fingerprint(&p));
    }

    #[test]
    fn clearing_the_user_origin_forgets_it() {
        let state = AppState::default();
        *state.user_origin.lock().unwrap() = Some((1.0, 2.0));
        state.clear_user_origin();
        assert!(state.user_origin.lock().unwrap().is_none());
    }

    #[test]
    fn controller_lock_fails_fast_when_busy() {
        let state = AppState::default();
        let _held = state.controller.lock().unwrap();
        let err = state.controller().err().expect("must not block");
        assert!(err.contains("busy"));
    }
}
