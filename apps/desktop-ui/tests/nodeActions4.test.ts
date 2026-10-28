import { beforeEach, describe, expect, it } from 'vitest';
import { enterNodeEdit, leaveNodeEdit, moveNodesByDrag, snapContextFor } from '@/canvas/nodeActions';
import { dragDraft, moveGesture, nodeWorldPosition, pressOnCanvas, releaseAt, toWorldNodes, type NodeGesture } from '@/lib/nodeEdit';
import { SNAP_PX, dragWithSnap } from '@/lib/nodeSnap';
import { compose } from '@/lib/transform';
import { useEditStore } from '@/state/editStore';
import { useMeasureStore } from '@/state/measureStore';
import { useNodeEditStore } from '@/state/nodeEditStore';
import { useNoticeStore } from '@/state/noticeStore';
import { useProjectStore } from '@/state/projectStore';
import type { NodePath, Path2D, Point2, ProjectFile, Transform2D, WorkspaceObject } from '@/types/domain';

// Snapping on the real stores: what is collected when a drag starts, the switch, and a whole drag run the way the canvas runs it.

const IDENTITY: Transform2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const square = (s = 10, x = 0, y = 0): Path2D => ({ closed: true, points: [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }] });
const outline = (id: string, paths: Path2D[], over: Partial<WorkspaceObject> = {}): WorkspaceObject => ({
  id,
  name: id,
  kind: { type: 'vector', paths },
  transform: IDENTITY,
  layer_id: null,
  visible: true,
  locked: false,
  z_index: 0,
  ...over,
});
function load(objects: WorkspaceObject[]): void {
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
  useProjectStore.getState().setSelection([objects[0]?.id ?? '']);
}
const project = () => useProjectStore.getState();
const obj = (id = 'a') => project().project?.objects.find((o) => o.id === id) as WorkspaceObject;
const nodesOf = (id = 'a') => (obj(id).kind as { nodes?: NodePath[] }).nodes;
const world = (): NodePath[] => {
  const o = obj();
  const nodes = nodesOf() ?? (o.kind as { paths: Path2D[] }).paths.map((p) => ({ closed: p.closed, nodes: p.points.map((q) => ({ x: q.x, y: q.y })) }));
  return toWorldNodes(nodes, o.transform);
};

/** Runs one drag exactly as canvas/NodeOverlay.tsx does: press, move, let go, with the same calls in the same order. */
function dragNode(from: Point2, to: Point2, opts: { alt?: boolean; scale?: number } = {}): { target: Point2 | null } {
  const scale = opts.scale ?? 1;
  const tolMm = SNAP_PX / (scale * 2);
  const w = world();
  const press = pressOnCanvas(w, [], from, tolMm, false);
  useNodeEditStore.getState().setSelection(press.selection);
  let g = press.gesture as NodeGesture;
  const ctx = g.kind === 'drag' ? snapContextFor(g.refs, w, tolMm) : null;
  g = moveGesture(g, to, 0.5);
  const dragged = dragWithSnap(g, to, ctx, !opts.alt, tolMm);
  const draft = dragDraft(g, nodesOf() ?? w, obj().transform, dragged.point);
  expect(draft === null || Array.isArray(draft)).toBe(true);
  const result = releaseAt(g, w, useNodeEditStore.getState().selection, dragged.point, 0.5);
  if (result.move) moveNodesByDrag(result.move.refs, result.move.dx, result.move.dy);
  return { target: dragged.target };
}

beforeEach(() => {
  leaveNodeEdit();
  useNodeEditStore.getState().setSnap(true);
  useEditStore.getState().setTool(null);
  useEditStore.getState().close();
  useMeasureStore.getState().setTool('select');
  useNoticeStore.getState().dismiss();
});

describe('the switch', () => {
  it('is on to start with, and turning it off and on again changes it', () => {
    expect(useNodeEditStore.getState().snap).toBe(true);
    useNodeEditStore.getState().setSnap(false);
    expect(useNodeEditStore.getState().snap).toBe(false);
    useNodeEditStore.getState().setSnap(true);
    expect(useNodeEditStore.getState().snap).toBe(true);
  });
  it('is not changed by starting or stopping node editing, whichever way it is set', () => {
    load([outline('a', [square(10)])]);
    for (const on of [false, true]) {
      useNodeEditStore.getState().setSnap(on);
      enterNodeEdit();
      expect(useNodeEditStore.getState().snap).toBe(on);
      leaveNodeEdit();
      expect(useNodeEditStore.getState().snap).toBe(on);
    }
  });
});

describe('snapContextFor', () => {
  beforeEach(() => {
    load([outline('a', [square(10)]), outline('b', [square(10, 30, 0)]), outline('hidden', [square(10, 60, 0)], { visible: false })]);
    enterNodeEdit();
  });
  it('collects the dragged nodes, the rest of this outline, and the corners of the other visible objects', () => {
    const ctx = snapContextFor([{ path: 0, node: 1 }], world(), 1);
    expect(ctx?.starts).toEqual([{ x: 10, y: 0 }]);
    expect(ctx?.index.points).toHaveLength(3 + 4);
  });
  it('is nothing when snapping is off', () => {
    useNodeEditStore.getState().setSnap(false);
    expect(snapContextFor([{ path: 0, node: 1 }], world(), 1)).toBeNull();
  });
  it('is nothing when node editing is not on, or nothing is dragged', () => {
    expect(snapContextFor([], world(), 1)).toBeNull();
    leaveNodeEdit();
    expect(snapContextFor([{ path: 0, node: 1 }], world(), 1)).toBeNull();
  });
});

describe('a whole drag, as the canvas runs it', () => {
  beforeEach(() => {
    load([outline('a', [square(10)]), outline('b', [square(10, 30, 0)])]);
    enterNodeEdit();
  });
  it('a node dragged near a corner of another object lands exactly on it, as one undo step', () => {
    const r = dragNode({ x: 10, y: 0 }, { x: 29.2, y: 0.6 });
    expect(r.target).toEqual({ x: 30, y: 0 });
    expect(nodeWorldPosition(nodesOf() ?? [], { path: 0, node: 1 }, obj().transform)).toEqual({ x: 30, y: 0 });
    expect(project().past).toHaveLength(1);
    project().undo();
    expect(nodesOf()).toBeUndefined();
  });
  it('the outline made from the snapped nodes has the corner exactly there', () => {
    dragNode({ x: 10, y: 0 }, { x: 29.2, y: 0.6 });
    const paths = (obj().kind as { paths: Path2D[] }).paths;
    expect(paths[0]?.points[1]).toEqual({ x: 30, y: 0 });
  });
  it('a node dragged somewhere with nothing near it goes exactly where it was dragged', () => {
    const r = dragNode({ x: 10, y: 0 }, { x: 20, y: -15 });
    expect(r.target).toBeNull();
    expect(nodeWorldPosition(nodesOf() ?? [], { path: 0, node: 1 }, obj().transform)).toEqual({ x: 20, y: -15 });
  });
  it('holding Alt moves it to where it was dragged even right next to a corner', () => {
    const r = dragNode({ x: 10, y: 0 }, { x: 29.2, y: 0.6 }, { alt: true });
    expect(r.target).toBeNull();
    expect(nodeWorldPosition(nodesOf() ?? [], { path: 0, node: 1 }, obj().transform)).toEqual({ x: 29.2, y: 0.6 });
  });
  it('with the switch off nothing snaps', () => {
    useNodeEditStore.getState().setSnap(false);
    const r = dragNode({ x: 10, y: 0 }, { x: 29.2, y: 0.6 });
    expect(r.target).toBeNull();
    expect(nodeWorldPosition(nodesOf() ?? [], { path: 0, node: 1 }, obj().transform)).toEqual({ x: 29.2, y: 0.6 });
  });
  it('zoomed in, the reach is smaller in millimetres: the same drag no longer snaps', () => {
    expect(dragNode({ x: 10, y: 0 }, { x: 28.5, y: 0.5 }, { scale: 1 }).target).toEqual({ x: 30, y: 0 });
    project().undo();
    expect(dragNode({ x: 10, y: 0 }, { x: 28.5, y: 0.5 }, { scale: 8 }).target).toBeNull();
  });
  it('a click that does not go far enough to count never snaps or moves anything', () => {
    const w = world();
    const press = pressOnCanvas(w, [], { x: 10, y: 0 }, 5, false);
    const g = moveGesture(press.gesture as NodeGesture, { x: 10.1, y: 0.1 }, 0.5);
    const ctx = snapContextFor((press.gesture as { refs: Array<{ path: number; node: number }> }).refs, w, 5);
    expect(dragWithSnap(g, { x: 10.1, y: 0.1 }, ctx, true, 5).target).toBeNull();
    expect(project().past).toHaveLength(0);
  });
});

describe('snapping where the objects are moved, turned and stretched', () => {
  it('the target is where the other object really is, and the dragged node lands on it', () => {
    const t = compose({ x: 100, y: 50, rotationDeg: 30, scaleX: 2, scaleY: 0.5 });
    load([outline('a', [square(10)], { transform: compose({ x: 5, y: 5, rotationDeg: 0, scaleX: 3, scaleY: 3 }) }), outline('b', [square(10)], { transform: t })]);
    enterNodeEdit();
    // the second corner of b, in world millimetres
    const target = { x: t.a * 10 + t.c * 0 + t.e, y: t.b * 10 + t.d * 0 + t.f };
    // the second corner of a is at (35, 5): drag it near the target
    const r = dragNode({ x: 35, y: 5 }, { x: target.x + 0.7, y: target.y - 0.5 });
    expect(r.target?.x).toBeCloseTo(target.x, 9);
    expect(r.target?.y).toBeCloseTo(target.y, 9);
    const landed = nodeWorldPosition(nodesOf() ?? [], { path: 0, node: 1 }, obj().transform) as Point2;
    expect(landed.x).toBeCloseTo(target.x, 2);
    expect(landed.y).toBeCloseTo(target.y, 2);
  });
});

describe('two outlines made to meet', () => {
  it('dragging the end of one line onto the end of another puts them in exactly the same place', () => {
    const a: Path2D = { closed: false, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] };
    const b: Path2D = { closed: false, points: [{ x: 25, y: 4 }, { x: 25, y: 30 }] };
    load([outline('a', [a]), outline('b', [b])]);
    enterNodeEdit();
    dragNode({ x: 20, y: 0 }, { x: 24.2, y: 3.5 });
    const end = nodeWorldPosition(nodesOf() ?? [], { path: 0, node: 1 }, obj().transform);
    expect(end).toEqual({ x: 25, y: 4 });
    const other = (obj('b').kind as { paths: Path2D[] }).paths[0]?.points[0];
    expect(end).toEqual(other);
  });
});
