use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProjectError {
    #[error("geometry error: {0}")]
    Geometry(#[from] makerlaser_geometry::GeometryError),

    #[error("layer {0} not found")]
    LayerNotFound(String),

    #[error("raster error: {0}")]
    Raster(String),

    #[error("{0}")]
    TooLarge(String),

    #[error("zip archive error: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("unsupported or corrupt .mlp project: {0}")]
    InvalidProjectFile(String),

    #[error("this project was saved by a newer MakerLaser (schema {found}; this version supports up to {supported})")]
    NewerSchema { found: u32, supported: u32 },
}

pub type Result<T> = std::result::Result<T, ProjectError>;
