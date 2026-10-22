//! `makerlaser-machine`: the machine layer. A real GRBL 1.1 serial controller and an offline
//! simulator implement the same [`Controller`] trait, so the UI never branches on whether
//! hardware is attached.

pub mod controller;
pub mod error;
pub mod grbl;
pub mod grbl_codes;
pub mod job_control;
pub mod motion;
pub mod ports;
pub mod simulator;
pub mod status;

pub use controller::{strip_comments, Controller, RealtimeControl};
pub use error::{MachineError, Result};
pub use grbl::GrblController;
pub use grbl_codes::{alarm as decode_alarm, error as decode_error, GrblDiagnostic};
pub use job_control::{JobControl, JobEvent};
pub use motion::{
    estimate_motion, MotionProfile, DEFAULT_JUNCTION_DEVIATION_MM, DEFAULT_RAPID_MM_MIN,
};
pub use ports::{list_available_ports, AvailablePort};
pub use simulator::{estimate_runtime, RuntimeEstimate, Simulator};
pub use status::{parse_status_line, GrblStatus, MachineState, Position3};
