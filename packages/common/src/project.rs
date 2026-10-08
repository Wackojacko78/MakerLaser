//! The `ProjectFile` aggregate: everything that makes up one `.mlp` document.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::geometry_types::{BoundingBox, Point2};
use crate::layers::Layer;
use crate::machine::MachineProfile;
use crate::material::MaterialLibrary;
use crate::objects::WorkspaceObject;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Units {
    Mm,
    Inch,
}

/// Where the job is placed on the machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StartFrom {
    /// The workspace is the machine bed: the job runs where it is drawn (how MakerLaser has
    /// always worked).
    #[default]
    Absolute,
    /// The job is placed around wherever the laser head is when it starts.
    CurrentPosition,
    /// The job is placed around a start point set earlier (the head goes there first).
    UserOrigin,
}

impl StartFrom {
    /// True when the job is placed relative to the laser head rather than the bed.
    pub fn is_relative(self) -> bool {
        self != StartFrom::Absolute
    }

    pub fn uses_user_origin(self) -> bool {
        self == StartFrom::UserOrigin
    }

    pub fn label(self) -> &'static str {
        match self {
            StartFrom::Absolute => "Absolute coordinates",
            StartFrom::CurrentPosition => "Current position",
            StartFrom::UserOrigin => "User origin",
        }
    }
}

/// Which point of the job sits on the start point (the nine dots), as seen on screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobOrigin {
    TopLeft,
    Top,
    TopRight,
    Left,
    Center,
    Right,
    #[default]
    BottomLeft,
    Bottom,
    BottomRight,
}

impl JobOrigin {
    /// Position of this dot inside a box, as fractions of its width and height. The workspace is
    /// Y-down, so a fraction of 0 in Y is the top of the screen.
    pub fn fractions(self) -> (f64, f64) {
        match self {
            JobOrigin::TopLeft => (0.0, 0.0),
            JobOrigin::Top => (0.5, 0.0),
            JobOrigin::TopRight => (1.0, 0.0),
            JobOrigin::Left => (0.0, 0.5),
            JobOrigin::Center => (0.5, 0.5),
            JobOrigin::Right => (1.0, 0.5),
            JobOrigin::BottomLeft => (0.0, 1.0),
            JobOrigin::Bottom => (0.5, 1.0),
            JobOrigin::BottomRight => (1.0, 1.0),
        }
    }

    /// The workspace point of `extent` that this dot stands for.
    pub fn anchor(self, extent: &BoundingBox) -> Point2 {
        let (fx, fy) = self.fractions();
        Point2::new(
            extent.min.x + fx * (extent.max.x - extent.min.x),
            extent.min.y + fy * (extent.max.y - extent.min.y),
        )
    }

    pub fn label(self) -> &'static str {
        match self {
            JobOrigin::TopLeft => "top left",
            JobOrigin::Top => "top",
            JobOrigin::TopRight => "top right",
            JobOrigin::Left => "left",
            JobOrigin::Center => "centre",
            JobOrigin::Right => "right",
            JobOrigin::BottomLeft => "bottom left",
            JobOrigin::Bottom => "bottom",
            JobOrigin::BottomRight => "bottom right",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectSettings {
    pub units: Units,
    pub grid_spacing_mm: f64,
    pub show_grid: bool,
    pub show_origin: bool,
    /// `false`: engrave, score, then cut. `true`: layers run in layer order (`z_order`).
    #[serde(default)]
    pub custom_run_order: bool,
    /// Where the job is placed: on the bed (`absolute`) or relative to the laser head.
    #[serde(default)]
    pub start_from: StartFrom,
    /// Which point of the job sits on the head when `start_from` is not `absolute`.
    #[serde(default)]
    pub job_origin: JobOrigin,
}

impl Default for ProjectSettings {
    fn default() -> Self {
        ProjectSettings {
            units: Units::Mm,
            grid_spacing_mm: 10.0,
            show_grid: true,
            show_origin: true,
            custom_run_order: false,
            start_from: StartFrom::Absolute,
            job_origin: JobOrigin::BottomLeft,
        }
    }
}

/// Bump when the on-disk shape changes in a way older readers cannot handle.
pub const PROJECT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectFile {
    pub schema_version: u32,
    pub id: Uuid,
    pub name: String,
    pub machine: MachineProfile,
    pub layers: Vec<Layer>,
    pub objects: Vec<WorkspaceObject>,
    pub materials: MaterialLibrary,
    pub settings: ProjectSettings,
}

impl ProjectFile {
    pub fn new(name: impl Into<String>, machine: MachineProfile) -> Self {
        ProjectFile {
            schema_version: PROJECT_SCHEMA_VERSION,
            id: Uuid::new_v4(),
            name: name.into(),
            machine,
            layers: Layer::default_set(),
            objects: Vec::new(),
            materials: MaterialLibrary::default_starter_set(),
            settings: ProjectSettings::default(),
        }
    }

    pub fn find_layer(&self, id: Uuid) -> Option<&Layer> {
        self.layers.iter().find(|l| l.id == id)
    }

    /// The box around the artwork that will run: visible objects on enabled layers. This is what
    /// Frame traces and what the Job origin dots are measured on.
    pub fn job_extent(&self) -> Option<BoundingBox> {
        self.objects
            .iter()
            .filter(|o| o.visible)
            .filter(|o| {
                o.layer_id
                    .and_then(|id| self.find_layer(id))
                    .map(|l| l.enabled)
                    .unwrap_or(false)
            })
            .filter_map(|o| o.world_bounding_box())
            .reduce(|a, b| a.union(&b))
    }

    /// Problems with the machine profile and every *enabled* layer.
    pub fn validation_errors(&self) -> Vec<String> {
        let mut errors = self.machine.validate();
        for layer in self.layers.iter().filter(|l| l.enabled) {
            errors.extend(layer.validate(100.0, self.machine.max_feed_rate_mm_min));
        }
        errors
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layers::LayerKind;

    #[test]
    fn new_project_has_default_layers_and_materials() {
        let p = ProjectFile::new("Untitled", MachineProfile::tts55_pro());
        assert_eq!(p.layers.len(), 4);
        assert!(!p.materials.presets.is_empty());
    }

    #[test]
    fn disabled_layers_are_not_validated() {
        let mut p = ProjectFile::new("T", MachineProfile::tts55_pro());
        let mut bad = Layer::new("bad", LayerKind::Cut, 9);
        bad.speed_mm_min = 1.0e9;
        bad.enabled = false;
        p.layers.push(bad);
        assert!(p.validation_errors().is_empty());
    }

    fn square(x: f64, y: f64, s: f64) -> crate::Path2D {
        crate::Path2D::new(
            vec![
                Point2::new(x, y),
                Point2::new(x + s, y),
                Point2::new(x + s, y + s),
                Point2::new(x, y + s),
            ],
            true,
        )
    }

    #[test]
    fn old_settings_without_start_from_load_as_absolute() {
        let json = r#"{"units":"mm","grid_spacing_mm":10.0,"show_grid":true,"show_origin":true}"#;
        let s: ProjectSettings = serde_json::from_str(json).unwrap();
        assert_eq!(s.start_from, StartFrom::Absolute);
        assert_eq!(s.job_origin, JobOrigin::BottomLeft);
        assert!(!s.start_from.is_relative());
        assert_eq!(ProjectSettings::default().start_from, StartFrom::Absolute);
    }

    #[test]
    fn start_from_and_job_origin_use_the_names_the_frontend_expects() {
        for (value, name) in [
            (StartFrom::Absolute, "absolute"),
            (StartFrom::CurrentPosition, "current_position"),
            (StartFrom::UserOrigin, "user_origin"),
        ] {
            assert_eq!(
                serde_json::to_string(&value).unwrap(),
                format!("\"{name}\"")
            );
        }
        for (value, name) in [
            (JobOrigin::TopLeft, "top_left"),
            (JobOrigin::Top, "top"),
            (JobOrigin::TopRight, "top_right"),
            (JobOrigin::Left, "left"),
            (JobOrigin::Center, "center"),
            (JobOrigin::Right, "right"),
            (JobOrigin::BottomLeft, "bottom_left"),
            (JobOrigin::Bottom, "bottom"),
            (JobOrigin::BottomRight, "bottom_right"),
        ] {
            assert_eq!(
                serde_json::to_string(&value).unwrap(),
                format!("\"{name}\"")
            );
        }
    }

    #[test]
    fn only_the_relative_modes_are_relative_and_only_user_origin_needs_a_stored_origin() {
        assert!(!StartFrom::Absolute.is_relative());
        assert!(StartFrom::CurrentPosition.is_relative());
        assert!(StartFrom::UserOrigin.is_relative());
        assert!(!StartFrom::CurrentPosition.uses_user_origin());
        assert!(StartFrom::UserOrigin.uses_user_origin());
    }

    #[test]
    fn job_origin_anchors_sit_where_the_nine_dots_say() {
        let b = BoundingBox {
            min: Point2::new(10.0, 20.0),
            max: Point2::new(30.0, 60.0),
        };
        for (origin, x, y) in [
            (JobOrigin::TopLeft, 10.0, 20.0),
            (JobOrigin::Top, 20.0, 20.0),
            (JobOrigin::TopRight, 30.0, 20.0),
            (JobOrigin::Left, 10.0, 40.0),
            (JobOrigin::Center, 20.0, 40.0),
            (JobOrigin::Right, 30.0, 40.0),
            (JobOrigin::BottomLeft, 10.0, 60.0),
            (JobOrigin::Bottom, 20.0, 60.0),
            (JobOrigin::BottomRight, 30.0, 60.0),
        ] {
            let p = origin.anchor(&b);
            assert_eq!((p.x, p.y), (x, y), "{origin:?}");
        }
    }

    #[test]
    fn job_extent_covers_visible_artwork_on_enabled_layers_only() {
        let mut p = ProjectFile::new("T", MachineProfile::tts55_pro());
        let cut = p
            .layers
            .iter()
            .find(|l| l.kind == LayerKind::Cut)
            .unwrap()
            .id;
        let mut shown = WorkspaceObject::new_vector("a", vec![square(10.0, 20.0, 30.0)], 0);
        shown.layer_id = Some(cut);
        let mut hidden = WorkspaceObject::new_vector("b", vec![square(200.0, 200.0, 5.0)], 1);
        hidden.layer_id = Some(cut);
        hidden.visible = false;
        let loose = WorkspaceObject::new_vector("c", vec![square(250.0, 250.0, 5.0)], 2);
        p.objects.push(shown);
        p.objects.push(hidden);
        p.objects.push(loose);
        let e = p.job_extent().unwrap();
        assert!((e.min.x - 10.0).abs() < 1e-9 && (e.min.y - 20.0).abs() < 1e-9);
        assert!((e.max.x - 40.0).abs() < 1e-9 && (e.max.y - 50.0).abs() < 1e-9);
        for l in p.layers.iter_mut() {
            l.enabled = false;
        }
        assert!(p.job_extent().is_none());
    }

    #[test]
    fn old_settings_without_run_order_load_as_automatic() {
        let json = r#"{"units":"mm","grid_spacing_mm":10.0,"show_grid":true,"show_origin":true}"#;
        let s: ProjectSettings = serde_json::from_str(json).unwrap();
        assert!(!s.custom_run_order);
        assert!(!ProjectSettings::default().custom_run_order);
    }

    #[test]
    fn project_json_round_trip() {
        let p = ProjectFile::new("T", MachineProfile::tts55_pro());
        let json = serde_json::to_string(&p).unwrap();
        let back: ProjectFile = serde_json::from_str(&json).unwrap();
        assert_eq!(back, p);
    }
}
