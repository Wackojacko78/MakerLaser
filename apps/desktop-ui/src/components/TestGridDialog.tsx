import { useMemo, useState, type ChangeEvent } from 'react';
import {
  DEFAULT_TEST_GRID,
  MAX_STEPS_PER_AXIS,
  TEST_PREFIX,
  buildTestGrid,
  type TestGridKind,
  type TestGridOptions,
  type TestGridResult,
} from '@/lib/testGrid';
import { useProjectStore } from '@/state/projectStore';

interface Props {
  onClose: () => void;
}

type Form = Record<
  | 'speedStart' | 'speedEnd' | 'speedSteps' | 'powerStart' | 'powerEnd' | 'powerSteps'
  | 'cellMm' | 'gapMm' | 'x' | 'y' | 'labelSpeed' | 'labelPower' | 'passes' | 'lineSpacingMm',
  string
>;

const KIND_HELP: Record<TestGridKind, string> = {
  fill: 'Fill: solid engraved squares. Best for finding an engraving setting.',
  score: 'Score: square outlines. Best for finding a marking or scoring setting.',
  cut: 'Cut: square outlines at cutting settings. Start with low power on scrap.',
};

/** Parses a text field; an empty or invalid field becomes NaN so the generator rejects it. */
const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));

/** Dialog that adds a speed x power material test grid to the project (one undo step). */
export function TestGridDialog({ onClose }: Props) {
  const project = useProjectStore((s) => s.project);
  const addTestGrid = useProjectStore((s) => s.addTestGrid);
  const removeTestGrid = useProjectStore((s) => s.removeTestGrid);

  const maxFeed = project?.machine.max_feed_rate_mm_min ?? 10000;
  const [kind, setKind] = useState<TestGridKind>('fill');
  const [labels, setLabels] = useState(true);
  const [air, setAir] = useState(false);
  const [f, setF] = useState<Form>({
    speedStart: String(DEFAULT_TEST_GRID.speedStart),
    speedEnd: String(Math.min(DEFAULT_TEST_GRID.speedEnd, maxFeed)),
    speedSteps: String(DEFAULT_TEST_GRID.speedSteps),
    powerStart: String(DEFAULT_TEST_GRID.powerStart),
    powerEnd: String(DEFAULT_TEST_GRID.powerEnd),
    powerSteps: String(DEFAULT_TEST_GRID.powerSteps),
    cellMm: String(DEFAULT_TEST_GRID.cellMm),
    gapMm: String(DEFAULT_TEST_GRID.gapMm),
    x: String(DEFAULT_TEST_GRID.x),
    y: String(DEFAULT_TEST_GRID.y),
    labelSpeed: String(Math.min(DEFAULT_TEST_GRID.labelSpeed, maxFeed)),
    labelPower: String(DEFAULT_TEST_GRID.labelPower),
    passes: String(DEFAULT_TEST_GRID.passes),
    lineSpacingMm: String(DEFAULT_TEST_GRID.lineSpacingMm),
  });
  const set = (key: keyof Form) => (e: ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [key]: e.target.value }));

  const hasExisting = useMemo(() => project?.layers.some((l) => l.name.startsWith(TEST_PREFIX)) ?? false, [project]);

  const built = useMemo((): { grid: TestGridResult | null; error: string | null } => {
    if (!project) return { grid: null, error: 'No project is open.' };
    const withoutOld = project.layers.filter((l) => !l.name.startsWith(TEST_PREFIX));
    const options: Partial<TestGridOptions> = {
      kind,
      labels,
      airAssist: air,
      speedStart: num(f.speedStart),
      speedEnd: num(f.speedEnd),
      speedSteps: num(f.speedSteps),
      powerStart: num(f.powerStart),
      powerEnd: num(f.powerEnd),
      powerSteps: num(f.powerSteps),
      cellMm: num(f.cellMm),
      gapMm: num(f.gapMm),
      x: num(f.x),
      y: num(f.y),
      labelSpeed: num(f.labelSpeed),
      labelPower: num(f.labelPower),
      passes: num(f.passes),
      lineSpacingMm: num(f.lineSpacingMm),
      baseLayerZ: withoutOld.reduce((m, l) => Math.max(m, l.z_order), -1) + 1,
      baseObjectZ: project.objects.reduce((m, o) => Math.max(m, o.z_index), -1) + 1,
    };
    try {
      const grid = buildTestGrid({
        ...options,
        limits: {
          bedWidthMm: project.machine.bed_width_mm,
          bedHeightMm: project.machine.bed_height_mm,
          maxFeedMmMin: project.machine.max_feed_rate_mm_min,
          maxPowerPercent: 100,
        },
      });
      return { grid, error: null };
    } catch (e) {
      return { grid: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [project, kind, labels, air, f]);

  if (!project) return null;
  const { grid, error } = built;

  const add = () => {
    if (!grid) return;
    addTestGrid(grid);
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Material test grid" style={{ width: 480, maxHeight: '90vh', overflowY: 'auto' }}>
        <h2>Material test grid</h2>
        <p className="hint">
          Engraves small squares at different speeds (left to right) and powers (top to bottom). Run it once on a scrap of your
          material, then keep the settings of the best square.
        </p>

        <div className="grid wide">
          <label>Square type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as TestGridKind)}>
            <option value="fill">Fill (engrave)</option>
            <option value="score">Score (outline)</option>
            <option value="cut">Cut (outline)</option>
          </select>
        </div>
        <p className="hint">{KIND_HELP[kind]}</p>

        <h4>Speed (across)</h4>
        <div className="grid wide">
          <label>From (mm/min)</label>
          <input type="number" value={f.speedStart} onChange={set('speedStart')} />
          <label>To (mm/min)</label>
          <input type="number" value={f.speedEnd} onChange={set('speedEnd')} />
          <label>Steps (1-{MAX_STEPS_PER_AXIS})</label>
          <input type="number" value={f.speedSteps} onChange={set('speedSteps')} />
        </div>

        <h4>Power (down)</h4>
        <div className="grid wide">
          <label>From (%)</label>
          <input type="number" value={f.powerStart} onChange={set('powerStart')} />
          <label>To (%)</label>
          <input type="number" value={f.powerEnd} onChange={set('powerEnd')} />
          <label>Steps (1-{MAX_STEPS_PER_AXIS})</label>
          <input type="number" value={f.powerSteps} onChange={set('powerSteps')} />
        </div>

        <h4>Size and position</h4>
        <div className="grid wide">
          <label>Square size (mm)</label>
          <input type="number" value={f.cellMm} onChange={set('cellMm')} />
          <label>Gap (mm)</label>
          <input type="number" value={f.gapMm} onChange={set('gapMm')} />
          <label>Left edge X (mm)</label>
          <input type="number" value={f.x} onChange={set('x')} />
          <label>Top edge Y (mm)</label>
          <input type="number" value={f.y} onChange={set('y')} />
        </div>

        <h4>Options</h4>
        <div className="grid wide">
          <label>Passes</label>
          <input type="number" value={f.passes} onChange={set('passes')} />
          {kind === 'fill' && (
            <>
              <label>Line spacing (mm)</label>
              <input type="number" step="0.01" value={f.lineSpacingMm} onChange={set('lineSpacingMm')} />
            </>
          )}
          <label>Air assist</label>
          <input type="checkbox" checked={air} onChange={(e) => setAir(e.target.checked)} />
          <label>Engrave labels</label>
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />
          {labels && (
            <>
              <label>Label speed (mm/min)</label>
              <input type="number" value={f.labelSpeed} onChange={set('labelSpeed')} />
              <label>Label power (%)</label>
              <input type="number" value={f.labelPower} onChange={set('labelPower')} />
            </>
          )}
        </div>

        {error && <p className="banner danger">{error}</p>}
        {grid && (
          <>
            <p className="hint">
              {grid.cells.length} squares, {grid.widthMm} x {grid.heightMm} mm. Adds {grid.layers.length} layers named “{TEST_PREFIX}…”.
              {hasExisting ? ' The existing test grid is replaced.' : ''}
            </p>
            {grid.warnings.length > 0 && (
              <ul className="warnings">
                {grid.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="modal-actions">
          {hasExisting && (
            <button
              onClick={() => {
                removeTestGrid();
                onClose();
              }}
              title="Remove the test grid layers and squares from the project"
            >
              Remove existing grid
            </button>
          )}
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={grid === null} onClick={add}>
            Add to project
          </button>
        </div>
      </div>
    </div>
  );
}
