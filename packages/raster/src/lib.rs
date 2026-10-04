//! `makerlaser-raster`: image adjustment, dithering and resampling for photo engraving.

pub mod adjust;
pub mod dither;
pub mod preview;

pub use adjust::Adjustments;
pub use dither::{dither, DitherAlgorithm};
pub use preview::{encode_png, load_grayscale, resample, resize_grayscale, Resampled};
