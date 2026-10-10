import { useEffect } from 'react';
import { importFromDialog } from '@/lib/actions';
import type { DrawTool } from '@/lib/inlineEdit';
import { useEditStore } from '@/state/editStore';
import { useMeasureStore } from '@/state/measureStore';
import { useProjectStore } from '@/state/projectStore';
import { useViewStore } from '@/state/viewStore';

const DRAW_TOOLS: { tool: DrawTool; glyph: string; label: string; title: string }[] = [
  { tool: 'rectangle', glyph: '\u25ad', label: 'Rectangle', title: 'Rectangle: drag on the canvas, or click, then type the sizes' },
  { tool: 'ellipse', glyph: '\u25ef', label: 'Ellipse', title: 'Ellipse or circle: drag on the canvas, or click (Shift keeps it round)' },
  { tool: 'polygon', glyph: '\u2b20', label: 'Polygon', title: 'Polygon: drag on the canvas, or click, then type the number of sides' },
  { tool: 'star', glyph: '\u2606', label: 'Star', title: 'Star: drag on the canvas, or click, then type the number of points' },
  { tool: 'text', glyph: 'T', label: 'Text', title: 'Text: click on the canvas, then type' },
];

export function ToolsPanel() {
  const project = useProjectStore((s) => s.project);
  const selected = useProjectStore((s) => s.selected.length);
  const view = useViewStore();
  const tool = useMeasureStore((s) => s.tool);
  const setTool = useMeasureStore((s) => s.setTool);
  const drawTool = useEditStore((s) => s.tool);
  const setDrawTool = useEditStore((s) => s.setTool);

  // Measure and the drawing tools exclude each other (pressing M while a drawing tool is picked).
  useEffect(() => {
    if (tool === 'measure' && drawTool !== null) setDrawTool(null);
  }, [tool, drawTool, setDrawTool]);

  const zoomBy = (factor: number) => {
    const next = Math.min(12, Math.max(0.1, view.scale * factor));
    // Zoom about the viewport centre-ish: keep the current pan origin stable.
    view.setView({ x: view.x, y: view.y, scale: next });
  };

  return (
    <aside className="left">
      <button
        className={tool === 'select' && drawTool === null ? 'tool active' : 'tool'}
        title="Select, move, resize and rotate (V)"
        onClick={() => {
          setTool('select');
          setDrawTool(null);
        }}
      >
        <span className="glyph">↖</span>
        <small>Select</small>
      </button>
      <button
        className={tool === 'measure' ? 'tool active' : 'tool'}
        title="Measure: click a point or a line, then a second one (M)"
        onClick={() => {
          setDrawTool(null);
          setTool('measure');
        }}
      >
        <span className="glyph">↔</span>
        <small>Measure</small>
      </button>
      {DRAW_TOOLS.map((t) => (
        <button
          key={t.tool}
          className={drawTool === t.tool ? 'tool active' : 'tool'}
          title={t.title}
          onClick={() => {
            setTool('select');
            setDrawTool(drawTool === t.tool ? null : t.tool);
          }}
        >
          <span className="glyph">{t.glyph}</span>
          <small>{t.label}</small>
        </button>
      ))}
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
