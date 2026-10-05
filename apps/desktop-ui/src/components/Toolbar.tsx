import { useState } from 'react';
import { machineSummary } from '@/lib/selectionInfo';
import {
  generateFlow,
  importFromDialog,
  newProjectFlow,
  openProjectFlow,
  saveFlow,
} from '@/lib/actions';
import { useJobStore } from '@/state/jobStore';
import { useProjectStore } from '@/state/projectStore';
import { useViewStore } from '@/state/viewStore';
import { MachineSettingsDialog } from '@/components/MachineSettingsDialog';
import { TestGridDialog } from '@/components/TestGridDialog';
import { ArrangeDialog } from '@/components/ArrangeDialog';
import { TextDialog } from '@/components/TextDialog';

export function Toolbar() {
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore((s) => s.revision !== s.savedRevision);
  const hasSelection = useProjectStore((s) => s.selected.length > 0);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const mutate = useProjectStore((s) => s.mutate);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const duplicate = useProjectStore((s) => s.duplicateSelected);
  const remove = useProjectStore((s) => s.removeSelected);
  const requestFit = useViewStore((s) => s.requestFit);
  const busy = useJobStore((s) => s.busy);
  const running = useJobStore((s) => s.running);
  const showPreview = useJobStore((s) => s.showPreview);
  const hasResult = useJobStore((s) => s.result !== null);
  const setShowPreview = useJobStore((s) => s.setShowPreview);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);

  if (!project) return null;

  return (
    <header className="toolbar">
      <b className="brand">
        Maker<span>Laser</span>
      </b>
      <div className="group">
        <button onClick={() => void newProjectFlow()} title="New project (Ctrl+N)">New</button>
        <button onClick={() => void openProjectFlow()} title="Open project (Ctrl+O)">Open</button>
        <button onClick={() => void saveFlow(false)} title="Save (Ctrl+S)">Save</button>
        <button onClick={() => void saveFlow(true)} title="Save as (Ctrl+Shift+S)">Save as</button>
      </div>
      <div className="group">
        <button className="accent" onClick={() => void importFromDialog()} title="Import SVG, DXF or image (Ctrl+I)">
          Import
        </button>
      </div>
      <div className="group">
        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
        <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">Redo</button>
        <button onClick={duplicate} disabled={!hasSelection} title="Duplicate (Ctrl+D)">Duplicate</button>
        <button onClick={remove} disabled={!hasSelection} title="Delete (Del)">Delete</button>
      </div>
      <div className="group">
        <button onClick={requestFit} title="Fit the bed to the window">Fit</button>
        <button onClick={() => setTextOpen(true)} title="Add text from any installed font">Text…</button>
        <button onClick={() => setArrangeOpen(true)} title="Align, space and repeat the selected objects">Arrange…</button>
        <button onClick={() => setGridOpen(true)} title="Add a speed x power material test grid">Test grid…</button>
        <button onClick={() => setSettingsOpen(true)} title="Machine, bed size and view settings">Machine…</button>
      </div>

      <span className="spacer" />
      <button
        onClick={() => setSettingsOpen(true)}
        title={`Machine: ${project.machine.name}\n${machineSummary(project.machine)}\nClick to change the machine`}
        style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderColor: 'var(--accent)' }}
      >
        Machine: <b>{project.machine.name}</b>
      </button>

      <input
        className="project-name"
        value={project.name}
        onChange={(e) =>
          mutate((p) => {
            p.name = e.target.value;
          }, 'project-name')
        }
        title="Project name"
      />
      <span className="dirty" title={dirty ? 'Unsaved changes' : 'All changes saved'}>{dirty ? '●' : ''}</span>

      <div className="group">
        <label className="check" title="Show the toolpath preview over the artwork">
          <input type="checkbox" checked={showPreview} disabled={!hasResult} onChange={(e) => setShowPreview(e.target.checked)} />
          Preview
        </label>
        <button className="primary" onClick={() => void generateFlow()} disabled={busy || running} title="Generate toolpath and G-code (Ctrl+Enter)">
          {busy ? 'Generating…' : 'Generate & Preview'}
        </button>
      </div>

      {settingsOpen && <MachineSettingsDialog onClose={() => setSettingsOpen(false)} />}
      {gridOpen && <TestGridDialog onClose={() => setGridOpen(false)} />}
      {arrangeOpen && <ArrangeDialog onClose={() => setArrangeOpen(false)} />}
      {textOpen && <TextDialog onClose={() => setTextOpen(false)} />}
    </header>
  );
}
