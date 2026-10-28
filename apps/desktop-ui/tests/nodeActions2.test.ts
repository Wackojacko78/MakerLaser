import { beforeEach, describe, expect, it } from 'vitest';
import {
  convertAndEdit,
  curvePicked,
  currentNodes,
  enterNodeEdit,
  leaveNodeEdit,
  moveHandleByDrag,
  moveNodesByDrag,
  setPickedMode,
  straightenPicked,
} from '@/canvas/nodeActions';
import { nodesFromPaths, nodesMatchPaths } from '@/lib/nodePath';
import { defaultShape, shapePaths } from '@/lib/shapes';
import { compose } from '@/lib/transform';
import { useEditStore } from '@/state/editStore';
import { useMeasureStore } from '@/state/measureStore';
import { useNodeEditStore } from '@/state/nodeEditStore';
import { useNoticeStore } from '@/state/noticeStore';
import { useProjectStore } from '@/state/projectStore';
import type { NodePath, Path2D, ProjectFile, Transform2D, WorkspaceObject } from '@/types/domain';

// Curves on the real project store: undo and redo, the objects' kinds being replaced and never edited, and notices.

const IDENTITY: Transform2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const square = (s = 10): Path2D => ({ closed: true, points: [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }] });
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
const kindOf = (id = 'a') => obj(id).kind as { paths: Path2D[]; nodes?: NodePath[]; source?: unknown };
const nodeAt = (n: number, id = 'a') => kindOf(id).nodes?.[0]?.nodes[n];
const said = () => useNoticeStore.getState().notice?.text ?? '';
const pick = (...refs: Array<[number, number]>) => useNodeEditStore.getState().setSelection(refs.map(([path, node]) => ({ path, node })));

beforeEach(() => {
  leaveNodeEdit();
  useEditStore.getState().setTool(null);
  useEditStore.getState().close();
  useMeasureStore.getState().setTool('select');
  useNoticeStore.getState().dismiss();
  load([outline('a')]);
  enterNodeEdit();
});

describe('Smooth, Symmetric and Corner', () => {
  it('Smooth on a corner makes handles, so the outline gets curved, as one undo step', () => {
    const before = obj().kind;
    pick([0, 1]);
    setPickedMode('smooth');
    expect(nodeAt(1)).toEqual({ x: 10, y: 0, in: { x: -2.357, y: -2.357 }, out: { x: 2.357, y: 2.357 }, mode: 'smooth' });
    expect(kindOf().paths[0]?.points.length).toBeGreaterThan(4);
    expect(nodesMatchPaths(kindOf().nodes ?? [], kindOf().paths)).toBe(true);
    expect(project().past).toHaveLength(1);
    project().undo();
    expect(obj().kind).toBe(before);
  });
  it('does several nodes at once, and says when there is nothing to do', () => {
    pick([0, 0], [0, 1], [0, 2], [0, 3]);
    setPickedMode('symmetric');
    expect(kindOf().nodes?.[0]?.nodes.every((n) => n.mode === 'symmetric' && n.in && n.out)).toBe(true);
    const steps = project().past.length;
    setPickedMode('symmetric');
    expect(project().past).toHaveLength(steps);
    expect(said()).toContain('already symmetric');
    pick([0, 1]);
    setPickedMode('symmetric');
    expect(said()).toBe('That node is already symmetric.');
  });
  it('asks for a pick, and leaves the project alone, when nothing is picked', () => {
    setPickedMode('smooth');
    expect(said()).toContain('Pick a node');
    expect(project().past).toHaveLength(0);
  });
  it('Corner keeps the handles and drops the mode', () => {
    pick([0, 1]);
    setPickedMode('smooth');
    setPickedMode('corner');
    expect(nodeAt(1)).toEqual({ x: 10, y: 0, in: { x: -2.357, y: -2.357 }, out: { x: 2.357, y: 2.357 } });
  });
});

describe('Curve and Straight', () => {
  it('Curve gives the line between two picked neighbours handles, without changing the outline, as one undo step', () => {
    const outlineBefore = JSON.parse(JSON.stringify(kindOf().paths)) as Path2D[];
    pick([0, 0], [0, 1]);
    curvePicked();
    expect(nodeAt(0)).toEqual({ x: 0, y: 0, out: { x: 3.333, y: 0 } });
    expect(nodeAt(1)).toEqual({ x: 10, y: 0, in: { x: -3.333, y: 0 } });
    expect(kindOf().paths).toEqual(outlineBefore);
    expect(project().past).toHaveLength(1);
    expect(said()).toContain('Made 1 line a curve');
  });
  it('Curve on one node bends the lines either side of it', () => {
    pick([0, 2]);
    curvePicked();
    expect(nodeAt(2)).toMatchObject({ in: { x: 0, y: -3.333 }, out: { x: -3.333, y: 0 } });
    expect(said()).toContain('Made 2 lines curves');
  });
  it('says what to do when the pick does not stand for a line, and what is already so', () => {
    pick([0, 0], [0, 2]);
    curvePicked();
    expect(said()).toContain('Pick two neighbouring nodes');
    pick([0, 0], [0, 1]);
    curvePicked();
    curvePicked();
    expect(said()).toContain('curves already');
    expect(project().past).toHaveLength(1);
    pick([0, 2], [0, 3]);
    straightenPicked();
    expect(said()).toContain('straight lines already');
  });
  it('Straight takes the handles away again and brings back the plain outline', () => {
    pick([0, 0], [0, 1]);
    curvePicked();
    straightenPicked();
    expect(kindOf().nodes).toEqual(nodesFromPaths([square(10)]));
    expect(project().past).toHaveLength(2);
  });
  it('Straight with nothing picked asks for a pick', () => {
    straightenPicked();
    expect(said()).toContain('Pick two neighbouring nodes');
  });
});

describe('dragging a handle', () => {
  it('moves it by the amount the pointer went and bends the outline, as one undo step', () => {
    pick([0, 1]);
    setPickedMode('smooth');
    const steps = project().past.length;
    moveHandleByDrag({ path: 0, node: 1 }, 'out', 0, 5);
    expect(project().past).toHaveLength(steps + 1);
    expect(nodeAt(1)?.out).toEqual({ x: 2.357, y: 7.357 });
    // smooth: the other handle swings to the opposite direction and keeps its length
    const inH = nodeAt(1)?.in as { x: number; y: number };
    expect(Math.hypot(inH.x, inH.y)).toBeCloseTo(Math.hypot(2.357, 2.357), 2);
    expect(inH.y / inH.x).toBeCloseTo(7.357 / 2.357, 1);
    expect(nodesMatchPaths(kindOf().nodes ?? [], kindOf().paths)).toBe(true);
    project().undo();
    expect(nodeAt(1)?.out).toEqual({ x: 2.357, y: 2.357 });
  });
  it('works on an object that is moved, turned and stretched: the handle follows the pointer in world millimetres', () => {
    const t = compose({ x: 50, y: 20, rotationDeg: 30, scaleX: 2, scaleY: 0.5 });
    load([outline('a', { transform: t })]);
    enterNodeEdit();
    pick([0, 1]);
    setPickedMode('smooth');
    const here = currentNodes();
    const out0 = here?.nodes[0]?.nodes[1]?.out as { x: number; y: number };
    moveHandleByDrag({ path: 0, node: 1 }, 'out', 6, -2);
    const out1 = currentNodes()?.nodes[0]?.nodes[1]?.out as { x: number; y: number };
    // the change of the handle, through the object's linear part, is the step the pointer made
    const dx = out1.x - out0.x;
    const dy = out1.y - out0.y;
    expect(t.a * dx + t.c * dy).toBeCloseTo(6, 1);
    expect(t.b * dx + t.d * dy).toBeCloseTo(-2, 1);
  });
  it('a drag of nothing is not an undo step', () => {
    pick([0, 1]);
    setPickedMode('smooth');
    const steps = project().past.length;
    moveHandleByDrag({ path: 0, node: 1 }, 'out', 0, 0);
    moveHandleByDrag({ path: 0, node: 9 }, 'out', 5, 5);
    expect(project().past).toHaveLength(steps);
  });
  it('moving the node takes its handles with it', () => {
    pick([0, 1]);
    setPickedMode('smooth');
    moveNodesByDrag([{ path: 0, node: 1 }], 4, 3);
    expect(nodeAt(1)).toEqual({ x: 14, y: 3, in: { x: -2.357, y: -2.357 }, out: { x: 2.357, y: 2.357 }, mode: 'smooth' });
  });
});

describe('Convert to outlines for a circle', () => {
  const circle = (): WorkspaceObject => {
    const source = { ...defaultShape('ellipse'), width_mm: 30, height_mm: 30 };
    return outline('a', { kind: { type: 'vector', paths: shapePaths(source), source } });
  };
  it('gives four curve nodes instead of hundreds of points, as one undo step, and node editing starts', () => {
    leaveNodeEdit();
    const original = circle();
    load([original]);
    const manyPoints = kindOf().paths[0]?.points.length ?? 0;
    expect(manyPoints).toBeGreaterThan(40);
    expect(convertAndEdit('a')).toBe(true);
    expect(kindOf().source).toBeUndefined();
    expect(kindOf().nodes?.[0]?.nodes).toHaveLength(4);
    expect(nodesMatchPaths(kindOf().nodes ?? [], kindOf().paths)).toBe(true);
    expect(project().past).toHaveLength(1);
    expect(useNodeEditStore.getState().editingId).toBe('a');
    project().undo();
    expect(obj().kind).toBe(original.kind);
  });
  it('and a handle of the converted circle can be dragged', () => {
    leaveNodeEdit();
    load([circle()]);
    convertAndEdit('a');
    moveHandleByDrag({ path: 0, node: 0 }, 'out', 0, -6);
    // the top node is smooth, so its other handle swings round: the circle is now a teardrop at the top
    expect(nodeAt(0)?.out?.y).toBeCloseTo(-6, 3);
    const inH = nodeAt(0)?.in as { x: number; y: number };
    expect(inH.y).toBeGreaterThan(0);
    expect(inH.x).toBeLessThan(0);
    expect(Math.hypot(inH.x, inH.y)).toBeCloseTo(8.284, 1);
    expect(project().past).toHaveLength(2);
  });
});
