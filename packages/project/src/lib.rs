//! `makerlaser-project`: the CAM engine and `.mlp` project format.
//!
//! ```text
//! Workspace -> Operations (cam) -> Toolpaths (toolpath) -> G-code (gcode) -> safety checks
//! ```
//! [`build_job`] runs the whole chain; the UI never builds G-code itself.

pub mod cam;
pub mod error;
pub mod gcode;
pub mod mlp;
pub mod safety;
pub mod toolpath;

use std::collections::HashMap;

use makerlaser_common::ProjectFile;
use uuid::Uuid;

pub use cam::{plan_operations, PlanResult};
pub use error::{ProjectError, Result};
pub use gcode::{generate_gcode, GcodeOptions};
pub use mlp::{load_project, save_project};
pub use safety::{check_all, check_project, check_toolpath, SafetyReport, BOUNDS_TOLERANCE_MM};
pub use toolpath::{
    generate_toolpath, MoveKind, Toolpath, ToolpathResult, ToolpathSegment, ToolpathStats,
};

/// Everything produced by planning a job.
#[derive(Debug, Clone)]
pub struct Job {
    pub gcode: String,
    pub toolpath: ToolpathResult,
    pub safety: SafetyReport,
    /// Planner and toolpath warnings (objects that will not run, skipped images, ...).
    pub warnings: Vec<String>,
}

/// Plans operations, generates the toolpath and G-code, and runs the safety checks.
pub fn build_job(
    project: &ProjectFile,
    image_bytes: &HashMap<Uuid, Vec<u8>>,
    options: &GcodeOptions,
) -> Result<Job> {
    let plan = plan_operations(project);
    let toolpath = generate_toolpath(project, &plan.operations, image_bytes)?;
    let safety = check_all(project, &toolpath.toolpath);
    let gcode = generate_gcode(&toolpath.toolpath, &project.machine, &project.name, options);
    let mut warnings = plan.warnings;
    warnings.extend(toolpath.warnings.iter().cloned());
    Ok(Job {
        gcode,
        toolpath,
        safety,
        warnings,
    })
}
