import { create } from 'zustand';
import type { GenerateResponse, JobEventPayload } from '@/types/domain';

const LOG_LIMIT = 300;

interface JobState {
  result: GenerateResponse | null;
  /** Project revision the result was generated from. */
  resultRevision: number | null;
  busy: boolean;
  running: boolean;
  paused: boolean;
  progress: { done: number; total: number } | null;
  status: string;
  log: string[];
  showPreview: boolean;
  /** 0..1 fraction of the toolpath drawn in the preview (the replay scrubber). */
  replay: number;

  setResult: (result: GenerateResponse, revision: number) => void;
  clearResult: () => void;
  setBusy: (busy: boolean) => void;
  setRunning: (running: boolean) => void;
  setStatus: (status: string) => void;
  setShowPreview: (show: boolean) => void;
  setReplay: (fraction: number) => void;
  addLog: (line: string) => void;
  clearLog: () => void;
  applyEvent: (event: JobEventPayload) => void;
}

export const useJobStore = create<JobState>((set) => ({
  result: null,
  resultRevision: null,
  busy: false,
  running: false,
  paused: false,
  progress: null,
  status: 'Ready',
  log: [],
  showPreview: true,
  replay: 1,

  setResult: (result, revision) =>
    set({ result, resultRevision: revision, replay: 1, showPreview: true, progress: null }),
  clearResult: () => set({ result: null, resultRevision: null }),
  setBusy: (busy) => set({ busy }),
  setRunning: (running) => set({ running, paused: false }),
  setStatus: (status) => set({ status }),
  setShowPreview: (showPreview) => set({ showPreview }),
  setReplay: (replay) => set({ replay: Math.min(1, Math.max(0, replay)) }),
  addLog: (line) =>
    set((s) => ({
      log: [...s.log.slice(-(LOG_LIMIT - 1)), `${new Date().toLocaleTimeString()}  ${line}`],
    })),
  clearLog: () => set({ log: [] }),

  applyEvent: (event) =>
    set((s) => {
      const stamp = (text: string) => [...s.log.slice(-(LOG_LIMIT - 1)), `${new Date().toLocaleTimeString()}  ${text}`];
      switch (event.type) {
        case 'progress':
          return { progress: { done: event.done, total: event.total }, status: 'Running' };
        case 'message':
          return { log: stamp(event.text) };
        case 'paused':
          return { paused: true, status: 'Paused', log: stamp('Paused') };
        case 'resumed':
          return { paused: false, status: 'Running', log: stamp('Resumed') };
        case 'completed':
          return { running: false, paused: false, status: 'Job complete', log: stamp('Job complete') };
        case 'aborted':
          return { running: false, paused: false, status: 'Stopped', log: stamp('Job stopped') };
        case 'failed':
          return { running: false, paused: false, status: 'Job failed', log: stamp(`Job failed: ${event.message}`) };
      }
    }),
}));
