import { useState } from 'react';
import { formatDuration, formatLength } from '@/lib/format';
import { originInfo } from '@/lib/transform';
import { useJobStore } from '@/state/jobStore';
import { useMachineStore } from '@/state/machineStore';
import { useProjectStore } from '@/state/projectStore';

interface Props {
  onCancel: () => void;
  onConfirm: () => void;
}

const CORNER: Record<string, string> = {
  bottom_left: 'bottom-left',
  bottom_right: 'bottom-right',
  top_left: 'top-left',
  top_right: 'top-right',
};

/** The last stop before the laser can fire: summary, warnings and acknowledgements. */
export function PreflightDialog({ onCancel, onConfirm }: Props) {
  const project = useProjectStore((s) => s.project);
  const result = useJobStore((s) => s.result);
  const simulated = useMachineStore((s) => s.simulated);
  const [checks, setChecks] = useState([false, false, false]);

  if (!project || !result) return null;
  const origin = originInfo(project.machine);
  const allChecked = simulated || checks.every(Boolean);
  const warnings = [...result.safety.warnings, ...result.warnings];
  const toggle = (i: number) => setChecks((c) => c.map((v, j) => (j === i ? !v : v)));

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Pre-flight check">
        <h2>Ready to run “{project.name}”?</h2>

        {simulated ? (
          <p className="banner info">Simulator: no laser will fire.</p>
        ) : (
          <p className="banner danger">This will fire a real laser.</p>
        )}

        <table className="summary">
          <tbody>
            <tr><th>Estimated time</th><td>{formatDuration(result.estimated_seconds)}</td></tr>
            <tr><th>Cut / score length</th><td>{formatLength(result.stats.cut_mm)}</td></tr>
            <tr><th>Engrave / fill length</th><td>{formatLength(result.stats.engrave_mm)}</td></tr>
            <tr><th>Travel (laser off)</th><td>{formatLength(result.stats.travel_mm)}</td></tr>
            <tr><th>G-code lines</th><td>{result.line_count.toLocaleString()}</td></tr>
            <tr><th>Bed</th><td>{project.machine.bed_width_mm} × {project.machine.bed_height_mm} mm</td></tr>
          </tbody>
        </table>

        <p className="origin-note">
          Jobs are absolute. The laser head must be parked at the work origin, the{' '}
          <b>{CORNER[project.machine.origin] ?? 'machine'}</b> corner of the bed (X0 Y0 at {origin.x}, {origin.y} mm on
          screen). Use <b>Set origin here</b> after jogging there.
        </p>

        {warnings.length > 0 && (
          <ul className="warnings">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}

        {!simulated && (
          <div className="checks">
            <label><input type="checkbox" checked={checks[0]} onChange={() => toggle(0)} /> The material is secured and the laser is focused on it.</label>
            <label><input type="checkbox" checked={checks[1]} onChange={() => toggle(1)} /> Eye protection is on, and ventilation or extraction is running.</label>
            <label><input type="checkbox" checked={checks[2]} onChange={() => toggle(2)} /> I will stay with the machine and know how to stop it (Stop button or the machine's own switch).</label>
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={!allChecked} onClick={onConfirm}>
            {simulated ? 'Run simulation' : 'Start job'}
          </button>
        </div>
      </div>
    </div>
  );
}
