import { useMemo, useState, type ChangeEvent } from 'react';
import { renderText, MAX_TEXT_CHARS, type TextAlign } from '@/lib/textRender';
import { shapePathData } from '@/lib/textTrace';
import { fontChoices, installedFonts, isFontAvailable, pickDefaultFont } from '@/lib/fonts';
import { TEST_PREFIX } from '@/lib/testGrid';
import { useProjectStore } from '@/state/projectStore';
import type { LayerKind, WorkspaceObject } from '@/types/domain';

interface Props {
  onClose: () => void;
}

type Mode = 'fill' | 'score' | 'cut';


const MODE_HELP: Record<Mode, string> = {
  fill: 'Engrave: the letters are filled in. Best for names, labels and serial numbers.',
  score: 'Outline: only the edges of the letters are drawn, at your Score layer settings.',
  cut: 'Cut: the letters are cut out along their edges. Fine text can fall out; use large, bold letters.',
};

/** Adds text to the project as ordinary vector outlines. */
export function TextDialog({ onClose }: Props) {
  const project = useProjectStore((s) => s.project);
  const addObject = useProjectStore((s) => s.addObject);

  const [text, setText] = useState('Hello');
  const [fontFamily, setFontFamily] = useState(() => pickDefaultFont(installedFonts()));
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [capHeight, setCapHeight] = useState('10');
  const [align, setAlign] = useState<TextAlign>('left');
  const [lineSpacing, setLineSpacing] = useState('1.2');
  const [mode, setMode] = useState<Mode>('fill');

  const built = useMemo(() => {
    try {
      const shape = renderText({
        text,
        fontFamily,
        bold,
        italic,
        capHeightMm: Number(capHeight),
        align,
        lineSpacing: Number(lineSpacing),
      });
      return { shape, error: shape ? null : 'Nothing to draw: the text has no visible characters in this font.' };
    } catch (e) {
      return { shape: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [text, fontFamily, bold, italic, capHeight, align, lineSpacing]);

  if (!project) return null;
  const { shape, error } = built;

  const layerFor = (kind: LayerKind) => project.layers.find((l) => l.kind === kind && !l.name.startsWith(TEST_PREFIX));
  const layer = layerFor(mode);
  const bedW = project.machine.bed_width_mm;
  const bedH = project.machine.bed_height_mm;
  const tooBig = shape !== null && (shape.widthMm > bedW || shape.heightMm > bedH);

  const add = () => {
    if (!shape) return;
    const firstLine = text.trim().split(/\r?\n/)[0] ?? '';
    const object: WorkspaceObject = {
      id: crypto.randomUUID(),
      name: `Text: ${firstLine.length > 24 ? firstLine.slice(0, 24) + '\u2026' : firstLine}`,
      kind: { type: 'vector', paths: shape.paths },
      // centred on the bed; drag it or use the Properties panel to move it
      transform: { a: 1, b: 0, c: 0, d: 1, e: bedW / 2 - shape.widthMm / 2, f: bedH / 2 - shape.heightMm / 2 },
      layer_id: layer?.id ?? null,
      visible: true,
      locked: false,
      z_index: useProjectStore.getState().nextZIndex(),
    };
    addObject(object);
    onClose();
  };

  const field = { background: 'var(--panel)', color: 'inherit', border: '1px solid var(--line)', borderRadius: 4, padding: '4px 6px' };

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Add text" style={{ width: 460, maxHeight: '90vh', overflowY: 'auto' }}>
        <h2>Add text</h2>

        <textarea
          value={text}
          maxLength={MAX_TEXT_CHARS}
          rows={3}
          autoFocus
          spellCheck={false}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
          style={{ ...field, width: '100%', font: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
          aria-label="Text"
        />

        <div className="grid wide">
          <label>Font</label>
          <input list="makerlaser-fonts" value={fontFamily} onChange={(e: ChangeEvent<HTMLInputElement>) => setFontFamily(e.target.value)} />
          <label>Style</label>
          <span>
            <label className="check">
              <input type="checkbox" checked={bold} onChange={(e: ChangeEvent<HTMLInputElement>) => setBold(e.target.checked)} /> Bold
            </label>{' '}
            <label className="check">
              <input type="checkbox" checked={italic} onChange={(e: ChangeEvent<HTMLInputElement>) => setItalic(e.target.checked)} /> Italic
            </label>
          </span>
          <label>Letter height (mm)</label>
          <input type="number" min="1" max="200" step="0.5" value={capHeight} onChange={(e: ChangeEvent<HTMLInputElement>) => setCapHeight(e.target.value)} />
          <label>Alignment</label>
          <select value={align} onChange={(e: ChangeEvent<HTMLSelectElement>) => setAlign(e.target.value as TextAlign)}>
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
          <label>Line spacing</label>
          <input type="number" min="0.8" max="3" step="0.1" value={lineSpacing} onChange={(e: ChangeEvent<HTMLInputElement>) => setLineSpacing(e.target.value)} />
          <label>Laser mode</label>
          <select value={mode} onChange={(e: ChangeEvent<HTMLSelectElement>) => setMode(e.target.value as Mode)}>
            <option value="fill">Engrave (fill)</option>
            <option value="score">Outline (score)</option>
            <option value="cut">Cut</option>
          </select>
        </div>
        <datalist id="makerlaser-fonts">
          {fontChoices(installedFonts()).map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <p className="hint">{MODE_HELP[mode]}</p>
        {!isFontAvailable(fontFamily) && <p className="hint">&ldquo;{fontFamily}&rdquo; was not found on this computer, so a default font will be drawn instead. Pick a font from the list.</p>}
        {!layer && <p className="hint">There is no {mode} layer, so the text will go on the default layer. Change it in the Layers panel.</p>}

        {error && <p className="banner danger">{error}</p>}
        {shape && (
          <>
            <svg
              viewBox={`-1 -1 ${shape.widthMm + 2} ${shape.heightMm + 2}`}
              style={{ width: '100%', height: 130, background: '#070d12', borderRadius: 4 }}
              role="img"
              aria-label="Preview of the traced text"
            >
              <path d={shapePathData(shape.paths)} fill="#8fe0a6" fillRule="evenodd" />
            </svg>
            <p className="hint">
              {shape.widthMm} x {shape.heightMm} mm, {shape.paths.length} outlines. It is placed in the middle of the bed. If the
              preview is not the font you chose, that font is not installed.
            </p>
            {tooBig && <p className="banner danger">The text is larger than the {bedW} x {bedH} mm bed.</p>}
          </>
        )}

        <div className="modal-actions">
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={shape === null} onClick={add}>
            Add to project
          </button>
        </div>
      </div>
    </div>
  );
}
