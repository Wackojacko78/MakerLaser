import { useEffect, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { PreflightDialog } from '@/components/PreflightDialog';
import { frameFlow, startJobFlow, stopFlow } from '@/lib/actions';
import { errorMessage, formatDuration } from '@/lib/format';
import { decodeGrblMessage } from '@/lib/grblDiagnostics';
import { api } from '@/lib/tauri';
import { useJobStore } from '@/state/jobStore';
import { useMachineStore } from '@/state/machineStore';
import { useNoticeStore } from '@/state/noticeStore';
import { useProjectStore } from '@/state/projectStore';

const JOG_STEPS = [0.1, 1, 10, 50];
const JOG_FEED = 2000;
const BAUDS = [115200, 250000, 57600, 38400, 9600];

type Tab = 'console' | 'gcode';

/** Why the Start button is unavailable, or null when the job may start. */
function startBlocker(args: {
  connected: boolean;
  running: boolean;
  hasResult: boolean;
  fresh: boolean;
  unsafe: boolean;
  empty: boolean;
}): string | null {
  if (args.running) return 'A job is running.';
  if (!args.hasResult) return 'Generate & Preview first.';
  if (!args.fresh) return 'The project changed: generate again.';
  if (args.unsafe) return 'Resolve the safety errors first.';
  if (args.empty) return 'Nothing to run.';
  if (!args.connected) return 'Connect a machine or the simulator.';
  return null;
}

const CONSOLE_MIN = 236; // the old fixed height: never smaller than the controls need
const CONSOLE_KEY = 'makerlaser.consoleHeight';
const clampConsole = (h: number) =>
  Math.min(Math.max(CONSOLE_MIN, Math.round(window.innerHeight * 0.7)), Math.max(CONSOLE_MIN, Math.round(h)));
const applyConsoleHeight = (h: number) => document.documentElement.style.setProperty('--console-h', `${h}px`);

/** Drag-to-resize for the bottom console. The height is a CSS variable, remembered between sessions. */
function useConsoleResize() {
  useEffect(() => {
    const saved = Number(localStorage.getItem(CONSOLE_KEY));
    if (saved > 0) applyConsoleHeight(clampConsole(saved));
    const onWindowResize = () => {
      const cur = parseFloat(document.documentElement.style.getPropertyValue('--console-h'));
      if (cur > 0) applyConsoleHeight(clampConsole(cur));
    };
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const footer = handle.parentElement as HTMLElement;
    const startY = e.clientY;
    const startH = footer.getBoundingClientRect().height;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => applyConsoleHeight(clampConsole(startH + (startY - ev.clientY)));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      localStorage.setItem(CONSOLE_KEY, String(Math.round(footer.getBoundingClientRect().height)));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const reset = () => {
    applyConsoleHeight(CONSOLE_MIN);
    localStorage.removeItem(CONSOLE_KEY);
  };

  return { onPointerDown, reset };
}

export function MachineConsole() {
  const resize = useConsoleResize();
  const machine = useMachineStore();
  const job = useJobStore();
  const revision = useProjectStore((s) => s.revision);
  const baudFromProject = useProjectStore((s) => s.project?.machine.baud_rate);
  const notify = useNoticeStore((s) => s.show);
  const [tab, setTab] = useState<Tab>('console');
  const [preflight, setPreflight] = useState(false);

  // Default the baud rate from the machine profile.
  useEffect(() => {
    if (baudFromProject) useMachineStore.getState().setBaud(baudFromProject);
  }, [baudFromProject]);

  const refreshPorts = async () => {
    try {
      useMachineStore.getState().setPorts(await api.ports());
    } catch (e) {
      notify('error', `Could not list serial ports: ${errorMessage(e)}`);
    }
  };

  useEffect(() => {
    void refreshPorts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll the machine status while connected and idle (a running job holds the controller).
  useEffect(() => {
    if (!machine.connected || job.running) return;
    let alive = true;
    const tick = async () => {
      try {
        const status = await api.status();
        if (alive) useMachineStore.getState().setStatus(status);
      } catch {
        /* busy or transient: keep the last value */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [machine.connected, job.running]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      job.addLog(label);
    } catch (e) {
      const text = errorMessage(e);
      job.addLog(`${label} failed: ${text}`);
      notify('error', `${label} failed: ${text}`);
    }
  };

  const connect = async () => {
    const simulate = machine.useSimulator;
    if (!simulate && machine.port === '') {
      notify('warning', 'Choose a serial port first (or tick Simulator).');
      return;
    }
    await run(simulate ? 'Simulator connected' : `Connected to ${machine.port}`, async () => {
      await api.connect(simulate ? 'SIMULATOR' : machine.port, machine.baud, simulate);
      useMachineStore.getState().setConnected(true, simulate);
    });
  };

  const disconnect = () =>
    run('Disconnected', async () => {
      await api.disconnect();
      useMachineStore.getState().setConnected(false, false);
    });

  const jog = (dx: number, dy: number) =>
    run(`Jog ${dx || dy} mm`, () => api.jog(dx * machine.jogStep, dy * machine.jogStep, JOG_FEED));

  const result = job.result;
  const fresh = job.resultRevision === revision;
  const blocker = startBlocker({
    connected: machine.connected,
    running: job.running,
    hasResult: result !== null,
    fresh,
    unsafe: (result?.safety.errors.length ?? 0) > 0,
    empty: result !== null && result.segments.length === 0,
  });
  const percent = job.progress && job.progress.total > 0 ? (job.progress.done / job.progress.total) * 100 : 0;
  const idle = machine.connected && !job.running;

  return (
    <footer className="console">
      <div
        className="console-resize"
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize · double-click to reset"
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.reset}
      />
      <div className="console-controls">
        {/* ---- connection ---- */}
        <div className="block">
          <h4>Connection</h4>
          <label className="check">
            <input type="checkbox" checked={machine.useSimulator} disabled={machine.connected} onChange={(e) => machine.setUseSimulator(e.target.checked)} />
            Simulator
          </label>
          <div className="row">
            <select disabled={machine.connected || machine.useSimulator} value={machine.port} onChange={(e) => machine.setPort(e.target.value)}>
              {machine.ports.length === 0 && <option value="">No serial ports</option>}
              {machine.ports.map((p) => (
                <option key={p.name} value={p.name}>{p.name}{p.description ? ` – ${p.description}` : ''}</option>
              ))}
            </select>
            <button className="mini" disabled={machine.connected} onClick={() => void refreshPorts()} title="Refresh ports">⟳</button>
          </div>
          <div className="row">
            <select disabled={machine.connected || machine.useSimulator} value={machine.baud} onChange={(e) => machine.setBaud(Number(e.target.value))}>
              {[...new Set([machine.baud, ...BAUDS])].map((b) => (
                <option key={b} value={b}>{b} baud</option>
              ))}
            </select>
            {machine.connected ? (
              <button onClick={() => void disconnect()} disabled={job.running}>Disconnect</button>
            ) : (
              <button className="accent" onClick={() => void connect()}>Connect</button>
            )}
          </div>
          <small className={`state ${machine.status?.state ?? ''}`}>
            {machine.connected
              ? `${machine.simulated ? 'Simulator' : 'GRBL'}: ${machine.status?.state ?? '…'}${
                  machine.status ? `  X${machine.status.position.x.toFixed(1)} Y${machine.status.position.y.toFixed(1)}` : ''
                }`
              : 'Not connected'}
          </small>
        </div>

        {/* ---- manual control ---- */}
        <div className="block">
          <h4>Move</h4>
          <div className="jog">
            <span />
            <button disabled={!idle} onClick={() => void jog(0, -1)} title="Up the screen">↑</button>
            <span />
            <button disabled={!idle} onClick={() => void jog(-1, 0)}>←</button>
            <button disabled={!idle} onClick={() => void run('Home', api.home)} title="Run the homing cycle ($H)">⌂</button>
            <button disabled={!idle} onClick={() => void jog(1, 0)}>→</button>
            <span />
            <button disabled={!idle} onClick={() => void jog(0, 1)} title="Down the screen">↓</button>
            <span />
          </div>
          <div className="row steps">
            {JOG_STEPS.map((s) => (
              <button key={s} className={machine.jogStep === s ? 'on' : ''} onClick={() => machine.setJogStep(s)}>{s}</button>
            ))}
            <small>mm</small>
          </div>
          <div className="row">
            <button disabled={!idle} onClick={() => void run('Origin set here', api.setOrigin)} title="Make the head's current position X0 Y0">Set origin here</button>
            <button disabled={!idle} onClick={() => void run('Alarm unlocked', api.unlock)} title="Clear an alarm lock ($X)">Unlock</button>
          </div>
        </div>

        {/* ---- job ---- */}
        <div className="block job">
          <h4>Job</h4>
          <div className="row">
            <button disabled={!idle} onClick={() => void frameFlow()} title="Trace the job outline with the laser off">Frame</button>
            <button
              className="start"
              disabled={blocker !== null}
              title={blocker ?? 'Run the previewed job'}
              onClick={() => setPreflight(true)}
            >
              Start…
            </button>
          </div>
          <div className="row">
            {job.paused ? (
              <button disabled={!job.running} onClick={() => void run('Resumed', api.resume)}>Resume</button>
            ) : (
              <button disabled={!job.running} onClick={() => void run('Paused', api.pause)}>Pause</button>
            )}
            <button className="stop" disabled={!machine.connected} onClick={() => void stopFlow()} title="Stop immediately: soft-resets the controller">
              STOP
            </button>
          </div>
          <div className="progress" aria-label="Job progress">
            <div style={{ width: `${percent}%` }} />
          </div>
          <small>
            {job.status}
            {job.progress ? ` · ${job.progress.done}/${job.progress.total}` : ''}
            {result ? ` · est. ${formatDuration(result.estimated_seconds)}` : ''}
          </small>
          {blocker && !job.running && <small className="blocker">{blocker}</small>}
        </div>

        {/* ---- replay ---- */}
        <div className="block replay">
          <h4>Replay</h4>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(job.replay * 1000)}
            disabled={!result || result.segments.length === 0}
            onChange={(e) => job.setReplay(Number(e.target.value) / 1000)}
            aria-label="Toolpath replay position"
          />
          <small>
            {result
              ? `${Math.round(job.replay * 100)}% of the toolpath${result.preview_simplified ? ' (preview simplified)' : ''}`
              : 'Generate a toolpath to replay it.'}
          </small>
          <small className="legend">
            <span style={{ color: '#ff4d4d' }}>■ cut</span> <span style={{ color: '#4d9bff' }}>■ score</span>{' '}
            <span style={{ color: '#2fd57b' }}>■ fill</span> <span style={{ color: '#b57bff' }}>■ engrave</span>{' '}
            <span style={{ color: '#7d8a97' }}>┄ travel</span> <span style={{ color: '#ffb020' }}>■ outside bed</span>
          </small>
        </div>
      </div>

      <div className="console-tabs">
        <button className={tab === 'console' ? 'on' : ''} onClick={() => setTab('console')}>Console</button>
        <button className={tab === 'gcode' ? 'on' : ''} onClick={() => setTab('gcode')}>G-code</button>
        {tab === 'gcode' && result && (
          <button
            onClick={async () => {
              const path = await save({ defaultPath: 'job.gcode', filters: [{ name: 'G-code', extensions: ['gcode', 'nc'] }] });
              if (path) await run('G-code saved', () => api.saveGcode(path));
            }}
          >
            Save G-code…
          </button>
        )}
        <span className="spacer" />
        <button className="mini" onClick={job.clearLog}>Clear</button>
      </div>

      {tab === 'console' ? (
        <pre className="log">
          {job.log.length === 0
            ? 'Messages from the machine and the planner appear here.'
            : job.log.map((line, i) => {
                const d = decodeGrblMessage(line.replace(/^[^ ]+\s+/, ''));
                return (
                  <div key={i} className={d ? d.kind : ''}>
                    {line}
                    {d ? `  →  ${d.title}` : ''}
                  </div>
                );
              })}
        </pre>
      ) : (
        <pre className="gcode">
          {result ? result.gcode_preview : 'Generate a toolpath to see the G-code.'}
          {result && result.line_count > 3000 ? `\n… (${result.line_count - 3000} more lines; use Save G-code to see all)` : ''}
        </pre>
      )}

      {preflight && result && (
        <PreflightDialog
          onCancel={() => setPreflight(false)}
          onConfirm={() => {
            setPreflight(false);
            void startJobFlow();
          }}
        />
      )}
    </footer>
  );
}
