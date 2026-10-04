//! Operation models: the bridge between "a layer full of objects" and "a concrete plan
//! the CAM engine can turn into toolpaths".
//! Pipeline: `Workspace -> Operations -> Toolpaths -> G-code -> Machine`.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CutOrderStrategy {
    /// Deepest-nested paths first, nearest-neighbour travel optimisation *within* each
    /// nesting depth only. Holes always finish before the boundary that contains them.
    InsideFirst,
    /// Equivalent to `InsideFirst`: outer boundaries (depth 0) are always cut last.
    OutsideLast,
    /// Keep the order paths were drawn in; no reordering.
    AsDrawn,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CutOperation {
    pub kerf_mm: f64,
    pub cut_order: CutOrderStrategy,
}

impl Default for CutOperation {
    fn default() -> Self {
        CutOperation {
            kerf_mm: 0.0,
            cut_order: CutOrderStrategy::InsideFirst,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScoreOperation {
    pub cut_order: CutOrderStrategy,
}

impl Default for ScoreOperation {
    fn default() -> Self {
        ScoreOperation {
            cut_order: CutOrderStrategy::InsideFirst,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FillPattern {
    Lines,
    CrossHatch,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FillOperation {
    pub pattern: FillPattern,
    pub angle_deg: f64,
    pub line_spacing_mm: f64,
}

impl Default for FillOperation {
    fn default() -> Self {
        FillOperation {
            pattern: FillPattern::Lines,
            angle_deg: 0.0,
            line_spacing_mm: 0.1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DitherAlgorithm {
    None,
    FloydSteinberg,
    Jarvis,
    Stucki,
    Atkinson,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanDirection {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RasterOperation {
    pub dpi: u32,
    pub dither: DitherAlgorithm,
    pub direction: ScanDirection,
    pub bidirectional: bool,
    /// -100..100
    pub brightness: f64,
    /// -100..100
    pub contrast: f64,
    /// 0.1..5.0
    pub gamma: f64,
    pub invert: bool,
}

impl Default for RasterOperation {
    fn default() -> Self {
        RasterOperation {
            dpi: 254, // 10 lines/mm
            dither: DitherAlgorithm::FloydSteinberg,
            direction: ScanDirection::Horizontal,
            bidirectional: true,
            brightness: 0.0,
            contrast: 0.0,
            gamma: 1.0,
            invert: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LaserOperation {
    Cut {
        layer_id: Uuid,
        object_ids: Vec<Uuid>,
        params: CutOperation,
    },
    Score {
        layer_id: Uuid,
        object_ids: Vec<Uuid>,
        params: ScoreOperation,
    },
    Fill {
        layer_id: Uuid,
        object_ids: Vec<Uuid>,
        params: FillOperation,
    },
    Raster {
        layer_id: Uuid,
        object_ids: Vec<Uuid>,
        params: RasterOperation,
    },
}

impl LaserOperation {
    pub fn layer_id(&self) -> Uuid {
        match self {
            LaserOperation::Cut { layer_id, .. }
            | LaserOperation::Score { layer_id, .. }
            | LaserOperation::Fill { layer_id, .. }
            | LaserOperation::Raster { layer_id, .. } => *layer_id,
        }
    }

    pub fn object_ids(&self) -> &[Uuid] {
        match self {
            LaserOperation::Cut { object_ids, .. }
            | LaserOperation::Score { object_ids, .. }
            | LaserOperation::Fill { object_ids, .. }
            | LaserOperation::Raster { object_ids, .. } => object_ids,
        }
    }

    /// Engraving runs before cutting so the part cannot shift or drop out before the
    /// engraved detail is finished. Lower runs first.
    pub fn execution_priority(&self) -> u8 {
        match self {
            LaserOperation::Raster { .. } => 0,
            LaserOperation::Fill { .. } => 1,
            LaserOperation::Score { .. } => 2,
            LaserOperation::Cut { .. } => 3,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raster_is_scheduled_before_cut() {
        let raster = LaserOperation::Raster {
            layer_id: Uuid::new_v4(),
            object_ids: vec![],
            params: RasterOperation::default(),
        };
        let cut = LaserOperation::Cut {
            layer_id: Uuid::new_v4(),
            object_ids: vec![],
            params: CutOperation::default(),
        };
        assert!(raster.execution_priority() < cut.execution_priority());
    }

    #[test]
    fn serde_tag_round_trips() {
        let op = LaserOperation::Fill {
            layer_id: Uuid::new_v4(),
            object_ids: vec![Uuid::new_v4()],
            params: FillOperation::default(),
        };
        let json = serde_json::to_string(&op).unwrap();
        assert!(json.contains("\"kind\":\"fill\""));
        let back: LaserOperation = serde_json::from_str(&json).unwrap();
        assert_eq!(back, op);
    }

    #[test]
    fn dither_names_are_snake_case() {
        let json = serde_json::to_string(&DitherAlgorithm::FloydSteinberg).unwrap();
        assert_eq!(json, "\"floyd_steinberg\"");
    }
}
