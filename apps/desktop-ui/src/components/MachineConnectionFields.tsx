import { NumberField } from '@/components/NumberField';
import {
  CONNECTION_KINDS,
  KIND_LABEL,
  NETWORK_NOT_READY,
  connectionOf,
  connectionProblems,
  describeConnection,
} from '@/lib/connectionSettings';
import { useProjectStore } from '@/state/projectStore';
import type { ConnectionKind } from '@/types/domain';

/**
 * The Connection rows of the Machine window: USB serial, or a network address for FluidNC.
 * Rendered inside the window's two-column grid, so everything here is a label and a control.
 */
export function MachineConnectionFields() {
  const project = useProjectStore((s) => s.project);
  const mutate = useProjectStore((s) => s.mutate);
  if (!project) return null;
  const c = connectionOf(project.machine);
  const network = c.kind !== 'serial';

  const setKind = (kind: ConnectionKind) =>
    mutate((p) => {
      if (kind === 'serial') {
        delete p.machine.connection;
        return;
      }
      const current = connectionOf(p.machine);
      p.machine.connection = { kind, host: current.host, port: current.port };
    }, 'machine-connection-kind');

  const setHost = (host: string) =>
    mutate((p) => {
      const current = connectionOf(p.machine);
      if (current.kind !== 'serial') p.machine.connection = { ...current, host };
    }, 'machine-connection-host');

  const setPort = (port: number) =>
    mutate((p) => {
      const current = connectionOf(p.machine);
      if (current.kind !== 'serial') p.machine.connection = { ...current, port };
    }, 'machine-connection-port');

  const problems = network ? connectionProblems(c) : [];

  return (
    <>
      <label>Connection</label>
      <select value={c.kind} onChange={(e) => setKind(e.target.value as ConnectionKind)}>
        {CONNECTION_KINDS.map((k) => (
          <option key={k} value={k}>{KIND_LABEL[k]}</option>
        ))}
      </select>
      {network && (
        <>
          <label>Address</label>
          <input value={c.host} placeholder="192.168.1.50 or fluidnc.local" onChange={(e) => setHost(e.target.value)} />
          <label>Port</label>
          <NumberField
            value={c.port}
            min={0}
            max={65535}
            onCommit={(v) => setPort(Math.round(v))}
            title="0 means the usual port: 81 for WebSocket, 23 for Telnet"
          />
          <span />
          <span className="hint">{problems.length > 0 ? problems.join(' ') : `${describeConnection(c)}. ${NETWORK_NOT_READY}`}</span>
        </>
      )}
    </>
  );
}
