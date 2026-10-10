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
    /// Fill and Image presets: overscan in mm. None means the preset does not set it, so applying
    /// it leaves the layer's overscan alone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overscan_mm: Option<f64>,
    /// Fill presets: trace the edge after the fill. None means the preset does not set it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill_outline: Option<bool>,
    /// Score presets: power ramp length in mm. None means the preset does not set it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ramp_mm: Option<f64>,
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
            overscan_mm: None,
            fill_outline: None,
            ramp_mm: None,
            thickness_mm: None,
            notes: Some("Starting point only. Run a test on scrap material first.".to_string()),
        }
    }

    pub fn apply_to(&self, layer: &mut Layer) {
        layer.speed_mm_min = self.speed_mm_min;
        layer.power_percent = self.power_percent;
        layer.passes = self.passes;
        layer.air_assist = self.air_assist;
        // Only the settings this layer type uses, and only when the preset sets them.
        match self.for_layer_kind {
            LayerKind::Fill => {
                if let Some(v) = self.overscan_mm {
                    layer.overscan_mm = v;
                }
                if let Some(v) = self.fill_outline {
                    layer.fill_outline = v;
                }
            }
            LayerKind::Image => {
                if let Some(v) = self.overscan_mm {
                    layer.overscan_mm = v;
                }
            }
            LayerKind::Score => {
                if let Some(v) = self.ramp_mm {
                    layer.ramp_mm = v;
                }
            }
            LayerKind::Cut => {}
        }
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

    fn fill_preset_with_extras() -> MaterialPreset {
        let mut p = MaterialPreset::new("Fill", LayerKind::Fill, 3000.0, 40.0, 1);
        p.overscan_mm = Some(3.0);
        p.fill_outline = Some(true);
        p.ramp_mm = Some(5.0);
        p
    }

    #[test]
    fn a_fill_preset_sets_overscan_and_outline_but_not_the_ramp() {
        let mut layer = Layer::new("F", LayerKind::Fill, 0);
        fill_preset_with_extras().apply_to(&mut layer);
        assert_eq!(layer.overscan_mm, 3.0);
        assert!(layer.fill_outline);
        assert_eq!(layer.ramp_mm, 0.0);
    }

    #[test]
    fn an_image_preset_sets_only_overscan() {
        let mut p = fill_preset_with_extras();
        p.for_layer_kind = LayerKind::Image;
        let mut layer = Layer::new("I", LayerKind::Image, 0);
        p.apply_to(&mut layer);
        assert_eq!(layer.overscan_mm, 3.0);
        assert!(!layer.fill_outline);
        assert_eq!(layer.ramp_mm, 0.0);
    }

    #[test]
    fn a_score_preset_sets_only_the_ramp() {
        let mut p = fill_preset_with_extras();
        p.for_layer_kind = LayerKind::Score;
        let mut layer = Layer::new("S", LayerKind::Score, 0);
        p.apply_to(&mut layer);
        assert_eq!(layer.ramp_mm, 5.0);
        assert_eq!(layer.overscan_mm, 0.0);
        assert!(!layer.fill_outline);
    }

    #[test]
    fn a_cut_preset_never_sets_overscan_outline_or_ramp() {
        let mut p = fill_preset_with_extras();
        p.for_layer_kind = LayerKind::Cut;
        let mut layer = Layer::new("C", LayerKind::Cut, 0);
        p.apply_to(&mut layer);
        assert_eq!(layer.overscan_mm, 0.0);
        assert!(!layer.fill_outline);
        assert_eq!(layer.ramp_mm, 0.0);
    }

    #[test]
    fn a_preset_that_does_not_set_them_leaves_the_layer_alone() {
        let preset = MaterialPreset::new("Old", LayerKind::Fill, 3000.0, 40.0, 1);
        let mut layer = Layer::new("F", LayerKind::Fill, 0);
        layer.overscan_mm = 2.0;
        layer.fill_outline = true;
        preset.apply_to(&mut layer);
        assert_eq!(layer.overscan_mm, 2.0);
        assert!(layer.fill_outline);
    }

    #[test]
    fn a_preset_can_switch_overscan_and_outline_off() {
        let mut preset = MaterialPreset::new("Off", LayerKind::Fill, 3000.0, 40.0, 1);
        preset.overscan_mm = Some(0.0);
        preset.fill_outline = Some(false);
        let mut layer = Layer::new("F", LayerKind::Fill, 0);
        layer.overscan_mm = 2.0;
        layer.fill_outline = true;
        preset.apply_to(&mut layer);
        assert_eq!(layer.overscan_mm, 0.0);
        assert!(!layer.fill_outline);
    }

    #[test]
    fn old_presets_without_the_new_fields_still_load() {
        let json = r##"{"id":"6f9c1c0e-5b0e-4a77-9a67-2f0a1d3f9a11","name":"Old",
            "for_layer_kind":"fill","speed_mm_min":3000.0,"power_percent":40.0,"passes":1,
            "air_assist":false,"thickness_mm":null,"notes":null}"##;
        let p: MaterialPreset = serde_json::from_str(json).unwrap();
        assert_eq!(p.overscan_mm, None);
        assert_eq!(p.fill_outline, None);
        assert_eq!(p.ramp_mm, None);
    }

    #[test]
    fn the_new_fields_round_trip_and_are_left_out_when_not_set() {
        let lib = MaterialLibrary {
            presets: vec![fill_preset_with_extras()],
        };
        let json = lib.to_json().unwrap();
        assert!(json.contains("\"overscan_mm\""), "{json}");
        assert_eq!(MaterialLibrary::from_json(&json).unwrap(), lib);
        let plain = MaterialLibrary::default_starter_set().to_json().unwrap();
        assert!(!plain.contains("overscan_mm"), "{plain}");
        assert!(!plain.contains("fill_outline"), "{plain}");
        assert!(!plain.contains("ramp_mm"), "{plain}");
    }

    #[test]
    fn a_preset_with_an_out_of_range_overscan_fails_the_layer_checks() {
        let mut preset = MaterialPreset::new("Far", LayerKind::Fill, 3000.0, 40.0, 1);
        preset.overscan_mm = Some(99.0);
        let mut layer = Layer::new("check", LayerKind::Fill, 0);
        preset.apply_to(&mut layer);
        assert_eq!(layer.validate(100.0, 10_000.0).len(), 1);
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
