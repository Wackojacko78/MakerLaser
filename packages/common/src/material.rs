//! Material preset library: named speed/power/passes combinations.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::layers::{Layer, LayerKind};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MaterialPreset {
    pub id: Uuid,
    pub name: String,
    pub for_layer_kind: LayerKind,
    pub speed_mm_min: f64,
    pub power_percent: f64,
    pub passes: u32,
    pub air_assist: bool,
    pub thickness_mm: Option<f64>,
    pub notes: Option<String>,
}

impl MaterialPreset {
    pub fn new(
        name: impl Into<String>,
        for_layer_kind: LayerKind,
        speed_mm_min: f64,
        power_percent: f64,
        passes: u32,
    ) -> Self {
        MaterialPreset {
            id: Uuid::new_v4(),
            name: name.into(),
            for_layer_kind,
            speed_mm_min,
            power_percent,
            passes,
            air_assist: matches!(for_layer_kind, LayerKind::Cut),
            thickness_mm: None,
            notes: Some("Starting point only. Run a test on scrap material first.".to_string()),
        }
    }

    pub fn apply_to(&self, layer: &mut Layer) {
        layer.speed_mm_min = self.speed_mm_min;
        layer.power_percent = self.power_percent;
        layer.passes = self.passes;
        layer.air_assist = self.air_assist;
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MaterialLibrary {
    pub presets: Vec<MaterialPreset>,
}

impl MaterialLibrary {
    /// Conservative starting points for a ~5 W diode laser. They are NOT tuned values:
    /// every material, batch and focus setting differs.
    pub fn default_starter_set() -> Self {
        MaterialLibrary {
            presets: vec![
                MaterialPreset::new("3mm Plywood - Cut", LayerKind::Cut, 150.0, 100.0, 3),
                MaterialPreset::new("3mm MDF - Cut", LayerKind::Cut, 120.0, 100.0, 4),
                MaterialPreset::new("Cardboard - Cut", LayerKind::Cut, 600.0, 100.0, 1),
                MaterialPreset::new(
                    "Cardboard - Score (fold line)",
                    LayerKind::Score,
                    2000.0,
                    12.0,
                    1,
                ),
                MaterialPreset::new("Plywood - Score", LayerKind::Score, 1500.0, 25.0, 1),
                MaterialPreset::new("Leather - Fill engrave", LayerKind::Fill, 3000.0, 35.0, 1),
                MaterialPreset::new("Plywood - Fill engrave", LayerKind::Fill, 3000.0, 45.0, 1),
                MaterialPreset::new("Plywood - Photo raster", LayerKind::Image, 4000.0, 40.0, 1),
                MaterialPreset::new("Slate - Photo raster", LayerKind::Image, 3000.0, 50.0, 1),
            ],
        }
    }

    pub fn to_json(&self) -> serde_json::Result<String> {
        serde_json::to_string_pretty(self)
    }

    pub fn from_json(data: &str) -> serde_json::Result<Self> {
        serde_json::from_str(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_overwrites_layer_parameters() {
        let preset = MaterialPreset::new("Test", LayerKind::Cut, 500.0, 70.0, 2);
        let mut layer = Layer::new("L", LayerKind::Cut, 0);
        preset.apply_to(&mut layer);
        assert_eq!(
            (layer.speed_mm_min, layer.power_percent, layer.passes),
            (500.0, 70.0, 2)
        );
    }

    #[test]
    fn json_round_trip() {
        let lib = MaterialLibrary::default_starter_set();
        let back = MaterialLibrary::from_json(&lib.to_json().unwrap()).unwrap();
        assert_eq!(back, lib);
    }

    #[test]
    fn starter_presets_are_within_layer_validation_limits() {
        for p in MaterialLibrary::default_starter_set().presets {
            let mut layer = Layer::new("x", p.for_layer_kind, 0);
            p.apply_to(&mut layer);
            assert!(layer.validate(100.0, 10_000.0).is_empty(), "{}", p.name);
        }
    }
}
