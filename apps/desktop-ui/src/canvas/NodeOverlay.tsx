import { useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Group, Line, Rect, Shape } from 'react-konva';
import { addNodeAt, moveHandleByDrag, moveNodesByDrag, snapContextFor } from '@/canvas/nodeActions';
import { PX_PER_MM } from '@/lib/constants';
import {
  DRAG_START_PX,
  MAX_DRAWN_NODES,
  NODE_HIT_PX,
  SEGMENT_HIT_PX,
  bandBox,
  dragDraft,
  editableNodes,
  handleTips,
  isSelected,
  moveGesture,
  pointerToWorldMm,
  pressOnCanvas,
  pxToMm,
  releaseAt,
  toWorldNodes,
  validRefs,
  type NodeGesture,
} from '@/lib/nodeEdit';
import { flattenNodes } from '@/lib/nodePath';
import { SNAP_PX, dragWithSnap, type SnapContext } from '@/lib/nodeSnap';
import { isAdditiveSelect } from '@/lib/selectionKeys';
import { applyToPoint } from '@/lib/transform';
import { useNodeEditStore } from '@/state/nodeEditStore';
import { useProjectStore } from '@/state/projectStore';
import { useViewStore } from '@/state/viewStore';
import type { NodePath, Point2 } from '@/types/domain';

/** Far bigger than any bed: the layer that catches the mouse while nodes are edited covers everything, so a click never reaches the artwork. */
const CATCH_PX = 500_000;
const HALF_MARKER_PX = 4;

/** The few drawing calls the markers need (a Konva context has them). Named here so no Konva type has to be. */
interface Pen {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fillStrokeShape(shape: unknown): void;
}

/** One small square for every pair in `points` (x, y, x, y ...), drawn as one path and then filled and stroked as the shape says. */
function drawSquares(pen: Pen, shape: unknown, points: readonly number[], half: number): void {
  pen.beginPath();
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i] as number;
    const y = points[i + 1] as number;
    pen.moveTo(x - half, y - half);
    pen.lineTo(x + half, y - half);
    pen.lineTo(x + half, y + half);
    pen.lineTo(x - half, y + half);
    pen.closePath();
  }
  pen.fillStrokeShape(shape);
}

/** A few short lines, from (x0, y0) to (x1, y1) for every four numbers in `points`: the handles. */
function drawLines(pen: Pen, shape: unknown, points: readonly number[]): void {
  pen.beginPath();
  for (let i = 0; i + 3 < points.length; i += 4) {
    pen.moveTo(points[i] as number, points[i + 1] as number);
    pen.lineTo(points[i + 2] as number, points[i + 3] as number);
  }
  pen.fillStrokeShape(shape);
}

/** One small diamond for every pair in `points`: the tips of the handles. */
function drawDiamonds(pen: Pen, shape: unknown, points: readonly number[], half: number): void {
  pen.beginPath();
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i] as number;
    const y = points[i + 1] as number;
    pen.moveTo(x, y - half);
    pen.lineTo(x + half, y);
    pen.lineTo(x, y + half);
    pen.lineTo(x - half, y);
    pen.closePath();
  }
  pen.fillStrokeShape(shape);
}

interface Latest {
  world: NodePath[];
  nodes: NodePath[];
}

/**
 * The nodes of the object being edited, drawn over it, and the mouse for them: click or box to pick, drag to move,
 * double-click a line to add a node. All the rules are in lib/nodeEdit.ts (unit-tested); this only draws and passes
 * positions in. While it is showing it covers the artwork, so the objects cannot be dragged, resized or picked.
 * Nothing is written until the mouse is let go, and then as one undo step.
 */
export function NodeOverlay({ viewScale }: { viewScale: number }) {
  const id = useNodeEditStore((s) => s.editingId);
  const selection = useNodeEditStore((s) => s.selection);
  const object = useProjectStore((s) => (id === null ? undefined : s.project?.objects.find((o) => o.id === id)));
  const [draft, setDraft] = useState<readonly NodePath[] | null>(null);
  const [band, setBand] = useState<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const gesture = useRef<NodeGesture | null>(null);
  const lastPoint = useRef<Point2 | null>(null);
  const latest = useRef<Latest | null>(null);
  // What the dragged nodes can land on (collected when the press starts a drag), and the one they have landed on, for the ring.
  const snapCtx = useRef<SnapContext | null>(null);
  const [snapMark, setSnapMark] = useState<Point2 | null>(null);

  const access = object ? editableNodes(object) : null;
  const nodes = access && access.ok ? access.nodes : null;
  const transform = object?.transform;
  const world = useMemo(() => (nodes && transform ? toWorldNodes(nodes, transform) : null), [nodes, transform]);
  const shownWorld = useMemo(() => (draft && transform ? toWorldNodes(draft, transform) : world), [draft, transform, world]);
  const picked = useMemo(() => (nodes ? validRefs(nodes, selection) : []), [nodes, selection]);

  useEffect(() => {
    latest.current = nodes && world ? { nodes, world } : null;
  });

  // The mouse can be let go anywhere, even outside the canvas: finish there.
  useEffect(() => {
    const onUp = () => {
      const g = gesture.current;
      const here = latest.current;
      gesture.current = null;
      snapCtx.current = null;
      setSnapMark(null);
      setBand(null);
      setDraft(null);
      if (!g || !here) return;
      const scale = useViewStore.getState().scale;
      const p = lastPoint.current ?? g.start;
      const result = releaseAt(g, here.world, useNodeEditStore.getState().selection, p, pxToMm(DRAG_START_PX, scale, PX_PER_MM));
      useNodeEditStore.getState().setSelection(result.selection);
      if (result.move) moveNodesByDrag(result.move.refs, result.move.dx, result.move.dy);
      if (result.handle) moveHandleByDrag(result.handle.ref, result.handle.side, result.handle.dx, result.handle.dy);
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  const total = nodes ? nodes.reduce((n, p) => n + p.nodes.length, 0) : 0;
  const markers = useMemo(() => {
    const plain: number[] = [];
    const chosen: number[] = [];
    if (!shownWorld) return { plain, chosen };
    shownWorld.forEach((np, path) =>
      np.nodes.forEach((n, node) => {
        const isPicked = isSelected(picked, { path, node });
        if (isPicked) chosen.push(n.x * PX_PER_MM, n.y * PX_PER_MM);
        else if (total <= MAX_DRAWN_NODES) plain.push(n.x * PX_PER_MM, n.y * PX_PER_MM);
      }),
    );
    return { plain, chosen };
  }, [shownWorld, picked, total]);

  // The handles of the picked nodes: a line from each node to the tip of each of its handles, and a diamond on the tip.
  const handles = useMemo(() => {
    const lines: number[] = [];
    const tips: number[] = [];
    if (!shownWorld) return { lines, tips };
    for (const t of handleTips(shownWorld, picked)) {
      lines.push(t.nodeX * PX_PER_MM, t.nodeY * PX_PER_MM, t.x * PX_PER_MM, t.y * PX_PER_MM);
      tips.push(t.x * PX_PER_MM, t.y * PX_PER_MM);
    }
    return { lines, tips };
  }, [shownWorld, picked]);

  const draftLines = useMemo(() => {
    if (!draft || !transform) return [];
    return flattenNodes(draft).map((p) => ({
      closed: p.closed,
      points: p.points.flatMap((q) => {
        const w = applyToPoint(transform, q);
        return [w.x * PX_PER_MM, w.y * PX_PER_MM];
      }),
    }));
  }, [draft, transform]);

  if (!object || !nodes || !transform || !world) return null;

  const half = HALF_MARKER_PX / viewScale;
  const worldAt = (e: Konva.KonvaEventObject<MouseEvent>): Point2 | null => {
    const pointer = e.target.getStage()?.getPointerPosition();
    return pointer ? pointerToWorldMm(pointer, useViewStore.getState(), PX_PER_MM) : null;
  };

  return (
    <Group>
      <Rect
        x={-CATCH_PX}
        y={-CATCH_PX}
        width={2 * CATCH_PX}
        height={2 * CATCH_PX}
        fill="rgba(0,0,0,0.01)"
        onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
          if (e.evt.button !== 0) return; // the middle button pans, which the stage handles
          const p = worldAt(e);
          if (!p) return;
          const scale = useViewStore.getState().scale;
          const r = pressOnCanvas(world, validRefs(nodes, useNodeEditStore.getState().selection), p, pxToMm(NODE_HIT_PX, scale, PX_PER_MM), isAdditiveSelect(e.evt));
          useNodeEditStore.getState().setSelection(r.selection);
          gesture.current = r.gesture;
          lastPoint.current = p;
          snapCtx.current = r.gesture && r.gesture.kind === 'drag' ? snapContextFor(r.gesture.refs, world, pxToMm(SNAP_PX, scale, PX_PER_MM)) : null;
          setBand(bandBox(r.gesture));
        }}
        onMouseMove={(e: Konva.KonvaEventObject<MouseEvent>) => {
          const g = gesture.current;
          if (!g) return;
          const p = worldAt(e);
          if (!p) return;
          const scale = useViewStore.getState().scale;
          const next = moveGesture(g, p, pxToMm(DRAG_START_PX, scale, PX_PER_MM));
          gesture.current = next;
          // Holding Alt drags without snapping. The pointer is replaced by where the snap puts the nodes, so the live outline and
          // what is committed on mouse up both use it.
          const dragged = dragWithSnap(next, p, snapCtx.current, !e.evt.altKey, pxToMm(SNAP_PX, scale, PX_PER_MM));
          lastPoint.current = dragged.point;
          setSnapMark(dragged.target);
          if (next.kind === 'band') setBand(bandBox(next));
          else setDraft(dragDraft(next, nodes, transform, dragged.point));
        }}
        onDblClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
          if (e.evt.button !== 0) return;
          const p = worldAt(e);
          if (!p) return;
          const scale = useViewStore.getState().scale;
          addNodeAt(p, pxToMm(NODE_HIT_PX, scale, PX_PER_MM), pxToMm(SEGMENT_HIT_PX, scale, PX_PER_MM));
        }}
      />
      {draftLines.map((l, i) => (
        <Line key={i} listening={false} points={l.points} closed={l.closed} stroke="#58d7ee" strokeWidth={1.4} strokeScaleEnabled={false} lineJoin="round" />
      ))}
      <Shape listening={false} stroke="#ffb020" strokeWidth={1} strokeScaleEnabled={false} sceneFunc={(ctx, shape) => drawLines(ctx, shape, handles.lines)} />
      <Shape listening={false} stroke="#3b2a00" strokeWidth={1} strokeScaleEnabled={false} fill="#ffd27a" sceneFunc={(ctx, shape) => drawDiamonds(ctx, shape, handles.tips, half * 1.1)} />
      <Shape listening={false} stroke="#58d7ee" strokeWidth={1} strokeScaleEnabled={false} fill="#0b3a45" sceneFunc={(ctx, shape) => drawSquares(ctx, shape, markers.plain, half)} />
      <Shape listening={false} stroke="#3b2a00" strokeWidth={1} strokeScaleEnabled={false} fill="#ffb020" sceneFunc={(ctx, shape) => drawSquares(ctx, shape, markers.chosen, half)} />
      {snapMark && (
        <Shape
          listening={false}
          stroke="#3ddc84"
          strokeWidth={2}
          strokeScaleEnabled={false}
          sceneFunc={(ctx, shape) => drawSquares(ctx, shape, [snapMark.x * PX_PER_MM, snapMark.y * PX_PER_MM], half * 2.2)}
        />
      )}
      {band && (
        <Rect
          listening={false}
          x={band.minX * PX_PER_MM}
          y={band.minY * PX_PER_MM}
          width={(band.maxX - band.minX) * PX_PER_MM}
          height={(band.maxY - band.minY) * PX_PER_MM}
          stroke="#ffb020"
          strokeWidth={1}
          strokeScaleEnabled={false}
          dash={[4, 3]}
          fill="rgba(255,176,32,0.08)"
        />
      )}
    </Group>
  );
}
