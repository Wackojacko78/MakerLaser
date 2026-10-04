use thiserror::Error;

#[derive(Debug, Error)]
pub enum GeometryError {
    #[error("boolean operation failed: {0}")]
    BooleanOpFailed(String),

    #[error("failed to parse SVG: {0}")]
    SvgParse(String),

    #[error("failed to parse DXF: {0}")]
    DxfParse(String),
}

pub type Result<T> = std::result::Result<T, GeometryError>;
