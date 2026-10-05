//! Plain-text config files: material libraries and machine profiles. The UI builds and checks
//! the JSON (`apps/desktop-ui/src/lib/configFormat.ts`); these commands only move the text
//! between disk and the UI, for paths the user picked in a native open/save dialog. They are
//! limited to `.json` files of a sensible size.

use std::path::PathBuf;

/// Config files are tiny; anything bigger than this is not one.
const MAX_CONFIG_BYTES: usize = 1_048_576;

/// The path as a `.json` path, adding the extension when `add_extension` is set and it is missing.
fn json_path(path: &str, add_extension: bool) -> Result<PathBuf, String> {
    let mut path = PathBuf::from(path);
    if add_extension && path.extension().is_none() {
        path.set_extension("json");
    }
    let is_json = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("json"));
    if is_json {
        Ok(path)
    } else {
        Err(format!("'{}' is not a .json file.", path.display()))
    }
}

#[tauri::command(async)]
pub fn read_config_file(path: String) -> Result<String, String> {
    let path = json_path(&path, false)?;
    let size = std::fs::metadata(&path)
        .map_err(|e| format!("Cannot read '{}': {e}", path.display()))?
        .len();
    if size > MAX_CONFIG_BYTES as u64 {
        return Err(format!(
            "'{}' is too large to be a MakerLaser config file.",
            path.display()
        ));
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Cannot read '{}': {e}", path.display()))
}

#[tauri::command(async)]
pub fn write_config_file(path: String, text: String) -> Result<(), String> {
    let path = json_path(&path, true)?;
    if text.len() > MAX_CONFIG_BYTES {
        return Err("That config is too large to save.".to_string());
    }
    std::fs::write(&path, text).map_err(|e| format!("Cannot write '{}': {e}", path.display()))
}
