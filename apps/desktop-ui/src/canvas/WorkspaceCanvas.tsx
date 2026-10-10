import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Circle, Group, Image as KImage, Layer as KLayer, Line, Rect, Shape, Stage, Text, Transformer } from 'react-konva';
import useImage from 'use-image';
import { DrawPreview } from '@/canvas/DrawPreview';
import { finishDrawing } from '@/canvas/drawActions';
import { openEditorAt, openEditorForKey } from '@/canvas/editActions';
import { MeasureOverlay } from '@/canvas/MeasureOverlay';
import { ToolpathOverlay } from '@/canvas/ToolpathOverlay';
import { CanvasEditor } from '@/components/CanvasEditor';
import { MeasureReadout } from '@/components/MeasureReadout';
import { PX_PER_MM } from '@/lib/constants';
import type { Draft } from '@/lib/inlineEdit';
import { SNAP_PX, freePoint, snapAt, type MeasureItem } from '@/lib/measure';
import { api } from '@/lib/tauri';
import { compose, decompose, fitView, imageSizeMm, objectsInBox, originInfo } from '@/lib/transform';
import { useEditStore } from '@/state/editStore';
import { useJobStore } from '@/state/jobStore';
import { useMeasureStore } from '@/state/measureStore';
import { useProjectStore } from '@/state/projectStore';
import { useViewStore } from '@/state/viewStore';
import type { ImageObjectData, Path2D, Transform2D, WorkspaceObject } from '@/types/domain';

const MIN_SCALE = 0.1;
const MAX_SCALE = 12;

// ---- artwork rendering --------------------------------------------------------------

const imageUrlCache = new Map<string, string>();

function RasterImage({ data }: { data: ImageObjectData }) {
  const [url, setUrl] = useState<string | undefined>(imageUrlCache.get(data.asset_id));
  useEffect(() => {
    if (imageUrlCache.has(data.asset_id)) return;
    let cancelled = false;
    api
      .imageDataUrl(data.asset_id)
      .then((u) => {
        if (u && !cancelled) {
          imageUrlCache.set(data.asset_id, u);
          setUrl(u);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [data.asset_id]);
  const [image] = useImage(url ?? '');
  const [w, h] = imageSizeMm(data);
  return <KImage image={image} width={w * PX_PER_MM} height={h * PX_PER_MM} />;
}

const VectorShape = memo(function VectorShape({ paths, color }: { paths: Path2D[]; color: string }) {
  // `paths` keeps its identity across edits (see cloneProject), so this is computed once.
  const flat = useMemo(
    () => paths.map((p) => ({ closed: p.closed, points: p.points.flatMap((q) => [q.x * PX_PER_MM, q.y * PX_PER_MM]) })),
    [paths],
  );
  return (
    <>
      {flat.map((p, i) => (
        <Line
          key={i}
          points={p.points}
          closed={p.closed}
          stroke={color}
          strokeWidth={1.4}
          strokeScaleEnabled={false}
          hitStrokeWidth={14}
          // Near-invisible fill so clicking inside a closed shape selects it.
          fill={p.closed ? 'rgba(255,255,255,0.012)' : undefined}
          lineJoin="round"
        />
      ))}
    </>
  );
});

function BedGrid({ width, height, spacing }: { width: number; height: number; spacing: number }) {
  return (
    <Shape
      listening={false}
      stroke="#223344"
      strokeWidth={1}
      strokeScaleEnabled={false}
      sceneFunc={(ctx, shape) => {
        ctx.beginPath();
        const step = Math.max(1, spacing);
        for (let x = 0; x <= width; x += step) {
          ctx.moveTo(x * PX_PER_MM, 0);
          ctx.lineTo(x * PX_PER_MM, height * PX_PER_MM);
        }
        for (let y = 0; y <= height; y += step) {
          ctx.moveTo(0, y * PX_PER_MM);
          ctx.lineTo(width * PX_PER_MM, y * PX_PER_MM);
        }
        ctx.fillStrokeShape(shape);
      }}
    />
  );
}

function OriginMarker({
  info,
  viewScale,
}: {
  info: ReturnType<typeof originInfo>;
  viewScale: number;
}) {
  const len = 18; // mm
  const px = info.x * PX_PER_MM;
  const py = info.y * PX_PER_MM;
  const font = 11 / viewScale;
  return (
    <Group listening={false}>
      <Line points={[px, py, px + info.xDir * len * PX_PER_MM, py]} stroke="#ff5b5b" strokeWidth={2} strokeScaleEnabled={false} />
      <Line points={[px, py, px, py + info.yDir * len * PX_PER_MM]} stroke="#3ddc84" strokeWidth={2} strokeScaleEnabled={false} />
      <Circle x={px} y={py} radius={4 / viewScale} fill="#ffffff" />
      <Text
        x={px + info.xDir * (len * PX_PER_MM + 4 / viewScale) - (info.xDir < 0 ? font : 0)}
        y={py - font / 2}
        text="X"
        fontSize={font}
        fill="#ff5b5b"
      />
      <Text
        x={px - font / 3}
        y={py + info.yDir * (len * PX_PER_MM + 4 / viewScale) - (info.yDir < 0 ? font : 0)}
        text="Y"
        fontSize={font}
        fill="#3ddc84"
      />
    </Group>
  );
}

// ---- canvas ---------------------------------------------------------------------------

type Band = { x0: number; y0: number; x1: number; y1: number };

export function WorkspaceCanvas() {
  const project = useProjectStore((s) => s.project);
  const selected = useProjectStore((s) => s.selected);
  const select = useProjectStore((s) => s.select);
  const setSelection = useProjectStore((s) => s.setSelection);
  const clearSelection = useProjectStore((s) => s.clearSelection);
  const transformMany = useProjectStore((s) => s.transformMany);

  const view = useViewStore();
  const result = useJobStore((s) => s.result);
  const showPreview = useJobStore((s) => s.showPreview);
  const replay = useJobStore((s) => s.replay);
  const measuring = useMeasureStore((s) => s.tool === 'measure');
  const openEdit = useEditStore((s) => s.open);
  const drawTool = useEditStore((s) => s.tool);
  const revision = useProjectStore((s) => s.revision);

  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const panRef = useRef<{ x: number; y: number; viewX: number; viewY: number } | null>(null);
  const bandRef = useRef<Band | null>(null);
  const commitPending = useRef(false);
  const lastFit = useRef(-1);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [band, setBand] = useState<Band | null>(null);
  // A shape being dragged out with a drawing tool, and where the canvas sits on the screen (the
  // floating editor is positioned from it).
  const draftRef = useRef<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [canvasPos, setCanvasPos] = useState({ left: 0, top: 0 });

  const bedW = project?.machine.bed_width_mm ?? 0;
  const bedH = project?.machine.bed_height_mm ?? 0;

  // Track the container size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) });
      const box = entry.target.getBoundingClientRect();
      setCanvasPos({ left: box.left, top: box.top });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fit the bed to the viewport on first display and whenever a fit is requested.
  useEffect(() => {
    if (size.w < 50 || size.h < 50 || bedW <= 0 || bedH <= 0) return;
    if (lastFit.current === view.fitNonce) return;
    lastFit.current = view.fitNonce;
    useViewStore.getState().setView(fitView(size.w, size.h, bedW, bedH, PX_PER_MM));
  }, [size.w, size.h, bedW, bedH, view.fitNonce]);

  // Keep the Transformer attached to the selected, unlocked, visible nodes.
  useEffect(() => {
    const stage = stageRef.current;
    const transformer = transformerRef.current;
    if (!stage || !transformer || !project) return;
    const editable = new Set(project.objects.filter((o) => o.visible && !o.locked).map((o) => o.id));
    // The Measure tool picks points: nothing can be dragged, resized or rotated while it is on.
    const ids: string[] = measuring ? [] : selected;
    const nodes = ids
      .filter((id) => editable.has(id))
      .map((id) => stage.findOne((n: Konva.Node) => n.id() === id))
      .filter((n): n is Konva.Node => !!n);
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selected, project, measuring]);

  // A measurement belongs to the drawing it was made on: any change (a move, undo, a new file) clears it.
  useEffect(() => {
    useMeasureStore.getState().clear();
  }, [revision]);

  // Persist the position/rotation/scale of every selected node in ONE undo step. Konva
  // fires drag/transform end once per node, so the commit is coalesced to a microtask.
  const scheduleCommit = useCallback(() => {
    if (commitPending.current) return;
    commitPending.current = true;
    queueMicrotask(() => {
      commitPending.current = false;
      const stage = stageRef.current;
      if (!stage) return;
      const updates: Record<string, Transform2D> = {};
      for (const id of useProjectStore.getState().selected) {
        const node = stage.findOne((n: Konva.Node) => n.id() === id);
        if (!node) continue;
        updates[id] = compose({
          x: node.x() / PX_PER_MM,
          y: node.y() / PX_PER_MM,
          rotationDeg: node.rotation(),
          scaleX: node.scaleX(),
          scaleY: node.scaleY(),
        });
      }
      transformMany(updates);
    });
  }, [transformMany]);

  // Middle-mouse panning uses window listeners so it keeps working outside the canvas.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const pan = panRef.current;
      if (!pan) return;
      const v = useViewStore.getState();
      v.setView({ scale: v.scale, x: pan.viewX + (e.clientX - pan.x), y: pan.viewY + (e.clientY - pan.y) });
    };
    const onUp = () => {
      panRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Finishes a drag or click with a drawing tool: the shape (or the text) is added.
  const finishDraft = () => {
    const d = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (d) finishDrawing(d, useViewStore.getState().scale);
  };

  // Enter or F2 opens the editor of the selected text or shape.
  useEffect(() => {
    window.addEventListener('keydown', openEditorForKey);
    return () => window.removeEventListener('keydown', openEditorForKey);
  }, []);

  // Esc leaves a drawing tool (and cancels a drag in progress); V goes back to Select.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      const typing =
        el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (typing) return;
      const selectKey = (e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (e.key !== 'Escape' && !selectKey) return;
      if (useEditStore.getState().tool === null && draftRef.current === null) return;
      draftRef.current = null;
      setDraft(null);
      useEditStore.getState().setTool(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const worldPointer = () => layerRef.current?.getRelativePointerPosition() ?? null;

  /** What a click would pick here: a snap point or line, or (with Shift held) the exact point under the pointer. */
  const measureHit = (shift: boolean): MeasureItem | null => {
    const p = worldPointer();
    if (!p || !project) return null;
    const cursor = { x: p.x / PX_PER_MM, y: p.y / PX_PER_MM };
    if (shift) return freePoint(cursor);
    const tolMm = SNAP_PX / (useViewStore.getState().scale * PX_PER_MM);
    return snapAt(project.objects, cursor, { tolMm, bed: { width: bedW, height: bedH } });
  };

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 1) {
      e.evt.preventDefault();
      const v = useViewStore.getState();
      panRef.current = { x: e.evt.clientX, y: e.evt.clientY, viewX: v.x, viewY: v.y };
      return;
    }
    if (measuring) {
      // The Measure tool: left click picks, right click clears. Nothing is selected, dragged or boxed.
      if (e.evt.button === 2) {
        useMeasureStore.getState().clear();
      } else if (e.evt.button === 0) {
        const hit = measureHit(e.evt.shiftKey);
        if (hit) useMeasureStore.getState().addPick(hit);
      }
      return;
    }
    // A drawing tool is picked: this press starts a new shape (or text), even over existing artwork.
    if (drawTool !== null) {
      if (e.evt.button === 0) {
        const p = worldPointer();
        if (p) {
          const at = { x: p.x / PX_PER_MM, y: p.y / PX_PER_MM };
          draftRef.current = { tool: drawTool, x0: at.x, y0: at.y, x1: at.x, y1: at.y, square: e.evt.shiftKey };
          setDraft(draftRef.current);
        }
      }
      return;
    }
    // Empty canvas (bed, grid and overlays do not listen): start a rubber band.
    if (e.evt.button === 0 && e.target === e.target.getStage()) {
      if (!e.evt.shiftKey) clearSelection();
      const p = worldPointer();
      if (!p) return;
      bandRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      setBand(bandRef.current);
    }
  };

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pointer = worldPointer();
    useMeasureStore.getState().setCursor(pointer ? { x: pointer.x / PX_PER_MM, y: pointer.y / PX_PER_MM } : null);
    if (measuring) useMeasureStore.getState().setHover(measureHit(e.evt.shiftKey));
    const d = draftRef.current;
    if (d) {
      // Dragging out a shape: the preview follows the pointer.
      if (pointer) {
        draftRef.current = { ...d, x1: pointer.x / PX_PER_MM, y1: pointer.y / PX_PER_MM, square: e.evt.shiftKey };
        setDraft(draftRef.current);
      }
      return;
    }
    if (!bandRef.current) return;
    const p = worldPointer();
    if (!p) return;
    bandRef.current = { ...bandRef.current, x1: p.x, y1: p.y };
    setBand(bandRef.current);
  };

  const finishBand = (additive: boolean) => {
    const b = bandRef.current;
    bandRef.current = null;
    setBand(null);
    if (!b || !project) return;
    const scale = useViewStore.getState().scale;
    if (Math.abs(b.x1 - b.x0) * scale < 3 && Math.abs(b.y1 - b.y0) * scale < 3) return; // a click, not a drag
    const box = {
      minX: Math.min(b.x0, b.x1) / PX_PER_MM,
      maxX: Math.max(b.x0, b.x1) / PX_PER_MM,
      minY: Math.min(b.y0, b.y1) / PX_PER_MM,
      maxY: Math.max(b.y0, b.y1) / PX_PER_MM,
    };
    const ids = objectsInBox(project.objects, box);
    setSelection(additive ? Array.from(new Set([...useProjectStore.getState().selected, ...ids])) : ids);
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    const v = useViewStore.getState();
    const factor = e.evt.deltaY > 0 ? 1 / 1.12 : 1.12;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
    const wx = (pointer.x - v.x) / v.scale;
    const wy = (pointer.y - v.y) / v.scale;
    v.setView({ scale: next, x: pointer.x - wx * next, y: pointer.y - wy * next });
  };

  if (!project) return <div className="workspace" ref={wrapRef} />;

  const preview = showPreview && result !== null;
  const origin = originInfo(project.machine);
  const layerColor = (o: WorkspaceObject) =>
    project.layers.find((l) => l.id === o.layer_id)?.color ?? '#9aa7b4';

  return (
    <div
      className={measuring ? 'workspace measuring' : 'workspace'}
      ref={wrapRef}
      style={drawTool !== null && !measuring ? { cursor: 'crosshair' } : undefined}
      onDoubleClick={() => {
        // The browser's own double-click fires wherever the two clicks land. Konva's needs both
        // clicks on the very same drawn shape, which text and thin outlines often miss.
        const p = layerRef.current?.getRelativePointerPosition();
        if (p && !measuring && drawTool === null) {
          openEditorAt({ x: p.x / PX_PER_MM, y: p.y / PX_PER_MM }, useViewStore.getState().scale);
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {size.w > 0 && (
        <Stage
          ref={stageRef}
          width={size.w}
          height={size.h}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={(e: Konva.KonvaEventObject<MouseEvent>) => {
            finishDraft();
            finishBand(e.evt.shiftKey);
          }}
          onMouseLeave={() => {
            finishDraft();
            finishBand(false);
            useMeasureStore.getState().setCursor(null);
            useMeasureStore.getState().setHover(null);
          }}
        >
          <KLayer ref={layerRef}>
            <Rect
              listening={false}
              width={bedW * PX_PER_MM}
              height={bedH * PX_PER_MM}
              fill="#0e1822"
              stroke="#4fb3d9"
              strokeWidth={2}
              strokeScaleEnabled={false}
            />
            {project.settings.show_grid && (
              <BedGrid width={bedW} height={bedH} spacing={project.settings.grid_spacing_mm} />
            )}
            {project.settings.show_origin && <OriginMarker info={origin} viewScale={view.scale} />}

            {[...project.objects]
              .filter((o) => o.visible)
              .sort((a, b) => a.z_index - b.z_index)
              .map((o) => {
                const d = decompose(o.transform);
                return (
                  <Group
                    key={o.id}
                    id={o.id}
                    x={d.x * PX_PER_MM}
                    y={d.y * PX_PER_MM}
                    rotation={d.rotationDeg}
                    scaleX={d.scaleX}
                    scaleY={d.scaleY}
                    opacity={preview ? 0.3 : 1}
                    draggable={!o.locked && !measuring && drawTool === null}
                    onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
                      if (e.evt.button !== 0) return;
                      if (measuring) return; // the Measure tool picks points: it must not select or drag
                      if (drawTool !== null) return; // a drawing tool starts a new shape instead
                      e.cancelBubble = true; // do not start a rubber band
                      const already = useProjectStore.getState().selected.includes(o.id);
                      if (e.evt.shiftKey) select(o.id, true);
                      else if (!already) select(o.id);
                    }}
                    onDragEnd={scheduleCommit}
                    onTransformEnd={scheduleCommit}
                    onDblClick={() => {
                      // Double-click text or a shape to edit what it was made from.
                      if (!measuring && !o.locked && o.kind.type === 'vector' && o.kind.source) openEdit(o.id);
                    }}
                  >
                    {o.kind.type === 'vector' ? (
                      <VectorShape paths={o.kind.paths} color={layerColor(o)} />
                    ) : (
                      <RasterImage data={o.kind} />
                    )}
                  </Group>
                );
              })}

            {preview && result && (
              <ToolpathOverlay
                segments={result.segments}
                fraction={replay}
                bedWidth={bedW}
                bedHeight={bedH}
                viewScale={view.scale}
              />
            )}

            <Transformer
              ref={transformerRef}
              rotateEnabled
              rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
              rotationSnapTolerance={4}
              anchorSize={9}
              anchorFill="#58d7ee"
              anchorStroke="#0b3a45"
              borderStroke="#58d7ee"
              shouldOverdrawWholeArea
              boundBoxFunc={(oldBox, newBox) =>
                Math.abs(newBox.width) < 4 || Math.abs(newBox.height) < 4 ? oldBox : newBox
              }
            />

            <DrawPreview draft={draft} viewScale={view.scale} />
            {measuring && <MeasureOverlay viewScale={view.scale} />}
            {band && (
              <Rect
                listening={false}
                x={Math.min(band.x0, band.x1)}
                y={Math.min(band.y0, band.y1)}
                width={Math.abs(band.x1 - band.x0)}
                height={Math.abs(band.y1 - band.y0)}
                stroke="#58d7ee"
                strokeWidth={1}
                strokeScaleEnabled={false}
                dash={[4, 3]}
                fill="rgba(88,215,238,0.08)"
              />
            )}
          </KLayer>
        </Stage>
      )}
      <MeasureReadout />
      <CanvasEditor container={{ left: canvasPos.left, top: canvasPos.top, width: size.w, height: size.h }} />
      <div className="canvas-hint">
        Wheel: zoom &middot; Middle-drag: pan &middot; Drag empty space: box select &middot; Shift: add to
        selection &middot; Arrows: nudge (Shift = 10 mm) &middot; Double-click text or a shape: edit it &middot; R E P S T: draw &middot; Esc: leave a drawing tool
      </div>
    </div>
  );
}
