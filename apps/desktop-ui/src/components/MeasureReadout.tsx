import { formatLength, itemsToMeasure, measure, measurementRows } from '@/lib/measure';
import { useMeasureStore } from '@/state/measureStore';
import { useProjectStore } from '@/state/projectStore';

const STEP = ['Click a point or a line.', 'Click a second point or line.', 'Click again to start a new measurement.'] as const;

/**
 * Sits over the canvas: the pointer position in a corner, and, while the Measure tool is on, the
 * numbers for what you have picked. It ignores the mouse (except its Clear button) so it can never
 * block a click on the drawing.
 */
export function MeasureReadout() {
  const tool = useMeasureStore((s) => s.tool);
  const picks = useMeasureStore((s) => s.picks);
  const hover = useMeasureStore((s) => s.hover);
  const cursor = useMeasureStore((s) => s.cursor);
  const clear = useMeasureStore((s) => s.clear);
  const units = useProjectStore((s) => s.project?.settings.units ?? 'mm');
  const measuring = tool === 'measure';
  const m = measuring ? measure(itemsToMeasure(picks, hover)) : null;
  return (
    <>
      {cursor && (
        <div className="cursor-chip" title="Pointer position on the bed, from the top-left corner">
          X {formatLength(cursor.x, units)} &middot; Y {formatLength(cursor.y, units)}
        </div>
      )}
      {measuring && (
        <div className="measure-panel" role="status">
          <div className="measure-head">
            <b>Measure</b>
            <button className="mini" disabled={picks.length === 0} onClick={clear} title="Clear the measurement (Esc or right-click)">
              Clear
            </button>
          </div>
          {m && (
            <table className="measure-rows">
              <tbody>
                {measurementRows(m, units).map((r) => (
                  <tr key={r.label}>
                    <th>{r.label}</th>
                    <td>{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="hint">{STEP[Math.min(picks.length, 2)]}</p>
          <p className="hint">Shift: pick the exact point, no snapping &middot; Esc: clear &middot; V: back to Select</p>
        </div>
      )}
    </>
  );
}
