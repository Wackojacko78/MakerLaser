import { formatLength, selectionStats, type Units } from '@/lib/measure';
import type { WorkspaceObject } from '@/types/domain';

/**
 * Extra size facts for the Selection panel, under the X / Y / W / H boxes: how many objects, the
 * corner-to-corner size, and the total length of the vector outlines (how much line would be cut
 * or scored). Read-only.
 */
export function SelectionStats({ objects, units }: { objects: readonly WorkspaceObject[]; units: Units }) {
  const s = selectionStats(objects);
  if (s.count === 0) return null;
  return (
    <div className="stats">
      {s.count > 1 && (
        <div className="stat-row">
          <span>Objects</span>
          <b>{s.count}</b>
        </div>
      )}
      <div className="stat-row" title="Corner to corner of the box around the selection">
        <span>Diagonal</span>
        <b>{formatLength(s.diagonal, units)}</b>
      </div>
      {s.outlineLength !== null && (
        <div className="stat-row" title="Total length of the vector outlines. Closed shapes include the closing edge.">
          <span>Outline length</span>
          <b>
            {formatLength(s.outlineLength, units)}
            {s.imageCount > 0 ? ' (images not counted)' : ''}
          </b>
        </div>
      )}
    </div>
  );
}
