//! Artwork import. The parsing happens here in Rust; the command returns only the new
//! object, so the UI (the source of truth) adds it to its own project without a
//! whole-project round trip that could overwrite unsynced edits.

use std::path::Path;

use makerlaser_common::{ImageData, ImageFormat, Transform2D, WorkspaceObject};
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::state::{lock, AppState};

const MAX_FILE_BYTES: u64 = 200 * 1024 * 1024;
/// Where a freshly imported object is placed on the bed.
const PLACEMENT_MARGIN_MM: f64 = 10.0;

#[derive(Debug, Serialize)]
pub struct ImportedArtwork {
    pub object: WorkspaceObject,
    pub warnings: Vec<String>,
}

fn file_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Imported")
        .to_string()
}

fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let len = std::fs::metadata(path)
        .map_err(|e| format!("Cannot read '{}': {e}", path.display()))?
        .len();
    if len > MAX_FILE_BYTES {
        return Err(format!(
            "'{}' is too large to import ({} MB).",
            path.display(),
            len / 1024 / 1024
        ));
    }
    std::fs::read(path).map_err(|e| format!("Cannot read '{}': {e}", path.display()))
}

#[tauri::command(async)]
pub fn import_artwork(
    state: State<'_, AppState>,
    path: String,
    z_index: i32,
) -> Result<ImportedArtwork, String> {
    let path = Path::new(&path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let name = file_stem(path);
    let place = Transform2D::translate(PLACEMENT_MARGIN_MM, PLACEMENT_MARGIN_MM);

    match ext.as_str() {
        "svg" | "dxf" => {
            let bytes = read_limited(path)?;
            let text = String::from_utf8_lossy(&bytes);
            let (mut paths, warnings) = if ext == "svg" {
                let r = makerlaser_geometry::parse_svg(&text).map_err(|e| e.to_string())?;
                (r.paths, r.warnings)
            } else {
                let r = makerlaser_geometry::parse_dxf(&text).map_err(|e| e.to_string())?;
                (r.paths, r.warnings)
            };
            if paths.is_empty() {
                let detail = if warnings.is_empty() { String::new() } else { format!(" {}", warnings.join(" ")) };
                return Err(format!("'{name}' contains no shapes MakerLaser can import.{detail}"));
            }
            makerlaser_geometry::normalize_to_origin(&mut paths);
            let mut object = WorkspaceObject::new_vector(name, paths, z_index);
            object.transform = place;
            Ok(ImportedArtwork { object, warnings })
        }
        "png" | "jpg" | "jpeg" | "bmp" => {
            let format = ImageFormat::from_extension(&ext)
                .ok_or_else(|| format!("Unsupported image type: .{ext}"))?;
            let bytes = read_limited(path)?;
            let decoded = makerlaser_raster::load_grayscale(&bytes)
                .map_err(|e| format!("'{name}' is not a readable image: {e}"))?;
            let image = ImageData {
                asset_id: Uuid::new_v4(),
                format,
                source_path: Some(path.display().to_string()),
                width_px: decoded.width(),
                height_px: decoded.height(),
                dpi: 96.0,
            };

            // Fit oversized pictures onto the bed (80%) so a 4000 px photo does not arrive
            // metres wide.
            let (nat_w, nat_h) = image.natural_size_mm();
            let bed = lock(&state.project)?.machine.bed_bounds();
            let (max_w, max_h) = (bed.width() * 0.8, bed.height() * 0.8);
            let mut warnings = Vec::new();
            let scale = (max_w / nat_w).min(max_h / nat_h).min(1.0);
            let mut transform = place;
            if scale < 1.0 {
                transform = Transform2D::scale(scale, scale).then(&place);
                warnings.push(format!(
                    "The image was scaled to {:.0}% to fit the bed.",
                    scale * 100.0
                ));
            }

            lock(&state.assets)?.insert(image.asset_id, bytes);
            let mut object = WorkspaceObject::new_image(name, image, z_index);
            object.transform = transform;
            Ok(ImportedArtwork { object, warnings })
        }
        "" => Err("The file has no extension; MakerLaser imports .svg, .dxf, .png, .jpg, .jpeg and .bmp.".to_string()),
        other => Err(format!(
            "'.{other}' files are not supported. MakerLaser imports .svg, .dxf, .png, .jpg, .jpeg and .bmp."
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stems_fall_back_gracefully() {
        assert_eq!(file_stem(Path::new("/a/b/logo.svg")), "logo");
        assert_eq!(file_stem(Path::new("")), "Imported");
    }
}
