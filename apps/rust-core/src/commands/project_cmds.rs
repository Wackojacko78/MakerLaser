//! Project lifecycle: new / sync / save / open, plus image access for the canvas.

use std::path::PathBuf;

use base64::Engine;
use makerlaser_common::{MachineProfile, ProjectFile, RasterOperation};
use tauri::State;
use uuid::Uuid;

use crate::state::{default_project, lock, AppState};

fn sniff_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if bytes.starts_with(b"BM") {
        "image/bmp"
    } else {
        "application/octet-stream"
    }
}

fn data_url(bytes: &[u8]) -> String {
    format!(
        "data:{};base64,{}",
        sniff_mime(bytes),
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn with_mlp_extension(path: &str) -> PathBuf {
    let mut p = PathBuf::from(path);
    if p.extension().is_none() {
        p.set_extension("mlp");
    }
    p
}

#[tauri::command(async)]
pub fn new_project(state: State<'_, AppState>) -> Result<ProjectFile, String> {
    let project = default_project();
    *lock(&state.project)? = project.clone();
    lock(&state.assets)?.clear();
    *lock(&state.project_path)? = None;
    *lock(&state.generated)? = None;
    Ok(project)
}

#[tauri::command(async)]
pub fn machine_presets() -> Vec<MachineProfile> {
    MachineProfile::presets()
}

/// Replaces the Rust-side project with the UI's current one.
#[tauri::command(async)]
pub fn sync_project(state: State<'_, AppState>, project: ProjectFile) -> Result<(), String> {
    *lock(&state.project)? = project;
    Ok(())
}

#[tauri::command(async)]
pub fn save_project_as(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let path = with_mlp_extension(&path);
    {
        let project = lock(&state.project)?;
        let assets = lock(&state.assets)?;
        makerlaser_project::save_project(&path, &project, &assets).map_err(|e| e.to_string())?;
    }
    *lock(&state.project_path)? = Some(path.clone());
    Ok(path.display().to_string())
}

#[tauri::command(async)]
pub fn save_project(state: State<'_, AppState>) -> Result<String, String> {
    let path = lock(&state.project_path)?
        .clone()
        .ok_or_else(|| "This project has not been saved yet.".to_string())?;
    let project = lock(&state.project)?;
    let assets = lock(&state.assets)?;
    makerlaser_project::save_project(&path, &project, &assets).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command(async)]
pub fn open_project(state: State<'_, AppState>, path: String) -> Result<ProjectFile, String> {
    let path = PathBuf::from(path);
    let (project, assets) = makerlaser_project::load_project(&path).map_err(|e| e.to_string())?;
    *lock(&state.project)? = project.clone();
    *lock(&state.assets)? = assets;
    *lock(&state.project_path)? = Some(path);
    *lock(&state.generated)? = None;
    Ok(project)
}

#[tauri::command(async)]
pub fn project_file_path(state: State<'_, AppState>) -> Result<Option<String>, String> {
    Ok(lock(&state.project_path)?
        .as_ref()
        .map(|p| p.display().to_string()))
}

/// The original image as a data URL, for display on the canvas.
#[tauri::command(async)]
pub fn get_image_data_url(
    state: State<'_, AppState>,
    asset_id: String,
) -> Result<Option<String>, String> {
    let id = Uuid::parse_str(&asset_id).map_err(|e| e.to_string())?;
    let assets = lock(&state.assets)?;
    Ok(assets.get(&id).map(|bytes| data_url(bytes)))
}

/// A dithered preview of an image with the layer's raster settings (no placement), as a
/// PNG data URL no larger than `max_dim` pixels on its longest side.
#[tauri::command(async)]
pub fn raster_preview(
    state: State<'_, AppState>,
    asset_id: String,
    params: RasterOperation,
    max_dim: u32,
) -> Result<Option<String>, String> {
    let id = Uuid::parse_str(&asset_id).map_err(|e| e.to_string())?;
    let bytes = match lock(&state.assets)?.get(&id) {
        Some(b) => b.clone(),
        None => return Ok(None),
    };
    let source = makerlaser_raster::load_grayscale(&bytes).map_err(|e| e.to_string())?;
    let max_dim = max_dim.clamp(64, 1200);
    let longest = source.width().max(source.height()).max(1);
    let scale = (max_dim as f64 / longest as f64).min(1.0);
    let (w, h) = (
        ((source.width() as f64 * scale).round() as u32).max(1),
        ((source.height() as f64 * scale).round() as u32).max(1),
    );
    let small = makerlaser_raster::resize_grayscale(&source, w, h);
    let adjusted = makerlaser_raster::Adjustments {
        brightness: params.brightness,
        contrast: params.contrast,
        gamma: params.gamma,
        invert: params.invert,
    }
    .apply(&small);
    let algorithm = match params.dither {
        makerlaser_common::DitherAlgorithm::None => makerlaser_raster::DitherAlgorithm::None,
        makerlaser_common::DitherAlgorithm::FloydSteinberg => {
            makerlaser_raster::DitherAlgorithm::FloydSteinberg
        }
        makerlaser_common::DitherAlgorithm::Jarvis => makerlaser_raster::DitherAlgorithm::Jarvis,
        makerlaser_common::DitherAlgorithm::Stucki => makerlaser_raster::DitherAlgorithm::Stucki,
        makerlaser_common::DitherAlgorithm::Atkinson => {
            makerlaser_raster::DitherAlgorithm::Atkinson
        }
    };
    let adjusted = makerlaser_raster::sharpen(&adjusted, params.sharpen);
    let dithered = makerlaser_raster::dither(&adjusted, algorithm, params.threshold);
    let png = makerlaser_raster::encode_png(&dithered).map_err(|e| e.to_string())?;
    Ok(Some(data_url(&png)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mime_types_are_sniffed_from_content() {
        assert_eq!(sniff_mime(&[0x89, b'P', b'N', b'G', 1, 2]), "image/png");
        assert_eq!(sniff_mime(&[0xFF, 0xD8, 0xFF]), "image/jpeg");
        assert_eq!(sniff_mime(b"BM...."), "image/bmp");
        assert_eq!(sniff_mime(b"zzz"), "application/octet-stream");
    }

    #[test]
    fn save_paths_get_the_mlp_extension() {
        assert_eq!(
            with_mlp_extension("/tmp/job"),
            PathBuf::from("/tmp/job.mlp")
        );
        assert_eq!(
            with_mlp_extension("/tmp/job.mlp"),
            PathBuf::from("/tmp/job.mlp")
        );
    }
}
