import { useEffect } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { WorkspaceCanvas } from '@/canvas/WorkspaceCanvas';
import { LayersPanel } from '@/components/LayersPanel';
import { MachineConsole } from '@/components/MachineConsole';
import { CloseGuard } from '@/components/CloseGuard';
import { MaterialsPanel } from '@/components/MaterialsPanel';
import { PropertiesPanel } from '@/components/PropertiesPanel';
import { ToolsPanel } from '@/components/ToolsPanel';
import { Toolbar } from '@/components/Toolbar';
import { errorMessage } from '@/lib/format';
import { api } from '@/lib/tauri';
import { useDragDropImport, useJobEvents, useShortcuts } from '@/lib/useAppEffects';
import { useNoticeStore } from '@/state/noticeStore';
import { useProjectStore } from '@/state/projectStore';
import '@/styles/app.css';

const RIGHT_MIN = 300;
const RIGHT_DEFAULT = 340; // the old fixed width
const RIGHT_KEY = 'makerlaser.rightPanelWidth';
const clampRight = (w: number) =>
  Math.min(Math.max(RIGHT_MIN, Math.round(window.innerWidth * 0.5)), Math.max(RIGHT_MIN, Math.round(w)));
const applyRightWidth = (w: number) => document.documentElement.style.setProperty('--right-w', w + 'px');

/** Drag-to-resize for the right-hand panel. The width is a CSS variable, remembered between sessions. */
function useRightPanelResize() {
  useEffect(() => {
    const saved = Number(localStorage.getItem(RIGHT_KEY));
    if (saved > 0) applyRightWidth(clampRight(saved));
    const onWindowResize = () => {
      const cur = parseFloat(document.documentElement.style.getPropertyValue('--right-w'));
      if (cur > 0) applyRightWidth(clampRight(cur));
    };
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const aside = handle.parentElement?.querySelector('aside.right') as HTMLElement | null;
    const startX = e.clientX;
    const startW = aside ? aside.getBoundingClientRect().width : RIGHT_DEFAULT;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => applyRightWidth(clampRight(startW + (startX - ev.clientX)));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (aside) localStorage.setItem(RIGHT_KEY, String(Math.round(aside.getBoundingClientRect().width)));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const reset = () => {
    applyRightWidth(RIGHT_DEFAULT);
    localStorage.removeItem(RIGHT_KEY);
  };

  return { onPointerDown, reset };
}

export default function App() {
  const rightResize = useRightPanelResize();
  const project = useProjectStore((s) => s.project);
  const notice = useNoticeStore((s) => s.notice);
  const dismiss = useNoticeStore((s) => s.dismiss);

  useJobEvents();
  useDragDropImport();
  useShortcuts();

  // Start with a fresh project from the backend (default layers, TTS-55 Pro profile).
  useEffect(() => {
    api
      .newProject()
      .then((p) => useProjectStore.getState().loadProject(p, null))
      .catch((e) => useNoticeStore.getState().show('error', `MakerLaser could not start: ${errorMessage(e)}`));
  }, []);

  if (!project) {
    return (
      <main className="splash">
        <b>
          Maker<span>Laser</span>
        </b>
        {notice?.kind === 'error' && <p className="fatal">{notice.text}</p>}
      </main>
    );
  }

  return (
    <main className="app">
      <Toolbar />
      <div className="body">
        <div
          className="panel-resize"
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize · double-click to reset"
          onPointerDown={rightResize.onPointerDown}
          onDoubleClick={rightResize.reset}
        />
        <ToolsPanel />
        <WorkspaceCanvas />
        <aside className="right">
          <PropertiesPanel />
          <LayersPanel />
          <MaterialsPanel />
        </aside>
      </div>
      <MachineConsole />
      <CloseGuard />
      {notice && (
        <div className={`notice ${notice.kind}`} role="status" onClick={dismiss}>
          {notice.text}
          <small> (click to dismiss)</small>
        </div>
      )}
    </main>
  );
}
