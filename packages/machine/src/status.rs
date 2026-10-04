//! Parsing of GRBL 1.1 real-time status reports, e.g.
//! `<Idle|MPos:0.000,0.000,0.000|FS:0,0>` or `<Hold:0|WPos:1.0,2.0,0.0>`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MachineState {
    Idle,
    Run,
    Hold,
    Jog,
    Alarm,
    Door,
    Check,
    Home,
    Sleep,
    Unknown,
}

impl MachineState {
    fn parse(s: &str) -> MachineState {
        // Hold and Door carry a sub-state suffix, e.g. "Hold:0".
        match s.split(':').next().unwrap_or("") {
            "Idle" => MachineState::Idle,
            "Run" => MachineState::Run,
            "Hold" => MachineState::Hold,
            "Jog" => MachineState::Jog,
            "Alarm" => MachineState::Alarm,
            "Door" => MachineState::Door,
            "Check" => MachineState::Check,
            "Home" => MachineState::Home,
            "Sleep" => MachineState::Sleep,
            _ => MachineState::Unknown,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Position3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GrblStatus {
    pub state: MachineState,
    pub position: Position3,
    /// True when `position` is a machine position (`MPos`), false for work position.
    pub is_machine_position: bool,
    pub feed_rate_mm_min: f64,
    pub spindle_value: f64,
}

pub fn parse_status_line(line: &str) -> Option<GrblStatus> {
    let line = line.trim();
    if !(line.starts_with('<') && line.ends_with('>')) {
        return None;
    }
    let mut fields = line[1..line.len() - 1].split('|');
    let state = MachineState::parse(fields.next()?);

    let mut position = Position3 {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    };
    let mut have_mpos = false;
    let mut feed = 0.0;
    let mut spindle = 0.0;

    for field in fields {
        if let Some(rest) = field.strip_prefix("MPos:") {
            if let Some(p) = parse_position(rest) {
                position = p;
                have_mpos = true;
            }
        } else if let Some(rest) = field.strip_prefix("WPos:") {
            // Only used when no MPos was reported; a genuine MPos of zero must win.
            if !have_mpos {
                if let Some(p) = parse_position(rest) {
                    position = p;
                }
            }
        } else if let Some(rest) = field.strip_prefix("FS:") {
            let mut parts = rest.split(',');
            feed = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
            spindle = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
        } else if let Some(rest) = field.strip_prefix("F:") {
            feed = rest.parse().unwrap_or(0.0);
        }
    }

    Some(GrblStatus {
        state,
        position,
        is_machine_position: have_mpos,
        feed_rate_mm_min: feed,
        spindle_value: spindle,
    })
}

fn parse_position(s: &str) -> Option<Position3> {
    let mut parts = s.split(',');
    let x = parts.next()?.trim().parse().ok()?;
    let y = parts.next()?.trim().parse().ok()?;
    let z = parts
        .next()
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(0.0);
    Some(Position3 { x, y, z })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_report() {
        let s = parse_status_line("<Idle|MPos:0.000,0.000,0.000|FS:0,0>").unwrap();
        assert_eq!(s.state, MachineState::Idle);
        assert!(s.is_machine_position);
    }

    #[test]
    fn run_report_with_feed_and_spindle() {
        let s =
            parse_status_line("<Run|MPos:12.500,4.200,0.000|FS:1500,800|Ov:100,100,100>").unwrap();
        assert_eq!(s.state, MachineState::Run);
        assert!((s.position.x - 12.5).abs() < 1e-9);
        assert_eq!((s.feed_rate_mm_min, s.spindle_value), (1500.0, 800.0));
    }

    #[test]
    fn hold_substate_is_recognised() {
        assert_eq!(
            parse_status_line("<Hold:0|MPos:0,0,0>").unwrap().state,
            MachineState::Hold
        );
        assert_eq!(
            parse_status_line("<Door:1|MPos:0,0,0>").unwrap().state,
            MachineState::Door
        );
    }

    #[test]
    fn a_genuine_zero_mpos_is_not_replaced_by_wpos() {
        let s = parse_status_line("<Idle|MPos:0.000,0.000,0.000|WPos:25.000,30.000,0.000|FS:0,0>")
            .unwrap();
        assert_eq!((s.position.x, s.position.y), (0.0, 0.0));
    }

    #[test]
    fn wpos_is_used_when_mpos_is_absent() {
        let s = parse_status_line("<Idle|WPos:25.000,30.000,0.000>").unwrap();
        assert_eq!((s.position.x, s.position.y), (25.0, 30.0));
        assert!(!s.is_machine_position);
    }

    #[test]
    fn alarm_report() {
        assert_eq!(
            parse_status_line("<Alarm|MPos:0,0,0|FS:0,0>")
                .unwrap()
                .state,
            MachineState::Alarm
        );
    }

    #[test]
    fn non_status_lines_are_ignored() {
        assert!(parse_status_line("ok").is_none());
        assert!(parse_status_line("error:9").is_none());
        assert!(parse_status_line("<broken").is_none());
    }
}
