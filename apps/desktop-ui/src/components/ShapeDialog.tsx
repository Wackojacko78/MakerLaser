import { useMemo, useState, type ChangeEvent } from 'react';
import { applyEdit, shapeFromObject } from '@/lib/objectEdit';
import {
  INNER_MAX,
  INNER_MIN,
  SHAPE_KINDS,
  SHAPE_LABELS,
  SHAPE_MAX_MM,
  SHAPE_MIN_MM,
  SIDES_MAX,
  SIDES_MIN,
  clampShape,
  defaultShape,
  shapeName,
  shapePaths,
} from '@/lib/shapes';
import { TEST_PREFIX } from '@/lib/testGrid';
import { shapePathData } from '@/lib/textTrace';
import { useProjectStore } from '@/state/projectStore';
import type { LayerKind, ShapeKind, WorkspaceObject } from '@/types/domain';

interface Props {
  onClose: () => void;
  /** Edit this shape object instead of adding a new one. */
  editId?: string;
}

type Mode = 'fill' | 'score' | 'cut';

const MODE_HELP: Record<Mode, string> = {
  fill: 'Engrave: the shape is filled in.',
  score: 'Outline: only the edge is drawn, at your Score layer settings.',
  cut: 'Cut: the shape is cut out along its edge.',
};

/** Adds a rectangle, ellipse, polygon or star to the project, or changes one that is already there. */
export function ShapeDialog({ onClose, editId }: Props) {
  const project = useProjectStore((s) => s.project);
  const addObject = useProjectStore((s) => s.addObject);
  const mutate = useProjectStore((s) => s.mutate);
  // When editing, start from what the shape was made from (with any resizing on the canvas applied).
  const [initial] = useState(() => {
    const current = editId ? useProjectStore.getState().project : null;
    const existing = current?.objects.find((o) => o.id === editId);
    return current && existing ? shapeFromObject(existing, current.layers) : null;
  });
  const start = initial?.source ?? defaultShape('rectangle');
  const [kind, setKind] = useState<ShapeKind>(start.shape);
  const [width, setWidth] = useState(String(start.width_mm));
  const [height, setHeight] = useState(String(start.height_mm));
  const [radius, setRadius] = useState(String(start.corner_radius_mm));
  const [sides, setSides] = useState(String(start.sides));
  const [inner, setInner] = useState(String(Math.round(start.inner_ratio * 100)));
  const [mode, setMode] = useState<Mode>(initial?.mode ?? 'score');

  const source = useMemo(
    () =>
      clampShape({
        type: 'shape',
        shape: kind,
        width_mm: Number(width),
        height_mm: Number(height),
        corner_radius_mm: Number(radius),
        sides: Number(sides),
        inner_ratio: Number(inner) / 100,
      }),
    [kind, width, height, radius, sides, inner],
  );
  const paths = useMemo(() => shapePaths(source), [source]);

  if (!project) return null;

  const layerFor = (k: LayerKind) => project.layers.find((l) => l.kind === k && !l.name.startsWith(TEST_PREFIX));
  const layer = layerFor(mode);
  const bedW = project.machine.bed_width_mm;
  const bedH = project.machine.bed_height_mm;
  const tooBig = source.width_mm > bedW || source.height_mm > bedH;

  const add = () => {
    const object: WorkspaceObject = {
      id: crypto.randomUUID(),
      name: shapeName(source),
      kind: { type: 'vector', paths, source },
      // centred on the bed; drag it or use the Properties panel to move it
      transform: { a: 1, b: 0, c: 0, d: 1, e: bedW / 2 - source.width_mm / 2, f: bedH / 2 - source.height_mm / 2 },
      layer_id: layer?.id ?? null,
      visible: true,
      locked: false,
      z_index: useProjectStore.getState().nextZIndex(),
    };
    addObject(object);
    onClose();
  };

  // Replaces the outlines of the shape being edited. Position and rotation are kept; any resizing
  // done with the handles is folded into the size, so the numbers in this box stay true.
  const saveEdit = () => {
    if (!editId) return;
    const layerId = layer && initial && mode !== initial.mode ? layer.id : undefined;
    mutate((p) => {
      const at = p.objects.findIndex((o) => o.id === editId);
      const current = p.objects[at];
      if (current) p.objects[at] = applyEdit(current, source, paths, layerId);
    });
    onClose();
  };

  const numberField = (
    label: string,
    value: string,
    set: (v: string) => void,
    limits: { min: number; max: number; step: number },
  ) => (
    <>
      <label>{label}</label>
      <input
        type="number"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => set(e.target.value)}
      />
    </>
  );

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Add shape" style={{ width: 460, maxHeight: '90vh', overflowY: 'auto' }}>
        <h2>{editId ? 'Edit shape' : 'Add shape'}</h2>
        <div className="grid wide">
          <label>Shape</label>
          <select value={kind} onChange={(e: ChangeEvent<HTMLSelectElement>) => setKind(e.target.value as ShapeKind)}>
            {SHAPE_KINDS.map((k) => (
              <option key={k} value={k}>
                {SHAPE_LABELS[k]}
              </option>
            ))}
          </select>
          {numberField('Width (mm)', width, setWidth, { min: SHAPE_MIN_MM, max: SHAPE_MAX_MM, step: 0.5 })}
          {numberField('Height (mm)', height, setHeight, { min: SHAPE_MIN_MM, max: SHAPE_MAX_MM, step: 0.5 })}
          {kind === 'rectangle' &&
            numberField('Corner radius (mm)', radius, setRadius, { min: 0, max: SHAPE_MAX_MM / 2, step: 0.5 })}
          {kind === 'polygon' && numberField('Sides', sides, setSides, { min: SIDES_MIN, max: SIDES_MAX, step: 1 })}
          {kind === 'star' && numberField('Points', sides, setSides, { min: SIDES_MIN, max: SIDES_MAX, step: 1 })}
          {kind === 'star' &&
            numberField('Inner size (%)', inner, setInner, { min: INNER_MIN * 100, max: INNER_MAX * 100, step: 5 })}
          <label>Laser mode</label>
          <select value={mode} onChange={(e: ChangeEvent<HTMLSelectElement>) => setMode(e.target.value as Mode)}>
            <option value="fill">Engrave (fill)</option>
            <option value="score">Outline (score)</option>
            <option value="cut">Cut</option>
          </select>
        </div>
        <p className="hint">{MODE_HELP[mode]}</p>
        {!layer && <p className="hint">There is no {mode} layer, so the shape will go on the default layer. Change it in the Layers panel.</p>}
        <svg
          viewBox={`-1 -1 ${source.width_mm + 2} ${source.height_mm + 2}`}
          style={{ width: '100%', height: 130, background: '#070d12', borderRadius: 4 }}
          role="img"
          aria-label="Preview of the shape"
        >
          <path d={shapePathData(paths)} fill={mode === 'fill' ? '#8fe0a6' : 'none'} stroke="#8fe0a6" strokeWidth={0.6} vectorEffect="non-scaling-stroke" fillRule="evenodd" />
        </svg>
        <p className="hint">
          {source.width_mm} x {source.height_mm} mm. {editId ? 'It keeps its position on the bed.' : 'It is placed in the middle of the bed.'}
        </p>
        {tooBig && (
          <p className="banner danger">
            The shape is larger than the {bedW} x {bedH} mm bed.
          </p>
        )}
        <div className="modal-actions">
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={editId ? saveEdit : add}>
            {editId ? 'Save changes' : 'Add to project'}
          </button>
        </div>
      </div>
    </div>
  );
}
