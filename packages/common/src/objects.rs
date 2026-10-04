//! The object system: everything on the canvas is a [`WorkspaceObject`].
//! `Text` and `Shape` objects are future work; both are expected to resolve to
//! [`VectorData`] for CAM purposes, so adding them will not touch the CAM engine.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::geometry_types::{BoundingBox, Path2D, Point2, Transform2D};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    Png,
    Jpg,
    Jpeg,
    Bmp,
}

impl ImageFormat {
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_ascii_lowercase().as_str() {
            "png" => Some(ImageFormat::Png),
            "jpg" => Some(ImageFormat::Jpg),
            "jpeg" => Some(ImageFormat::Jpeg),
            "bmp" => Some(ImageFormat::Bmp),
            _ => None,
        }
    }

    pub fn extension(&self) -> &'static str {
        match self {
            ImageFormat::Png => "png",
            ImageFormat::Jpg => "jpg",
            ImageFormat::Jpeg => "jpeg",
            ImageFormat::Bmp => "bmp",
        }
    }

    pub fn mime(&self) -> &'static str {
        match self {
            ImageFormat::Png => "image/png",
            ImageFormat::Jpg | ImageFormat::Jpeg => "image/jpeg",
            ImageFormat::Bmp => "image/bmp",
        }
    }
}

/// A raster image object. Pixel data is stored once per `asset_id` (in the `.mlp`
/// archive under `images/<asset_id>.<ext>`), so duplicating an object shares the asset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImageData {
    pub asset_id: Uuid,
    pub format: ImageFormat,
    pub source_path: Option<String>,
    pub width_px: u32,
    pub height_px: u32,
    /// Pixels per inch used to derive the natural physical size.
    pub dpi: f64,
}

impl ImageData {
    /// Natural size in millimetres before the object's transform is applied.
    pub fn natural_size_mm(&self) -> (f64, f64) {
        let dpi = if self.dpi > 0.0 { self.dpi } else { 96.0 };
        (
            self.width_px as f64 / dpi * 25.4,
            self.height_px as f64 / dpi * 25.4,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VectorData {
    pub paths: Vec<Path2D>,
}

impl VectorData {
    pub fn bounding_box(&self) -> Option<BoundingBox> {
        self.paths
            .iter()
            .filter_map(|p| p.bounding_box())
            .reduce(|a, b| a.union(&b))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ObjectKind {
    Image(ImageData),
    Vector(VectorData),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceObject {
    pub id: Uuid,
    pub name: String,
    pub kind: ObjectKind,
    pub transform: Transform2D,
    pub layer_id: Option<Uuid>,
    pub visible: bool,
    pub locked: bool,
    pub z_index: i32,
}

impl WorkspaceObject {
    pub fn new_vector(name: impl Into<String>, paths: Vec<Path2D>, z_index: i32) -> Self {
        WorkspaceObject {
            id: Uuid::new_v4(),
            name: name.into(),
            kind: ObjectKind::Vector(VectorData { paths }),
            transform: Transform2D::IDENTITY,
            layer_id: None,
            visible: true,
            locked: false,
            z_index,
        }
    }

    pub fn new_image(name: impl Into<String>, image: ImageData, z_index: i32) -> Self {
        WorkspaceObject {
            id: Uuid::new_v4(),
            name: name.into(),
            kind: ObjectKind::Image(image),
            transform: Transform2D::IDENTITY,
            layer_id: None,
            visible: true,
            locked: false,
            z_index,
        }
    }

    /// Axis-aligned bounding box in workspace coordinates (transform applied).
    pub fn world_bounding_box(&self) -> Option<BoundingBox> {
        match &self.kind {
            ObjectKind::Vector(v) => v
                .paths
                .iter()
                .map(|p| p.transformed(&self.transform))
                .filter_map(|p| p.bounding_box())
                .reduce(|a, b| a.union(&b)),
            ObjectKind::Image(img) => {
                let (w, h) = img.natural_size_mm();
                let corners = [
                    Point2::new(0.0, 0.0),
                    Point2::new(w, 0.0),
                    Point2::new(w, h),
                    Point2::new(0.0, h),
                ];
                let world: Vec<Point2> = corners.iter().map(|p| self.transform.apply(*p)).collect();
                BoundingBox::from_points(&world)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_image() -> ImageData {
        ImageData {
            asset_id: Uuid::new_v4(),
            format: ImageFormat::Png,
            source_path: None,
            width_px: 300,
            height_px: 600,
            dpi: 300.0,
        }
    }

    #[test]
    fn natural_size_at_300_dpi() {
        let (w, h) = sample_image().natural_size_mm();
        assert!((w - 25.4).abs() < 1e-6 && (h - 50.8).abs() < 1e-6);
    }

    #[test]
    fn world_box_respects_transform() {
        let sq = Path2D::new(
            vec![
                Point2::new(0.0, 0.0),
                Point2::new(10.0, 0.0),
                Point2::new(10.0, 10.0),
                Point2::new(0.0, 10.0),
            ],
            true,
        );
        let mut obj = WorkspaceObject::new_vector("sq", vec![sq], 0);
        obj.transform = Transform2D::translate(5.0, 5.0);
        let b = obj.world_bounding_box().unwrap();
        assert_eq!(b.min, Point2::new(5.0, 5.0));
        assert_eq!(b.max, Point2::new(15.0, 15.0));
    }

    #[test]
    fn image_object_serialises_with_type_tag() {
        let obj = WorkspaceObject::new_image("photo", sample_image(), 0);
        let json = serde_json::to_string(&obj).unwrap();
        assert!(json.contains("\"type\":\"image\""));
        assert!(json.contains("\"asset_id\""));
        let back: WorkspaceObject = serde_json::from_str(&json).unwrap();
        assert_eq!(back, obj);
    }

    #[test]
    fn extension_mapping() {
        assert_eq!(ImageFormat::from_extension("JPG"), Some(ImageFormat::Jpg));
        assert_eq!(ImageFormat::from_extension("svg"), None);
    }
}
