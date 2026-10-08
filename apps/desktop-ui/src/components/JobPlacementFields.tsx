import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/format';
import {
  JOB_ORIGIN_GRID,
  JOB_ORIGIN_LABEL,
  START_FROM_HELP,
  START_FROM_LABEL,
  START_FROM_VALUES,
  describeUserOrigin,
  isRelative,
  jobOriginOf,
  startFromOf,
} from '@/lib/placement';
import { api } from '@/lib/tauri';
import { useMachineStore } from '@/state/machineStore';
import { useNoticeStore } from '@/state/noticeStore';
import { useProjectStore } from '@/state/projectStore';
import type { JobOrigin, StartFrom } from '@/types/domain';

/**
 * Start From and Job Origin, in the Machine window. Start From says whether the job runs where
 * you see it on the bed (absolute) or around the laser head; Job Origin says which point of the
 * job sits on the head. The User origin is a head position remembered by the app until the
 * controller is reset, so it lives on the Rust side, not in the project.
 */
export function JobPlacementFields() {
  const project = useProjectStore((s) => s.project);
  const mutate = useProjectStore((s) => s.mutate);
  const connected = useMachineStore((s) => s.connected);
  const notify = useNoticeStore((s) => s.show);
  const [origin, setOrigin] = useState<[number, number] | null>(null);

  useEffect(() => {
    api
      .userOrigin()
      .then(setOrigin)
      .catch(() => setOrigin(null));
  }, [connected]);

  if (!project) return null;
  const startFrom = startFromOf(project.settings);
  const jobOrigin = jobOriginOf(project.settings);
  const relative = isRelative(project.settings);

  const setStartFrom = (value: StartFrom) =>
    mutate((p) => {
      p.settings.start_from = value;
    }, 'start-from');
  const setJobOrigin = (value: JobOrigin) =>
    mutate((p) => {
      p.settings.job_origin = value;
    }, 'job-origin');

  const setHere = async () => {
    try {
      const o = await api.setUserOrigin();
      setOrigin(o);
      notify('info', `User origin set. ${describeUserOrigin(o)}`);
    } catch (e) {
      notify('error', errorMessage(e));
    }
  };
  const clear = async () => {
    try {
      await api.clearUserOrigin();
      setOrigin(null);
    } catch (e) {
      notify('error', errorMessage(e));
    }
  };

  return (
    <div className="grid wide">
      <label>Start from</label>
      <select value={startFrom} onChange={(e) => setStartFrom(e.target.value as StartFrom)}>
        {START_FROM_VALUES.map((v) => (
          <option key={v} value={v}>{START_FROM_LABEL[v]}</option>
        ))}
      </select>
      <label>Job origin</label>
      <div
        role="radiogroup"
        aria-label="Job origin"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 28px)', gap: 4, opacity: relative ? 1 : 0.4 }}
      >
        {JOB_ORIGIN_GRID.flat().map((o) => (
          <button
            key={o}
            role="radio"
            aria-checked={o === jobOrigin}
            disabled={!relative}
            title={`Job origin: ${JOB_ORIGIN_LABEL[o]}`}
            onClick={() => setJobOrigin(o)}
            style={{ width: 28, height: 28, padding: 0, fontWeight: o === jobOrigin ? 700 : 400 }}
          >
            {o === jobOrigin ? '\u25CF' : '\u25CB'}
          </button>
        ))}
      </div>
      {startFrom === 'user_origin' && (
        <>
          <label>User origin</label>
          <div className="preset-row" style={{ flexWrap: 'wrap' }}>
            <button
              onClick={() => void setHere()}
              disabled={!connected}
              title="Remember where the laser head is now as the start point (jog it there first)"
            >
              Set user origin
            </button>
            <button onClick={() => void clear()} disabled={!origin} title="Forget the start point">Clear</button>
            <span className="hint">{connected ? describeUserOrigin(origin) : 'Connect to set it.'}</span>
          </div>
        </>
      )}
      <span />
      <span className="hint">{START_FROM_HELP[startFrom]}</span>
    </div>
  );
}
