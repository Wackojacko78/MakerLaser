//! Machine connection, manual control and job execution.
//!
//! Safety rules enforced here (in addition to the pre-flight checks done when generating):
//! * nothing moves unless a machine or the simulator has been explicitly connected;
//! * a job only starts from the exact G-code the user previewed (fingerprint match);
//! * only one job can run at a time;
//! * manual motion is refused while a job is running (the controller is busy);
//! * Pause/Resume/Stop use the real-time channel, so they work mid-job.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use makerlaser_common::{Point2, ProjectFile};
use makerlaser_machine::{
    AvailablePort, GrblController, GrblStatus, JobEvent, MachineError, Simulator,
};
use serde::Serialize;
use tauri::{Emitter, State};

use crate::console::{changes_machine_coordinates, check_console_line};
use crate::placement::{
    frame_laser_s, frame_program, laser_frame_program, place_program, Placement,
};
use crate::state::{fingerprint, lock, AppState, POISONED};

const FRAME_FEED_MM_MIN: f64 = 3000.0;
const MAX_JOG_MM: f64 = 1000.0;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum JobEventPayload {
    Progress { done: usize, total: usize },
    Message { text: String },
    Paused,
    Resumed,
    Completed,
    Aborted,
    Failed { message: String },
}

impl From<JobEvent<'_>> for JobEventPayload {
    fn from(event: JobEvent<'_>) -> Self {
        match event {
            JobEvent::Progress { done, total } => JobEventPayload::Progress { done, total },
            JobEvent::Message(text) => JobEventPayload::Message {
                text: text.to_string(),
            },
            JobEvent::Paused => JobEventPayload::Paused,
            JobEvent::Resumed => JobEventPayload::Resumed,
            JobEvent::Completed => JobEventPayload::Completed,
            JobEvent::Aborted => JobEventPayload::Aborted,
        }
    }
}

fn is_running(state: &AppState) -> bool {
    state.job_running.load(Ordering::SeqCst)
}

/// The placement for Start From "Current position" or "User origin", or `None` for "Absolute".
/// The anchor is the job origin (one of the nine points of the artwork's box) in machine
/// coordinates, the same coordinates the previewed G-code uses.
fn relative_placement(
    state: &AppState,
    project: &ProjectFile,
) -> Result<Option<Placement>, String> {
    let start_from = project.settings.start_from;
    if !start_from.is_relative() {
        return Ok(None);
    }
    let extent = project.job_extent().ok_or_else(|| {
        "Nothing to place: no visible artwork is assigned to an enabled layer.".to_string()
    })?;
    let anchor = project
        .machine
        .workspace_to_machine(project.settings.job_origin.anchor(&extent));
    let user_origin = if start_from.uses_user_origin() {
        let stored = *state.user_origin.lock().map_err(|_| POISONED.to_string())?;
        Some(stored.ok_or_else(|| {
            "Start From is User origin, but no user origin is set. Jog the head to where the job should start, then press Set user origin in the Machine window."
                .to_string()
        })?)
    } else {
        None
    };
    Ok(Some(Placement {
        anchor: (anchor.x, anchor.y),
        user_origin,
    }))
}

/// Clears `job_running` when the job thread ends, even if it panics.
struct RunningGuard(Arc<AtomicBool>);

impl Drop for RunningGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[tauri::command(async)]
pub fn list_serial_ports() -> Result<Vec<AvailablePort>, String> {
    makerlaser_machine::list_available_ports().map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn machine_connect(
    state: State<'_, AppState>,
    port: String,
    baud: u32,
    simulate: bool,
) -> Result<(), String> {
    if is_running(&state) {
        return Err("A job is running. Stop it before reconnecting.".to_string());
    }
    // Only USB serial can connect for now. Say so plainly instead of trying a serial port.
    if !simulate && lock(&state.project)?.machine.uses_network() {
        return Err(
            "This machine is set to connect over the network, which MakerLaser cannot do yet. Choose USB serial in the Machine window, or use the simulator."
                .to_string(),
        );
    }
    let mut controller = state.controller()?;
    if controller.is_connected() {
        return Err("Already connected. Disconnect first.".to_string());
    }
    let mut next: Box<dyn makerlaser_machine::Controller> = if simulate {
        Box::new(Simulator::new())
    } else {
        Box::new(GrblController::new())
    };
    if !simulate && !(300..=4_000_000).contains(&baud) {
        return Err("Choose a valid baud rate (GRBL normally uses 115200).".to_string());
    }
    next.connect(&port, baud).map_err(|e| e.to_string())?;
    *lock(&state.realtime)? = next.realtime_handle();
    *controller = next;
    state.clear_user_origin();
    Ok(())
}

#[tauri::command(async)]
pub fn machine_disconnect(state: State<'_, AppState>) -> Result<(), String> {
    if is_running(&state) {
        return Err("A job is running. Stop it before disconnecting.".to_string());
    }
    let mut controller = state.controller()?;
    controller.disconnect().map_err(|e| e.to_string())?;
    *lock(&state.realtime)? = None;
    state.clear_user_origin();
    Ok(())
}

#[tauri::command(async)]
pub fn machine_status(state: State<'_, AppState>) -> Result<GrblStatus, String> {
    let mut controller = state.controller()?;
    controller.query_status().map_err(|e| e.to_string())
}

/// Jog in *screen* directions (Y-down workspace deltas, in mm): "up" is negative `dy`.
#[tauri::command(async)]
pub fn machine_jog(state: State<'_, AppState>, dx: f64, dy: f64, feed: f64) -> Result<(), String> {
    if !(dx.is_finite() && dy.is_finite() && feed.is_finite()) || feed <= 0.0 {
        return Err("Invalid jog request.".to_string());
    }
    if dx.abs() > MAX_JOG_MM || dy.abs() > MAX_JOG_MM {
        return Err(format!(
            "Jog distance is limited to {MAX_JOG_MM:.0} mm per move."
        ));
    }
    let (profile_feed, mdx, mdy) = {
        let project = lock(&state.project)?;
        let (mdx, mdy) = project.machine.workspace_delta_to_machine(dx, dy);
        (project.machine.max_feed_rate_mm_min, mdx, mdy)
    };
    let mut controller = state.controller()?;
    controller
        .jog(mdx, mdy, feed.min(profile_feed))
        .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn machine_home(state: State<'_, AppState>) -> Result<(), String> {
    let mut controller = state.controller()?;
    controller.home().map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn machine_unlock(state: State<'_, AppState>) -> Result<(), String> {
    let mut controller = state.controller()?;
    controller.unlock().map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn machine_set_origin(state: State<'_, AppState>) -> Result<(), String> {
    let mut controller = state.controller()?;
    controller.set_origin().map_err(|e| e.to_string())
}

/// Remembers where the head is now (machine position) as the User origin for Start From.
#[tauri::command(async)]
pub fn machine_set_user_origin(state: State<'_, AppState>) -> Result<(f64, f64), String> {
    if is_running(&state) {
        return Err("A job is running. Stop it before setting the user origin.".to_string());
    }
    let mut controller = state.controller()?;
    let status = controller.query_status().map_err(|e| e.to_string())?;
    if format!("{:?}", status.state) == "Alarm" {
        return Err(
            "The machine is in an alarm state. Unlock it and check where the head is first."
                .to_string(),
        );
    }
    if !status.is_machine_position {
        return Err(
            "The controller reports work position instead of machine position (GRBL setting $10), so the user origin cannot be stored reliably. Set $10=1 and try again."
                .to_string(),
        );
    }
    let origin = (status.position.x, status.position.y);
    if !(origin.0.is_finite() && origin.1.is_finite()) {
        return Err("The controller reported an invalid position.".to_string());
    }
    *state.user_origin.lock().map_err(|_| POISONED.to_string())? = Some(origin);
    Ok(origin)
}

#[tauri::command(async)]
pub fn machine_user_origin(state: State<'_, AppState>) -> Result<Option<(f64, f64)>, String> {
    Ok(*state.user_origin.lock().map_err(|_| POISONED.to_string())?)
}

#[tauri::command(async)]
pub fn machine_clear_user_origin(state: State<'_, AppState>) -> Result<(), String> {
    state.clear_user_origin();
    Ok(())
}

/// Traces the outline of the job. The laser is off unless `laser_percent` is given: then it is on
/// at that low power (at most `FRAME_LASER_MAX_PERCENT`) for the trace, so the outline can be seen
/// on the material. Refuses an empty job or one outside the bed.
#[tauri::command(async)]
pub fn machine_frame(state: State<'_, AppState>, laser_percent: Option<f64>) -> Result<(), String> {
    let (min, max, feed, relative, laser_s) = {
        let project = lock(&state.project)?;
        let extent = project
            .objects
            .iter()
            .filter(|o| o.visible)
            .filter(|o| {
                o.layer_id
                    .and_then(|id| project.find_layer(id))
                    .map(|l| l.enabled)
                    .unwrap_or(false)
            })
            .filter_map(|o| o.world_bounding_box())
            .reduce(|a, b| a.union(&b))
            .ok_or_else(|| {
                "Nothing to frame: no visible artwork is assigned to an enabled layer.".to_string()
            })?;
        if !extent.fits_within(
            &project.machine.bed_bounds(),
            makerlaser_project::BOUNDS_TOLERANCE_MM,
        ) {
            return Err(
                "The artwork reaches outside the machine bed; move it inside before framing."
                    .to_string(),
            );
        }
        let a = project.machine.workspace_to_machine(extent.min);
        let b = project.machine.workspace_to_machine(extent.max);
        let min = Point2::new(a.x.min(b.x), a.y.min(b.y));
        let max = Point2::new(a.x.max(b.x), a.y.max(b.y));
        (
            (min.x, min.y),
            (max.x, max.y),
            FRAME_FEED_MM_MIN.min(project.machine.max_feed_rate_mm_min),
            relative_placement(&state, &project)?,
            laser_percent
                .map(|percent| frame_laser_s(percent, project.machine.max_spindle_value))
                .transpose()?,
        )
    };
    let mut controller = state.controller()?;
    // Laser off on the bed is the controller's own frame. Everything else is a short program run
    // like a job: Start From relative to the head traces the outline around it and comes back, and
    // with the laser on it is switched on only for the trace and off again before the return move.
    // An abort or an error soft-resets the controller, which switches the laser off.
    let lines = match (relative.as_ref(), laser_s) {
        (None, None) => return controller.frame(min, max, feed).map_err(|e| e.to_string()),
        (Some(placement), None) => frame_program(min, max, feed, placement)?,
        (placement, Some(s)) => laser_frame_program(min, max, feed, placement, s)?,
    };
    let control = state.job_control.clone();
    control.reset();
    let outcome = controller.run_program(&lines, &control, &mut |_| {});
    if outcome.is_err() {
        // The controller was reset: a remembered machine position may no longer be valid.
        state.clear_user_origin();
    }
    outcome.map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn machine_start(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // Everything is verified before the job thread is spawned.
    let (lines, relative) = {
        let generated = lock(&state.generated)?;
        let job = generated
            .as_ref()
            .ok_or_else(|| "Generate the toolpath first.".to_string())?;
        if !job.safety.is_safe_to_run() {
            return Err(format!(
                "Safety check failed: {}",
                job.safety.errors.join(" ")
            ));
        }
        let project = lock(&state.project)?;
        let current = fingerprint(&project);
        if current != job.fingerprint {
            return Err(
                "The project changed after the G-code was generated. Generate and preview again."
                    .to_string(),
            );
        }
        let relative = relative_placement(&state, &project)?;
        (job.lines.clone(), relative)
    };
    // Every run clears a stale G92 offset; the relative modes also place the job around the head.
    let lines = place_program(&lines, relative.as_ref())?;

    {
        let controller = state.controller()?;
        if !controller.is_connected() {
            return Err("No machine or simulator is connected.".to_string());
        }
    }

    if state
        .job_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("A job is already running.".to_string());
    }
    state.job_control.reset();

    let controller = state.controller.clone();
    let control = state.job_control.clone();
    let running = RunningGuard(state.job_running.clone());
    let user_origin = state.user_origin.clone();

    std::thread::spawn(move || {
        let _running = running;
        let outcome = match controller.lock() {
            Ok(mut c) => c.run_program(&lines, &control, &mut |event| {
                let _ = app.emit("job-event", JobEventPayload::from(event));
            }),
            Err(_) => Err(MachineError::InternalState(
                "controller lock poisoned".into(),
            )),
        };
        match outcome {
            Ok(()) | Err(MachineError::Aborted) => {} // Completed / Aborted already emitted
            Err(e) => {
                // The controller was reset: a remembered machine position may no longer be valid.
                if let Ok(mut origin) = user_origin.lock() {
                    *origin = None;
                }
                let _ = app.emit(
                    "job-event",
                    JobEventPayload::Failed {
                        message: e.to_string(),
                    },
                );
            }
        }
    });
    Ok(())
}

fn realtime(state: &AppState) -> Result<Arc<dyn makerlaser_machine::RealtimeControl>, String> {
    lock(&state.realtime)?
        .clone()
        .ok_or_else(|| "No machine or simulator is connected.".to_string())
}

#[tauri::command(async)]
pub fn machine_pause(state: State<'_, AppState>) -> Result<(), String> {
    // Pause (feed hold) belongs to a running job. A frame has nothing to resume, and one with the
    // laser on is ended with STOP, which switches the laser off.
    if !is_running(&state) {
        return Err("There is no running job to pause. Use STOP to end a frame.".to_string());
    }
    realtime(&state)?.pause().map_err(|e| e.to_string())?;
    state.job_control.request_pause();
    Ok(())
}

#[tauri::command(async)]
pub fn machine_resume(state: State<'_, AppState>) -> Result<(), String> {
    realtime(&state)?.resume().map_err(|e| e.to_string())?;
    state.job_control.request_resume();
    Ok(())
}

/// Sends one typed command to the controller (the console box) and returns what it printed in
/// reply, for example the settings list for `$$`. Only with a real machine connected and no job
/// running. The line is checked first (see `console.rs`): one plain line, no real-time characters,
/// nothing that switches the laser on.
#[tauri::command(async)]
pub fn machine_send(state: State<'_, AppState>, line: String) -> Result<Vec<String>, String> {
    let line = check_console_line(&line)?;
    if is_running(&state) {
        return Err(
            "A job is running. Use Pause or STOP; commands can be sent when it has finished."
                .to_string(),
        );
    }
    let mut controller = state.controller()?;
    if !controller.is_connected() {
        return Err("No machine or simulator is connected.".to_string());
    }
    // STOP asks the job control to abort, which also ends a command that is still waiting.
    state.job_control.reset();
    let outcome = controller.send_command(&line, &state.job_control);
    if changes_machine_coordinates(&line) {
        // Homing, or a setting that moves zero or changes the position report: a remembered
        // machine position may no longer be valid.
        state.clear_user_origin();
    }
    outcome.map_err(|e| e.to_string())
}

/// Emergency stop: the job loop is told to stop sending *first*, then GRBL is soft-reset
/// (which halts motion and switches the laser off). Works even when no job is running.
#[tauri::command(async)]
pub fn machine_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.job_control.request_abort();
    state.clear_user_origin();
    realtime(&state)?.stop().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_events_serialise_with_a_type_tag_the_ui_can_switch_on() {
        let json = serde_json::to_string(&JobEventPayload::Progress { done: 3, total: 9 }).unwrap();
        assert_eq!(json, r#"{"type":"progress","done":3,"total":9}"#);
        let json = serde_json::to_string(&JobEventPayload::Completed).unwrap();
        assert_eq!(json, r#"{"type":"completed"}"#);
    }

    fn project_with_a_square(start_from: &str) -> ProjectFile {
        use makerlaser_common::{LayerKind, Path2D, WorkspaceObject};
        let mut p = crate::state::default_project();
        let layer = p
            .layers
            .iter()
            .find(|l| l.kind == LayerKind::Cut)
            .unwrap()
            .id;
        let square = Path2D::new(
            vec![
                Point2::new(10.0, 20.0),
                Point2::new(40.0, 20.0),
                Point2::new(40.0, 60.0),
                Point2::new(10.0, 60.0),
            ],
            true,
        );
        let mut o = WorkspaceObject::new_vector("sq", vec![square], 0);
        o.layer_id = Some(layer);
        p.objects.push(o);
        let settings = format!(
            r#"{{"units":"mm","grid_spacing_mm":10.0,"show_grid":true,"show_origin":true,"start_from":"{start_from}","job_origin":"center"}}"#
        );
        p.settings = serde_json::from_str(&settings).unwrap();
        p
    }

    #[test]
    fn absolute_start_from_has_no_placement() {
        let state = AppState::default();
        let project = crate::state::default_project();
        assert!(relative_placement(&state, &project).unwrap().is_none());
    }

    #[test]
    fn current_position_anchors_the_job_origin_in_machine_coordinates() {
        let state = AppState::default();
        let project = project_with_a_square("current_position");
        // The artwork spans X 10..40, Y 20..60 on screen; its centre is (25, 40), which is
        // (25, 260) on a 300 mm bed with the origin at the bottom left.
        let p = relative_placement(&state, &project).unwrap().unwrap();
        assert_eq!(
            p,
            Placement {
                anchor: (25.0, 260.0),
                user_origin: None
            }
        );
    }

    #[test]
    fn user_origin_start_needs_a_stored_user_origin() {
        let state = AppState::default();
        let project = project_with_a_square("user_origin");
        let err = relative_placement(&state, &project).unwrap_err();
        assert!(err.contains("no user origin is set"), "{err}");
        *state.user_origin.lock().unwrap() = Some((120.0, 80.0));
        let p = relative_placement(&state, &project).unwrap().unwrap();
        assert_eq!(p.user_origin, Some((120.0, 80.0)));
    }

    #[test]
    fn a_relative_start_with_nothing_to_place_is_refused() {
        let state = AppState::default();
        let mut project = project_with_a_square("current_position");
        project.objects.clear();
        let err = relative_placement(&state, &project).unwrap_err();
        assert!(err.contains("Nothing to place"), "{err}");
    }

    #[test]
    fn running_guard_clears_the_flag_on_drop() {
        let flag = Arc::new(AtomicBool::new(true));
        {
            let _g = RunningGuard(flag.clone());
        }
        assert!(!flag.load(Ordering::SeqCst));
    }
}
