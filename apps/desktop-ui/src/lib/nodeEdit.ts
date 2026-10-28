// Node editing, stage 1b: the rules that sit between the mouse and keyboard and the node model in lib/nodePath.ts.
// Pure TypeScript (no React, Konva or Tauri imports), so it is unit-tested in plain Node (tests/nodeEdit.test.ts).
// The canvas (canvas/NodeOverlay.tsx), the keys (canvas/useNodeEdit.ts) and the panel (components/NodesPanel.tsx) only
// feed it positions and keys and show what it answers.
//
// Nodes are stored in the object's own (local) millimetres, but the user works in the workspace (world) millimetres, so
// everything that comes from the pointer is turned into world millimetres first and the object's transform is undone
// before a node is changed. A Bezier curve keeps its shape under any affine transform, so the position along a segment
// (t) found in world space is the same t in local space.
import { moveHandle, type HandleSide } from '@/lib/nodeCurves';
import {
  deleteNodes,
  insertNode,
  moveNodes,
  nearestSegment,
  nodeAccess,
  nodeAccessMessage,
  nodeAt,
  nodesInBox,
  refKey,
  segmentCount,
  setNodePosition,
  type NodeRef,
} from '@/lib/nodePath';
import { applyToPoint } from '@/lib/transform';
import type { NodePath, ObjectKind, Point2, Transform2D, WorkspaceObject } from '@/types/domain';

/** How close (in screen pixels) the pointer has to be to a node, and to a line to add a node on it. */
export const NODE_HIT_PX = 8;
export const SEGMENT_HIT_PX = 6;
/** A press that moves less than this many screen pixels is a click, not a drag. */
export const DRAG_START_PX = 3;
/** Above this many nodes only the selected ones are drawn on the canvas (the rest can still be picked). */
export const MAX_DRAWN_NODES = 5_000;
/** The handles of at most this many picked nodes are drawn and can be grabbed. */
export const MAX_HANDLE_NODES = 300;

// ---- the transform ----------------------------------------------------------------------------------

/** The transform that undoes `t`, or null when it flattens the object (it cannot be undone). */
export function invertTransform(t: Transform2D): Transform2D | null {
  const det = t.a * t.d - t.b * t.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = t.d / det;
  const b = -t.b / det;
  const c = -t.c / det;
  const d = t.a / det;
  return { a, b, c, d, e: -(a * t.e + c * t.f), f: -(b * t.e + d * t.f) };
}

/** The nodes in world millimetres: positions through the whole transform, handles through its linear part (they are offsets). */
export function toWorldNodes(nodes: readonly NodePath[], t: Transform2D): NodePath[] {
  const handle = (h: { x: number; y: number } | undefined) => (h ? { x: t.a * h.x + t.c * h.y, y: t.b * h.x + t.d * h.y } : undefined);
  return nodes.map((np) => ({
    closed: np.closed,
    nodes: np.nodes.map((n) => {
      const p = applyToPoint(t, { x: n.x, y: n.y });
      const into = handle(n.in);
      const away = handle(n.out);
      return { x: p.x, y: p.y, ...(into ? { in: into } : {}), ...(away ? { out: away } : {}), ...(n.mode ? { mode: n.mode } : {}) };
    }),
  }));
}

/** A step in world millimetres as a step in the object's own millimetres, or null when the transform cannot be undone. */
export function worldStepToLocal(t: Transform2D, dx: number, dy: number): Point2 | null {
  const det = t.a * t.d - t.b * t.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return { x: (t.d * dx - t.c * dy) / det, y: (-t.b * dx + t.a * dy) / det };
}

/** Moves the chosen nodes by a step in world millimetres. The same list comes back when there is nothing to do. */
export function moveSelectedWorld(nodes: readonly NodePath[], refs: readonly NodeRef[], t: Transform2D, dx: number, dy: number): readonly NodePath[] {
  const step = worldStepToLocal(t, dx, dy);
  return step ? moveNodes(nodes, refs, step.x, step.y) : nodes;
}

/** Puts one node at a position in world millimetres (the X and Y boxes). */
export function setNodeWorldPosition(nodes: readonly NodePath[], ref: NodeRef, t: Transform2D, x: number, y: number): readonly NodePath[] {
  const inverse = invertTransform(t);
  if (!inverse) return nodes;
  const local = applyToPoint(inverse, { x, y });
  return setNodePosition(nodes, ref, local.x, local.y);
}

/** Where a node is in world millimetres, or null when it is not there. */
export function nodeWorldPosition(nodes: readonly NodePath[], ref: NodeRef, t: Transform2D): Point2 | null {
  const n = nodes[ref.path]?.nodes[ref.node];
  return n ? applyToPoint(t, { x: n.x, y: n.y }) : null;
}

// ---- the pointer ------------------------------------------------------------------------------------

/** A pointer position on the stage (screen pixels) as world millimetres, given the pan and zoom and the canvas pixels per millimetre. */
export function pointerToWorldMm(pointer: Point2, view: { x: number; y: number; scale: number }, pxPerMm: number): Point2 {
  return { x: (pointer.x - view.x) / view.scale / pxPerMm, y: (pointer.y - view.y) / view.scale / pxPerMm };
}

/** A distance in screen pixels as millimetres at this zoom. */
export const pxToMm = (px: number, scale: number, pxPerMm: number): number => px / (scale * pxPerMm);

// ---- the selection ----------------------------------------------------------------------------------

/** The references that point at a node that is there, each once, in outline then node order. */
export function validRefs(nodes: readonly NodePath[], refs: readonly NodeRef[]): NodeRef[] {
  const seen = new Set<string>();
  const kept: NodeRef[] = [];
  for (const r of refs) {
    if (!nodes[r.path]?.nodes[r.node] || seen.has(refKey(r))) continue;
    seen.add(refKey(r));
    kept.push(r);
  }
  return kept.sort((a, b) => a.path - b.path || a.node - b.node);
}

/** The selection with this node added, or taken out when it is in it already. */
export function toggleRef(refs: readonly NodeRef[], ref: NodeRef): NodeRef[] {
  const key = refKey(ref);
  return refs.some((r) => refKey(r) === key) ? refs.filter((r) => refKey(r) !== key) : [...refs, ref];
}

export function unionRefs(a: readonly NodeRef[], b: readonly NodeRef[]): NodeRef[] {
  const seen = new Set(a.map(refKey));
  return [...a, ...b.filter((r) => !seen.has(refKey(r)))];
}

export const isSelected = (refs: readonly NodeRef[], ref: NodeRef): boolean => refs.some((r) => r.path === ref.path && r.node === ref.node);

// ---- one gesture: press, move, release ------------------------------------------------------------------

export type NodeGesture =
  /** Dragging nodes: where the press was (world mm), which nodes, and whether it has moved far enough to count. */
  | { kind: 'drag'; start: Point2; refs: NodeRef[]; moved: boolean }
  /** Dragging a box on empty canvas to pick nodes. `base` is what was selected before an additive box. */
  | { kind: 'band'; start: Point2; current: Point2; additive: boolean; base: NodeRef[] }
  /** Dragging one handle of a node. */
  | { kind: 'handle'; start: Point2; ref: NodeRef; side: HandleSide; moved: boolean };

export interface PressResult {
  selection: NodeRef[];
  gesture: NodeGesture | null;
}

/**
 * A press on the canvas. On a node it picks it (Shift or Ctrl adds it or takes it out) and starts dragging whatever is
 * picked; a node that is already picked keeps the whole pick, so several can be dragged together. Anywhere else it
 * starts a box, and clears the pick unless it is additive.
 */
export function pressAt(
  worldNodes: readonly NodePath[],
  selection: readonly NodeRef[],
  p: Point2,
  tolMm: number,
  additive: boolean,
): PressResult {
  const hit = nodeAt(worldNodes, p.x, p.y, tolMm);
  if (hit) {
    if (additive) {
      const next = toggleRef(selection, hit);
      return { selection: next, gesture: isSelected(next, hit) ? { kind: 'drag', start: p, refs: next, moved: false } : null };
    }
    const next = isSelected(selection, hit) ? [...selection] : [hit];
    return { selection: next, gesture: { kind: 'drag', start: p, refs: next, moved: false } };
  }
  const base = additive ? [...selection] : [];
  return { selection: base, gesture: { kind: 'band', start: p, current: p, additive, base } };
}

/** The gesture after the pointer has moved to `p`. A drag counts once it has gone `thresholdMm`. */
export function moveGesture(g: NodeGesture, p: Point2, thresholdMm: number): NodeGesture {
  if (g.kind === 'band') return { ...g, current: p };
  return g.moved ? g : { ...g, moved: Math.hypot(p.x - g.start.x, p.y - g.start.y) >= thresholdMm };
}

// ---- handles ----------------------------------------------------------------------------------------------------

/** One visible handle: which node and side, where its node is and where its tip is (world mm). */
export interface HandleTip {
  ref: NodeRef;
  side: HandleSide;
  nodeX: number;
  nodeY: number;
  x: number;
  y: number;
}

/** The handles of the picked nodes that reach somewhere, in world millimetres (the nodes must already be in world millimetres). */
export function handleTips(world: readonly NodePath[], picked: readonly NodeRef[], limit: number = MAX_HANDLE_NODES): HandleTip[] {
  const tips: HandleTip[] = [];
  for (const ref of picked.slice(0, limit)) {
    const n = world[ref.path]?.nodes[ref.node];
    if (!n) continue;
    for (const side of ['in', 'out'] as const) {
      const h = side === 'in' ? n.in : n.out;
      if (h && Math.hypot(h.x, h.y) > 1e-9) tips.push({ ref, side, nodeX: n.x, nodeY: n.y, x: n.x + h.x, y: n.y + h.y });
    }
  }
  return tips;
}

/** The handle tip nearest the point, if one is within `tolMm`. */
export function handleAt(world: readonly NodePath[], picked: readonly NodeRef[], p: Point2, tolMm: number): (HandleTip & { distance: number }) | null {
  let best: (HandleTip & { distance: number }) | null = null;
  for (const tip of handleTips(world, picked)) {
    const distance = Math.hypot(tip.x - p.x, tip.y - p.y);
    if (distance <= tolMm && (!best || distance < best.distance)) best = { ...tip, distance };
  }
  return best;
}

/**
 * A press on the canvas, with the handles of the picked nodes taken into account: a handle that is nearer than any node starts
 * dragging that handle, and anything else is a press as `pressAt` handles it. Shift and Ctrl never grab a handle, so they can
 * still add a node that lies under one.
 */
export function pressOnCanvas(
  worldNodes: readonly NodePath[],
  selection: readonly NodeRef[],
  p: Point2,
  tolMm: number,
  additive: boolean,
): PressResult {
  if (!additive) {
    const handle = handleAt(worldNodes, validRefs(worldNodes, selection), p, tolMm);
    if (handle) {
      const node = nodeAt(worldNodes, p.x, p.y, tolMm);
      const n = node ? worldNodes[node.path]?.nodes[node.node] : undefined;
      if (!n || handle.distance < Math.hypot(n.x - p.x, n.y - p.y)) {
        return { selection: [...selection], gesture: { kind: 'handle', start: p, ref: handle.ref, side: handle.side, moved: false } };
      }
    }
  }
  return pressAt(worldNodes, selection, p, tolMm, additive);
}

/** The nodes with one handle moved by a step in world millimetres (the handle follows the pointer as it moves). */
export function moveHandleWorld(local: readonly NodePath[], ref: NodeRef, side: HandleSide, t: Transform2D, dx: number, dy: number): readonly NodePath[] {
  const node = local[ref.path]?.nodes[ref.node];
  const step = worldStepToLocal(t, dx, dy);
  if (!node || !step) return local;
  const h = (side === 'in' ? node.in : node.out) ?? { x: 0, y: 0 };
  return moveHandle(local, ref, side, { x: h.x + step.x, y: h.y + step.y });
}

/** The nodes while a drag is in progress, or null when it is not a drag that has moved. */
export function dragDraft(g: NodeGesture | null, local: readonly NodePath[], t: Transform2D, p: Point2): readonly NodePath[] | null {
  if (!g || g.kind === 'band' || !g.moved) return null;
  if (g.kind === 'handle') return moveHandleWorld(local, g.ref, g.side, t, p.x - g.start.x, p.y - g.start.y);
  return moveSelectedWorld(local, g.refs, t, p.x - g.start.x, p.y - g.start.y);
}

export interface ReleaseResult {
  selection: NodeRef[];
  /** Move the dragged nodes by this much (world mm) as one undo step. Null when nothing is to be moved. */
  move: { dx: number; dy: number; refs: NodeRef[] } | null;
  /** Move one handle by this much (world mm) as one undo step. Null when no handle was dragged. */
  handle: { ref: NodeRef; side: HandleSide; dx: number; dy: number } | null;
}

/** The pointer is let go at `p`: a drag that moved is committed; a box picks the nodes inside it. */
export function releaseAt(
  g: NodeGesture | null,
  worldNodes: readonly NodePath[],
  selection: readonly NodeRef[],
  p: Point2,
  thresholdMm: number,
): ReleaseResult {
  if (!g) return { selection: [...selection], move: null, handle: null };
  if (g.kind === 'handle') {
    return { selection: [...selection], move: null, handle: g.moved ? { ref: g.ref, side: g.side, dx: p.x - g.start.x, dy: p.y - g.start.y } : null };
  }
  if (g.kind === 'drag') {
    return g.moved
      ? { selection: [...selection], move: { dx: p.x - g.start.x, dy: p.y - g.start.y, refs: g.refs }, handle: null }
      : { selection: [...selection], move: null, handle: null };
  }
  const wide = Math.abs(p.x - g.start.x) >= thresholdMm || Math.abs(p.y - g.start.y) >= thresholdMm;
  if (!wide) return { selection: [...selection], move: null, handle: null };
  const box = {
    minX: Math.min(g.start.x, p.x),
    maxX: Math.max(g.start.x, p.x),
    minY: Math.min(g.start.y, p.y),
    maxY: Math.max(g.start.y, p.y),
  };
  const inside = nodesInBox(worldNodes, box);
  return { selection: g.additive ? unionRefs(g.base, inside) : inside, move: null, handle: null };
}

/** The box a band gesture is drawing, or null for anything else. */
export function bandBox(g: NodeGesture | null): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!g || g.kind !== 'band') return null;
  return { minX: Math.min(g.start.x, g.current.x), maxX: Math.max(g.start.x, g.current.x), minY: Math.min(g.start.y, g.current.y), maxY: Math.max(g.start.y, g.current.y) };
}

/** A double-click at `p`: puts a node on the line there. Null when there is no line within reach, or a node is (it would sit on top of it). */
export function insertAtWorldPoint(
  local: readonly NodePath[],
  t: Transform2D,
  p: Point2,
  nodeTolMm: number,
  segmentTolMm: number,
): { nodes: NodePath[]; ref: NodeRef } | null {
  const world = toWorldNodes(local, t);
  if (nodeAt(world, p.x, p.y, nodeTolMm)) return null;
  const hit = nearestSegment(world, p.x, p.y, segmentTolMm);
  return hit ? insertNode(local, { path: hit.path, segment: hit.segment }, hit.t) : null;
}

// ---- who can be edited, and when node editing has to stop ---------------------------------------------------------

export type EditableNodes =
  | { ok: true; nodes: NodePath[]; stale: boolean }
  | { ok: false; message: string };

/**
 * What nodeAccess said about each kind. A kind is never edited in place (see cloneProject in state/projectStore.ts), so the
 * answer for a kind never goes stale, and asking twice gives the very same node list: an edit that changes nothing can be
 * told from one that does by comparing the lists, and a big outline is not read again for every mouse move.
 */
const accessCache = new WeakMap<object, ReturnType<typeof nodeAccess>>();

/** The nodes of an object for editing, or what to tell the user. A locked object is refused first. */
export function editableNodes(object: Pick<WorkspaceObject, 'locked' | 'kind'>): EditableNodes {
  if (object.locked) return { ok: false, message: 'This object is locked. Unlock it to edit its nodes.' };
  let access = accessCache.get(object.kind);
  if (!access) {
    access = nodeAccess(object.kind as ObjectKind);
    accessCache.set(object.kind, access);
  }
  if (!access.ok) return { ok: false, message: nodeAccessMessage(access.reason) };
  return { ok: true, nodes: access.nodes, stale: access.stale };
}

export interface GuardInput {
  /** The object being edited as nodes, or null when none is. */
  editingId: string | null;
  /** That object as it is in the project now, or undefined when it is gone. */
  object: Pick<WorkspaceObject, 'id' | 'locked' | 'kind'> | undefined;
  selected: readonly string[];
  drawToolPicked: boolean;
  measureToolPicked: boolean;
}

/**
 * What node editing has to do about the state of the program. It stops when the object is gone, is locked, has become text
 * or a shape again, or cannot be edited; when another object is selected; and when a drawing tool or Measure is picked.
 * When the selection is empty (what Undo and Redo leave) it picks the object again so editing carries on.
 */
export function guardNodeMode(g: GuardInput): 'none' | 'leave' | 'reselect' {
  if (g.editingId === null) return 'none';
  if (!g.object || g.object.id !== g.editingId) return 'leave';
  if (g.drawToolPicked || g.measureToolPicked) return 'leave';
  if (!editableNodes(g.object).ok) return 'leave';
  if (g.selected.length === 0) return 'reselect';
  if (g.selected.length !== 1 || g.selected[0] !== g.editingId) return 'leave';
  return 'none';
}

// ---- deleting ----------------------------------------------------------------------------------------------------

export interface DeletePlan {
  nodes: NodePath[] | null;
  /** What to say under the buttons or in a notice. */
  message: string;
}

/** Takes the picked nodes out. Refuses (nodes is null) when nothing is picked or when nothing at all would be left. */
export function planDelete(nodes: readonly NodePath[], refs: readonly NodeRef[]): DeletePlan {
  const picked = validRefs(nodes, refs);
  if (picked.length === 0) return { nodes: null, message: 'Pick a node first, then press Delete.' };
  const r = deleteNodes(nodes, picked);
  if (r.nodes.length === 0) {
    return { nodes: null, message: 'That would leave nothing of this object. Leave node editing and delete the object instead.' };
  }
  const parts = [`Deleted ${r.removed} ${r.removed === 1 ? 'node' : 'nodes'}.`];
  if (r.opened > 0) parts.push(`${r.opened === 1 ? 'A closed outline' : `${r.opened} closed outlines`} left with two nodes became an open line.`);
  if (r.gone > 0) parts.push(`${r.gone === 1 ? 'An outline' : `${r.gone} outlines`} with too few nodes left ${r.gone === 1 ? 'was' : 'were'} removed.`);
  return { nodes: r.nodes, message: parts.join(' ') };
}

/** "12 nodes. 3 picked." for the panel. */
export function nodeSummary(nodes: readonly NodePath[], picked: number): string {
  const total = nodes.reduce((n, p) => n + p.nodes.length, 0);
  const outlines = nodes.length;
  const base = `${total.toLocaleString('en-NZ')} ${total === 1 ? 'node' : 'nodes'} on ${outlines} ${outlines === 1 ? 'outline' : 'outlines'}.`;
  return picked > 0 ? `${base} ${picked} picked.` : base;
}

/** True when an outline has a segment (a node alone has none). */
export const hasSegments = (nodes: readonly NodePath[]): boolean => nodes.some((p) => segmentCount(p) > 0);

// ---- keys ---------------------------------------------------------------------------------------------------------

export interface NodeKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
  isComposing: boolean;
}

export type NodeKeyAction =
  | { type: 'toggle' }
  | { type: 'escape' }
  | { type: 'leave' }
  | { type: 'delete' }
  | { type: 'nudge'; dx: number; dy: number };

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * What a key press does for node editing, or null to leave it alone. N starts or stops node editing; while editing, Esc
 * clears the pick and then stops, V stops, Delete (or Backspace) deletes the picked nodes and the arrow keys nudge them by
 * 1 mm (10 mm with Shift). Nothing happens while typing in a box or with a dialog open; Ctrl, Alt and the Windows key are
 * other shortcuts; and Delete does not repeat when it is held down (that would take out one node after another).
 */
export function nodeKeyAction(
  e: NodeKeyEvent,
  target: { tag: string; contentEditable: boolean } | null,
  modalOpen: boolean,
  editing: boolean,
): NodeKeyAction | null {
  if (modalOpen || e.isComposing) return null;
  if (target && (TYPING.has(target.tag.toUpperCase()) || target.contentEditable)) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === 'n' && !e.shiftKey) return e.repeat ? null : { type: 'toggle' };
  if (!editing) return null;
  if (e.key === 'Escape' && !e.shiftKey) return e.repeat ? null : { type: 'escape' };
  if (key === 'v' && !e.shiftKey) return e.repeat ? null : { type: 'leave' };
  if ((e.key === 'Delete' || e.key === 'Backspace') && !e.shiftKey) return e.repeat ? null : { type: 'delete' };
  if (e.key.startsWith('Arrow')) {
    const step = e.shiftKey ? 10 : 1;
    return {
      type: 'nudge',
      dx: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
      dy: e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
    };
  }
  return null;
}
