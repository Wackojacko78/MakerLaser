//! Layer system. Every workspace object is assigned to one layer; the layer decides
//! *how* the laser processes it and carries all the parameters for that mode.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::operations::RasterOperation;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayerKind {
    /// Full cut along the path.
    Cut,
    /// Single light pass along the path (fold lines, marking).
    Score,
    /// Vector fill of closed shapes with parallel (or cross-hatched) lines.
    Fill,
    /// Raster/photo engraving of image objects.
    Image,
}

impl LayerKind {
    pub fn default_color(&self) -> &'static str {
        match self {
            LayerKind::Cut => "#FF4D4D",
            LayerKind::Score => "#4D8DFF",
            LayerKind::Fill => "#3DDC84",
            LayerKind::Image => "#B26DFF",
        }
    }
}

fn default_line_spacing() -> f64 {
    0.1
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Layer {
    pub id: Uuid,
    pub name: String,
    pub kind: LayerKind,
    /// Feed rate in mm/min.
    pub speed_mm_min: f64,
    /// Laser power, percent of the machine's maximum (0-100].
    pub power_percent: f64,
    pub passes: u32,
    pub air_assist: bool,
    pub enabled: bool,
    pub z_order: i32,
    pub color: String,

    /// Cut layers: total kerf width to compensate for (0 = off).
    #[serde(default)]
    pub kerf_mm: f64,
    /// Fill layers: distance between scan lines.
    #[serde(default = "default_line_spacing")]
    pub line_spacing_mm: f64,
    /// Fill layers: scan angle.
    #[serde(default)]
    pub fill_angle_deg: f64,
    /// Fill layers: add a second pass at +90 degrees.
    #[serde(default)]
    pub cross_hatch: bool,
    /// Image layers: raster pipeline settings.
    #[serde(default)]
    pub raster: RasterOperation,
}

impl Layer {
    pub fn new(name: impl Into<String>, kind: LayerKind, z_order: i32) -> Self {
        let (speed, power, air) = match kind {
            LayerKind::Cut => (300.0, 80.0, true),
            LayerKind::Score => (1000.0, 15.0, false),
            LayerKind::Fill => (3000.0, 40.0, false),
            LayerKind::Image => (3000.0, 40.0, false),
        };
        Layer {
            id: Uuid::new_v4(),
            name: name.into(),
            kind,
            speed_mm_min: speed,
            power_percent: power,
            passes: 1,
            air_assist: air,
            enabled: true,
            z_order,
            color: kind.default_color().to_string(),
            kerf_mm: 0.0,
            line_spacing_mm: default_line_spacing(),
            fill_angle_deg: 0.0,
            cross_hatch: false,
            raster: RasterOperation::default(),
        }
    }

    /// The four standard layers every new project starts with.
    pub fn default_set() -> Vec<Layer> {
        vec![
            Layer::new("Cut", LayerKind::Cut, 0),
            Layer::new("Score", LayerKind::Score, 1),
            Layer::new("Fill", LayerKind::Fill, 2),
            Layer::new("Image", LayerKind::Image, 3),
        ]
    }

    /// Human-readable problems with this layer's parameters (empty when valid).
    pub fn validate(&self, max_power_percent: f64, max_feed_mm_min: f64) -> Vec<String> {
        let mut problems = Vec::new();
        let n = &self.name;
        if !(self.power_percent > 0.0 && self.power_percent <= max_power_percent) {
            problems.push(format!(
                "Layer '{n}': power {:.1}% is outside (0, {max_power_percent:.0}]",
                self.power_percent
            ));
        }
        if !(self.speed_mm_min > 0.0 && self.speed_mm_min <= max_feed_mm_min) {
            problems.push(format!(
                "Layer '{n}': speed {:.0} mm/min is outside (0, {max_feed_mm_min:.0}]",
                self.speed_mm_min
            ));
        }
        if self.passes == 0 || self.passes > 100 {
            problems.push(format!("Layer '{n}': passes must be between 1 and 100"));
        }
        if !(0.0..=2.0).contains(&self.kerf_mm) {
            problems.push(format!("Layer '{n}': kerf must be between 0 and 2 mm"));
        }
        if self.kind == LayerKind::Fill
            && (self.line_spacing_mm.is_nan() || self.line_spacing_mm < 0.01)
        {
            problems.push(format!(
                "Layer '{n}': fill line spacing must be at least 0.01 mm"
            ));
        }
        if self.kind == LayerKind::Image && !(25..=2540).contains(&self.raster.dpi) {
            problems.push(format!(
                "Layer '{n}': raster DPI must be between 25 and 2540"
            ));
        }
        problems
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_set_has_four_layers_in_order() {
        let layers = Layer::default_set();
        assert_eq!(layers.len(), 4);
        assert_eq!(layers[0].kind, LayerKind::Cut);
        assert!(layers[0].air_assist);
    }

    #[test]
    fn validate_flags_bad_power_and_passes() {
        let mut l = Layer::new("Bad", LayerKind::Cut, 0);
        l.power_percent = 150.0;
        l.passes = 0;
        let problems = l.validate(100.0, 10_000.0);
        assert_eq!(problems.len(), 2);
    }

    #[test]
    fn nan_values_are_rejected() {
        let mut l = Layer::new("NaN", LayerKind::Cut, 0);
        l.power_percent = f64::NAN;
        assert!(!l.validate(100.0, 10_000.0).is_empty());
    }

    #[test]
    fn old_files_without_new_fields_still_load() {
        let json = r##"{"id":"6f9c1c0e-5b0e-4a77-9a67-2f0a1d3f9a11","name":"Cut","kind":"cut",
            "speed_mm_min":300.0,"power_percent":80.0,"passes":1,"air_assist":true,
            "enabled":true,"z_order":0,"color":"#FF0000"}"##;
        let l: Layer = serde_json::from_str(json).unwrap();
        assert_eq!(l.line_spacing_mm, 0.1);
        assert_eq!(l.raster.dpi, 254);
    }
}
