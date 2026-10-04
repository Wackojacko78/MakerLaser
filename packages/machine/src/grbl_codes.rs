//! Human-readable GRBL 1.1 error and alarm descriptions (wording follows the public GRBL
//! `error_codes_en_US.csv` / `alarm_codes_en_US.csv` references).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GrblDiagnostic {
    pub code: u8,
    pub title: &'static str,
    pub recovery: &'static str,
}

pub fn error(code: u8) -> GrblDiagnostic {
    let (title, recovery) = match code {
        1 => ("Expected command letter", "Regenerate the G-code."),
        2 => (
            "Bad number format",
            "A number is missing or malformed; regenerate the G-code.",
        ),
        3 => (
            "Invalid system command",
            "Check the controller firmware and the command.",
        ),
        4 => (
            "Negative value",
            "A value that must be positive was negative.",
        ),
        5 => (
            "Homing not enabled",
            "Enable homing ($22) or do not use Home.",
        ),
        8 => ("Machine not idle", "Wait for motion to stop, then retry."),
        9 => (
            "G-code locked out",
            "Clear the alarm ($X) or re-home first.",
        ),
        10 => (
            "Soft limits need homing",
            "Enable homing before enabling soft limits.",
        ),
        11 => ("Line overflow", "A G-code line was too long."),
        13 => (
            "Safety door open",
            "Close the enclosure and check the door input.",
        ),
        15 => (
            "Travel exceeded",
            "The jog target is beyond the machine travel; jog less.",
        ),
        20 => (
            "Unsupported G-code command",
            "The firmware does not support a command in the program.",
        ),
        21 => (
            "Modal group violation",
            "Conflicting commands in one line; regenerate.",
        ),
        22 => (
            "Feed rate undefined",
            "A feed move had no speed; set a layer speed above zero.",
        ),
        24 => ("Invalid target", "The commanded move is invalid."),
        33 => (
            "Invalid motion target",
            "Check the artwork for corrupt geometry.",
        ),
        _ => ("GRBL error", "Check the console for the rejected line."),
    };
    GrblDiagnostic {
        code,
        title,
        recovery,
    }
}

pub fn alarm(code: u8) -> GrblDiagnostic {
    let (title, recovery) = match code {
        1 => (
            "Hard limit triggered",
            "Position is likely lost: inspect the machine, then re-home.",
        ),
        2 => (
            "Soft limit: target beyond machine travel",
            "Check job placement and the bed size, then unlock ($X).",
        ),
        3 => (
            "Reset while moving",
            "Position is likely lost: re-home before continuing.",
        ),
        4 => ("Probe fail", "Probe was not in its expected state."),
        5 => ("Probe fail", "Probe did not make contact."),
        6 => (
            "Homing failed: cycle reset",
            "Resolve the cause and home again.",
        ),
        7 => (
            "Homing failed: door opened",
            "Close the enclosure and home again.",
        ),
        8 => (
            "Homing failed: pull-off",
            "Check the limit switch and pull-off setting.",
        ),
        9 => (
            "Homing failed: no switch found",
            "Check switch wiring, direction and travel.",
        ),
        _ => (
            "GRBL alarm",
            "Do not continue until the cause is understood.",
        ),
    };
    GrblDiagnostic {
        code,
        title,
        recovery,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_alarm_and_error() {
        assert!(alarm(2).title.contains("Soft limit"));
        assert_eq!(error(22).title, "Feed rate undefined");
    }

    #[test]
    fn unknown_codes_are_safe() {
        assert_eq!(error(250).title, "GRBL error");
        assert_eq!(alarm(250).title, "GRBL alarm");
    }
}
