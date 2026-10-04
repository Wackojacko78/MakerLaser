//! `makerlaser-common`: shared domain models used by every other MakerLaser crate and
//! mirrored by hand in `apps/desktop-ui/src/types/domain.ts`.

pub mod geometry_types;
pub mod layers;
pub mod machine;
pub mod material;
pub mod objects;
pub mod operations;
pub mod project;

pub use geometry_types::{BoundingBox, Path2D, Point2, Transform2D};
pub use layers::{Layer, LayerKind};
pub use machine::{ControllerKind, MachineOrigin, MachineProfile};
pub use material::{MaterialLibrary, MaterialPreset};
pub use objects::{ImageData, ImageFormat, ObjectKind, VectorData, WorkspaceObject};
pub use operations::{
    CutOperation, CutOrderStrategy, DitherAlgorithm, FillOperation, FillPattern, LaserOperation,
    RasterOperation, ScanDirection, ScoreOperation,
};
pub use project::{ProjectFile, ProjectSettings, Units, PROJECT_SCHEMA_VERSION};
