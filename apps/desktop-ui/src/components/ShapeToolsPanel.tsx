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
import {
  DEFAULT_ORIGINAL_MODES,
  ORIGINAL_MODES,
  ORIGINAL_MODE_HELP,
  ORIGINAL_MODE_LABELS,
  applyOriginals,
  originalsNote,
  planOriginals,
  resultLook,
  type OriginalMode,
} from '@/lib/originals';
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
 * the buttons (no pop-ups). Each tool has its own "Original shapes" setting (lib/originals.ts): Combine and
 * Fillet / Chamfer replace the shapes they are made from, with their name and position in the list, and
 * Offset keeps its original, because its point is a new line round it. Any of them can also hide the originals
 * or leave them. The planning is in lib/shapeOps.ts and lib/corners.ts; combining and offsetting are done by
 * the Rust geometry crate.
 */
export function ShapeToolsPanel({ active }: { active: boolean }) {
  const project = useProjectStore((s) => s.project);
  const selected = useProjectStore((s) => s.selected);
  const mutate = useProjectStore((s) => s.mutate);
  const setSelection = useProjectStore((s) => s.setSelection);
  const [busy, setBusy] = useState(false);
  // What happens to the shapes a result is made from, for each tool (each has its own usual choice).
  const [originalCombine, setOriginalCombine] = useState<OriginalMode>(DEFAULT_ORIGINAL_MODES.combine);
  const [originalOffset, setOriginalOffset] = useState<OriginalMode>(DEFAULT_ORIGINAL_MODES.offset);
  const [originalCorners, setOriginalCorners] = useState<OriginalMode>(DEFAULT_ORIGINAL_MODES.corners);
  const [say, setSay] = useState<Say>(null);
  const [cutFrom, setCutFrom] = useState<string | null>(null);
  const [distance, setDistance] = useState(2);
  const [rounded, setRounded] = useState(false);
  const [borderOnly, setBorderOnly] = useState(false);
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
  // Where an object sits in the stacking order now (a result that takes its place keeps it).
  const zOf = (id: string): number | undefined => project.objects.find((o) => o.id === id)?.z_index;
  /** The "Original shapes" choice at the bottom of a tool. */
  const originalField = (value: OriginalMode, onChange: (mode: OriginalMode) => void) => (
    <PanelField label="Original shapes" title={ORIGINAL_MODE_HELP[value]}>
      <select value={value} onChange={(e) => onChange(e.target.value as OriginalMode)} style={fullWidth}>
        {ORIGINAL_MODES.map((m) => (
          <option key={m} value={m}>
            {ORIGINAL_MODE_LABELS[m]}
          </option>
        ))}
      </select>
    </PanelField>
  );

  const combine = async (op: BooleanOp) => {
    const plan = planBoolean(project.objects, selected, op, baseId);
    if (!plan.ok) {
      tell(false, plan.message);
      return;
    }
    setBusy(true);
    try {
      const paths = await api.booleanPaths(op, plan.shapes);
      const shape = resultObject(paths, { name: plan.baseName, layerId: plan.layerId, zIndex: useProjectStore.getState().nextZIndex() });
      if (!shape) {
        tell(false, emptyResultMessage(op));
        return;
      }
      // Shapes that are locked or have open lines are refused before this point, so every source can be replaced.
      const originals = planOriginals(
        originalCombine,
        plan.sourceIds.map((id) => ({ id, locked: false, hasLoose: false })),
      );
      // The result takes the place of the base shape: its name, and its position in the stacking order.
      const look = resultLook(originals.remove.length > 0, plan.baseName, `${plan.baseName} (${BOOLEAN_LABELS[op].toLowerCase()})`, baseId ? zOf(baseId) : undefined, shape.z_index);
      const made = { ...shape, name: look.name, z_index: look.zIndex };
      mutate((p) => {
        p.objects = applyOriginals(p.objects, originals);
        p.objects.push(made);
      });
      setSelection([made.id]);
      tell(true, [`${BOOLEAN_LABELS[op]}: ${plan.sourceIds.length} shapes became one.`, originalsNote(originals, 'combine')].filter(Boolean).join(' '));
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
      const shapes: Array<{ item: (typeof plan.items)[number]; shape: WorkspaceObject }> = [];
      const vanished: string[] = [];
      plan.items.forEach((item, i) => {
        const shape = resultObject(results[i] ?? [], { name: item.name, layerId: item.layerId, zIndex: 0 });
        if (shape) shapes.push({ item, shape });
        else vanished.push(item.name);
      });
      if (shapes.length === 0) {
        tell(false, delta < 0 ? 'Nothing is left: the shape is smaller than the offset.' : 'Nothing was made.');
        return;
      }
      // Only shapes that produced a result have an original to deal with. Locked ones, and ones with open lines, are kept.
      const originals = planOriginals(
        originalOffset,
        shapes.map(({ item }) => ({ id: item.id, locked: item.locked, hasLoose: item.hasLoose })),
      );
      const removed = new Set(originals.remove);
      let z = useProjectStore.getState().nextZIndex();
      const made: WorkspaceObject[] = shapes.map(({ item, shape }) => {
        const look = resultLook(removed.has(item.id), item.name, offsetName(item.name, delta, borderOnly), zOf(item.id), z);
        if (look.zIndex === z) z += 1;
        return { ...shape, name: look.name, z_index: look.zIndex };
      });
      mutate((p) => {
        p.objects = applyOriginals(p.objects, originals);
        p.objects.push(...made);
      });
      setSelection(made.map((o) => o.id));
      const what = borderOnly ? 'border' : 'offset';
      const notes: string[] = [];
      if (vanished.length > 0) notes.push(`${vanished.map((n) => `"${n}"`).join(', ')} vanished (smaller than the offset).`);
      if (wholeShape.length > 0) notes.push(`${wholeShape.map((n) => `"${n}"`).join(', ')} is smaller than the offset, so its border is the whole shape.`);
      if (plan.skipped.length > 0) notes.push(`${plan.skipped.map((n) => `"${n}"`).join(', ')} left out (not a closed shape).`);
      const about = originalsNote(originals, 'offset');
      if (about) notes.push(about);
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
    const shapes: Array<{ item: (typeof plan.items)[number]; shape: WorkspaceObject }> = [];
    const untouched: string[] = [];
    const totals = { shapes: 0, changed: 0, reduced: 0, skipped: 0 };
    for (const item of plan.items) {
      const result = roundCorners(item.paths, options);
      const shape = result.changed > 0 ? resultObject(result.paths, { name: item.name, layerId: item.layerId, zIndex: 0 }) : null;
      if (!shape) {
        untouched.push(item.name);
        continue;
      }
      shapes.push({ item, shape });
      totals.shapes += 1;
      totals.changed += result.changed;
      totals.reduced += result.reduced;
      totals.skipped += result.skipped;
    }
    if (shapes.length === 0) {
      tell(false, noCornersMessage({ minTurnDeg: minTurn, which: cornerWhich }));
      return;
    }
    // Only shapes that had a corner changed have an original to deal with. Locked ones, and ones with open lines, are kept.
    const originals = planOriginals(
      originalCorners,
      shapes.map(({ item }) => ({ id: item.id, locked: item.locked, hasLoose: item.hasLoose })),
    );
    const removed = new Set(originals.remove);
    let z = useProjectStore.getState().nextZIndex();
    const made: WorkspaceObject[] = shapes.map(({ item, shape }) => {
      const look = resultLook(removed.has(item.id), item.name, cornersName(item.name, style, cornerSize), zOf(item.id), z);
      if (look.zIndex === z) z += 1;
      return { ...shape, name: look.name, z_index: look.zIndex };
    });
    mutate((p) => {
      p.objects = applyOriginals(p.objects, originals);
      p.objects.push(...made);
    });
    setSelection(made.map((o) => o.id));
    const names = (list: readonly string[]) => list.map((n) => `"${n}"`).join(', ');
    const notes: string[] = [];
    if (untouched.length > 0) notes.push(`${names(untouched)} had no corner to change.`);
    if (plan.skipped.length > 0) notes.push(`${names(plan.skipped)} left out (not a closed shape).`);
    if (plan.tooDetailed.length > 0) notes.push(`${names(plan.tooDetailed)} left out (too much detail).`);
    const about = originalsNote(originals, 'corners');
    if (about) notes.push(about);
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
        {originalField(originalCombine, setOriginalCombine)}
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
        {originalField(originalOffset, setOriginalOffset)}
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
        {originalField(originalCorners, setOriginalCorners)}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
          <button disabled={!canCorners} title="Round the corners: each becomes an arc of the radius in Size." style={fullWidth} onClick={() => roundNow('round')}>
            Fillet
          </button>
          <button disabled={!canCorners} title="Cut the corners off: each is cut Size along both of its edges." style={fullWidth} onClick={() => roundNow('chamfer')}>
            Chamfer
          </button>
        </div>
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
