import { useEffect, useRef, useState } from 'react';
import { DimInput } from '@/components/DimInput';
import { FontSelect } from '@/components/FontSelect';
import { useObjectEditing } from '@/components/useObjectEditing';
import { readShapeField, shapeFields } from '@/lib/inlineEdit';
import type { LaserMode } from '@/lib/objectEdit';
import { SHAPE_KINDS, SHAPE_LABELS } from '@/lib/shapes';
import { MAX_TEXT_CHARS } from '@/lib/textRender';
import { useEditStore } from '@/state/editStore';
import type { ShapeKind, TextAlignment } from '@/types/domain';

interface Props {
  /** The text or shape object to edit. */
  id: string;
  /**
   * "panel" sits in the Properties panel. "bar" is the floating editor on the canvas: it takes the
   * cursor when it opens, so you can type straight away.
   */
  variant: 'panel' | 'bar';
}

const rowStyle = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '6px 0' } as const;
const fieldStyle = {
  background: 'var(--panel)',
  color: 'inherit',
  border: '1px solid var(--line)',
  borderRadius: 4,
  padding: '3px 5px',
  font: 'inherit',
} as const;

/**
 * The boxes for editing a text or shape object in place: no dialog. Shapes get a size box for each
 * side (width, height, and corner radius, sides or inner size where they apply); text gets a text
 * box and its font settings. Everything changes the object live, and Tab goes from box to box.
 */
export function ObjectFields({ id, variant }: Props) {
  const edit = useObjectEditing(id);
  const focusNonce = useEditStore((s) => s.focusNonce);
  const firstBox = useRef<HTMLInputElement>(null);
  const textBox = useRef<HTMLTextAreaElement>(null);
  const [textDraft, setTextDraft] = useState<string | null>(null);
  const [nothingToDraw, setNothingToDraw] = useState(false);

  // The floating editor takes the cursor each time it opens.
  useEffect(() => {
    if (variant !== 'bar' || focusNonce === 0) return;
    const target = textBox.current ?? firstBox.current;
    target?.focus();
    target?.select();
  }, [variant, focusNonce]);

  const { shape, text } = edit;

  if (shape) {
    const fields = shapeFields(shape.source.shape);
    return (
      <div>
        <div style={rowStyle}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ opacity: 0.8 }}>Shape</span>
            <select
              value={shape.source.shape}
              style={fieldStyle}
              onChange={(e) => edit.setShapeKind(e.target.value as ShapeKind)}
            >
              {SHAPE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SHAPE_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ opacity: 0.8 }}>Laser</span>
            <select value={shape.mode} style={fieldStyle} onChange={(e) => edit.setShapeMode(e.target.value as LaserMode)}>
              <option value="fill">Engrave</option>
              <option value="score">Outline</option>
              <option value="cut">Cut</option>
            </select>
          </label>
        </div>
        <div style={rowStyle}>
          {fields.map((f, i) => (
            <DimInput
              key={f.key}
              label={f.label}
              unit={f.unit}
              value={readShapeField(shape.source, f.key)}
              onValue={(v) => edit.setShapeField(f.key, v)}
              inputRef={i === 0 ? firstBox : undefined}
              width={f.unit === 'mm' ? 62 : 48}
            />
          ))}
        </div>
      </div>
    );
  }

  if (text) {
    return (
      <div>
        <textarea
          ref={textBox}
          value={textDraft ?? text.text}
          maxLength={MAX_TEXT_CHARS}
          rows={variant === 'bar' ? 3 : 2}
          spellCheck={false}
          aria-label="Text"
          style={{ ...fieldStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
          onChange={(e) => {
            const typed = e.target.value;
            setTextDraft(typed);
            setNothingToDraw(!edit.setText({ text: typed }));
          }}
          onBlur={() => {
            setTextDraft(null);
            setNothingToDraw(false);
          }}
        />
        {nothingToDraw && <div style={{ opacity: 0.75, fontSize: '0.9em' }}>Nothing to draw yet: type some text.</div>}
        <div style={rowStyle}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ opacity: 0.8 }}>Font</span>
            <FontSelect value={text.fontFamily} onChange={(family) => edit.setText({ fontFamily: family })} />
          </label>
          <DimInput
            label="Size"
            unit="mm"
            value={Number(text.capHeight)}
            onValue={(v) => edit.setText({ capHeight: String(v) })}
            title="Letter height in mm"
          />
        </div>
        <div style={rowStyle}>
          <label className="check" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={text.bold} onChange={(e) => edit.setText({ bold: e.target.checked })} /> Bold
          </label>
          <label className="check" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={text.italic} onChange={(e) => edit.setText({ italic: e.target.checked })} /> Italic
          </label>
          <select value={text.align} style={fieldStyle} aria-label="Alignment" onChange={(e) => edit.setText({ align: e.target.value as TextAlignment })}>
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
          <DimInput
            label="Lines"
            value={Number(text.lineSpacing)}
            onValue={(v) => edit.setText({ lineSpacing: String(v) })}
            width={44}
            title="Line spacing"
          />
          <select value={text.mode} style={fieldStyle} aria-label="Laser mode" onChange={(e) => edit.setTextMode(e.target.value as LaserMode)}>
            <option value="fill">Engrave</option>
            <option value="score">Outline</option>
            <option value="cut">Cut</option>
          </select>
        </div>
      </div>
    );
  }

  return null;
}
