import { convertAndEdit, curvePicked, deletePickedNodes, enterNodeEdit, leaveNodeEdit, setPickedMode, setPickedNodePosition, straightenPicked } from '@/canvas/nodeActions';
import { NumberField } from '@/components/NumberField';
import { pickedMode, segmentsOfPick } from '@/lib/nodeCurves';
import { editableNodes, nodeSummary, nodeWorldPosition, validRefs } from '@/lib/nodeEdit';
import { useNodeEditStore } from '@/state/nodeEditStore';
import type { NodeMode, WorkspaceObject } from '@/types/domain';

const MODES: ReadonlyArray<{ mode: NodeMode; label: string; title: string }> = [
  { mode: 'corner', label: 'Corner', title: 'The two handles of the node are free, so it can be a sharp point' },
  { mode: 'smooth', label: 'Smooth', title: 'The handles lie on one line, so the curve has no kink here. Makes handles if there are none' },
  { mode: 'symmetric', label: 'Symmetric', title: 'Smooth, and the two handles are the same length. Makes handles if there are none' },
];

const rowStyle = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, margin: '4px 0' } as const;

/**
 * Node editing in the Properties panel, for the one selected outline: the button that starts it, what it can do while it
 * is on (the count, X and Y of the picked node, Delete, Done), and, for text and shapes, Convert to outlines. Text and
 * shapes stay text and shapes (and keep their size and font boxes) until they are converted. The rules are in
 * lib/nodeEdit.ts; the actions that change the project are in canvas/nodeActions.ts.
 */
export function NodesPanel({ object }: { object: WorkspaceObject }) {
  const editing = useNodeEditStore((s) => s.editingId === object.id);
  const selection = useNodeEditStore((s) => s.selection);
  if (object.kind.type !== 'vector') return null;
  const hasRecipe = object.kind.source !== undefined;
  const access = hasRecipe ? null : editableNodes(object);

  if (hasRecipe) {
    return (
      <div className="nodes-panel" style={{ margin: '6px 0' }}>
        <h4>Nodes</h4>
        <p className="hint">This is text or a shape, so it keeps its size and font boxes. To move its points, convert it to outlines first (Ctrl+Z undoes it). A circle or ellipse becomes 4 or 8 curve nodes, and rounded corners become curves.</p>
        <button disabled={object.locked} onClick={() => convertAndEdit(object.id)} title="Make this an ordinary outline with nodes. It looks the same, but is no longer text or a shape.">
          Convert to outlines
        </button>
      </div>
    );
  }
  if (!access || !access.ok) {
    return (
      <div className="nodes-panel" style={{ margin: '6px 0' }}>
        <h4>Nodes</h4>
        <p className="hint">{access ? access.message : ''}</p>
      </div>
    );
  }
  if (!editing) {
    return (
      <div className="nodes-panel" style={{ margin: '6px 0' }}>
        <h4>Nodes</h4>
        <button onClick={() => enterNodeEdit(object.id)} title="Show the points of this outline and move them (N). Double-click it does the same.">
          Edit nodes (N)
        </button>
      </div>
    );
  }
  const picked = validRefs(access.nodes, selection);
  const only = picked.length === 1 ? picked[0] : undefined;
  const pos = only ? nodeWorldPosition(access.nodes, only, object.transform) : null;
  const mode = pickedMode(access.nodes, picked);
  const pick = segmentsOfPick(access.nodes, picked);
  return (
    <div className="nodes-panel" style={{ margin: '6px 0' }}>
      <h4>Nodes</h4>
      <p className="hint" role="status">
        {nodeSummary(access.nodes, picked.length)}
      </p>
      {pos ? (
        <div className="field-row">
          <label>X</label>
          <NumberField value={pos.x} onCommit={(v) => setPickedNodePosition(v, pos.y)} title="Where the picked node is, in mm from the left of the bed" />
          <label>Y</label>
          <NumberField value={pos.y} onCommit={(v) => setPickedNodePosition(pos.x, v)} title="Where the picked node is, in mm from the top of the bed" />
        </div>
      ) : null}
      {picked.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4, margin: '4px 0' }} role="group" aria-label="Node type">
            {MODES.map((m) => (
              <button key={m.mode} className={mode === m.mode ? 'accent' : undefined} aria-pressed={mode === m.mode} title={m.title} onClick={() => setPickedMode(m.mode)}>
                {m.label}
              </button>
            ))}
          </div>
          <div style={rowStyle} role="group" aria-label="Lines and curves">
            <button disabled={pick.lines === 0} onClick={() => curvePicked()} title="Make the line between the picked nodes a curve (or the lines either side of one picked node). Then drag its handles">
              Curve
            </button>
            <button disabled={pick.curves === 0} onClick={() => straightenPicked()} title="Make the curve between the picked nodes a straight line again">
              Straight
            </button>
          </div>
        </>
      )}
      <div style={rowStyle}>
        <button disabled={picked.length === 0} onClick={() => deletePickedNodes()} title="Take the picked nodes out (Delete)">
          Delete {picked.length > 1 ? 'nodes' : 'node'}
        </button>
        <button className="accent" onClick={() => leaveNodeEdit()} title="Stop editing nodes (Esc or V)">
          Done
        </button>
      </div>
      <p className="hint">
        Click or drag a box to pick. Shift or Ctrl adds. Drag to move. Arrows nudge 1 mm (Shift 10). Double-click a line to add a node. Delete takes picked nodes out. A picked node shows its handles: drag one to bend the curve.
        {access.stale ? ' (The nodes were made again as plain corners.)' : ''}
      </p>
    </div>
  );
}
