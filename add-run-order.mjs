// Lets you choose the order the layers run in (for example engrave first, then cut) and shows
// the order on each layer. The default stays "engrave, score, then cut"; choosing "my own order"
// makes the laser run the layers from the top of the Layers list to the bottom.
// Run from C:\Dev\MakerLaser:   node add-run-order.mjs
// Safe: checks every edit point first and writes nothing unless ALL of them can be applied.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const ui = path.join(root, 'apps', 'desktop-ui');
const NEW_FILES = {
 "src/lib/runOrder.ts": "// The order the layers run in, and moving a layer earlier or later. Pure TypeScript (no React,\n// Konva or Tauri imports), so everything here is unit-tested in plain Node\n// (tests/runOrder.test.ts).\n//\n// This mirrors `plan_operations` in packages/project/src/cam.rs, which is what actually decides\n// the order the laser runs in. The panel only DISPLAYS what that code will do, so keep the two\n// in step.\n//\n//   Automatic (the default): every layer that runs is sorted by type first (image, fill, score,\n//   cut: engraving first, cutting last), then by its place in the layer list.\n//   My own order (custom_run_order): sorted by its place in the layer list only.\n//\n// \"Place in the layer list\" is the layer's z_order (ties keep their list order).\n\nimport type { Layer, LayerKind, ProjectFile } from '@/types/domain';\n\n/** The same ranking as `LaserOperation::execution_priority` in Rust: lower runs first. */\nexport const KIND_PRIORITY: Record<LayerKind, number> = { image: 0, fill: 1, score: 2, cut: 3 };\n\ntype OrderProject = {\n  layers: readonly Layer[];\n  objects: ReadonlyArray<Pick<ProjectFile['objects'][number], 'layer_id' | 'visible' | 'kind'>>;\n  settings: { custom_run_order?: boolean };\n};\n\nexport const isCustomOrder = (p: Pick<OrderProject, 'settings'>): boolean => p.settings.custom_run_order === true;\n\n/** The layers in list order (z_order, ties in their current order): the order the panel shows. */\nexport function orderedLayers<L extends Pick<Layer, 'z_order'>>(layers: readonly L[]): L[] {\n  return layers\n    .map((layer, index) => ({ layer, index }))\n    .sort((a, b) => a.layer.z_order - b.layer.z_order || a.index - b.index)\n    .map((row) => row.layer);\n}\n\n/** True when the layer is enabled and holds at least one visible object it can run. */\nfunction runs(layer: Layer, objects: OrderProject['objects']): boolean {\n  if (!layer.enabled) return false;\n  const wantsImage = layer.kind === 'image';\n  return objects.some((o) => o.visible && o.layer_id === layer.id && (o.kind.type === 'image') === wantsImage);\n}\n\n/** Ids of the layers that will run, in the order they run. */\nexport function computeRunOrder(project: OrderProject): string[] {\n  const custom = isCustomOrder(project);\n  return project.layers\n    .map((layer, index) => ({ layer, index }))\n    .filter(({ layer }) => runs(layer, project.objects))\n    .sort(\n      (a, b) =>\n        (custom ? 0 : KIND_PRIORITY[a.layer.kind]) - (custom ? 0 : KIND_PRIORITY[b.layer.kind]) ||\n        a.layer.z_order - b.layer.z_order ||\n        a.index - b.index,\n    )\n    .map(({ layer }) => layer.id);\n}\n\n/**\n * A warning when, in your own order, something runs after a cut: the cut-out piece can shift or\n * drop out before it is engraved. Null when the order is safe (or automatic).\n */\nexport function runOrderWarning(project: OrderProject): string | null {\n  if (!isCustomOrder(project)) return null;\n  const byId = new Map(project.layers.map((l) => [l.id, l]));\n  const kinds = computeRunOrder(project).map((id) => byId.get(id) as Layer);\n  const firstCut = kinds.findIndex((l) => l.kind === 'cut');\n  if (firstCut < 0) return null;\n  const later = kinds.slice(firstCut + 1).filter((l) => l.kind !== 'cut');\n  if (later.length === 0) return null;\n  const names = later.map((l) => `\\u201c${l.name}\\u201d`).join(', ');\n  return `${names} ${later.length === 1 ? 'runs' : 'run'} after a cut. The cut-out piece may shift or drop out before it is engraved: put the cut layer last unless the piece is held in place.`;\n}\n\nfunction renumber(layers: Layer[]): void {\n  layers.forEach((l, i) => {\n    l.z_order = i;\n  });\n}\n\n/**\n * Switching to \"my own order\": put the layers in the order they are running in right now\n * (engraving first, cutting last), so nothing changes until you move a layer yourself.\n * Rewrites the list order and z_order in place.\n */\nexport function adoptAutomaticOrder(layers: Layer[]): void {\n  const sorted = layers\n    .map((layer, index) => ({ layer, index }))\n    .sort((a, b) => KIND_PRIORITY[a.layer.kind] - KIND_PRIORITY[b.layer.kind] || a.layer.z_order - b.layer.z_order || a.index - b.index)\n    .map((row) => row.layer);\n  renumber(sorted);\n  layers.splice(0, layers.length, ...sorted);\n}\n\n/** Index in `sorted` that `from` would swap with, or -1. `withinKind` skips layers of other types. */\nfunction targetIndex(sorted: readonly Layer[], from: number, delta: -1 | 1, withinKind: boolean): number {\n  const here = sorted[from];\n  if (!here) return -1;\n  let to = from + delta;\n  if (withinKind) {\n    while (to >= 0 && to < sorted.length && sorted[to]?.kind !== here.kind) to += delta;\n  }\n  return to >= 0 && to < sorted.length ? to : -1;\n}\n\n/** Whether `moveLayer` would do anything. */\nexport function canMoveLayer(layers: readonly Layer[], id: string, delta: -1 | 1, withinKind: boolean): boolean {\n  const sorted = orderedLayers(layers);\n  return targetIndex(sorted, sorted.findIndex((l) => l.id === id), delta, withinKind) >= 0;\n}\n\n/**\n * Moves a layer one place earlier (-1) or later (+1) in the list and renumbers z_order to match.\n * With `withinKind` (automatic order) it swaps with the nearest layer of the same type, because\n * only those can change the run order there. Returns false, changing nothing, if it cannot move.\n */\nexport function moveLayer(layers: Layer[], id: string, delta: -1 | 1, withinKind: boolean): boolean {\n  const sorted = orderedLayers(layers);\n  const from = sorted.findIndex((l) => l.id === id);\n  const to = targetIndex(sorted, from, delta, withinKind);\n  const a = sorted[from];\n  const b = sorted[to];\n  if (from < 0 || to < 0 || !a || !b) return false;\n  sorted[from] = b;\n  sorted[to] = a;\n  renumber(sorted);\n  layers.splice(0, layers.length, ...sorted);\n  return true;\n}\n",
 "tests/runOrder.test.ts": "import { describe, expect, it } from 'vitest';\nimport {\n  adoptAutomaticOrder,\n  canMoveLayer,\n  computeRunOrder,\n  isCustomOrder,\n  moveLayer,\n  orderedLayers,\n  runOrderWarning,\n} from '@/lib/runOrder';\nimport type { Layer, LayerKind, WorkspaceObject } from '@/types/domain';\n\nconst RASTER = { dpi: 254, dither: 'floyd_steinberg', direction: 'horizontal', bidirectional: true, brightness: 0, contrast: 0, gamma: 1, invert: false } as const;\n\nfunction layer(id: string, kind: LayerKind, z: number, over: Partial<Layer> = {}): Layer {\n  return {\n    id, name: id, kind, speed_mm_min: 300, power_percent: 50, passes: 1, air_assist: false, enabled: true, z_order: z,\n    color: '#fff', kerf_mm: 0, line_spacing_mm: 0.1, fill_angle_deg: 0, cross_hatch: false, raster: { ...RASTER }, ...over,\n  };\n}\nconst vector = (layerId: string | null, over: Partial<WorkspaceObject> = {}): WorkspaceObject => ({\n  id: `v-${layerId}`, name: 'v', kind: { type: 'vector', paths: [] }, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },\n  layer_id: layerId, visible: true, locked: false, z_index: 0, ...over,\n});\nconst image = (layerId: string | null, over: Partial<WorkspaceObject> = {}): WorkspaceObject => ({\n  ...vector(layerId), id: `i-${layerId}`,\n  kind: { type: 'image', asset_id: 'a', format: 'png', source_path: null, width_px: 1, height_px: 1, dpi: 96 }, ...over,\n});\n\n/** The four default layers, in the order a new project has them. */\nconst defaults = () => [layer('Cut', 'cut', 0), layer('Score', 'score', 1), layer('Fill', 'fill', 2), layer('Image', 'image', 3)];\nconst project = (layers: Layer[], objects: WorkspaceObject[], custom?: boolean) => ({ layers, objects, settings: { custom_run_order: custom } });\nconst everything = [vector('Cut'), vector('Score'), vector('Fill'), image('Image')];\n\ndescribe('automatic order', () => {\n  it('runs engraving first and cutting last, whatever the layer list says', () => {\n    expect(computeRunOrder(project(defaults(), everything))).toEqual(['Image', 'Fill', 'Score', 'Cut']);\n  });\n  it('is the default when the setting is absent or false', () => {\n    expect(isCustomOrder({ settings: {} })).toBe(false);\n    expect(isCustomOrder({ settings: { custom_run_order: false } })).toBe(false);\n    expect(computeRunOrder(project(defaults(), everything, false))).toEqual(['Image', 'Fill', 'Score', 'Cut']);\n  });\n  it('orders two layers of the same type by their place in the list', () => {\n    const layers = [layer('CutA', 'cut', 5), layer('CutB', 'cut', 1), layer('Image', 'image', 9)];\n    expect(computeRunOrder(project(layers, [vector('CutA'), vector('CutB'), image('Image')]))).toEqual(['Image', 'CutB', 'CutA']);\n  });\n  it('keeps list order for equal z_order', () => {\n    const layers = [layer('A', 'cut', 0), layer('B', 'cut', 0)];\n    expect(computeRunOrder(project(layers, [vector('A'), vector('B')]))).toEqual(['A', 'B']);\n  });\n});\n\ndescribe('custom order', () => {\n  it('follows the layer list only', () => {\n    expect(computeRunOrder(project(defaults(), everything, true))).toEqual(['Cut', 'Score', 'Fill', 'Image']);\n    const reordered = [layer('Image', 'image', 0), layer('Cut', 'cut', 1), layer('Fill', 'fill', 2), layer('Score', 'score', 3)];\n    expect(computeRunOrder(project(reordered, everything, true))).toEqual(['Image', 'Cut', 'Fill', 'Score']);\n  });\n});\n\ndescribe('which layers run at all', () => {\n  it('skips disabled layers, empty layers, and layers with only hidden objects', () => {\n    const layers = defaults();\n    layers[1] = layer('Score', 'score', 1, { enabled: false });\n    const objs = [vector('Cut'), vector('Score'), vector('Fill', { visible: false }), image('Image')];\n    expect(computeRunOrder(project(layers, objs))).toEqual(['Image', 'Cut']);\n    expect(computeRunOrder(project(defaults(), []))).toEqual([]);\n  });\n  it('skips objects with no layer, and objects of the wrong type for the layer', () => {\n    const objs = [vector(null), image('Cut'), vector('Image'), vector('Score')];\n    expect(computeRunOrder(project(defaults(), objs))).toEqual(['Score']);\n  });\n  it('counts a locked object', () => {\n    expect(computeRunOrder(project(defaults(), [vector('Cut', { locked: true })]))).toEqual(['Cut']);\n  });\n});\n\ndescribe('runOrderWarning', () => {\n  it('is silent in automatic order', () => {\n    expect(runOrderWarning(project(defaults(), everything))).toBe(null);\n  });\n  it('warns when engraving runs after a cut, naming the layers', () => {\n    const w = runOrderWarning(project(defaults(), everything, true)) as string;\n    expect(w).toContain('\\u201cScore\\u201d, \\u201cFill\\u201d, \\u201cImage\\u201d run after a cut');\n    expect(runOrderWarning(project(defaults(), [vector('Cut'), image('Image')], true))).toContain('\\u201cImage\\u201d runs after a cut');\n  });\n  it('is silent when the cut is last, when there is no cut, and when only cuts follow a cut', () => {\n    const cutLast = [layer('Image', 'image', 0), layer('Cut', 'cut', 1)];\n    expect(runOrderWarning(project(cutLast, [image('Image'), vector('Cut')], true))).toBe(null);\n    expect(runOrderWarning(project(defaults(), [vector('Score'), image('Image')], true))).toBe(null);\n    const twoCuts = [layer('CutA', 'cut', 0), layer('CutB', 'cut', 1)];\n    expect(runOrderWarning(project(twoCuts, [vector('CutA'), vector('CutB')], true))).toBe(null);\n  });\n  it('ignores layers that do not run', () => {\n    expect(runOrderWarning(project(defaults(), [vector('Cut')], true))).toBe(null);\n  });\n});\n\ndescribe('adoptAutomaticOrder', () => {\n  it('lists the layers in the order they run now and renumbers z_order', () => {\n    const layers = defaults();\n    adoptAutomaticOrder(layers);\n    expect(layers.map((l) => l.id)).toEqual(['Image', 'Fill', 'Score', 'Cut']);\n    expect(layers.map((l) => l.z_order)).toEqual([0, 1, 2, 3]);\n  });\n  it('changes nothing about what runs: custom order straight after adopting equals the automatic order', () => {\n    const layers = [layer('CutB', 'cut', 7), layer('Image', 'image', 3), layer('CutA', 'cut', 2), layer('Fill', 'fill', 11), layer('Score', 'score', 0)];\n    const objs = [vector('CutB'), vector('CutA'), image('Image'), vector('Fill'), vector('Score')];\n    const before = computeRunOrder(project(layers, objs, false));\n    adoptAutomaticOrder(layers);\n    expect(computeRunOrder(project(layers, objs, true))).toEqual(before);\n  });\n  it('is stable for layers of the same type', () => {\n    const layers = [layer('B', 'cut', 5), layer('A', 'cut', 5)];\n    adoptAutomaticOrder(layers);\n    expect(layers.map((l) => l.id)).toEqual(['B', 'A']);\n  });\n});\n\ndescribe('moveLayer (custom order: adjacent swap)', () => {\n  it('moves a layer up and down and renumbers', () => {\n    const layers = defaults();\n    expect(moveLayer(layers, 'Image', -1, false)).toBe(true);\n    expect(layers.map((l) => l.id)).toEqual(['Cut', 'Score', 'Image', 'Fill']);\n    expect(layers.map((l) => l.z_order)).toEqual([0, 1, 2, 3]);\n    expect(moveLayer(layers, 'Cut', 1, false)).toBe(true);\n    expect(layers.map((l) => l.id)).toEqual(['Score', 'Cut', 'Image', 'Fill']);\n  });\n  it('changes the run order the way you expect', () => {\n    const layers = defaults();\n    adoptAutomaticOrder(layers); // Image, Fill, Score, Cut\n    const objs = [vector('Cut'), vector('Score'), vector('Fill'), image('Image')];\n    moveLayer(layers, 'Cut', -1, false);\n    moveLayer(layers, 'Cut', -1, false);\n    moveLayer(layers, 'Cut', -1, false);\n    expect(computeRunOrder(project(layers, objs, true))).toEqual(['Cut', 'Image', 'Fill', 'Score']);\n  });\n  it('does nothing at the ends', () => {\n    const layers = defaults();\n    const before = JSON.stringify(layers);\n    expect(moveLayer(layers, 'Cut', -1, false)).toBe(false);\n    expect(moveLayer(layers, 'Image', 1, false)).toBe(false);\n    expect(moveLayer(layers, 'nope', 1, false)).toBe(false);\n    expect(JSON.stringify(layers)).toBe(before);\n  });\n  it('first brings a list whose array order and z_order disagree into line', () => {\n    const layers = [layer('B', 'cut', 2), layer('A', 'cut', 0), layer('C', 'cut', 1)]; // list order is A, C, B\n    expect(orderedLayers(layers).map((l) => l.id)).toEqual(['A', 'C', 'B']);\n    expect(moveLayer(layers, 'B', -1, false)).toBe(true);\n    expect(layers.map((l) => l.id)).toEqual(['A', 'B', 'C']);\n    expect(layers.map((l) => l.z_order)).toEqual([0, 1, 2]);\n  });\n});\n\ndescribe('moveLayer (automatic order: within the same type)', () => {\n  it('swaps with the nearest layer of the same type and leaves the others alone', () => {\n    const layers = [layer('CutA', 'cut', 0), layer('Image', 'image', 1), layer('CutB', 'cut', 2), layer('Fill', 'fill', 3)];\n    expect(moveLayer(layers, 'CutB', -1, true)).toBe(true);\n    expect(layers.map((l) => l.id)).toEqual(['CutB', 'Image', 'CutA', 'Fill']);\n  });\n  it('cannot move a layer that is alone of its type', () => {\n    const layers = defaults();\n    expect(canMoveLayer(layers, 'Cut', -1, true)).toBe(false);\n    expect(canMoveLayer(layers, 'Cut', 1, true)).toBe(false);\n    expect(moveLayer(layers, 'Image', -1, true)).toBe(false);\n  });\n  it('really changes the order the two cut layers run in', () => {\n    const layers = [layer('CutA', 'cut', 0), layer('CutB', 'cut', 1)];\n    const objs = [vector('CutA'), vector('CutB')];\n    expect(computeRunOrder(project(layers, objs))).toEqual(['CutA', 'CutB']);\n    moveLayer(layers, 'CutB', -1, true);\n    expect(computeRunOrder(project(layers, objs))).toEqual(['CutB', 'CutA']);\n  });\n});\n\ndescribe('canMoveLayer', () => {\n  it('matches what moveLayer does', () => {\n    const layers = defaults();\n    expect(canMoveLayer(layers, 'Cut', -1, false)).toBe(false);\n    expect(canMoveLayer(layers, 'Cut', 1, false)).toBe(true);\n    expect(canMoveLayer(layers, 'Image', 1, false)).toBe(false);\n    expect(canMoveLayer(layers, 'Image', -1, false)).toBe(true);\n    expect(canMoveLayer(layers, 'missing', 1, false)).toBe(false);\n  });\n  it('does not change anything', () => {\n    const layers = defaults();\n    const before = JSON.stringify(layers);\n    canMoveLayer(layers, 'Image', -1, false);\n    expect(JSON.stringify(layers)).toBe(before);\n  });\n});\n"
};
const SNIP = {
 "cam_sort": "(\n    if project.settings.custom_run_order {\n        0\n    } else {\n        op.execution_priority()\n    },\n    z,\n)\n",
 "cam_tests": "#[test]\nfn automatic_order_runs_engraving_before_cutting_whatever_the_layer_order() {\n    let mut p = project();\n    vector_on(&mut p, LayerKind::Cut);\n    image_on(&mut p, LayerKind::Image);\n    for l in p.layers.iter_mut().filter(|l| l.kind == LayerKind::Cut) {\n        l.z_order = -10; // listed first, but it still runs last\n    }\n    let plan = plan_operations(&p);\n    assert!(matches!(plan.operations[0], LaserOperation::Raster { .. }));\n    assert!(matches!(plan.operations[1], LaserOperation::Cut { .. }));\n    assert!(plan.warnings.is_empty());\n}\n\n#[test]\nfn custom_order_follows_the_layer_order_and_warns_about_engraving_after_a_cut() {\n    let mut p = project();\n    vector_on(&mut p, LayerKind::Cut);\n    image_on(&mut p, LayerKind::Image);\n    p.settings.custom_run_order = true;\n    for l in p.layers.iter_mut().filter(|l| l.kind == LayerKind::Cut) {\n        l.z_order = -10;\n    }\n    let plan = plan_operations(&p);\n    assert!(matches!(plan.operations[0], LaserOperation::Cut { .. }));\n    assert!(matches!(plan.operations[1], LaserOperation::Raster { .. }));\n    assert!(plan.warnings.iter().any(|w| w.contains(\"after a cut\")));\n}\n\n#[test]\nfn custom_order_with_the_cut_last_has_no_warning() {\n    let mut p = project();\n    vector_on(&mut p, LayerKind::Cut);\n    image_on(&mut p, LayerKind::Image);\n    p.settings.custom_run_order = true;\n    for l in p.layers.iter_mut() {\n        l.z_order = if l.kind == LayerKind::Cut { 10 } else { 0 };\n    }\n    let plan = plan_operations(&p);\n    assert!(matches!(plan.operations[0], LaserOperation::Raster { .. }));\n    assert!(matches!(plan.operations[1], LaserOperation::Cut { .. }));\n    assert!(plan.warnings.is_empty());\n}\n\n#[test]\nfn layers_of_the_same_kind_run_in_layer_order() {\n    let mut p = project();\n    let mut second = makerlaser_common::Layer::new(\"Cut 2\", LayerKind::Cut, 0);\n    second.z_order = -5; // listed before the default Cut layer\n    let second_id = second.id;\n    p.layers.push(second);\n    vector_on(&mut p, LayerKind::Cut); // on the default Cut layer\n    let mut o = WorkspaceObject::new_vector(\"w\", vec![square()], 1);\n    o.layer_id = Some(second_id);\n    p.objects.push(o);\n    let plan = plan_operations(&p);\n    assert_eq!(plan.operations.len(), 2);\n    assert_eq!(plan.operations[0].layer_id(), second_id);\n}\n\n",
 "cam_warning": "// In \"my own order\" mode a cut can come before engraving. That is allowed, but the cut-out\n// piece may shift or drop out before the engraving is done, so say so.\nif project.settings.custom_run_order {\n    if let Some(first_cut) = operations\n        .iter()\n        .position(|op| matches!(op, LaserOperation::Cut { .. }))\n    {\n        let later: Vec<String> = operations[first_cut + 1..]\n            .iter()\n            .filter(|op| !matches!(op, LaserOperation::Cut { .. }))\n            .filter_map(|op| project.find_layer(op.layer_id()))\n            .map(|l| format!(\"'{}'\", l.name))\n            .collect();\n        if !later.is_empty() {\n            let verb = if later.len() == 1 { \"runs\" } else { \"run\" };\n            warnings.push(format!(\n                \"Run order: {} {verb} after a cut. The cut-out piece may shift or drop out before it is engraved. Put the cut layer last unless the piece is held in place.\",\n                later.join(\", \")\n            ));\n        }\n    }\n}\n\n",
 "card_arrows": "<button\n  className=\"mini\"\n  disabled={!canMoveUp}\n  title={custom ? 'Run this layer earlier' : 'Run this layer before the previous layer of the same type'}\n  onClick={(e) => {\n    e.preventDefault();\n    mutate((p) => {\n      moveLayer(p.layers, layer.id, -1, !custom);\n    });\n  }}\n>\n  &#9650;\n</button>\n<button\n  className=\"mini\"\n  disabled={!canMoveDown}\n  title={custom ? 'Run this layer later' : 'Run this layer after the next layer of the same type'}\n  onClick={(e) => {\n    e.preventDefault();\n    mutate((p) => {\n      moveLayer(p.layers, layer.id, 1, !custom);\n    });\n  }}\n>\n  &#9660;\n</button>\n",
 "card_badge": "{runPosition > 0 && (\n  <span title=\"The order this layer runs in: #1 runs first\" style={{ color: 'var(--accent)', fontWeight: 600 }}>\n    #{runPosition}\n  </span>\n)}\n",
 "card_signature": "function LayerCard({\n  layer,\n  runPosition,\n  custom,\n  canMoveUp,\n  canMoveDown,\n}: {\n  layer: Layer;\n  /** 1 = runs first; 0 = this layer will not run (disabled or empty). */\n  runPosition: number;\n  custom: boolean;\n  canMoveUp: boolean;\n  canMoveDown: boolean;\n}) {\n",
 "domain_field": "/** false: engrave, score, then cut. true: layers run from the top of the Layers list to the bottom. */\ncustom_run_order?: boolean;\n",
 "panel_function": "export function LayersPanel() {\n  const project = useProjectStore((s) => s.project);\n  const mutate = useProjectStore((s) => s.mutate);\n  if (!project) return null;\n\n  const custom = isCustomOrder(project);\n  const runOrder = computeRunOrder(project);\n  const listed = orderedLayers(project.layers);\n  const warning = runOrderWarning(project);\n\n  return (\n    <section className=\"panel\">\n      <h3>Layers</h3>\n      <div className=\"preset-row\" style={{ margin: '0 0 4px' }}>\n        <select\n          value={custom ? 'custom' : 'auto'}\n          title=\"Which layer the laser runs first\"\n          onChange={(e) => {\n            const wantCustom = e.target.value === 'custom';\n            mutate((p) => {\n              // Switching to your own order keeps today's order until you move a layer.\n              if (wantCustom) adoptAutomaticOrder(p.layers);\n              p.settings.custom_run_order = wantCustom;\n            });\n          }}\n        >\n          <option value=\"auto\">Run order: engrave, score, then cut</option>\n          <option value=\"custom\">Run order: my own (top to bottom)</option>\n        </select>\n      </div>\n      <p className=\"hint\" style={{ margin: '2px 0 6px' }}>\n        {custom\n          ? 'Layers run from the top of this list to the bottom. Use the arrows to change it. #1 runs first.'\n          : 'Engraving runs first and cutting last. The arrows reorder layers of the same type. Choose \"my own\" to put any layer first. #1 runs first.'}\n      </p>\n      {warning && <p className=\"banner danger\">{warning}</p>}\n      {listed.map((l) => (\n        <LayerCard\n          key={l.id}\n          layer={l}\n          runPosition={runOrder.indexOf(l.id) + 1}\n          custom={custom}\n          canMoveUp={canMoveLayer(project.layers, l.id, -1, !custom)}\n          canMoveDown={canMoveLayer(project.layers, l.id, 1, !custom)}\n        />\n      ))}\n    </section>\n  );\n}\n",
 "panel_import": "import {\n  adoptAutomaticOrder,\n  canMoveLayer,\n  computeRunOrder,\n  isCustomOrder,\n  moveLayer,\n  orderedLayers,\n  runOrderWarning,\n} from '@/lib/runOrder';\n",
 "project_default": "custom_run_order: false,\n",
 "project_field": "/// `false`: engrave, score, then cut. `true`: layers run in layer order (`z_order`).\n#[serde(default)]\npub custom_run_order: bool,\n",
 "project_tests": "#[test]\nfn old_settings_without_run_order_load_as_automatic() {\n    let json = r#\"{\"units\":\"mm\",\"grid_spacing_mm\":10.0,\"show_grid\":true,\"show_origin\":true}\"#;\n    let s: ProjectSettings = serde_json::from_str(json).unwrap();\n    assert!(!s.custom_run_order);\n    assert!(!ProjectSettings::default().custom_run_order);\n}\n\n"
};

const P = {
  domain: path.join(ui, 'src', 'types', 'domain.ts'),
  layers: path.join(ui, 'src', 'components', 'LayersPanel.tsx'),
  project: path.join(root, 'packages', 'common', 'src', 'project.rs'),
  cam: path.join(root, 'packages', 'project', 'src', 'cam.rs'),
};

function stop(message) {
  console.log(message);
  console.log('Nothing was changed.');
  process.exit(1);
}
const missing = Object.values(P).filter((f) => !fs.existsSync(f));
if (missing.length > 0) {
  console.log('Run this from the MakerLaser repo root. Not found:');
  for (const f of missing) console.log('  ' + path.relative(root, f).split(path.sep).join('/'));
  stop('');
}
const read = (f) => fs.readFileSync(f, 'utf8');
const src = Object.fromEntries(Object.entries(P).map(([k, f]) => [k, read(f)]));
const targets = Object.keys(NEW_FILES).map((rel) => [rel, path.join(ui, ...rel.split('/'))]);
const existing = targets.filter(([, abs]) => fs.existsSync(abs));
if (existing.length > 0 || src.project.includes('custom_run_order') || src.layers.includes('runOrder')) {
  console.log('Already applied (or files exist). Nothing written.');
  process.exit(0);
}

const eolOf = (s) => (s.includes('\r\n') ? '\r\n' : '\n');
const fix = (text, eol) => text.replace(/\r?\n/g, eol);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function locate(text, find, label) {
  const lines = find.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  const re = new RegExp(lines.map(esc).join('[ \\t]*\\r?\\n[ \\t\\r\\n]*'), 'g');
  const hits = [...text.matchAll(re)];
  if (hits.length === 0) throw new Error('Could not find the place to edit in ' + label + '.');
  if (hits.length > 1) throw new Error('The place to edit is not unique in ' + label + '.');
  return hits[0];
}
const splice = (text, hit, replacement) => text.slice(0, hit.index) + replacement + text.slice(hit.index + hit[0].length);
const indentOf = (text, index) => text.slice(text.lastIndexOf('\n', index - 1) + 1, index);
/** Snippet lines, with the snippet's own relative indentation, re-indented to `indent`. */
const block = (name, indent, eol) =>
  SNIP[name].replace(/\r?\n+$/, '').split(/\r?\n/).map((l, i) => (i === 0 || l === '' ? l : indent + l)).join(eol);

/** Replaces the matched text with a snippet (first line takes the place of the match). */
function replaceWith(text, find, snippet, label) {
  const hit = locate(text, find, label);
  const indent = indentOf(text, hit.index);
  return splice(text, hit, block(snippet, indent.trim() === '' ? indent : '', eolOf(text)));
}
function insertAfter(text, find, snippet, label) {
  const hit = locate(text, find, label);
  const eol = eolOf(text);
  const indent = indentOf(text, hit.index);
  const pad = indent.trim() === '' ? indent : '';
  return splice(text, hit, hit[0] + eol + pad + block(snippet, pad, eol));
}
function insertBefore(text, find, snippet, label) {
  const hit = locate(text, find, label);
  const eol = eolOf(text);
  const indent = indentOf(text, hit.index);
  if (indent.trim() !== '') throw new Error('The place to edit does not start a line in ' + label + '.');
  const blankAfter = /\r?\n\r?\n$/.test(SNIP[snippet]) ? eol : '';
  return splice(text, hit, block(snippet, indent, eol) + eol + blankAfter + indent + hit[0]);
}

const out = {};
try {
  // ---- domain.ts ----
  out[P.domain] = insertAfter(src.domain, 'show_origin: boolean;', 'domain_field', 'types/domain.ts');

  // ---- project.rs ----
  {
    let t = insertAfter(src.project, 'pub show_origin: bool,', 'project_field', 'project.rs (the settings struct)');
    t = insertAfter(t, 'show_origin: true,', 'project_default', 'project.rs (the default settings)');
    t = insertBefore(t, '#[test]\nfn project_json_round_trip() {', 'project_tests', 'project.rs (tests)');
    out[P.project] = t;
  }

  // ---- cam.rs ----
  {
    let t = replaceWith(src.cam, '(op.execution_priority(), z)', 'cam_sort', 'cam.rs (the sort)');
    t = insertBefore(t, 'PlanResult {\noperations,\nwarnings,\n}', 'cam_warning', 'cam.rs (the result)');
    t = insertBefore(t, '#[test]\nfn layer_parameters_flow_into_the_operation() {', 'cam_tests', 'cam.rs (tests)');
    out[P.cam] = t;
  }

  // ---- LayersPanel.tsx ----
  {
    let t = insertAfter(src.layers, "import { errorMessage } from '@/lib/format';", 'panel_import', 'LayersPanel.tsx (imports)');
    t = replaceWith(t, 'function LayerCard({ layer }: { layer: Layer }) {', 'card_signature', 'LayersPanel.tsx (the layer card)');
    t = insertBefore(t, '<span className="count">{objects.length}</span>', 'card_badge', 'LayersPanel.tsx (the layer header)');
    t = insertAfter(t, '<span className="count">{objects.length}</span>', 'card_arrows', 'LayersPanel.tsx (the layer header)');
    t = replaceWith(
      t,
      [
        'export function LayersPanel() {',
        'const project = useProjectStore((s) => s.project);',
        'if (!project) return null;',
        'return (',
        '<section className="panel">',
        '<h3>Layers</h3>',
        '{project.layers.map((l) => (',
        '<LayerCard key={l.id} layer={l} />',
        '))}',
        '</section>',
        ');',
        '}',
      ].join('\n'),
      'panel_function',
      'LayersPanel.tsx (the panel)',
    );
    out[P.layers] = t;
  }
} catch (e) {
  stop(e.message + ' Your file may differ from what this script expects; paste it and I will adjust the script.');
}

// ---- everything matched: write ----
const uiEol = eolOf(src.layers);
for (const [rel, abs] of targets) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, fix(NEW_FILES[rel], uiEol), 'utf8');
  console.log('created ' + path.relative(root, abs).split(path.sep).join('/'));
}
for (const [abs, text] of Object.entries(out)) {
  fs.writeFileSync(abs, text, 'utf8');
  console.log('edited  ' + path.relative(root, abs).split(path.sep).join('/'));
}
console.log('');
console.log('Next: cargo fmt --all ; cargo test --workspace ; npm run ui:typecheck ; npm run ui:test ; npm run dev');
