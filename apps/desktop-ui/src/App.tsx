import { useEffect } from 'react';
import { WorkspaceCanvas } from '@/canvas/WorkspaceCanvas';
import { LayersPanel } from '@/components/LayersPanel';
import { MachineConsole } from '@/components/MachineConsole';
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

export default function App() {
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
        <ToolsPanel />
        <WorkspaceCanvas />
        <aside className="right">
          <PropertiesPanel />
          <LayersPanel />
          <MaterialsPanel />
        </aside>
      </div>
      <MachineConsole />
      {notice && (
        <div className={`notice ${notice.kind}`} role="status" onClick={dismiss}>
          {notice.text}
          <small> (click to dismiss)</small>
        </div>
      )}
    </main>
  );
}
