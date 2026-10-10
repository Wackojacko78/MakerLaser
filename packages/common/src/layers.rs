//! Layer system. Every workspace object is assigned to one layer; the layer decides
//! *how* the laser processes it and carries all the parameters for that mode.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::operations::{RasterOperation, MAX_SHARPEN};

/// Largest overscan a layer may ask for, in mm.
pub const MAX_OVERSCAN_MM: f64 = 25.0;
/// Largest power ramp a Score layer may ask for, in mm.
pub const MAX_RAMP_MM: f64 = 10.0;

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
    /// Fill and Image layers: how far the head runs past each end of a scan line, laser off, so
    /// the burn happens at full speed. 0 = off.
    #[serde(default)]
    pub overscan_mm: f64,
    /// Fill layers: after the fill, trace the edge of every closed shape once, for a crisp edge.
    #[serde(default)]
    pub fill_outline: bool,
    /// Score layers: the power rises over this many mm at the start of each line and falls over the
    /// same distance at the end, so the ends do not burn darker. 0 = off. Cut layers are never
    /// ramped, so a cut always goes all the way through.
    #[serde(default)]
    pub ramp_mm: f64,
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
            overscan_mm: 0.0,
            fill_outline: false,
            ramp_mm: 0.0,
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
        if !(0.0..=MAX_OVERSCAN_MM).contains(&self.overscan_mm) {
            problems.push(format!(
                "Layer '{n}': overscan must be between 0 and {:.0} mm",
                MAX_OVERSCAN_MM
            ));
        }
        if !(0.0..=MAX_RAMP_MM).contains(&self.ramp_mm) {
            problems.push(format!(
                "Layer '{n}': power ramp must be between 0 and {:.0} mm",
                MAX_RAMP_MM
            ));
        }
        if self.kind == LayerKind::Image && !(0.0..=MAX_SHARPEN).contains(&self.raster.sharpen) {
            problems.push(format!(
                "Layer '{n}': sharpen must be between 0 and {:.0}",
                MAX_SHARPEN
            ));
        }
        problems
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_outline_pass_and_the_power_ramp_are_off_by_default_and_old_files_load_with_them_off() {
        let l = Layer::new("Score", LayerKind::Score, 1);
        assert!(!l.fill_outline);
        assert_eq!(l.ramp_mm, 0.0);
        let json = r##"{"id":"6f9c1c0e-5b0e-4a77-9a67-2f0a1d3f9a11","name":"Fill","kind":"fill",
            "speed_mm_min":3000.0,"power_percent":40.0,"passes":1,"air_assist":false,
            "enabled":true,"z_order":2,"color":"#00FF00","overscan_mm":2.0}"##;
        let old: Layer = serde_json::from_str(json).unwrap();
        assert!(!old.fill_outline);
        assert_eq!(old.ramp_mm, 0.0);
        assert_eq!(old.overscan_mm, 2.0);
    }

    #[test]
    fn the_new_settings_survive_a_round_trip() {
        let mut l = Layer::new("Score", LayerKind::Score, 1);
        l.fill_outline = true;
        l.ramp_mm = 3.5;
        let json = serde_json::to_string(&l).unwrap();
        assert!(json.contains("\"fill_outline\":true"), "{json}");
        assert!(json.contains("\"ramp_mm\":3.5"), "{json}");
        let back: Layer = serde_json::from_str(&json).unwrap();
        assert_eq!(back, l);
    }

    #[test]
    fn a_ramp_outside_its_range_is_rejected() {
        let mut l = Layer::new("Score", LayerKind::Score, 1);
        l.ramp_mm = 5.0;
        assert!(l.validate(100.0, 10_000.0).is_empty());
        l.ramp_mm = MAX_RAMP_MM;
        assert!(l.validate(100.0, 10_000.0).is_empty());
        for bad in [-1.0, MAX_RAMP_MM + 1.0, f64::NAN, f64::INFINITY] {
            l.ramp_mm = bad;
            assert_eq!(l.validate(100.0, 10_000.0).len(), 1, "{bad}");
        }
    }

    #[test]
    fn overscan_is_off_by_default_and_old_files_load_with_it_off() {
        assert_eq!(Layer::new("Fill", LayerKind::Fill, 0).overscan_mm, 0.0);
        let json = r##"{"id":"6f9c1c0e-5b0e-4a77-9a67-2f0a1d3f9a11","name":"Fill","kind":"fill",
            "speed_mm_min":3000.0,"power_percent":40.0,"passes":1,"air_assist":false,
            "enabled":true,"z_order":2,"color":"#00FF00"}"##;
        let l: Layer = serde_json::from_str(json).unwrap();
        assert_eq!(l.overscan_mm, 0.0);
    }

    #[test]
    fn overscan_outside_its_range_is_rejected() {
        let mut l = Layer::new("Fill", LayerKind::Fill, 0);
        l.overscan_mm = 5.0;
        assert!(l.validate(100.0, 10_000.0).is_empty());
        for bad in [-1.0, MAX_OVERSCAN_MM + 1.0, f64::NAN] {
            l.overscan_mm = bad;
            assert_eq!(l.validate(100.0, 10_000.0).len(), 1, "{bad}");
        }
    }

    #[test]
    fn the_sharpen_range_is_checked_on_image_layers() {
        let mut l = Layer::new("Image", LayerKind::Image, 3);
        l.raster.sharpen = 40.0;
        assert!(l.validate(100.0, 10_000.0).is_empty());
        l.raster.sharpen = MAX_SHARPEN;
        assert!(l.validate(100.0, 10_000.0).is_empty());
        for bad in [-1.0, MAX_SHARPEN + 1.0, f64::NAN, f64::INFINITY] {
            l.raster.sharpen = bad;
            assert_eq!(l.validate(100.0, 10_000.0).len(), 1, "{bad}");
        }
        // Layers that do not engrave pictures ignore it.
        let mut cut = Layer::new("Cut", LayerKind::Cut, 0);
        cut.raster.sharpen = 500.0;
        assert!(cut.validate(100.0, 10_000.0).is_empty());
    }

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
