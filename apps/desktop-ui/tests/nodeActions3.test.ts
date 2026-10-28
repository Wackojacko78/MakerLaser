import { beforeEach, describe, expect, it } from 'vitest';
import { convertAndEdit, enterNodeEdit, fitCurves, leaveNodeEdit } from '@/canvas/nodeActions';
import { fitOutlines } from '@/lib/curveFit';
import { flattenNodes, nodesFromPaths, nodesMatchPaths } from '@/lib/nodePath';
import { defaultShape, shapePaths } from '@/lib/shapes';
import { useEditStore } from '@/state/editStore';
import { useMeasureStore } from '@/state/measureStore';
import { useNodeEditStore } from '@/state/nodeEditStore';
import { useNoticeStore } from '@/state/noticeStore';
import { useProjectStore } from '@/state/projectStore';
import type { NodePath, ObjectKind, Path2D, ProjectFile, Transform2D, WorkspaceObject } from '@/types/domain';

// Fit curves on the real project store: undo and redo, the kind of an object replaced and never edited in place, and what is said.

const IDENTITY: Transform2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const circle = (r: number, n: number): Path2D => ({
  closed: true,
  points: Array.from({ length: n }, (_, i) => ({ x: r + r * Math.cos((2 * Math.PI * i) / n), y: r + r * Math.sin((2 * Math.PI * i) / n) })),
});
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
const kindOf = (id = 'a') => obj(id).kind as { paths: Path2D[]; nodes?: NodePath[]; source?: unknown };
const said = () => useNoticeStore.getState().notice?.text ?? '';

beforeEach(() => {
  leaveNodeEdit();
  useEditStore.getState().setTool(null);
  useEditStore.getState().close();
  useMeasureStore.getState().setTool('select');
  useNoticeStore.getState().dismiss();
  load([outline('a', [circle(20, 400)])]);
});

describe('Fit curves', () => {
  it('turns the points of an outline into a few curve nodes, as one undo step, and says how many', () => {
    const before = obj().kind;
    expect(fitCurves('a', 0.05)).toBe(true);
    expect(kindOf().nodes?.[0]?.nodes.length).toBeLessThanOrEqual(8);
    expect(kindOf().paths).toEqual(flattenNodes(kindOf().nodes ?? []));
    expect(nodesMatchPaths(kindOf().nodes ?? [], kindOf().paths)).toBe(true);
    expect(kindOf().paths[0]?.points.length).toBeLessThan(400);
    expect(project().past).toHaveLength(1);
    expect(said()).toMatch(/^Fitted curves: 400 points became \d+ nodes, within 0\.05 mm of the old outline\.$/);
    expect(obj().kind).not.toBe(before);
  });
  it('Undo brings back the very same outline, and Redo fits it again', () => {
    const before = obj().kind;
    const json = JSON.stringify(before);
    fitCurves('a', 0.05);
    const after = obj().kind;
    project().undo();
    expect(obj().kind).toBe(before);
    expect(JSON.stringify(before)).toBe(json);
    project().redo();
    expect(obj().kind).toBe(after);
  });
  it('does not need node editing to be on, and does not turn it on', () => {
    fitCurves('a', 0.05);
    expect(useNodeEditStore.getState().editingId).toBeNull();
  });
  it('with node editing on, carries on editing and clears the pick (the nodes are new ones)', () => {
    enterNodeEdit();
    useNodeEditStore.getState().setSelection([{ path: 0, node: 5 }]);
    fitCurves('a', 0.05);
    expect(useNodeEditStore.getState().editingId).toBe('a');
    expect(useNodeEditStore.getState().selection).toEqual([]);
    expect(project().selected).toEqual(['a']);
  });
  it('leaves the object where it is, whatever has been done to it', () => {
    const t: Transform2D = { a: 2, b: 0.5, c: -0.5, d: 2, e: 30, f: 40 };
    load([outline('a', [circle(20, 400)], { transform: t })]);
    fitCurves('a', 0.05);
    expect(obj().transform).toEqual(t);
  });
  it('a larger distance gives no more nodes than a smaller one', () => {
    fitCurves('a', 0.05);
    const tight = kindOf().nodes?.[0]?.nodes.length ?? 0;
    load([outline('a', [circle(20, 400)])]);
    fitCurves('a', 1);
    expect(kindOf().nodes?.[0]?.nodes.length ?? 99).toBeLessThanOrEqual(tight);
  });
  it('fits every outline of an object together', () => {
    load([outline('a', [circle(20, 400), circle(5, 120), { closed: true, points: circle(5, 100).points.map((p) => ({ x: p.x + 50, y: p.y })) }])]);
    fitCurves('a', 0.05);
    expect(kindOf().nodes).toHaveLength(3);
    expect(kindOf().nodes?.every((p) => p.closed && p.nodes.length <= 8)).toBe(true);
    expect(project().past).toHaveLength(1);
  });
  it('says what distance it used when it was asked for one that cannot be used', () => {
    fitCurves('a', 0.0001);
    expect(said()).toContain('within 0.025 mm');
    load([outline('a', [circle(20, 400)])]);
    fitCurves('a', Number.NaN);
    expect(said()).toContain('within 0.05 mm');
    load([outline('a', [circle(20, 400)])]);
    fitCurves('a', 500);
    expect(said()).toContain('within 5 mm');
  });
  it('is the same result the pure function gives', () => {
    fitCurves('a', 0.2);
    expect(kindOf().nodes).toEqual(fitOutlines([circle(20, 400)], 0.2).nodes);
  });
});

describe('Fit curves does nothing when there is nothing to do', () => {
  it('a triangle, a star or a square needs every point (or has no gain), so nothing changes and there is no undo step', () => {
    const star = shapePaths({ ...defaultShape('star'), width_mm: 40, height_mm: 40, sides: 5 });
    for (const paths of [[{ closed: true, points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 15, y: 20 }] }], star]) {
      load([outline('a', paths)]);
      const before = obj().kind;
      expect(fitCurves('a', 0.05)).toBe(false);
      expect(obj().kind).toBe(before);
      expect(project().past).toHaveLength(0);
      expect(said()).toContain('nothing to gain');
    }
  });
  it('fitting an outline that was fitted already never makes it bigger', () => {
    fitCurves('a', 0.05);
    const first = kindOf().nodes?.[0]?.nodes.length ?? 0;
    fitCurves('a', 0.05);
    expect(kindOf().nodes?.[0]?.nodes.length ?? 99).toBeLessThanOrEqual(first);
  });
});

describe('Fit curves refuses what it cannot do, in words, and changes nothing', () => {
  const shape = { ...defaultShape('ellipse'), width_mm: 30, height_mm: 30 };
  const picture: ObjectKind = { type: 'image', asset_id: 'x', format: 'png', source_path: null, width_px: 1, height_px: 1, dpi: 96 };
  it('text and shapes (convert them first), pictures, a locked object, an object that is not there', () => {
    const cases: Array<[WorkspaceObject, string]> = [
      [outline('a', shapePaths(shape), { kind: { type: 'vector', paths: shapePaths(shape), source: shape } }), 'Convert to outlines'],
      [outline('a', [], { kind: picture }), 'Select one outline'],
      [outline('a', [circle(20, 400)], { locked: true }), 'locked'],
    ];
    for (const [object, words] of cases) {
      load([object]);
      const before = obj().kind;
      expect(fitCurves('a', 0.05)).toBe(false);
      expect(said()).toContain(words);
      expect(obj().kind).toBe(before);
      expect(project().past).toHaveLength(0);
    }
    expect(fitCurves('nobody', 0.05)).toBe(false);
    expect(said()).toContain('Select one outline');
  });
  it('an empty object', () => {
    load([outline('a', [])]);
    expect(fitCurves('a', 0.05)).toBe(false);
    expect(said()).toContain('no outlines');
  });
});

describe('Convert to outlines and then Fit curves', () => {
  it('turns a shape into nodes and then a polygon of many points into a few, each as its own undo step', () => {
    const polygon = shapePaths({ ...defaultShape('ellipse'), width_mm: 30, height_mm: 30 });
    load([outline('a', polygon, { kind: { type: 'vector', paths: polygon, source: { ...defaultShape('ellipse'), width_mm: 30, height_mm: 30 } } })]);
    expect(convertAndEdit('a')).toBe(true);
    expect(project().past).toHaveLength(1);
    expect(kindOf().nodes?.[0]?.nodes).toHaveLength(4);
  });
  it('an imported drawing with corner nodes made one per point can be fitted after node editing made them', () => {
    load([outline('a', [circle(20, 400)])]);
    enterNodeEdit();
    expect(kindOf().nodes).toBeUndefined();
    fitCurves('a', 0.05);
    expect(kindOf().nodes?.[0]?.nodes.length).toBeLessThanOrEqual(8);
    expect(nodesFromPaths(kindOf().paths).length).toBeGreaterThan(0);
  });
});
