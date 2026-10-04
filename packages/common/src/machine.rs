//! Machine profiles: the physical and firmware characteristics of a specific laser.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::geometry_types::{BoundingBox, Point2};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ControllerKind {
    Grbl1_1,
    Ruida,
    Galvo,
}

/// Where the machine's (0,0) sits, viewed from above with the workspace drawn Y-down.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MachineOrigin {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MachineProfile {
    pub id: Uuid,
    pub name: String,
    pub controller: ControllerKind,
    pub bed_width_mm: f64,
    pub bed_height_mm: f64,
    pub origin: MachineOrigin,
    pub max_feed_rate_mm_min: f64,
    /// Maximum S value the controller accepts (GRBL `$30`, normally 1000).
    pub max_spindle_value: u32,
    pub homing_supported: bool,
    pub air_assist_supported: bool,
    pub baud_rate: u32,
}

impl MachineProfile {
    /// Two Trees TTS-55 Pro, standard frame. The manufacturer lists a 300 x 300 mm
    /// engraving area; verify against your own machine before first use.
    pub fn tts55_pro() -> Self {
        MachineProfile {
            id: Uuid::new_v4(),
            name: "Two Trees TTS-55 Pro (300 x 300)".to_string(),
            controller: ControllerKind::Grbl1_1,
            bed_width_mm: 300.0,
            bed_height_mm: 300.0,
            origin: MachineOrigin::BottomLeft,
            max_feed_rate_mm_min: 10_000.0,
            max_spindle_value: 1000,
            homing_supported: false,
            air_assist_supported: true,
            baud_rate: 115_200,
        }
    }

    /// TTS-55 Pro with the manufacturer's 600 x 600 mm extension kit fitted.
    pub fn tts55_pro_extended() -> Self {
        MachineProfile {
            name: "Two Trees TTS-55 Pro (600 x 600 extension)".to_string(),
            bed_width_mm: 600.0,
            bed_height_mm: 600.0,
            ..Self::tts55_pro()
        }
    }

    pub fn generic_grbl() -> Self {
        MachineProfile {
            id: Uuid::new_v4(),
            name: "Generic GRBL 1.1 (300 x 300)".to_string(),
            controller: ControllerKind::Grbl1_1,
            bed_width_mm: 300.0,
            bed_height_mm: 300.0,
            origin: MachineOrigin::BottomLeft,
            max_feed_rate_mm_min: 6_000.0,
            max_spindle_value: 1000,
            homing_supported: false,
            air_assist_supported: false,
            baud_rate: 115_200,
        }
    }

    pub fn presets() -> Vec<MachineProfile> {
        vec![
            Self::tts55_pro(),
            Self::tts55_pro_extended(),
            Self::generic_grbl(),
        ]
    }

    pub fn bed_bounds(&self) -> BoundingBox {
        BoundingBox {
            min: Point2::ZERO,
            max: Point2::new(self.bed_width_mm, self.bed_height_mm),
        }
    }

    /// Converts a Y-down, top-left-origin workspace point into the machine's own
    /// coordinates. This is the ONLY place workspace axes are flipped. The mapping is a
    /// reflection and therefore its own inverse (see [`Self::machine_to_workspace`]).
    pub fn workspace_to_machine(&self, p: Point2) -> Point2 {
        let (w, h) = (self.bed_width_mm, self.bed_height_mm);
        match self.origin {
            MachineOrigin::TopLeft => Point2::new(p.x, p.y),
            MachineOrigin::TopRight => Point2::new(w - p.x, p.y),
            MachineOrigin::BottomLeft => Point2::new(p.x, h - p.y),
            MachineOrigin::BottomRight => Point2::new(w - p.x, h - p.y),
        }
    }

    pub fn machine_to_workspace(&self, p: Point2) -> Point2 {
        self.workspace_to_machine(p)
    }

    /// Converts a *direction* on screen (workspace delta, Y-down) into the machine's
    /// relative move, e.g. "up the screen" becomes +Y on a bottom-left-origin machine.
    pub fn workspace_delta_to_machine(&self, dx: f64, dy: f64) -> (f64, f64) {
        let origin = self.workspace_to_machine(Point2::ZERO);
        let moved = self.workspace_to_machine(Point2::new(dx, dy));
        (moved.x - origin.x, moved.y - origin.y)
    }

    pub fn validate(&self) -> Vec<String> {
        let mut problems = Vec::new();
        if !(self.bed_width_mm > 0.0 && self.bed_height_mm > 0.0) {
            problems.push("Machine bed size must be positive".to_string());
        }
        if self.max_feed_rate_mm_min.is_nan() || self.max_feed_rate_mm_min <= 0.0 {
            problems.push("Machine maximum feed rate must be positive".to_string());
        }
        if self.max_spindle_value == 0 {
            problems.push("Machine maximum S value ($30) must be greater than zero".to_string());
        }
        problems
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tts55_default_bed_is_300() {
        let b = MachineProfile::tts55_pro().bed_bounds();
        assert_eq!((b.width(), b.height()), (300.0, 300.0));
    }

    #[test]
    fn bottom_left_origin_flips_y() {
        let m = MachineProfile::tts55_pro();
        // Top-left of the screen is the far end of the machine's Y axis.
        let p = m.workspace_to_machine(Point2::new(0.0, 0.0));
        assert_eq!(p, Point2::new(0.0, 300.0));
        let q = m.workspace_to_machine(Point2::new(10.0, 290.0));
        assert_eq!(q, Point2::new(10.0, 10.0));
    }

    #[test]
    fn every_origin_is_an_involution() {
        for origin in [
            MachineOrigin::TopLeft,
            MachineOrigin::TopRight,
            MachineOrigin::BottomLeft,
            MachineOrigin::BottomRight,
        ] {
            let mut m = MachineProfile::tts55_pro();
            m.origin = origin;
            let p = Point2::new(12.5, 77.0);
            assert_eq!(m.machine_to_workspace(m.workspace_to_machine(p)), p);
        }
    }

    #[test]
    fn up_the_screen_is_plus_y_on_a_bottom_left_origin_machine() {
        let m = MachineProfile::tts55_pro();
        assert_eq!(m.workspace_delta_to_machine(0.0, -10.0), (0.0, 10.0));
        assert_eq!(m.workspace_delta_to_machine(10.0, 0.0), (10.0, 0.0));
        let mut tl = MachineProfile::tts55_pro();
        tl.origin = MachineOrigin::TopLeft;
        assert_eq!(tl.workspace_delta_to_machine(0.0, -10.0), (0.0, -10.0));
    }

    #[test]
    fn controller_kind_serialises_as_expected_by_the_frontend() {
        let json = serde_json::to_string(&ControllerKind::Grbl1_1).unwrap();
        assert_eq!(json, "\"grbl1_1\"");
    }
}
