import { useState, type ChangeEvent } from 'react';
import {
  planAlign,
  planArray,
  planCenterOnBed,
  planDistribute,
  type AlignMode,
  type AlignTo,
  type ArrayOptions,
  type MovePlan,
} from '@/lib/arrange';
import { useNoticeStore } from '@/state/noticeStore';
import { useProjectStore } from '@/state/projectStore';

interface Props {
  onClose: () => void;
}

const ALIGN_BUTTONS: Array<[AlignMode, string, string]> = [
  ['left', 'Left', 'Line up the left edges'],
  ['hcenter', 'Centre', 'Line up the horizontal centres'],
  ['right', 'Right', 'Line up the right edges'],
  ['top', 'Top', 'Line up the top edges'],
  ['vcenter', 'Middle', 'Line up the vertical centres'],
  ['bottom', 'Bottom', 'Line up the bottom edges'],
];

/** A text field's value as a number; empty or invalid text becomes NaN so the planner rejects it. */
const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Align, distribute, centre and grid-array the selected objects. It sits at the left of the
 * window, over the tool strip, and does not dim or block the canvas, so you can change the
 * selection with the window open.
 */
export function ArrangeDialog({ onClose }: Props) {
  const project = useProjectStore((s) => s.project);
  const selected = useProjectStore((s) => s.selected);
  const mutate = useProjectStore((s) => s.mutate);
  const setSelection = useProjectStore((s) => s.setSelection);
  const notify = useNoticeStore((s) => s.show);

  const [alignTo, setAlignTo] = useState<AlignTo>('selection');
  const [rows, setRows] = useState('2');
  const [cols, setCols] = useState('3');
  const [gapX, setGapX] = useState('5');
  const [gapY, setGapY] = useState('5');

  if (!project) return null;
  const bed = { width: project.machine.bed_width_mm, height: project.machine.bed_height_mm };

  const runMove = (plan: MovePlan) => {
    const moved = Object.keys(plan.updates).length;
    if (moved === 0) {
      notify('info', plan.message ?? 'Nothing to do.');
      return;
    }
    mutate((p) => {
      for (const o of p.objects) {
        const t = plan.updates[o.id];
        if (t) o.transform = t;
      }
    });
    const locked = plan.skippedLocked > 0 ? ` ${plural(plan.skippedLocked, 'locked object was', 'locked objects were')} left in place.` : '';
    notify('info', `Moved ${plural(moved, 'object', 'objects')}.${locked}`);
  };

  const opts: ArrayOptions = { rows: num(rows), cols: num(cols), gapX: num(gapX), gapY: num(gapY) };
  // A dry run for the summary under the settings; the real copies get their ids when you press the button.
  const preview = planArray(project.objects, selected, opts, bed, () => 'preview');

  const createArray = () => {
    const plan = planArray(project.objects, selected, opts, bed);
    if (plan.errors.length > 0) return;
    mutate((p) => {
      p.objects.push(...plan.copies);
    });
    setSelection([...selected, ...plan.copies.map((c) => c.id)]);
    notify('info', `Added ${plural(plan.copies.length, 'copy', 'copies')}.`);
    onClose();
  };

  const field = (value: string, set: (v: string) => void, label: string) => (
    <>
      <label>{label}</label>
      <input type="number" min="0" value={value} onChange={(e: ChangeEvent<HTMLInputElement>) => set(e.target.value)} />
    </>
  );

  return (
    <div className="modal-backdrop" style={{ background: 'transparent', placeItems: 'start start', padding: '64px 0 0 90px', pointerEvents: 'none' }}>
      <div className="modal" role="dialog" aria-label="Arrange" style={{ pointerEvents: 'auto', width: 340, maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' }}>
        <h2>Arrange</h2>
        <p className="hint" style={{ margin: '2px 0 8px' }}>
          {plural(selected.length, 'object', 'objects')} selected. You can change the selection with this window open.
        </p>

        <h4>Align</h4>
        <div className="grid wide">
          <label>Align to</label>
          <select value={alignTo} onChange={(e: ChangeEvent<HTMLSelectElement>) => setAlignTo(e.target.value as AlignTo)}>
            <option value="selection">The selection</option>
            <option value="bed">The bed</option>
          </select>
        </div>
        <div className="preset-row" style={{ flexWrap: 'wrap' }}>
          {ALIGN_BUTTONS.map(([mode, label, tip]) => (
            <button key={mode} title={tip} onClick={() => runMove(planAlign(project.objects, selected, mode, alignTo, bed))}>
              {label}
            </button>
          ))}
        </div>
        <div className="preset-row" style={{ flexWrap: 'wrap' }}>
          <button title="Move the selection so its middle is the middle of the bed" onClick={() => runMove(planCenterOnBed(project.objects, selected, bed))}>
            Centre on bed
          </button>
        </div>

        <h4>Space evenly</h4>
        <div className="preset-row" style={{ flexWrap: 'wrap' }}>
          <button title="Equal gaps from left to right (needs three or more objects)" onClick={() => runMove(planDistribute(project.objects, selected, 'x'))}>
            Across
          </button>
          <button title="Equal gaps from top to bottom (needs three or more objects)" onClick={() => runMove(planDistribute(project.objects, selected, 'y'))}>
            Down
          </button>
        </div>

        <h4>Grid array</h4>
        <p className="hint" style={{ margin: '0 0 6px' }}>Repeats the selection to the right and downwards.</p>
        <div className="grid wide">
          {field(cols, setCols, 'Columns')}
          {field(rows, setRows, 'Rows')}
          {field(gapX, setGapX, 'Column gap (mm)')}
          {field(gapY, setGapY, 'Row gap (mm)')}
        </div>
        {preview.errors.length > 0 && selected.length > 0 && <p className="banner danger">{preview.errors.join(' ')}</p>}
        {preview.errors.length === 0 && preview.bounds && (
          <p className="hint">
            Makes {plural(preview.copies.length, 'copy', 'copies')}, {Math.round((preview.bounds.maxX - preview.bounds.minX) * 10) / 10} ×{' '}
            {Math.round((preview.bounds.maxY - preview.bounds.minY) * 10) / 10} mm in all.
          </p>
        )}
        {preview.warnings.length > 0 && (
          <ul className="warnings">
            {preview.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        <div className="preset-row">
          <button className="primary" disabled={preview.errors.length > 0} onClick={createArray}>
            Create array
          </button>
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
