//! CAM planner: `Workspace -> Operations`. Turns layers and their objects into an ordered
//! list of [`LaserOperation`]s, and reports anything that will *not* run and why.

use makerlaser_common::{
    CutOperation, CutOrderStrategy, FillOperation, FillPattern, LaserOperation, LayerKind,
    ObjectKind, ProjectFile, ScoreOperation,
};

#[derive(Debug, Clone, Default)]
pub struct PlanResult {
    pub operations: Vec<LaserOperation>,
    pub warnings: Vec<String>,
}

/// One operation per enabled layer that has at least one compatible, visible object.
/// Operations are ordered by execution priority (engrave before cut), then layer order.
pub fn plan_operations(project: &ProjectFile) -> PlanResult {
    let mut warnings = Vec::new();
    let mut operations = Vec::new();

    for obj in project.objects.iter().filter(|o| o.visible) {
        match obj.layer_id {
            None => warnings.push(format!(
                "'{}' is not assigned to a layer and will not be run.",
                obj.name
            )),
            Some(id) if project.find_layer(id).is_none() => warnings.push(format!(
                "'{}' references a layer that no longer exists and will not be run.",
                obj.name
            )),
            _ => {}
        }
    }

    for layer in project.layers.iter().filter(|l| l.enabled) {
        let wants_image = layer.kind == LayerKind::Image;
        let mut object_ids = Vec::new();
        for obj in project
            .objects
            .iter()
            .filter(|o| o.visible && o.layer_id == Some(layer.id))
        {
            let is_image = matches!(obj.kind, ObjectKind::Image(_));
            if is_image == wants_image {
                object_ids.push(obj.id);
            } else if is_image {
                warnings.push(format!(
                    "Image '{}' is on the vector layer '{}' and will not be run. Move it to an Image layer.",
                    obj.name, layer.name
                ));
            } else {
                warnings.push(format!(
                    "Vector '{}' is on the Image layer '{}' and will not be run. Move it to a Cut, Score or Fill layer.",
                    obj.name, layer.name
                ));
            }
        }
        if object_ids.is_empty() {
            continue;
        }

        let layer_id = layer.id;
        operations.push(match layer.kind {
            LayerKind::Cut => LaserOperation::Cut {
                layer_id,
                object_ids,
                params: CutOperation {
                    kerf_mm: layer.kerf_mm,
                    cut_order: CutOrderStrategy::InsideFirst,
                },
            },
            LayerKind::Score => LaserOperation::Score {
                layer_id,
                object_ids,
                params: ScoreOperation {
                    cut_order: CutOrderStrategy::InsideFirst,
                },
            },
            LayerKind::Fill => LaserOperation::Fill {
                layer_id,
                object_ids,
                params: FillOperation {
                    pattern: if layer.cross_hatch {
                        FillPattern::CrossHatch
                    } else {
                        FillPattern::Lines
                    },
                    angle_deg: layer.fill_angle_deg,
                    line_spacing_mm: layer.line_spacing_mm,
                },
            },
            LayerKind::Image => LaserOperation::Raster {
                layer_id,
                object_ids,
                params: layer.raster.clone(),
            },
        });
    }

    operations.sort_by_key(|op| {
        let z = project
            .find_layer(op.layer_id())
            .map(|l| l.z_order)
            .unwrap_or(0);
        (op.execution_priority(), z)
    });

    PlanResult {
        operations,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use makerlaser_common::{
        ImageData, ImageFormat, MachineProfile, Path2D, Point2, WorkspaceObject,
    };
    use uuid::Uuid;

    fn square() -> Path2D {
        Path2D::new(
            vec![
                Point2::new(0.0, 0.0),
                Point2::new(10.0, 0.0),
                Point2::new(10.0, 10.0),
                Point2::new(0.0, 10.0),
            ],
            true,
        )
    }

    fn project() -> ProjectFile {
        ProjectFile::new("T", MachineProfile::tts55_pro())
    }

    fn layer_of(p: &ProjectFile, kind: LayerKind) -> Uuid {
        p.layers.iter().find(|l| l.kind == kind).unwrap().id
    }

    fn vector_on(p: &mut ProjectFile, kind: LayerKind) {
        let mut o = WorkspaceObject::new_vector("v", vec![square()], 0);
        o.layer_id = Some(layer_of(p, kind));
        p.objects.push(o);
    }

    fn image_on(p: &mut ProjectFile, kind: LayerKind) {
        let img = ImageData {
            asset_id: Uuid::new_v4(),
            format: ImageFormat::Png,
            source_path: None,
            width_px: 10,
            height_px: 10,
            dpi: 96.0,
        };
        let mut o = WorkspaceObject::new_image("img", img, 1);
        o.layer_id = Some(layer_of(p, kind));
        p.objects.push(o);
    }

    #[test]
    fn engraving_is_scheduled_before_cutting() {
        let mut p = project();
        vector_on(&mut p, LayerKind::Cut);
        image_on(&mut p, LayerKind::Image);
        let plan = plan_operations(&p);
        assert_eq!(plan.operations.len(), 2);
        assert!(matches!(plan.operations[0], LaserOperation::Raster { .. }));
        assert!(matches!(plan.operations[1], LaserOperation::Cut { .. }));
    }

    #[test]
    fn disabled_and_empty_layers_produce_nothing() {
        let mut p = project();
        vector_on(&mut p, LayerKind::Cut);
        for l in &mut p.layers {
            l.enabled = false;
        }
        assert!(plan_operations(&p).operations.is_empty());
        assert!(plan_operations(&project()).operations.is_empty());
    }

    #[test]
    fn unassigned_objects_are_reported() {
        let mut p = project();
        p.objects
            .push(WorkspaceObject::new_vector("loose", vec![square()], 0));
        let plan = plan_operations(&p);
        assert!(plan.operations.is_empty());
        assert!(plan.warnings.iter().any(|w| w.contains("loose")));
    }

    #[test]
    fn mismatched_object_and_layer_kinds_are_reported_not_silently_dropped() {
        let mut p = project();
        vector_on(&mut p, LayerKind::Image);
        image_on(&mut p, LayerKind::Cut);
        let plan = plan_operations(&p);
        assert!(plan.operations.is_empty());
        assert_eq!(plan.warnings.len(), 2);
    }

    #[test]
    fn locked_objects_still_run() {
        let mut p = project();
        vector_on(&mut p, LayerKind::Cut);
        p.objects[0].locked = true;
        assert_eq!(plan_operations(&p).operations.len(), 1);
    }

    #[test]
    fn layer_parameters_flow_into_the_operation() {
        let mut p = project();
        vector_on(&mut p, LayerKind::Cut);
        p.layers
            .iter_mut()
            .find(|l| l.kind == LayerKind::Cut)
            .unwrap()
            .kerf_mm = 0.2;
        match &plan_operations(&p).operations[0] {
            LaserOperation::Cut { params, .. } => assert_eq!(params.kerf_mm, 0.2),
            other => panic!("unexpected {other:?}"),
        }
    }
}
