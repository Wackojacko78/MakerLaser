//! Machine profiles: the physical and firmware characteristics of a specific laser.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::geometry_types::{BoundingBox, Point2};
/// The largest rapid speed (mm/min) or acceleration (mm/s²) a machine profile may hold.
pub const MAX_MOTION_VALUE: f64 = 1_000_000.0;
/// The largest junction deviation (GRBL `$11`) a machine profile may hold, in mm.
pub const MAX_JUNCTION_DEVIATION_MM: f64 = 10.0;

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

/// How MakerLaser reaches the machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionKind {
    /// A USB serial port: the default, and the only kind that can connect today.
    #[default]
    Serial,
    /// A WebSocket to a network controller such as FluidNC (usually port 81).
    Websocket,
    /// Raw TCP (Telnet) to a network controller such as FluidNC (usually port 23).
    Telnet,
}

/// Where and how to reach the machine. A network connection is stored, validated and saved, but
/// MakerLaser refuses to connect with one for now (see `machine_connect`).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ConnectionSettings {
    #[serde(default)]
    pub kind: ConnectionKind,
    /// Host name or IPv4 address for the network kinds. Ignored for USB serial.
    #[serde(default)]
    pub host: String,
    /// TCP port. `0` means the usual port for the kind (81 for WebSocket, 23 for Telnet).
    #[serde(default)]
    pub port: u16,
}

impl ConnectionSettings {
    pub fn is_network(&self) -> bool {
        self.kind != ConnectionKind::Serial
    }

    /// Problems with the address (none for USB serial, which has nothing to check).
    pub fn problems(&self) -> Vec<String> {
        if !self.is_network() {
            return Vec::new();
        }
        host_problem(&self.host)
            .map(|p| format!("Machine address: {p}"))
            .into_iter()
            .collect()
    }
}

/// Why `raw` cannot be a machine address, or `None` when it can. IPv4 addresses and host names
/// only. Mirrors `hostProblem` in apps/desktop-ui/src/lib/connectionSettings.ts: keep the two in step.
pub fn host_problem(raw: &str) -> Option<String> {
    let host = raw.trim();
    if host.is_empty() {
        return Some(
            "Enter the machine's address, for example 192.168.1.50 or fluidnc.local.".to_string(),
        );
    }
    if host.len() > 253 {
        return Some("The address is too long.".to_string());
    }
    if !host
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return Some(
            "The address may only contain letters, digits, hyphens and dots. Leave out http://, spaces, paths and the port number: enter the port separately."
                .to_string(),
        );
    }
    let labels: Vec<&str> = host.split('.').collect();
    if labels.iter().any(|l| l.is_empty()) {
        return Some(
            "The address has an empty part (two dots in a row, or a dot at the start or end)."
                .to_string(),
        );
    }
    if labels.iter().any(|l| l.len() > 63) {
        return Some("Each part of the address must be 63 characters or fewer.".to_string());
    }
    if labels
        .iter()
        .any(|l| l.starts_with('-') || l.ends_with('-'))
    {
        return Some("A part of the address cannot start or end with a hyphen.".to_string());
    }
    if labels.iter().all(|l| l.bytes().all(|b| b.is_ascii_digit())) {
        let valid = labels.len() == 4
            && labels
                .iter()
                .all(|l| l.len() <= 3 && l.parse::<u16>().is_ok_and(|n| n <= 255));
        if !valid {
            return Some(
                "That looks like an IP address but is not a valid one: it needs four numbers from 0 to 255, like 192.168.1.50."
                    .to_string(),
            );
        }
    }
    None
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
    /// How to reach the machine. Absent in older files, which means USB serial.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection: Option<ConnectionSettings>,
    /// The fastest the machine moves, in mm/min (GRBL `$110` and `$111`; the smaller if they differ).
    /// Only the time estimate uses it. Absent: the estimate assumes 6000.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rapid_feed_mm_min: Option<f64>,
    /// How fast the head speeds up and slows down, in mm/s² (GRBL `$120` and `$121`; the smaller if they
    /// differ). Only the time estimate uses it. Absent: the estimate ignores acceleration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acceleration_mm_s2: Option<f64>,
    /// GRBL's junction deviation (`$11`), in mm. Only the time estimate uses it. Absent: 0.01.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub junction_deviation_mm: Option<f64>,
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
            connection: None,
            // The speeds one TTS-55 Pro reported ($110 and $111, $120 and $121): check yours with $$.
            rapid_feed_mm_min: Some(30_000.0),
            acceleration_mm_s2: Some(2_500.0),
            junction_deviation_mm: None,
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
            connection: None,
            rapid_feed_mm_min: None,
            acceleration_mm_s2: None,
            junction_deviation_mm: None,
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
        let motion_ok = |v: f64| v.is_finite() && (1.0..=MAX_MOTION_VALUE).contains(&v);
        if self.rapid_feed_mm_min.is_some_and(|v| !motion_ok(v)) {
            problems.push(format!(
                "Machine rapid speed must be a number from 1 to {MAX_MOTION_VALUE:.0} mm/min"
            ));
        }
        if self.acceleration_mm_s2.is_some_and(|v| !motion_ok(v)) {
            problems.push(format!(
                "Machine acceleration must be a number from 1 to {MAX_MOTION_VALUE:.0} mm/s2"
            ));
        }
        if self
            .junction_deviation_mm
            .is_some_and(|v| !(v.is_finite() && v > 0.0 && v <= MAX_JUNCTION_DEVIATION_MM))
        {
            problems.push(format!(
                "Machine junction deviation must be above 0 and at most {MAX_JUNCTION_DEVIATION_MM:.0} mm"
            ));
        }
        if let Some(connection) = &self.connection {
            problems.extend(connection.problems());
        }
        problems
    }

    /// True when the machine is reached over the network rather than a USB serial port.
    pub fn uses_network(&self) -> bool {
        self.connection
            .as_ref()
            .is_some_and(ConnectionSettings::is_network)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn network(kind: ConnectionKind, host: &str) -> ConnectionSettings {
        ConnectionSettings {
            kind,
            host: host.to_string(),
            port: 0,
        }
    }

    #[test]
    fn a_machine_without_a_connection_is_usb_serial_and_is_saved_without_one() {
        let m = MachineProfile::tts55_pro();
        assert!(m.connection.is_none());
        assert!(!m.uses_network());
        let json = serde_json::to_string(&m).unwrap();
        assert!(!json.contains("connection"), "{json}");
    }

    #[test]
    fn older_machine_json_without_a_connection_still_loads() {
        let json = r#"{"id":"00000000-0000-0000-0000-000000000000","name":"Old","controller":"grbl1_1","bed_width_mm":300.0,"bed_height_mm":300.0,"origin":"bottom_left","max_feed_rate_mm_min":10000.0,"max_spindle_value":1000,"homing_supported":false,"air_assist_supported":true,"baud_rate":115200}"#;
        let m: MachineProfile = serde_json::from_str(json).unwrap();
        assert!(m.connection.is_none());
        assert!(!m.uses_network());
    }

    #[test]
    fn a_network_connection_round_trips_through_json() {
        let mut m = MachineProfile::tts55_pro();
        m.connection = Some(ConnectionSettings {
            kind: ConnectionKind::Websocket,
            host: "fluidnc.local".to_string(),
            port: 81,
        });
        assert!(m.uses_network());
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains(r#""kind":"websocket""#), "{json}");
        let back: MachineProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(back, m);
    }

    #[test]
    fn connection_kinds_use_the_names_the_frontend_expects() {
        for (kind, name) in [
            (ConnectionKind::Serial, "serial"),
            (ConnectionKind::Websocket, "websocket"),
            (ConnectionKind::Telnet, "telnet"),
        ] {
            assert_eq!(serde_json::to_string(&kind).unwrap(), format!("\"{name}\""));
        }
    }

    #[test]
    fn usb_serial_ignores_any_address() {
        let c = network(ConnectionKind::Serial, "not an address!");
        assert!(!c.is_network());
        assert!(c.problems().is_empty());
    }

    #[test]
    fn good_addresses_are_accepted() {
        for h in [
            "192.168.1.50",
            "0.0.0.0",
            "255.255.255.255",
            "fluidnc.local",
            "laser-1",
            "FluidNC",
            "3dprinter.local",
            "10.0.0.x",
            "  192.168.1.5  ",
        ] {
            assert_eq!(host_problem(h), None, "{h:?}");
        }
    }

    #[test]
    fn bad_addresses_are_refused() {
        for h in [
            "",
            "   ",
            "http://fluidnc.local",
            "fluidnc.local:81",
            "a b",
            "host/path",
            "a..b",
            ".a",
            "a.",
            "-a",
            "a-.b",
            "256.1.1.1",
            "1.2.3",
            "1.2.3.4.5",
            "1234",
            "0007.1.1.1",
        ] {
            assert!(host_problem(h).is_some(), "{h:?}");
        }
        assert!(host_problem(&"a".repeat(64)).is_some());
    }

    #[test]
    fn a_bad_network_address_is_a_machine_problem_but_only_for_network_machines() {
        let mut m = MachineProfile::tts55_pro();
        m.connection = Some(network(ConnectionKind::Telnet, "bad host"));
        assert!(m.validate().iter().any(|p| p.contains("Machine address")));
        m.connection = Some(network(ConnectionKind::Telnet, "10.0.0.5"));
        assert!(m.validate().is_empty());
        m.connection = Some(network(ConnectionKind::Serial, "bad host"));
        assert!(m.validate().is_empty());
    }

    #[test]
    fn the_motion_settings_are_in_the_tts55_preset_only_and_older_files_load_without_them() {
        let tts = MachineProfile::tts55_pro();
        assert_eq!(tts.rapid_feed_mm_min, Some(30_000.0));
        assert_eq!(tts.acceleration_mm_s2, Some(2_500.0));
        assert_eq!(tts.junction_deviation_mm, None);
        assert_eq!(
            MachineProfile::tts55_pro_extended().acceleration_mm_s2,
            Some(2_500.0)
        );
        let generic = MachineProfile::generic_grbl();
        assert!(
            generic.rapid_feed_mm_min.is_none()
                && generic.acceleration_mm_s2.is_none()
                && generic.junction_deviation_mm.is_none()
        );
        // Settings that are not there are not saved.
        let json = serde_json::to_string(&generic).unwrap();
        assert!(
            !json.contains("rapid_feed")
                && !json.contains("acceleration")
                && !json.contains("junction"),
            "{json}"
        );
        // A machine saved before they existed loads with none of them.
        let old = r#"{"id":"00000000-0000-0000-0000-000000000000","name":"Old","controller":"grbl1_1","bed_width_mm":300.0,"bed_height_mm":300.0,"origin":"bottom_left","max_feed_rate_mm_min":10000.0,"max_spindle_value":1000,"homing_supported":false,"air_assist_supported":true,"baud_rate":115200}"#;
        let m: MachineProfile = serde_json::from_str(old).unwrap();
        assert!(
            m.rapid_feed_mm_min.is_none()
                && m.acceleration_mm_s2.is_none()
                && m.junction_deviation_mm.is_none()
        );
        assert!(m.validate().is_empty());
    }

    #[test]
    fn the_motion_settings_round_trip_under_the_names_the_frontend_expects() {
        let mut m = MachineProfile::generic_grbl();
        m.rapid_feed_mm_min = Some(24_000.0);
        m.acceleration_mm_s2 = Some(1_800.0);
        m.junction_deviation_mm = Some(0.02);
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains(r#""rapid_feed_mm_min":24000.0"#), "{json}");
        assert!(json.contains(r#""acceleration_mm_s2":1800.0"#), "{json}");
        assert!(json.contains(r#""junction_deviation_mm":0.02"#), "{json}");
        let back: MachineProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(back, m);
    }

    #[test]
    fn motion_settings_that_make_no_sense_are_machine_problems() {
        let mut m = MachineProfile::tts55_pro();
        assert!(m.validate().is_empty());
        for bad in [0.0, -5.0, f64::NAN, f64::INFINITY, 2.0e6] {
            m.rapid_feed_mm_min = Some(bad);
            assert!(
                m.validate().iter().any(|p| p.contains("rapid speed")),
                "{bad}"
            );
            m.rapid_feed_mm_min = None;
            m.acceleration_mm_s2 = Some(bad);
            assert!(
                m.validate().iter().any(|p| p.contains("acceleration")),
                "{bad}"
            );
            m.acceleration_mm_s2 = None;
        }
        for bad in [0.0, -0.01, f64::NAN, 11.0] {
            m.junction_deviation_mm = Some(bad);
            assert!(
                m.validate()
                    .iter()
                    .any(|p| p.contains("junction deviation")),
                "{bad}"
            );
        }
        m.junction_deviation_mm = Some(0.05);
        assert!(m.validate().is_empty());
    }

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
