// What node editing does to the project: start and stop it, and each edit as one undo step. The rules are in
// lib/nodeEdit.ts and lib/nodePath.ts and are unit-tested; this file only connects them to the stores.
import { makeCurves, makeStraight, segmentsOfPick, setNodeMode, type HandleSide } from '@/lib/nodeCurves';
import { editableNodes, insertAtWorldPoint, moveHandleWorld, moveSelectedWorld, nodeWorldPosition, planDelete, setNodeWorldPosition, validRefs } from '@/lib/nodeEdit';
import { convertToOutlines, kindWithNodes, nodeAccess, type NodeRef } from '@/lib/nodePath';
import { useEditStore } from '@/state/editStore';
import { useMeasureStore } from '@/state/measureStore';
import { useNodeEditStore } from '@/state/nodeEditStore';
import { useNoticeStore } from '@/state/noticeStore';
import { useProjectStore } from '@/state/projectStore';
import type { NodeMode, NodePath, Point2, WorkspaceObject } from '@/types/domain';

const say = (kind: 'info' | 'warning' | 'error', text: string): void => useNoticeStore.getState().show(kind, text);

/** The one selected object, or undefined when nothing, or more than one thing, is selected. */
export function theOnlySelectedObject(): WorkspaceObject | undefined {
  const { project, selected } = useProjectStore.getState();
  const id = selected.length === 1 ? selected[0] : undefined;
  return id === undefined ? undefined : project?.objects.find((o) => o.id === id);
}

function objectById(id: string): WorkspaceObject | undefined {
  return useProjectStore.getState().project?.objects.find((o) => o.id === id);
}

/** Starts node editing of the object (the one selected when no id is given). Says why, and does nothing, when it cannot. */
export function enterNodeEdit(id?: string): boolean {
  const object = id === undefined ? theOnlySelectedObject() : objectById(id);
  if (!object) {
    say('info', 'Select one outline to edit its nodes.');
    return false;
  }
  const access = editableNodes(object);
  if (!access.ok) {
    say('info', access.message);
    return false;
  }
  useEditStore.getState().setTool(null);
  useEditStore.getState().close();
  useMeasureStore.getState().setTool('select');
  useProjectStore.getState().setSelection([object.id]);
  useNodeEditStore.getState().start(object.id);
  if (access.stale) say('warning', 'This object had nodes that no longer matched its outline, so they were made again as plain corners.');
  return true;
}

export function leaveNodeEdit(): void {
  useNodeEditStore.getState().stop();
}

/** N: starts node editing, or stops it. */
export function toggleNodeEdit(): void {
  if (useNodeEditStore.getState().editingId !== null) leaveNodeEdit();
  else enterNodeEdit();
}

/** The nodes being edited, as the project has them now (made from the outline when there are none yet). Null when not editing. */
export function currentNodes(): { object: WorkspaceObject; nodes: NodePath[] } | null {
  const id = useNodeEditStore.getState().editingId;
  const object = id === null ? undefined : objectById(id);
  if (!object) return null;
  const access = editableNodes(object);
  return access.ok ? { object, nodes: access.nodes } : null;
}

/**
 * Puts new nodes on the object (and, with them, its flattened outlines) as ONE undo step. Edits that share a
 * `coalesceKey` and come within a second of each other are one step (typing a position, holding an arrow key).
 * Nothing is done, and no undo step is made, when the nodes are the ones it has already.
 */
export function commitNodes(id: string, nodes: readonly NodePath[], coalesceKey?: string): boolean {
  const object = objectById(id);
  if (!object || object.kind.type !== 'vector' || object.kind.source) return false;
  const before = editableNodes(object);
  if (before.ok && before.nodes === nodes) return false;
  useProjectStore.getState().mutate((p) => {
    const o = p.objects.find((x) => x.id === id);
    if (o && o.kind.type === 'vector') o.kind = kindWithNodes(o.kind, nodes);
  }, coalesceKey);
  return true;
}

/** The picked nodes of the object being edited, the ones that are still there. */
export function pickedNodes(): NodeRef[] {
  const here = currentNodes();
  return here ? validRefs(here.nodes, useNodeEditStore.getState().selection) : [];
}

/** Moves the picked nodes by a step in world millimetres (the arrow keys). */
export function nudgePickedNodes(dx: number, dy: number): void {
  const here = currentNodes();
  if (!here) return;
  const picked = validRefs(here.nodes, useNodeEditStore.getState().selection);
  if (picked.length === 0) return;
  commitNodes(here.object.id, moveSelectedWorld(here.nodes, picked, here.object.transform, dx, dy), `nodes-nudge-${here.object.id}`);
}

/** Moves nodes by the amount a drag went (world millimetres): one undo step for the whole drag. */
export function moveNodesByDrag(refs: readonly NodeRef[], dx: number, dy: number): void {
  const here = currentNodes();
  if (!here) return;
  commitNodes(here.object.id, moveSelectedWorld(here.nodes, validRefs(here.nodes, refs), here.object.transform, dx, dy));
}

/** Delete: takes the picked nodes out, and says what happened. */
export function deletePickedNodes(): void {
  const here = currentNodes();
  if (!here) return;
  const plan = planDelete(here.nodes, useNodeEditStore.getState().selection);
  if (!plan.nodes) {
    say('info', plan.message);
    return;
  }
  commitNodes(here.object.id, plan.nodes);
  useNodeEditStore.getState().setSelection([]);
  say('info', plan.message);
}

/** Moves one handle by the amount a drag went (world millimetres): one undo step for the whole drag. */
export function moveHandleByDrag(ref: NodeRef, side: HandleSide, dx: number, dy: number): void {
  const here = currentNodes();
  if (!here) return;
  commitNodes(here.object.id, moveHandleWorld(here.nodes, ref, side, here.object.transform, dx, dy));
}

/** Corner, Smooth or Symmetric for the picked nodes. Smooth and Symmetric make handles where there are none. */
export function setPickedMode(mode: NodeMode): void {
  const here = currentNodes();
  if (!here) return;
  const picked = validRefs(here.nodes, useNodeEditStore.getState().selection);
  if (picked.length === 0) {
    say('info', 'Pick a node first.');
    return;
  }
  const next = setNodeMode(here.nodes, picked, mode);
  if (next === here.nodes) {
    say('info', `${picked.length === 1 ? 'That node is' : 'Those nodes are'} already ${mode}.`);
    return;
  }
  commitNodes(here.object.id, next);
}

const NOTHING_TO_BEND = 'Pick two neighbouring nodes, or one node, to bend the line or lines between them.';

/** Curve: turns the straight lines between the picked nodes (or either side of one picked node) into curves you can shape with their handles. */
export function curvePicked(): void {
  const here = currentNodes();
  if (!here) return;
  const picked = validRefs(here.nodes, useNodeEditStore.getState().selection);
  const { segments, lines } = segmentsOfPick(here.nodes, picked);
  if (segments.length === 0) {
    say('info', NOTHING_TO_BEND);
    return;
  }
  if (lines === 0) {
    say('info', 'Those are curves already. Drag their handles to shape them.');
    return;
  }
  commitNodes(here.object.id, makeCurves(here.nodes, segments));
  say('info', `Made ${lines} ${lines === 1 ? 'line a curve' : 'lines curves'}. Drag the handles to shape ${lines === 1 ? 'it' : 'them'}.`);
}

/** Straight: turns the curves between the picked nodes back into straight lines. */
export function straightenPicked(): void {
  const here = currentNodes();
  if (!here) return;
  const picked = validRefs(here.nodes, useNodeEditStore.getState().selection);
  const { segments, curves } = segmentsOfPick(here.nodes, picked);
  if (segments.length === 0) {
    say('info', NOTHING_TO_BEND);
    return;
  }
  if (curves === 0) {
    say('info', 'Those are straight lines already.');
    return;
  }
  commitNodes(here.object.id, makeStraight(here.nodes, segments));
}

/** Esc: clears the pick, and stops node editing when nothing was picked. */
export function escapeNodeEdit(): void {
  if (useNodeEditStore.getState().selection.length > 0) useNodeEditStore.getState().setSelection([]);
  else leaveNodeEdit();
}

/** A double-click at a world position: puts a node on the line there and picks it. */
export function addNodeAt(p: Point2, nodeTolMm: number, segmentTolMm: number): boolean {
  const here = currentNodes();
  if (!here) return false;
  const r = insertAtWorldPoint(here.nodes, here.object.transform, p, nodeTolMm, segmentTolMm);
  if (!r) return false;
  commitNodes(here.object.id, r.nodes);
  useNodeEditStore.getState().setSelection([r.ref]);
  return true;
}

/** The X and Y boxes: puts the one picked node at a position in world millimetres. */
export function setPickedNodePosition(x: number, y: number): void {
  const here = currentNodes();
  if (!here) return;
  const picked = validRefs(here.nodes, useNodeEditStore.getState().selection);
  const only = picked[0];
  if (picked.length !== 1 || !only) return;
  commitNodes(here.object.id, setNodeWorldPosition(here.nodes, only, here.object.transform, x, y), `nodes-xy-${here.object.id}`);
}

/** Where the one picked node is, in world millimetres. */
export function pickedNodePosition(): Point2 | null {
  const here = currentNodes();
  if (!here) return null;
  const picked = validRefs(here.nodes, useNodeEditStore.getState().selection);
  const only = picked[0];
  return picked.length === 1 && only ? nodeWorldPosition(here.nodes, only, here.object.transform) : null;
}

/**
 * Convert to outlines: text or a shape becomes an ordinary outline with nodes (its recipe is dropped, the outline stays
 * exactly as it is) as ONE undo step, and node editing starts on it.
 */
export function convertAndEdit(id: string): boolean {
  const object = objectById(id);
  if (!object || object.kind.type !== 'vector') return false;
  if (object.locked) {
    say('info', 'This object is locked. Unlock it to convert it.');
    return false;
  }
  if (!object.kind.source) return enterNodeEdit(id);
  const converted = convertToOutlines(object.kind);
  if (!nodeAccess(converted).ok) {
    say('info', 'There is nothing in this object to convert.');
    return false;
  }
  useProjectStore.getState().mutate((p) => {
    const o = p.objects.find((x) => x.id === id);
    if (o && o.kind.type === 'vector') o.kind = convertToOutlines(o.kind);
  });
  useEditStore.getState().close();
  return enterNodeEdit(id);
}
