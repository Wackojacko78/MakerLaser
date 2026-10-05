//! The `ProjectFile` aggregate: everything that makes up one `.mlp` document.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectSettings {
    pub units: Units,
    pub grid_spacing_mm: f64,
    pub show_grid: bool,
    pub show_origin: bool,
    /// `false`: engrave, score, then cut. `true`: layers run in layer order (`z_order`).
    #[serde(default)]
    pub custom_run_order: bool,
}

impl Default for ProjectSettings {
    fn default() -> Self {
        ProjectSettings {
            units: Units::Mm,
            grid_spacing_mm: 10.0,
            show_grid: true,
            show_origin: true,
            custom_run_order: false,
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
