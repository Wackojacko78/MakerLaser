import { create } from 'zustand';
import type { GrblStatus, SerialPortInfo } from '@/types/domain';

interface MachineState {
  connected: boolean;
  simulated: boolean;
  port: string;
  baud: number;
  ports: SerialPortInfo[];
  useSimulator: boolean;
  status: GrblStatus | null;
  jogStep: number;

  setConnected: (connected: boolean, simulated: boolean) => void;
  setPort: (port: string) => void;
  setBaud: (baud: number) => void;
  setPorts: (ports: SerialPortInfo[]) => void;
  setUseSimulator: (use: boolean) => void;
  setStatus: (status: GrblStatus | null) => void;
  setJogStep: (mm: number) => void;
}

export const useMachineStore = create<MachineState>((set) => ({
  connected: false,
  simulated: false,
  port: '',
  baud: 115200,
  ports: [],
  useSimulator: true,
  status: null,
  jogStep: 10,

  setConnected: (connected, simulated) => set({ connected, simulated, status: null }),
  setPort: (port) => set({ port }),
  setBaud: (baud) => set({ baud }),
  setPorts: (ports) =>
    set((s) => ({ ports, port: ports.some((p) => p.name === s.port) ? s.port : ports[0]?.name ?? '' })),
  setUseSimulator: (useSimulator) => set({ useSimulator }),
  setStatus: (status) => set({ status }),
  setJogStep: (jogStep) => set({ jogStep }),
}));
