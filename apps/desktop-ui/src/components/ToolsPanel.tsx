import { importFromDialog } from '@/lib/actions';
import { useMeasureStore } from '@/state/measureStore';
import { useProjectStore } from '@/state/projectStore';
import { useViewStore } from '@/state/viewStore';

export function ToolsPanel() {
  const project = useProjectStore((s) => s.project);
  const selected = useProjectStore((s) => s.selected.length);
  const view = useViewStore();
  const tool = useMeasureStore((s) => s.tool);
  const setTool = useMeasureStore((s) => s.setTool);

  const zoomBy = (factor: number) => {
    const next = Math.min(12, Math.max(0.1, view.scale * factor));
    // Zoom about the viewport centre-ish: keep the current pan origin stable.
    view.setView({ x: view.x, y: view.y, scale: next });
  };

  return (
    <aside className="left">
      <button
        className={tool === 'select' ? 'tool active' : 'tool'}
        title="Select, move, resize and rotate (V)"
        onClick={() => setTool('select')}
      >
        <span className="glyph">↖</span>
        <small>Select</small>
      </button>
      <button
        className={tool === 'measure' ? 'tool active' : 'tool'}
        title="Measure: click a point or a line, then a second one (M)"
        onClick={() => setTool('measure')}
      >
        <span className="glyph">↔</span>
        <small>Measure</small>
      </button>
      <button className="tool" onClick={() => void importFromDialog()} title="Import artwork">
        <span className="glyph">⤓</span>
        <small>Import</small>
      </button>
      <button className="tool" onClick={view.requestFit} title="Fit bed to window">
        <span className="glyph">⛶</span>
        <small>Fit</small>
      </button>
      <div className="zoom">
        <button onClick={() => zoomBy(1.25)} title="Zoom in">+</button>
        <small>{Math.round(view.scale * 100)}%</small>
        <button onClick={() => zoomBy(0.8)} title="Zoom out">−</button>
      </div>
      <hr />
      <small className="meta">{project?.objects.length ?? 0} objects</small>
      <small className="meta">{selected} selected</small>
      <small className="meta">
        {project?.machine.bed_width_mm} × {project?.machine.bed_height_mm} mm
      </small>
    </aside>
  );
}
