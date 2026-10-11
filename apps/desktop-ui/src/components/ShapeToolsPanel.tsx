import { useMemo, useState } from 'react';
import { NumberField } from '@/components/NumberField';
import { PanelField, PanelGroup, PanelTick, fullWidth, hintStyle, twoColumns } from '@/components/PanelParts';
import {
  CORNER_WHICH,
  CORNER_WHICH_LABELS,
  DEFAULT_CORNER_SIZE_MM,
  DEFAULT_MIN_TURN_DEG,
  MAX_CORNER_MM,
  MAX_TURN_DEG,
  MIN_TURN_DEG,
  cornersHint,
  cornersName,
  cornersSummary,
  findCorners,
  noCornersMessage,
  planCorners,
  roundCorners,
  validateCornerOptions,
  type CornerStyle,
  type CornerWhich,
} from '@/lib/corners';
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
import type { Path2D, WorkspaceObject } from '@/types/domain';

/**
 * What the panel says after an action: green when it worked, red when it did not. It belongs to the
 * selection it was about (`key`) and is hidden when something else is selected, so it never goes stale.
 */
type Say = { ok: boolean; text: string; key: string } | null;

/**
 * Shape tools: combine shapes (union, subtract, intersect, exclude), offset them, and repeat them round a
 * circle. It is the "Shape tools" tab of the right-hand panel (RightTabs.tsx), also opened by the toolbar
 * button "Shape tools…". It works on the current selection, so you can pick other shapes while it is showing,
 * and it keeps its settings (distance, corners, array settings ...) while another tab is showing, because the
 * panel stays mounted and only draws nothing. Each action is one undo step and the answer is written under
 * the buttons (no pop-ups). The planning is in lib/shapeOps.ts; combining and offsetting are done by the
 * Rust geometry crate.
 */
export function ShapeToolsPanel({ active }: { active: boolean }) {
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
  // Fillet and chamfer: the size, which corners, and how sharp a bend has to be to count as a corner.
  const [cornerSize, setCornerSize] = useState(DEFAULT_CORNER_SIZE_MM);
  const [cornerWhich, setCornerWhich] = useState<CornerWhich>('all');
  const [minTurn, setMinTurn] = useState(DEFAULT_MIN_TURN_DEG);
  const [keepCornerOriginal, setKeepCornerOriginal] = useState(true);
  // How many corners the settings find in the selection: worked out again only when they, or the artwork, change.
  const cornerFound = useMemo(() => {
    if (!active || !project) return null;
    const plan = planCorners(project.objects, selected);
    let found = 0;
    let shapes = 0;
    if (plan.ok && Number.isFinite(minTurn) && minTurn >= MIN_TURN_DEG && minTurn <= MAX_TURN_DEG) {
      for (const item of plan.items) {
        const n = findCorners(item.paths, { minTurnDeg: minTurn, which: cornerWhich });
        if (n > 0) {
          found += n;
          shapes += 1;
        }
      }
    }
    return { plan, found, shapes };
  }, [active, project, selected, minTurn, cornerWhich]);
  // Every hook is above this line: the panel draws nothing while another tab is showing, and keeps its settings.
  if (!active || !project) return null;

  const bed = { width: project.machine.bed_width_mm, height: project.machine.bed_height_mm };
  const choices = booleanChoices(project.objects, selected);
  // The base shape: the one picked, or the shape furthest back while nothing (valid) is picked.
  const baseId = chosenBase(choices, cutFrom);
  const canCombine = planBoolean(project.objects, selected, 'union', baseId).ok;
  const canOffset = planOffset(project.objects, selected).ok;
  const cornerProblems = validateCornerOptions({ sizeMm: cornerSize, minTurnDeg: minTurn });
  const canCorners = cornerFound !== null && cornerFound.plan.ok && cornerFound.found > 0 && cornerProblems.length === 0;
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

  const roundNow = (style: CornerStyle) => {
    const problem = validateCornerOptions({ sizeMm: cornerSize, minTurnDeg: minTurn })[0];
    if (problem) {
      tell(false, problem);
      return;
    }
    const plan = planCorners(project.objects, selected);
    if (!plan.ok) {
      tell(false, plan.message);
      return;
    }
    const options = { style, sizeMm: cornerSize, minTurnDeg: minTurn, which: cornerWhich };
    let z = useProjectStore.getState().nextZIndex();
    const made: WorkspaceObject[] = [];
    const replaced = new Set<string>();
    const untouched: string[] = [];
    const totals = { shapes: 0, changed: 0, reduced: 0, skipped: 0 };
    for (const item of plan.items) {
      const result = roundCorners(item.paths, options);
      const object =
        result.changed > 0 ? resultObject(result.paths, { name: cornersName(item.name, style, cornerSize), layerId: item.layerId, zIndex: z }) : null;
      if (!object) {
        untouched.push(item.name);
        continue;
      }
      z += 1;
      made.push(object);
      totals.shapes += 1;
      totals.changed += result.changed;
      totals.reduced += result.reduced;
      totals.skipped += result.skipped;
      // The original is only replaced when asked, and never when it is locked or has open lines (they would be lost).
      if (!keepCornerOriginal && !item.locked && !item.hasLoose) replaced.add(item.id);
    }
    if (made.length === 0) {
      tell(false, noCornersMessage({ minTurnDeg: minTurn, which: cornerWhich }));
      return;
    }
    mutate((p) => {
      if (replaced.size > 0) p.objects = p.objects.filter((o) => !replaced.has(o.id));
      p.objects.push(...made);
    });
    setSelection(made.map((o) => o.id));
    const names = (list: readonly string[]) => list.map((n) => `"${n}"`).join(', ');
    const notes: string[] = [];
    if (untouched.length > 0) notes.push(`${names(untouched)} had no corner to change.`);
    if (plan.skipped.length > 0) notes.push(`${names(plan.skipped)} left out (not a closed shape).`);
    if (plan.tooDetailed.length > 0) notes.push(`${names(plan.tooDetailed)} left out (too much detail).`);
    if (!keepCornerOriginal && made.length > replaced.size) notes.push('Locked shapes and shapes with open lines were kept.');
    tell(true, [cornersSummary(style, totals), ...notes].join(' '));
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

  return (
    <section className="panel" aria-label="Shape tools" style={{ minWidth: 0 }}>
      <h3>Shape tools</h3>
      <p className="hint" style={{ ...hintStyle, marginBottom: 8 }}>
        {selectedCount === 0 ? 'Nothing is selected.' : selectedCount === 1 ? '1 object is selected.' : `${selectedCount} objects are selected.`} The tools work on the
        selection, so you can pick other shapes while this tab is showing.
      </p>
      <PanelGroup title="Combine shapes" first>
        {choices.length >= 2 && (
          <PanelField label="Subtract from" title="The base shape. Subtract cuts all the other selected shapes out of it, and the result goes on its layer.">
            <select value={baseId ?? ''} onChange={(e) => setCutFrom(e.target.value)} style={{ ...fullWidth, textOverflow: 'ellipsis' }}>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </PanelField>
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
      </PanelGroup>

      <PanelGroup title="Offset">
        <div style={twoColumns}>
          <PanelField label="Distance (mm)" title="How far the new outline is from the old one">
            <NumberField value={distance} min={0.01} max={MAX_OFFSET_MM} title="How far the new outline is from the old one" onCommit={setDistance} />
          </PanelField>
          <PanelField label="Corners">
            <select value={rounded ? 'round' : 'sharp'} onChange={(e) => setRounded(e.target.value === 'round')} style={fullWidth}>
              <option value="sharp">Sharp</option>
              <option value="round">Round</option>
            </select>
          </PanelField>
        </div>
        <PanelField
          label="Result"
          title="Engraving fills the whole shape. A border is only the band between the old outline and the new one, so the middle is left alone."
        >
          <select value={borderOnly ? 'border' : 'shape'} onChange={(e) => setBorderOnly(e.target.value === 'border')} style={fullWidth}>
            <option value="shape">Whole shape</option>
            <option value="border">Border only (a frame)</option>
          </select>
        </PanelField>
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
        <PanelTick checked={keepOriginal} onChange={setKeepOriginal} title="Leave the shape you started from where it is">
          Keep the original
        </PanelTick>
      </PanelGroup>

      <PanelGroup title="Fillet and chamfer">
        <div style={twoColumns}>
          <PanelField label="Size (mm)" title="A fillet's radius, or how far a chamfer cuts along each of the two edges. Where the edges next to a corner are too short, that corner is made smaller.">
            <NumberField value={cornerSize} min={0.01} max={MAX_CORNER_MM} title="Fillet radius, or chamfer length along each edge" onCommit={setCornerSize} />
          </PanelField>
          <PanelField
            label="Skip bends gentler than (°)"
            title="Only corners that turn the outline by at least this many degrees are changed. A square corner turns it by 90, a point on a smooth curve by a few, so the curves of circles and rounded shapes are left alone."
          >
            <NumberField value={minTurn} min={MIN_TURN_DEG} max={MAX_TURN_DEG} title="The least a corner must turn the outline, in degrees" onCommit={setMinTurn} />
          </PanelField>
        </div>
        <PanelField label="Which corners" title="Outside corners stick out; inside corners are notches. Holes are worked out from which outline is inside which.">
          <select value={cornerWhich} onChange={(e) => setCornerWhich(e.target.value as CornerWhich)} style={fullWidth}>
            {CORNER_WHICH.map((w) => (
              <option key={w} value={w}>
                {CORNER_WHICH_LABELS[w]}
              </option>
            ))}
          </select>
        </PanelField>
        <p className="hint" style={hintStyle}>
          {cornerProblems[0] ?? (cornerFound ? cornersHint(cornerFound.plan, cornerFound.found, cornerFound.shapes, { minTurnDeg: minTurn, which: cornerWhich }) : '')}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
          <button disabled={!canCorners} title="Round the corners: each becomes an arc of the radius in Size." style={fullWidth} onClick={() => roundNow('round')}>
            Fillet
          </button>
          <button disabled={!canCorners} title="Cut the corners off: each is cut Size along both of its edges." style={fullWidth} onClick={() => roundNow('chamfer')}>
            Chamfer
          </button>
        </div>
        <PanelTick checked={keepCornerOriginal} onChange={setKeepCornerOriginal} title="Leave the shape you started from where it is">
          Keep the original
        </PanelTick>
      </PanelGroup>
      <PanelGroup title="Circular array">
        <div style={twoColumns}>
          <PanelField label="Pieces" title="Pieces in the pattern, the original included">
            <NumberField value={count} min={2} max={MAX_CIRCULAR_COUNT} title="Pieces in the pattern, the original included" onCommit={(v) => setCount(Math.round(v))} />
          </PanelField>
          <PanelField label="Angle (degrees)" title="How far round the pattern goes: 360 is a full circle">
            <NumberField value={angle} min={1} max={360} title="How far round the pattern goes: 360 is a full circle" onCommit={setAngle} />
          </PanelField>
          <PanelField label="Centre X (mm)" title="The point the copies go round (mm from the left of the bed)">
            <NumberField value={arrayOptions.centerX} title="The point the copies go round (mm from the left of the bed)" onCommit={setCenterX} />
          </PanelField>
          <PanelField label="Centre Y (mm)" title="The point the copies go round (mm from the top of the bed)">
            <NumberField value={arrayOptions.centerY} title="The point the copies go round (mm from the top of the bed)" onCommit={setCenterY} />
          </PanelField>
        </div>
        <div style={{ ...twoColumns, alignItems: 'center' }}>
          <PanelTick checked={turnCopies} onChange={setTurnCopies} title="Turn each copy to face the way it has gone round, like the numbers on a clock">
            Turn the copies
          </PanelTick>
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
      </PanelGroup>
      {shown && (
        <p className="hint" role="status" style={{ ...hintStyle, marginTop: 8, color: shown.ok ? 'var(--ok)' : 'var(--danger, #ff6b6b)' }}>
          {shown.text}
        </p>
      )}
    </section>
  );
}
