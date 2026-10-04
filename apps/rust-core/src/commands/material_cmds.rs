//! Material library import/export. The library itself lives in the project (and therefore
//! in the UI store); these commands only read and write `.json` files.

use makerlaser_common::{Layer, MaterialLibrary};

#[tauri::command(async)]
pub fn import_materials(path: String) -> Result<MaterialLibrary, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| format!("Cannot read '{path}': {e}"))?;
    let library = MaterialLibrary::from_json(&text)
        .map_err(|e| format!("'{path}' is not a MakerLaser material library: {e}"))?;
    for preset in &library.presets {
        let mut layer = Layer::new("check", preset.for_layer_kind, 0);
        preset.apply_to(&mut layer);
        let problems = layer.validate(100.0, f64::MAX);
        if !problems.is_empty() {
            return Err(format!(
                "Preset '{}' is invalid: {}",
                preset.name,
                problems.join("; ")
            ));
        }
    }
    Ok(library)
}

#[tauri::command(async)]
pub fn export_materials(path: String, library: MaterialLibrary) -> Result<(), String> {
    let json = library.to_json().map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Cannot write '{path}': {e}"))
}
