//! The object system: everything on the canvas is a [`WorkspaceObject`].
//! Text and shapes are ordinary vector outlines as far as CAM is concerned. They are kept with their
//! settings (`VectorData::source`) so they can be opened and edited again later.

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

/// What a vector object was made from, kept next to its outlines so the object can be opened and
/// edited again. Imported artwork has none. The outlines stay the truth for the planner: this is only
/// the recipe the user typed in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ObjectSource {
    Text(TextSource),
    Shape(ShapeSource),
}

/// The settings of a text object. The font is named, not embedded: on another computer without that
/// font the text can still be edited, and is drawn in a default font until a font is picked.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextSource {
    pub text: String,
    pub font_family: String,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    /// Letter height in mm.
    pub cap_height_mm: f64,
    /// "left", "center" or "right".
    #[serde(default = "default_text_align")]
    pub align: String,
    #[serde(default = "default_line_spacing")]
    pub line_spacing: f64,
}

fn default_text_align() -> String {
    "left".to_string()
}

fn default_line_spacing() -> f64 {
    1.2
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShapeKind {
    Rectangle,
    Ellipse,
    Polygon,
    Star,
}

/// The settings of a shape object.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShapeSource {
    pub shape: ShapeKind,
    pub width_mm: f64,
    pub height_mm: f64,
    /// Rectangles only.
    #[serde(default)]
    pub corner_radius_mm: f64,
    /// Polygons: the number of sides. Stars: the number of points.
    #[serde(default = "default_sides")]
    pub sides: u32,
    /// Stars only: the inner radius over the outer.
    #[serde(default = "default_inner_ratio")]
    pub inner_ratio: f64,
}

fn default_sides() -> u32 {
    5
}

fn default_inner_ratio() -> f64 {
    0.5
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VectorData {
    pub paths: Vec<Path2D>,
    /// Set for text and shapes made in MakerLaser. Left out of the file when there is none, so
    /// imported artwork is saved exactly as before.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<ObjectSource>,
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
            kind: ObjectKind::Vector(VectorData { paths, source: None }),
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
    fn vectors_without_a_source_are_saved_and_loaded_as_before() {
        let obj = WorkspaceObject::new_vector("sq", vec![], 0);
        let json = serde_json::to_string(&obj).unwrap();
        assert!(!json.contains("source"), "{json}");
        let kind: ObjectKind = serde_json::from_str(r#"{"type":"vector","paths":[]}"#).unwrap();
        match kind {
            ObjectKind::Vector(v) => assert!(v.source.is_none()),
            other => panic!("not a vector: {other:?}"),
        }
    }

    #[test]
    fn a_text_source_survives_a_round_trip_with_the_names_the_frontend_expects() {
        let mut obj = WorkspaceObject::new_vector("Text: Hi", vec![], 0);
        if let ObjectKind::Vector(v) = &mut obj.kind {
            v.source = Some(ObjectSource::Text(TextSource {
                text: "Hi\nthere".to_string(),
                font_family: "Arial".to_string(),
                bold: true,
                italic: false,
                cap_height_mm: 10.0,
                align: "center".to_string(),
                line_spacing: 1.2,
            }));
        }
        let json = serde_json::to_string(&obj).unwrap();
        assert!(json.contains(r#""source":{"type":"text""#), "{json}");
        assert!(json.contains(r#""font_family":"Arial""#), "{json}");
        assert!(json.contains(r#""cap_height_mm":10.0"#), "{json}");
        let back: WorkspaceObject = serde_json::from_str(&json).unwrap();
        assert_eq!(back, obj);
    }

    #[test]
    fn a_shape_source_survives_a_round_trip_with_the_names_the_frontend_expects() {
        let mut obj = WorkspaceObject::new_vector("Rectangle", vec![], 0);
        if let ObjectKind::Vector(v) = &mut obj.kind {
            v.source = Some(ObjectSource::Shape(ShapeSource {
                shape: ShapeKind::Rectangle,
                width_mm: 40.0,
                height_mm: 20.0,
                corner_radius_mm: 3.0,
                sides: 6,
                inner_ratio: 0.5,
            }));
        }
        let json = serde_json::to_string(&obj).unwrap();
        assert!(json.contains(r#""source":{"type":"shape","shape":"rectangle""#), "{json}");
        let back: WorkspaceObject = serde_json::from_str(&json).unwrap();
        assert_eq!(back, obj);
        for (kind, name) in [
            (ShapeKind::Ellipse, "ellipse"),
            (ShapeKind::Polygon, "polygon"),
            (ShapeKind::Star, "star"),
        ] {
            assert_eq!(serde_json::to_string(&kind).unwrap(), format!("\"{name}\""));
        }
    }

    #[test]
    fn a_source_with_only_the_essential_fields_loads_with_sensible_defaults() {
        let shape: ObjectSource = serde_json::from_str(
            r#"{"type":"shape","shape":"star","width_mm":10.0,"height_mm":10.0}"#,
        )
        .unwrap();
        match shape {
            ObjectSource::Shape(s) => {
                assert_eq!((s.sides, s.inner_ratio, s.corner_radius_mm), (5, 0.5, 0.0));
            }
            other => panic!("not a shape: {other:?}"),
        }
        let text: ObjectSource = serde_json::from_str(
            r#"{"type":"text","text":"Hi","font_family":"Arial","cap_height_mm":8.0}"#,
        )
        .unwrap();
        match text {
            ObjectSource::Text(t) => {
                assert_eq!(
                    (t.bold, t.italic, t.align.as_str(), t.line_spacing),
                    (false, false, "left", 1.2)
                );
            }
            other => panic!("not text: {other:?}"),
        }
    }

    #[test]
    fn extension_mapping() {
        assert_eq!(ImageFormat::from_extension("JPG"), Some(ImageFormat::Jpg));
        assert_eq!(ImageFormat::from_extension("svg"), None);
    }
}
