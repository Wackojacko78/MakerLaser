import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Circle, Group, Image as KImage, Layer as KLayer, Line, Rect, Shape, Stage, Text, Transformer } from 'react-konva';
import useImage from 'use-image';
import { ToolpathOverlay } from '@/canvas/ToolpathOverlay';
import { PX_PER_MM } from '@/lib/constants';
import { api } from '@/lib/tauri';
import { compose, decompose, fitView, imageSizeMm, objectsInBox, originInfo } from '@/lib/transform';
import { useJobStore } from '@/state/jobStore';
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

  const bedW = project?.machine.bed_width_mm ?? 0;
  const bedH = project?.machine.bed_height_mm ?? 0;

  // Track the container size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) });
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
    const nodes = selected
      .filter((id) => editable.has(id))
      .map((id) => stage.findOne((n: Konva.Node) => n.id() === id))
      .filter((n): n is Konva.Node => !!n);
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selected, project]);

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

  const worldPointer = () => layerRef.current?.getRelativePointerPosition() ?? null;

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 1) {
      e.evt.preventDefault();
      const v = useViewStore.getState();
      panRef.current = { x: e.evt.clientX, y: e.evt.clientY, viewX: v.x, viewY: v.y };
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

  const onMouseMove = () => {
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
    <div className="workspace" ref={wrapRef} onContextMenu={(e) => e.preventDefault()}>
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
          onMouseUp={(e: Konva.KonvaEventObject<MouseEvent>) => finishBand(e.evt.shiftKey)}
          onMouseLeave={() => finishBand(false)}
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
                    draggable={!o.locked}
                    onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
                      if (e.evt.button !== 0) return;
                      e.cancelBubble = true; // do not start a rubber band
                      const already = useProjectStore.getState().selected.includes(o.id);
                      if (e.evt.shiftKey) select(o.id, true);
                      else if (!already) select(o.id);
                    }}
                    onDragEnd={scheduleCommit}
                    onTransformEnd={scheduleCommit}
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
      <div className="canvas-hint">
        Wheel: zoom &middot; Middle-drag: pan &middot; Drag empty space: box select &middot; Shift: add to
        selection &middot; Arrows: nudge (Shift = 10 mm)
      </div>
    </div>
  );
}
