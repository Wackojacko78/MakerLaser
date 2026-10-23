import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNodeAt,
  commitNodes,
  convertAndEdit,
  currentNodes,
  deletePickedNodes,
  enterNodeEdit,
  escapeNodeEdit,
  leaveNodeEdit,
  moveNodesByDrag,
  nudgePickedNodes,
  pickedNodePosition,
  pickedNodes,
  setPickedNodePosition,
  toggleNodeEdit,
} from '@/canvas/nodeActions';
import { nodeWorldPosition } from '@/lib/nodeEdit';
import { nodesFromPaths, nodesMatchPaths } from '@/lib/nodePath';
import { compose } from '@/lib/transform';
import { useEditStore } from '@/state/editStore';
import { useMeasureStore } from '@/state/measureStore';
import { useNodeEditStore } from '@/state/nodeEditStore';
import { useNoticeStore } from '@/state/noticeStore';
import { useProjectStore } from '@/state/projectStore';
import type { NodePath, ObjectKind, Path2D, ProjectFile, Transform2D, WorkspaceObject } from '@/types/domain';

// These run the real project store (undo, redo, coalescing, sharing of kinds) with the node-editing actions on top.

const IDENTITY: Transform2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const square = (s = 10): Path2D => ({
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: s, y: 0 },
    { x: s, y: s },
    { x: 0, y: s },
  ],
});
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v as object)) freeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}
const SHAPE_SOURCE = { type: 'shape', shape: 'rectangle', width_mm: 10, height_mm: 10, corner_radius_mm: 0, sides: 5, inner_ratio: 0.5 } as const;
const outline = (id: string, over: Partial<WorkspaceObject> = {}): WorkspaceObject => ({
  id,
  name: id,
  kind: { type: 'vector', paths: [square(10)] },
  transform: IDENTITY,
  layer_id: null,
  visible: true,
  locked: false,
  z_index: 0,
  ...over,
});
function load(objects: WorkspaceObject[], selected: string[] = [objects[0]?.id ?? '']): void {
  const project = {
    schema_version: 1,
    id: 'p',
    name: 'T',
    machine: { bed_width_mm: 300, bed_height_mm: 300 },
    layers: [],
    objects,
    materials: { presets: [] },
    settings: { units: 'mm', grid_spacing_mm: 10, show_grid: true, show_origin: true },
  } as unknown as ProjectFile;
  useProjectStore.getState().loadProject(project, null);
  useProjectStore.getState().setSelection(selected);
}
const project = () => useProjectStore.getState();
const obj = (id = 'a') => project().project?.objects.find((o) => o.id === id) as WorkspaceObject;
const pointsOf = (id = 'a') => (obj(id).kind.type === 'vector' ? (obj(id).kind as { paths: Path2D[] }).paths : []);
const nodesOf = (id = 'a') => (obj(id).kind.type === 'vector' ? (obj(id).kind as { nodes?: unknown[] }).nodes : undefined);
const said = () => useNoticeStore.getState().notice?.text ?? '';
const pick = (...refs: Array<[number, number]>) => useNodeEditStore.getState().setSelection(refs.map(([path, node]) => ({ path, node })));
const undo = () => useProjectStore.getState().undo();

beforeEach(() => {
  leaveNodeEdit();
  useEditStore.getState().setTool(null);
  useEditStore.getState().close();
  useMeasureStore.getState().setTool('select');
  useNoticeStore.getState().dismiss();
  load([outline('a')]);
});

describe('starting and stopping', () => {
  it('starts on the one selected outline, writes nothing, and makes no undo step', () => {
    const before = obj().kind;
    const revision = project().revision;
    expect(enterNodeEdit()).toBe(true);
    expect(useNodeEditStore.getState().editingId).toBe('a');
    expect(project().selected).toEqual(['a']);
    expect(project().past).toHaveLength(0);
    expect(project().revision).toBe(revision);
    expect(obj().kind).toBe(before);
  });
  it('N starts it and stops it', () => {
    toggleNodeEdit();
    expect(useNodeEditStore.getState().editingId).toBe('a');
    toggleNodeEdit();
    expect(useNodeEditStore.getState().editingId).toBeNull();
  });
  it('stops, and forgets what was picked', () => {
    enterNodeEdit();
    pick([0, 1]);
    leaveNodeEdit();
    expect(useNodeEditStore.getState().editingId).toBeNull();
    expect(useNodeEditStore.getState().selection).toEqual([]);
  });
  it('puts down a drawing tool and Measure, and closes the floating editor', () => {
    useEditStore.getState().setTool('rectangle');
    useMeasureStore.getState().setTool('measure');
    useEditStore.getState().open('a');
    enterNodeEdit();
    expect(useEditStore.getState().tool).toBeNull();
    expect(useEditStore.getState().editingId).toBeNull();
    expect(useMeasureStore.getState().tool).toBe('select');
  });
  it('says why, and does nothing, when nothing or too much is selected', () => {
    load([outline('a'), outline('b')], []);
    expect(enterNodeEdit()).toBe(false);
    expect(said()).toContain('Select one outline');
    project().setSelection(['a', 'b']);
    expect(enterNodeEdit()).toBe(false);
    expect(useNodeEditStore.getState().editingId).toBeNull();
  });
  it('says why when the object is text or a shape, a picture or locked', () => {
    load([outline('s', { kind: { type: 'vector', paths: [square(10)], source: SHAPE_SOURCE } })]);
    expect(enterNodeEdit()).toBe(false);
    expect(said()).toContain('Convert to outlines');
    const picture: ObjectKind = { type: 'image', asset_id: 'x', format: 'png', source_path: null, width_px: 1, height_px: 1, dpi: 96 };
    load([outline('i', { kind: picture })]);
    expect(enterNodeEdit()).toBe(false);
    expect(said()).toContain('Trace');
    load([outline('l', { locked: true })]);
    expect(enterNodeEdit()).toBe(false);
    expect(said()).toContain('locked');
  });
  it('tells the user when the nodes it had no longer matched the outline', () => {
    load([outline('a', { kind: { type: 'vector', paths: [square(10)], nodes: [{ closed: true, nodes: [{ x: 1, y: 1 }] }] } })]);
    expect(enterNodeEdit()).toBe(true);
    expect(said()).toContain('no longer matched');
  });
  it('Esc clears the pick first and stops on the second press', () => {
    enterNodeEdit();
    pick([0, 1]);
    escapeNodeEdit();
    expect(useNodeEditStore.getState().editingId).toBe('a');
    expect(useNodeEditStore.getState().selection).toEqual([]);
    escapeNodeEdit();
    expect(useNodeEditStore.getState().editingId).toBeNull();
  });
  it('has no nodes to give when it is not on', () => {
    expect(currentNodes()).toBeNull();
    expect(pickedNodes()).toEqual([]);
    expect(pickedNodePosition()).toBeNull();
  });
});

describe('moving nodes', () => {
  it('a drag is one undo step, and Undo brings back the very same outline', () => {
    const original = obj().kind;
    const originalJson = JSON.stringify(original);
    enterNodeEdit();
    moveNodesByDrag([{ path: 0, node: 2 }], 3, 4);
    expect(project().past).toHaveLength(1);
    expect(pointsOf()[0]?.points[2]).toEqual({ x: 13, y: 14 });
    expect(pointsOf()[0]?.points[0]).toEqual({ x: 0, y: 0 });
    expect(nodesOf()).toHaveLength(1);
    expect(nodesMatchPaths((obj().kind as unknown as { nodes: NodePath[] }).nodes, pointsOf())).toBe(true);
    expect(obj().kind).not.toBe(original);
    expect(JSON.stringify(original)).toBe(originalJson);
    undo();
    expect(obj().kind).toBe(original);
    project().redo();
    expect(pointsOf()[0]?.points[2]).toEqual({ x: 13, y: 14 });
  });
  it('moves several nodes together, and the picked ones only', () => {
    enterNodeEdit();
    moveNodesByDrag([{ path: 0, node: 1 }, { path: 0, node: 2 }], 0, 5);
    const pts = pointsOf()[0]?.points ?? [];
    expect(pts.map((p) => p.y)).toEqual([0, 5, 15, 10]);
  });
  it('a move of nothing is not an undo step', () => {
    enterNodeEdit();
    moveNodesByDrag([{ path: 0, node: 2 }], 0, 0);
    moveNodesByDrag([], 5, 5);
    expect(project().past).toHaveLength(0);
    expect(nodesOf()).toBeUndefined();
  });
  it('moves by world millimetres whatever the object has been done to', () => {
    const t = compose({ x: 50, y: 20, rotationDeg: 30, scaleX: 2, scaleY: 0.5 });
    load([outline('a', { transform: t })]);
    enterNodeEdit();
    const before = nodeWorldPosition(currentNodes()?.nodes ?? [], { path: 0, node: 1 }, t);
    moveNodesByDrag([{ path: 0, node: 1 }], 6, -2);
    const after = nodeWorldPosition(currentNodes()?.nodes ?? [], { path: 0, node: 1 }, obj().transform);
    expect(Math.abs((after?.x ?? 0) - ((before?.x ?? 0) + 6))).toBeLessThan(0.01);
    expect(Math.abs((after?.y ?? 0) - ((before?.y ?? 0) - 2))).toBeLessThan(0.01);
  });
  it('a nudge with an arrow key moves the picked nodes, and a held key is one undo step', () => {
    enterNodeEdit();
    pick([0, 0]);
    nudgePickedNodes(1, 0);
    nudgePickedNodes(1, 0);
    nudgePickedNodes(1, 0);
    expect(project().past).toHaveLength(1);
    expect(pointsOf()[0]?.points[0]).toEqual({ x: 3, y: 0 });
    undo();
    expect(pointsOf()[0]?.points[0]).toEqual({ x: 0, y: 0 });
  });
  it('a nudge with nothing picked does nothing, and does not move the object', () => {
    enterNodeEdit();
    const t = obj().transform;
    nudgePickedNodes(1, 0);
    expect(project().past).toHaveLength(0);
    expect(obj().transform).toEqual(t);
  });
  it('does not write to a frozen outline, so nothing is edited in place', () => {
    load([outline('a', { kind: freeze({ type: 'vector', paths: [square(10)] }) as ObjectKind })]);
    enterNodeEdit();
    pick([0, 1]);
    moveNodesByDrag([{ path: 0, node: 1 }], 1, 1);
    nudgePickedNodes(1, 1);
    deletePickedNodes();
    expect(project().past.length).toBeGreaterThan(0);
  });
  it('refuses to write to text or a shape, or to something that is not there', () => {
    load([outline('a', { kind: { type: 'vector', paths: [square(10)], source: SHAPE_SOURCE } })]);
    expect(commitNodes('a', nodesFromPaths([square(3)]))).toBe(false);
    expect(commitNodes('nobody', nodesFromPaths([square(3)]))).toBe(false);
    expect(project().past).toHaveLength(0);
  });
});

describe('deleting nodes', () => {
  it('takes the picked node out, clears the pick, and says so', () => {
    enterNodeEdit();
    pick([0, 0]);
    deletePickedNodes();
    expect(pointsOf()[0]?.points).toHaveLength(3);
    expect(useNodeEditStore.getState().selection).toEqual([]);
    expect(said()).toBe('Deleted 1 node.');
    expect(project().past).toHaveLength(1);
    undo();
    expect(pointsOf()[0]?.points).toHaveLength(4);
  });
  it('asks for a pick when nothing is picked', () => {
    enterNodeEdit();
    deletePickedNodes();
    expect(said()).toContain('Pick a node');
    expect(project().past).toHaveLength(0);
  });
  it('refuses to leave nothing of the object', () => {
    enterNodeEdit();
    const before = obj().kind;
    pick([0, 0], [0, 1], [0, 2], [0, 3]);
    deletePickedNodes();
    expect(said()).toContain('delete the object');
    expect(obj().kind).toBe(before);
    expect(project().past).toHaveLength(0);
  });
  it('a closed outline left with two nodes becomes an open line', () => {
    load([outline('a', { kind: { type: 'vector', paths: [{ closed: true, points: square(10).points.slice(0, 3) }, square(4)] } })]);
    enterNodeEdit();
    pick([0, 2]);
    deletePickedNodes();
    expect(pointsOf()[0]?.closed).toBe(false);
    expect(said()).toContain('open line');
  });
});

describe('adding a node', () => {
  it('a double-click on a line puts a node there and picks it', () => {
    enterNodeEdit();
    expect(addNodeAt({ x: 5, y: 0.05 }, 0.5, 0.5)).toBe(true);
    expect(pointsOf()[0]?.points).toHaveLength(5);
    expect(pointsOf()[0]?.points[1]).toEqual({ x: 5, y: 0 });
    expect(useNodeEditStore.getState().selection).toEqual([{ path: 0, node: 1 }]);
    expect(project().past).toHaveLength(1);
  });
  it('does nothing away from a line or on a node', () => {
    enterNodeEdit();
    expect(addNodeAt({ x: 5, y: 5 }, 0.5, 0.5)).toBe(false);
    expect(addNodeAt({ x: 0.1, y: 0.1 }, 0.5, 0.5)).toBe(false);
    expect(project().past).toHaveLength(0);
  });
  it('works when the object is moved and stretched', () => {
    const t = compose({ x: 10, y: 20, rotationDeg: 0, scaleX: 3, scaleY: 3 });
    load([outline('a', { transform: t })]);
    enterNodeEdit();
    // the top edge is at world y = 20, from x = 10 to x = 40
    expect(addNodeAt({ x: 25, y: 20.1 }, 0.5, 0.5)).toBe(true);
    expect(pointsOf()[0]?.points[1]?.x).toBeCloseTo(5, 1);
  });
});

describe('the X and Y boxes', () => {
  const t = compose({ x: 10, y: 20, rotationDeg: 0, scaleX: 2, scaleY: 2 });
  beforeEach(() => {
    load([outline('a', { transform: t })]);
    enterNodeEdit();
  });
  it('put the one picked node at a position in world millimetres', () => {
    pick([0, 1]);
    expect(pickedNodePosition()).toEqual({ x: 30, y: 20 });
    setPickedNodePosition(50, 60);
    expect(pickedNodePosition()).toEqual({ x: 50, y: 60 });
    expect(pointsOf()[0]?.points[1]).toEqual({ x: 20, y: 20 });
  });
  it('typing digits one after another is one undo step', () => {
    pick([0, 1]);
    setPickedNodePosition(5, 60);
    setPickedNodePosition(50, 60);
    setPickedNodePosition(51, 61);
    expect(project().past).toHaveLength(1);
    expect(pickedNodePosition()).toEqual({ x: 51, y: 61 });
    undo();
    expect(pointsOf()[0]?.points[1]).toEqual({ x: 10, y: 0 });
  });
  it('do nothing unless exactly one node is picked', () => {
    pick([0, 1], [0, 2]);
    expect(pickedNodePosition()).toBeNull();
    setPickedNodePosition(50, 60);
    pick();
    setPickedNodePosition(50, 60);
    expect(project().past).toHaveLength(0);
  });
});

describe('Convert to outlines', () => {
  it('makes a shape an ordinary outline with the same points, as one undo step, and starts node editing', () => {
    const original: ObjectKind = { type: 'vector', paths: [square(10)], source: SHAPE_SOURCE };
    load([outline('a', { kind: original })]);
    useEditStore.getState().open('a');
    expect(convertAndEdit('a')).toBe(true);
    expect('source' in obj().kind && (obj().kind as { source?: unknown }).source !== undefined).toBe(false);
    expect(pointsOf()).toEqual([square(10)]);
    expect(nodesOf()).toHaveLength(1);
    expect(project().past).toHaveLength(1);
    expect(useNodeEditStore.getState().editingId).toBe('a');
    expect(useEditStore.getState().editingId).toBeNull();
    undo();
    expect(obj().kind).toBe(original);
  });
  it('then lets its nodes be moved', () => {
    load([outline('a', { kind: { type: 'vector', paths: [square(10)], source: SHAPE_SOURCE } })]);
    convertAndEdit('a');
    moveNodesByDrag([{ path: 0, node: 2 }], 5, 5);
    expect(pointsOf()[0]?.points[2]).toEqual({ x: 15, y: 15 });
    expect(project().past).toHaveLength(2);
  });
  it('refuses a locked object, and just starts editing an outline that has no recipe', () => {
    load([outline('a', { locked: true, kind: { type: 'vector', paths: [square(10)], source: SHAPE_SOURCE } })]);
    expect(convertAndEdit('a')).toBe(false);
    expect(said()).toContain('locked');
    expect(project().past).toHaveLength(0);
    load([outline('b')]);
    expect(convertAndEdit('b')).toBe(true);
    expect(project().past).toHaveLength(0);
    expect(useNodeEditStore.getState().editingId).toBe('b');
  });
  it('says so when there is nothing in the object', () => {
    load([outline('a', { kind: { type: 'vector', paths: [], source: SHAPE_SOURCE } })]);
    expect(convertAndEdit('a')).toBe(false);
    expect(said()).toContain('nothing');
    expect(convertAndEdit('nobody')).toBe(false);
  });
});
