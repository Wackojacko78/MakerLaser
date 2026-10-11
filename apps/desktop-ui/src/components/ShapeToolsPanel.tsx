import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { NumberField } from '@/components/NumberField';
import { selectionKey } from '@/lib/selectionKeys';
import { api } from '@/lib/tauri';
import {
  BOOLEAN_HELP,
  BOOLEAN_LABELS,
  BOOLEAN_OPS,
  MAX_CIRCULAR_COUNT,
  MAX_OFFSET_MM,
  booleanChoices,
  booleanHint,
  chosenBase,
  circularSummary,
  emptyResultMessage,
  failure,
  offsetName,
  planBoolean,
  planBorder,
  planCircularArray,
  planOffset,
  resultObject,
  validateOffset,
  type BooleanOp,
} from '@/lib/shapeOps';
import { useProjectStore } from '@/state/projectStore';
import { useShapeToolsStore } from '@/state/shapeToolsStore';
import type { Path2D, WorkspaceObject } from '@/types/domain';

/**
 * What the window says after an action: green when it worked, red when it did not. It belongs to the
 * selection it was about (`key`) and is hidden when something else is selected, so it never goes stale.
 */
type Say = { ok: boolean; text: string; key: string } | null;

// ---- layout ------------------------------------------------------------------------------------
// The panel is narrow, so everything is built from two small pieces: a two-column grid whose columns
// may shrink (minmax(0, 1fr)), and fields with their label ABOVE the box, so a label never has to
// share a row with its box. Nothing here depends on the .field-row styles of the other panels.

const twoColumns: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, alignItems: 'end' };
const fullWidth: CSSProperties = { width: '100%', minWidth: 0, boxSizing: 'border-box' };
const hintStyle: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.35, overflowWrap: 'anywhere' };

function Group({ title, first, children }: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
        marginTop: first ? 0 : 10,
        paddingTop: first ? 0 : 8,
        borderTop: first ? 'none' : '1px solid var(--border, rgba(255, 255, 255, 0.14))',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', opacity: 0.8 }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <label title={title} style={{ display: 'grid', gap: 2, minWidth: 0, fontSize: 12 }}>
      <span style={{ opacity: 0.75 }}>{label}</span>
      {children}
    </label>
  );
}

function Tick({ checked, onChange, title, children }: { checked: boolean; onChange: (v: boolean) => void; title?: string; children: ReactNode }) {
  return (
    <label title={title} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, minWidth: 0 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 'auto', margin: 0, flex: '0 0 auto' }} />
      <span>{children}</span>
    </label>
  );
}

/**
 * Shape tools: combine shapes (union, subtract, intersect, exclude), offset them, and repeat them
 * round a circle. It is a window you bring up from the toolbar ("Shape tools...") and it stays up,
 * whatever is selected, until you close it with the x. It works on the current selection, so you can
 * pick other shapes with it open. Drag its title bar to move it; double-click the title bar to put it
 * back. Each action is one undo step and the answer is written under the buttons (no pop-ups).
 *
 * It is mounted once, in App.tsx, and draws nothing while it is closed, so its settings (distance,
 * corners, array settings ...) are kept between openings. The planning is in lib/shapeOps.ts;
 * combining and offsetting are done by the Rust geometry crate.
 */
export function ShapeToolsPanel() {
  const open = useShapeToolsStore((s) => s.open);
  const setOpen = useShapeToolsStore((s) => s.setOpen);
  const project = useProjectStore((s) => s.project);
  const selected = useProjectStore((s) => s.selected);
  const mutate = useProjectStore((s) => s.mutate);
  const setSelection = useProjectStore((s) => s.setSelection);
  const [busy, setBusy] = useState(false);
  const [say, setSay] = useState<Say>(null);
  const [cutFrom, setCutFrom] = useState<string | null>(null);
  const [distance, setDistance] = useState(2);
  const [rounded, setRounded] = useState(false);
  const [borderOnly, setBorderOnly] = useState(false);
  const [keepOriginal, setKeepOriginal] = useState(true);
  const [count, setCount] = useState(6);
  const [angle, setAngle] = useState(360);
  // null: the middle of the bed, whatever the bed is at the moment.
  const [centerX, setCenterX] = useState<number | null>(null);
  const [centerY, setCenterY] = useState<number | null>(null);
  const [turnCopies, setTurnCopies] = useState(false);
  // Where the window is, once it has been dragged. null: its usual place, beside the right-hand panel.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  // Every hook is above this line: the window can be closed without losing its settings.
  if (!open || !project) return null;

  const bed = { width: project.machine.bed_width_mm, height: project.machine.bed_height_mm };
  const choices = booleanChoices(project.objects, selected);
  // The base shape: the one picked, or the shape furthest back while nothing (valid) is picked.
  const baseId = chosenBase(choices, cutFrom);
  const canCombine = planBoolean(project.objects, selected, 'union', baseId).ok;
  const canOffset = planOffset(project.objects, selected).ok;
  const arrayOptions = {
    count,
    angleDeg: angle,
    centerX: centerX ?? bed.width / 2,
    centerY: centerY ?? bed.height / 2,
    rotateCopies: turnCopies,
  };
  const preview = planCircularArray(project.objects, selected, arrayOptions, bed, () => 'preview');
  const selectedCount = project.objects.filter((o) => selected.includes(o.id)).length;
  // Say something about the selection as it is NOW (call it after setSelection, so a result is about its own selection).
  const tell = (ok: boolean, text: string) => setSay({ ok, text, key: selectionKey(useProjectStore.getState().selected) });
  const shown = say && say.key === selectionKey(selected) ? say : null;

  const combine = async (op: BooleanOp) => {
    const plan = planBoolean(project.objects, selected, op, baseId);
    if (!plan.ok) {
      tell(false, plan.message);
      return;
    }
    setBusy(true);
    try {
      const paths = await api.booleanPaths(op, plan.shapes);
      const made = resultObject(paths, { name: BOOLEAN_LABELS[op], layerId: plan.layerId, zIndex: useProjectStore.getState().nextZIndex() });
      if (!made) {
        tell(false, emptyResultMessage(op));
        return;
      }
      const gone = new Set(plan.sourceIds);
      mutate((p) => {
        p.objects = p.objects.filter((o) => !gone.has(o.id));
        p.objects.push(made);
      });
      setSelection([made.id]);
      tell(true, `${BOOLEAN_LABELS[op]}: ${plan.sourceIds.length} shapes became one.`);
    } catch (e) {
      tell(false, failure(e));
    } finally {
      setBusy(false);
    }
  };

  const offsetBy = async (direction: 1 | -1) => {
    const problem = validateOffset(distance)[0];
    if (problem) {
      tell(false, problem);
      return;
    }
    const plan = planOffset(project.objects, selected);
    if (!plan.ok) {
      tell(false, plan.message);
      return;
    }
    const delta = direction * distance;
    setBusy(true);
    try {
      const moved = await Promise.all(plan.items.map((item) => api.offsetPaths(item.paths, delta, rounded)));
      // A border is the band between the old outline and the new one, with the middle left empty.
      const results: Path2D[][] = [];
      const wholeShape: string[] = [];
      for (const [i, item] of plan.items.entries()) {
        const newPaths = moved[i] ?? [];
        if (!borderOnly) {
          results.push(newPaths);
          continue;
        }
        const border = planBorder(item.paths, newPaths, delta);
        if (border.kind === 'direct') {
          if (border.paths.length > 0) wholeShape.push(item.name);
          results.push(border.paths);
        } else {
          results.push(await api.booleanPaths('subtract', border.shapes));
        }
      }
      let z = useProjectStore.getState().nextZIndex();
      const made: WorkspaceObject[] = [];
      const vanished: string[] = [];
      const replaced = new Set<string>();
      plan.items.forEach((item, i) => {
        const object = resultObject(results[i] ?? [], { name: offsetName(item.name, delta, borderOnly), layerId: item.layerId, zIndex: z });
        if (!object) {
          vanished.push(item.name);
          return;
        }
        z += 1;
        made.push(object);
        // The original is only replaced when asked, and never when it is locked or has open lines (they would be lost).
        if (!keepOriginal && !item.locked && !item.hasLoose) replaced.add(item.id);
      });
      if (made.length === 0) {
        tell(false, delta < 0 ? 'Nothing is left: the shape is smaller than the offset.' : 'Nothing was made.');
        return;
      }
      mutate((p) => {
        if (replaced.size > 0) p.objects = p.objects.filter((o) => !replaced.has(o.id));
        p.objects.push(...made);
      });
      setSelection(made.map((o) => o.id));
      const what = borderOnly ? 'border' : 'offset';
      const notes: string[] = [];
      if (vanished.length > 0) notes.push(`${vanished.map((n) => `"${n}"`).join(', ')} vanished (smaller than the offset).`);
      if (wholeShape.length > 0) notes.push(`${wholeShape.map((n) => `"${n}"`).join(', ')} is smaller than the offset, so its border is the whole shape.`);
      if (plan.skipped.length > 0) notes.push(`${plan.skipped.map((n) => `"${n}"`).join(', ')} left out (not a closed shape).`);
      if (!keepOriginal && made.length > replaced.size) notes.push('Locked shapes and shapes with open lines were kept.');
      tell(true, [`Made ${made.length} ${what} ${made.length === 1 ? 'shape' : 'shapes'}.`, ...notes].join(' '));
    } catch (e) {
      tell(false, failure(e));
    } finally {
      setBusy(false);
    }
  };

  const makeArray = () => {
    const plan = planCircularArray(project.objects, selected, arrayOptions, bed);
    const problem = plan.errors[0];
    if (problem) {
      tell(false, problem);
      return;
    }
    mutate((p) => {
      p.objects.push(...plan.copies);
    });
    setSelection([...selected, ...plan.copies.map((c) => c.id)]);
    tell(true, `Made ${plan.copies.length} copies.`);
  };

  const placement: CSSProperties = pos
    ? // Dragged: stay on screen if the window gets smaller.
      { left: `clamp(0px, ${Math.round(pos.left)}px, calc(100vw - 160px))`, top: `clamp(0px, ${Math.round(pos.top)}px, calc(100vh - 60px))` }
    : { top: 64, right: 'calc(var(--right-w, 340px) + 12px)' };

  return (
    <div
      role="dialog"
      aria-label="Shape tools"
      style={{
        position: 'fixed',
        ...placement,
        width: 320,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'calc(100vh - 140px)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
        boxSizing: 'border-box',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.55)',
      }}
    >
      <div
        title={'Drag to move \u00b7 double-click to put it back'}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 8px 12px', borderBottom: '1px solid var(--line)', cursor: 'grab', userSelect: 'none', touchAction: 'none' }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return; // the close button is not part of the handle
          const box = e.currentTarget.parentElement?.getBoundingClientRect();
          if (!box) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          grab.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
        }}
        onPointerMove={(e) => {
          const g = grab.current;
          if (g) setPos({ left: e.clientX - g.dx, top: e.clientY - g.dy });
        }}
        onPointerUp={() => {
          grab.current = null;
        }}
        onPointerCancel={() => {
          grab.current = null;
        }}
        onDoubleClick={() => setPos(null)}
      >
        <h3 style={{ margin: 0, flex: 1 }}>Shape tools</h3>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selectedCount === 0 ? 'nothing selected' : `${selectedCount} selected`}</span>
        <button className="mini" aria-label="Close Shape tools" title="Close (your settings are kept)" onClick={() => setOpen(false)}>
          {'\u00d7'}
        </button>
      </div>
      <div style={{ overflowY: 'auto', minWidth: 0, padding: '10px 12px 12px' }}>
        <Group title="Combine shapes" first>
          {choices.length >= 2 && (
            <Field label="Subtract from" title="The base shape. Subtract cuts all the other selected shapes out of it, and the result goes on its layer.">
              <select value={baseId ?? ''} onChange={(e) => setCutFrom(e.target.value)} style={{ ...fullWidth, textOverflow: 'ellipsis' }}>
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <p className="hint" style={hintStyle}>
            {booleanHint(project.objects, selected, baseId)}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
            {BOOLEAN_OPS.map((op) => (
              <button key={op} disabled={busy || !canCombine} title={BOOLEAN_HELP[op]} style={fullWidth} onClick={() => void combine(op)}>
                {BOOLEAN_LABELS[op]}
              </button>
            ))}
          </div>
        </Group>

        <Group title="Offset">
          <div style={twoColumns}>
            <Field label="Distance (mm)" title="How far the new outline is from the old one">
              <NumberField value={distance} min={0.01} max={MAX_OFFSET_MM} title="How far the new outline is from the old one" onCommit={setDistance} />
            </Field>
            <Field label="Corners">
              <select value={rounded ? 'round' : 'sharp'} onChange={(e) => setRounded(e.target.value === 'round')} style={fullWidth}>
                <option value="sharp">Sharp</option>
                <option value="round">Round</option>
              </select>
            </Field>
          </div>
          <Field
            label="Result"
            title="Engraving fills the whole shape. A border is only the band between the old outline and the new one, so the middle is left alone."
          >
            <select value={borderOnly ? 'border' : 'shape'} onChange={(e) => setBorderOnly(e.target.value === 'border')} style={fullWidth}>
              <option value="shape">Whole shape</option>
              <option value="border">Border only (a frame)</option>
            </select>
          </Field>
          {borderOnly && (
            <p className="hint" style={hintStyle}>
              A frame: the band between the old outline and the new one, with the middle empty. Engraving it leaves the middle alone.
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
            <button
              disabled={busy || !canOffset}
              title="A bigger outline round every selected shape. Holes get smaller."
              style={fullWidth}
              onClick={() => void offsetBy(1)}
            >
              Outward
            </button>
            <button
              disabled={busy || !canOffset}
              title="A smaller outline inside every selected shape. Holes get bigger."
              style={fullWidth}
              onClick={() => void offsetBy(-1)}
            >
              Inward
            </button>
          </div>
          <Tick checked={keepOriginal} onChange={setKeepOriginal} title="Leave the shape you started from where it is">
            Keep the original
          </Tick>
        </Group>

        <Group title="Circular array">
          <div style={twoColumns}>
            <Field label="Pieces" title="Pieces in the pattern, the original included">
              <NumberField value={count} min={2} max={MAX_CIRCULAR_COUNT} title="Pieces in the pattern, the original included" onCommit={(v) => setCount(Math.round(v))} />
            </Field>
            <Field label="Angle (degrees)" title="How far round the pattern goes: 360 is a full circle">
              <NumberField value={angle} min={1} max={360} title="How far round the pattern goes: 360 is a full circle" onCommit={setAngle} />
            </Field>
            <Field label="Centre X (mm)" title="The point the copies go round (mm from the left of the bed)">
              <NumberField value={arrayOptions.centerX} title="The point the copies go round (mm from the left of the bed)" onCommit={setCenterX} />
            </Field>
            <Field label="Centre Y (mm)" title="The point the copies go round (mm from the top of the bed)">
              <NumberField value={arrayOptions.centerY} title="The point the copies go round (mm from the top of the bed)" onCommit={setCenterY} />
            </Field>
          </div>
          <div style={{ ...twoColumns, alignItems: 'center' }}>
            <Tick checked={turnCopies} onChange={setTurnCopies} title="Turn each copy to face the way it has gone round, like the numbers on a clock">
              Turn the copies
            </Tick>
            <button
              style={fullWidth}
              title="Put the centre in the middle of the bed"
              onClick={() => {
                setCenterX(null);
                setCenterY(null);
              }}
            >
              Bed centre
            </button>
          </div>
          <p className="hint" style={hintStyle}>
            {selectedCount === 0 ? 'Select the shapes to repeat.' : circularSummary(preview, selectedCount)}
          </p>
          <button disabled={busy || preview.errors.length > 0} style={fullWidth} onClick={makeArray}>
            Make array
          </button>
        </Group>
        {shown && (
          <p className="hint" role="status" style={{ ...hintStyle, marginTop: 8, color: shown.ok ? 'var(--ok)' : 'var(--danger, #ff6b6b)' }}>
            {shown.text}
          </p>
        )}
      </div>
    </div>
  );
}
