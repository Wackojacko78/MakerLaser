//! The editable nodes of a vector outline (node editing, see docs/project-format.md).
//!
//! An object may carry `nodes` next to its `paths`: the editable form of the same outlines. `paths` stays
//! the straight-segment form that the planner, the preview and the shape tools read, and when `nodes` is
//! present it is always the flattened form of it. This crate only holds the data; everything that edits
//! or flattens nodes is in the user interface (apps/desktop-ui/src/lib/nodePath.ts), and nothing in CAM
//! reads them, so they cannot change what the laser does.
//!
//! A segment from one node to the next is straight unless the first node has an `out` handle or the second
//! has an `in` handle; then it is a cubic Bezier whose control points are the node plus its handle, with a
//! missing handle counting as zero. Handles are offsets from their node, in millimetres, so they travel
//! with it.
use serde::{Deserialize, Serialize};

/// How the two handles of a node are tied together when one of them is dragged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeMode {
    /// The handles are free. This is the usual mode, and it is left out of the file.
    #[default]
    Corner,
    /// The handles lie on one line, with lengths of their own.
    Smooth,
    /// The handles lie on one line and are the same length.
    Symmetric,
}

impl NodeMode {
    /// For `skip_serializing_if`: a corner is the default and is not written.
    fn is_corner(&self) -> bool {
        *self == NodeMode::Corner
    }
}

/// A Bezier handle, as an offset from its node.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Handle {
    pub x: f64,
    pub y: f64,
}

/// One editable point of an outline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PathNode {
    pub x: f64,
    pub y: f64,
    /// The handle on the side of the previous node. None: no handle.
    #[serde(rename = "in", default, skip_serializing_if = "Option::is_none")]
    pub in_handle: Option<Handle>,
    /// The handle on the side of the next node. None: no handle.
    #[serde(rename = "out", default, skip_serializing_if = "Option::is_none")]
    pub out_handle: Option<Handle>,
    #[serde(default, skip_serializing_if = "NodeMode::is_corner")]
    pub mode: NodeMode,
}

impl PathNode {
    /// A plain corner at this position, with no handles.
    pub fn corner(x: f64, y: f64) -> Self {
        PathNode {
            x,
            y,
            in_handle: None,
            out_handle: None,
            mode: NodeMode::Corner,
        }
    }
}

/// The nodes of one outline. `closed` is the same flag as the outline in `paths` that these nodes belong to
/// (the outlines and the node lists are in the same order).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NodePath {
    pub closed: bool,
    pub nodes: Vec<PathNode>,
}

impl NodePath {
    /// True when no node has a handle, so every segment is a straight line.
    pub fn is_straight(&self) -> bool {
        self.nodes
            .iter()
            .all(|n| n.in_handle.is_none() && n.out_handle.is_none())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_corner_is_written_as_just_its_position() {
        let json = serde_json::to_string(&PathNode::corner(1.5, -2.0)).unwrap();
        assert_eq!(json, r#"{"x":1.5,"y":-2.0}"#);
    }

    #[test]
    fn handles_and_modes_use_the_names_the_frontend_expects() {
        let node = PathNode {
            x: 1.0,
            y: 2.0,
            in_handle: Some(Handle { x: -1.0, y: 0.5 }),
            out_handle: Some(Handle { x: 1.0, y: -0.5 }),
            mode: NodeMode::Symmetric,
        };
        let json = serde_json::to_string(&node).unwrap();
        assert_eq!(
            json,
            r#"{"x":1.0,"y":2.0,"in":{"x":-1.0,"y":0.5},"out":{"x":1.0,"y":-0.5},"mode":"symmetric"}"#
        );
        assert_eq!(serde_json::from_str::<PathNode>(&json).unwrap(), node);
        for (mode, name) in [
            (NodeMode::Corner, "corner"),
            (NodeMode::Smooth, "smooth"),
            (NodeMode::Symmetric, "symmetric"),
        ] {
            assert_eq!(serde_json::to_string(&mode).unwrap(), format!("\"{name}\""));
        }
    }

    #[test]
    fn a_node_with_only_a_position_loads_as_a_corner_with_no_handles() {
        let node: PathNode = serde_json::from_str(r#"{"x":3,"y":4}"#).unwrap();
        assert_eq!(node, PathNode::corner(3.0, 4.0));
        assert_eq!(node.mode, NodeMode::Corner);
    }

    #[test]
    fn a_path_is_straight_only_when_no_node_has_a_handle() {
        let mut path = NodePath {
            closed: true,
            nodes: vec![
                PathNode::corner(0.0, 0.0),
                PathNode::corner(10.0, 0.0),
                PathNode::corner(10.0, 10.0),
            ],
        };
        assert!(path.is_straight());
        path.nodes[1].out_handle = Some(Handle { x: 2.0, y: 0.0 });
        assert!(!path.is_straight());
        path.nodes[1].out_handle = None;
        path.nodes[2].in_handle = Some(Handle { x: 0.0, y: -2.0 });
        assert!(!path.is_straight());
    }

    #[test]
    fn a_node_path_survives_a_round_trip() {
        let path = NodePath {
            closed: false,
            nodes: vec![
                PathNode {
                    out_handle: Some(Handle { x: 0.0, y: 5.5 }),
                    ..PathNode::corner(20.0, 0.0)
                },
                PathNode {
                    in_handle: Some(Handle { x: 5.5, y: 0.0 }),
                    mode: NodeMode::Smooth,
                    ..PathNode::corner(0.0, 20.0)
                },
            ],
        };
        let json = serde_json::to_string(&path).unwrap();
        assert_eq!(serde_json::from_str::<NodePath>(&json).unwrap(), path);
    }
}
