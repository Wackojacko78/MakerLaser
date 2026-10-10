//! Checks for commands typed into the console box, before they reach the controller.
//!
//! The box is for GRBL system commands (`$$` to list the settings, `$32=1` to change one), the
//! odd G-code line and the like. It is deliberately narrower than a raw serial terminal:
//!
//! * one plain-text line, at most `MAX_COMMAND_LEN` characters (GRBL's line buffer is small);
//! * no real-time characters (`!`, `~`, `?`, Ctrl-X): Pause, Resume and STOP have buttons, and
//!   the status is polled automatically;
//! * nothing that switches the laser on (`M3`/`M4`): the beam is only ever lit by a job or by
//!   Frame with laser on, which have their own limits and warnings;
//! * no `$RST`, which wipes the controller's settings.

/// GRBL's line buffer is 80 characters in a normal build; anything longer is cut or refused.
pub const MAX_COMMAND_LEN: usize = 80;

/// Removes `; ...` and `( ... )` comments, spaces and case, so commands can be recognised
/// whichever way they were typed (GRBL itself ignores all three).
fn compact(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut depth = 0u32;
    for ch in line.chars() {
        match ch {
            ';' if depth == 0 => break,
            '(' => depth += 1,
            ')' if depth > 0 => depth -= 1,
            c if depth == 0 && !c.is_whitespace() => out.push(c.to_ascii_uppercase()),
            _ => {}
        }
    }
    out
}

/// True when a G-code line contains an `M3` or `M4` word (laser on), however it is written:
/// `M3`, `m4`, `M03`, `G1 X5 M4 S10`.
fn switches_laser_on(code: &str) -> bool {
    code.match_indices('M').any(|(at, _)| {
        let digits: String = code[at + 1..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        matches!(digits.parse::<u32>(), Ok(3) | Ok(4))
    })
}

/// Checks a typed command and returns the line to send (trimmed), or a message saying why not.
pub fn check_console_line(raw: &str) -> Result<String, String> {
    let line = raw.trim();
    if line.is_empty() {
        return Err("Type a command first.".to_string());
    }
    if let Some(c) = line.chars().find(|c| !c.is_ascii() || c.is_ascii_control()) {
        return Err(if c == '\u{18}' {
            "Ctrl-X is the soft reset. Use the STOP button.".to_string()
        } else {
            "A command is one line of plain text: no line breaks, tabs or special characters."
                .to_string()
        });
    }
    if line.len() > MAX_COMMAND_LEN {
        return Err(format!(
            "Commands are limited to {MAX_COMMAND_LEN} characters (the controller's line buffer)."
        ));
    }
    if line.contains(|c: char| matches!(c, '!' | '~' | '?')) {
        return Err(
            "!, ~ and ? are real-time characters. Use the Pause, Resume and STOP buttons; the status is shown automatically."
                .to_string(),
        );
    }
    let code = compact(line);
    if code.starts_with("$RST") {
        return Err(
            "Restoring the controller's defaults ($RST) is not available here, because it wipes every setting. Use another program if you really need it."
                .to_string(),
        );
    }
    if !code.starts_with('$') && switches_laser_on(&code) {
        return Err(
            "M3 and M4 switch the laser on, so they are not available here. A job or Frame with laser on lights the beam, with their own limits."
                .to_string(),
        );
    }
    Ok(line.to_string())
}

/// True when the command can change what machine coordinates mean (homing, axis direction,
/// the position report), so a remembered user origin must be forgotten.
pub fn changes_machine_coordinates(line: &str) -> bool {
    let code = compact(line);
    if code.starts_with("$H") {
        return true;
    }
    let Some(setting) = code.strip_prefix('$') else {
        return false;
    };
    let Some((number, _)) = setting.split_once('=') else {
        return false;
    };
    // $3 axis directions, $10 status report, $13 report units, $23 homing direction.
    matches!(number.parse::<u32>(), Ok(3) | Ok(10) | Ok(13) | Ok(23))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_commands_pass_and_are_trimmed() {
        for ok in [
            "$$",
            "$32=1",
            "  $I  ",
            "G0 X10 Y10",
            "g1 x5 f100",
            "M5",
            "M8",
            "$H",
            "$X",
        ] {
            assert_eq!(check_console_line(ok).unwrap(), ok.trim(), "{ok}");
        }
    }

    #[test]
    fn empty_overlong_and_multi_line_input_is_refused() {
        assert!(check_console_line("").is_err());
        assert!(check_console_line("   ").is_err());
        assert!(check_console_line(&"G0 ".repeat(40)).is_err());
        assert!(check_console_line(&"X".repeat(MAX_COMMAND_LEN)).is_ok());
        assert!(check_console_line(&"X".repeat(MAX_COMMAND_LEN + 1)).is_err());
        assert!(check_console_line("G0 X1\nM4 S1000").is_err());
        assert!(check_console_line("G0 X1\rM5").is_err());
        assert!(check_console_line("G0\tX1").is_err());
        assert!(check_console_line("G0 X1 ×").is_err());
    }

    #[test]
    fn real_time_characters_are_refused_and_point_to_the_buttons() {
        for bad in ["!", "~", "?", "$J=G91 X1 F100 !", "G0 X1 ?"] {
            let err = check_console_line(bad).unwrap_err();
            assert!(err.contains("real-time"), "{bad}: {err}");
        }
        let err = check_console_line("\u{18}").unwrap_err();
        assert!(err.contains("STOP"), "{err}");
    }

    #[test]
    fn nothing_that_switches_the_laser_on_gets_through() {
        for bad in [
            "M3 S10",
            "m4",
            "M03",
            "M04 S5",
            "G1 X5 M4 S10",
            "G1X5M3",
            "M 4",
        ] {
            let err = check_console_line(bad).unwrap_err();
            assert!(err.contains("M3 and M4"), "{bad}: {err}");
        }
    }

    #[test]
    fn other_m_words_and_comments_are_not_mistaken_for_laser_on() {
        for ok in [
            "M5",
            "M30",
            "M8",
            "M9",
            "M2",
            "( M3 ) G0 X1",
            "G0 X1 ; M4 later",
            "M5 M8",
        ] {
            assert!(check_console_line(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn a_settings_wipe_is_refused_but_settings_can_be_read_and_written() {
        assert!(check_console_line("$RST=*").is_err());
        assert!(check_console_line("$rst=$").is_err());
        assert!(check_console_line("$ RST=#").is_err());
        for ok in ["$$", "$#", "$G", "$32=1", "$100=80.000"] {
            assert!(check_console_line(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn only_homing_and_the_coordinate_settings_clear_the_remembered_origin() {
        for yes in ["$H", "$h", "$3=2", "$10=1", "$13=0", "$23=1", "$ 23 = 1"] {
            assert!(changes_machine_coordinates(yes), "{yes}");
        }
        for no in [
            "$$", "$32=1", "$100=80", "$130=300", "$X", "G0 X1", "$3", "M5",
        ] {
            assert!(!changes_machine_coordinates(no), "{no}");
        }
    }
}
