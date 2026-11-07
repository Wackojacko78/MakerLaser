import { useMemo } from 'react';
import { Circle, Group, Image as KonvaImage, Shape, Text } from 'react-konva';
import { PX_PER_MM } from '@/lib/constants';
import {
  KIND_CUT,
  KIND_ENGRAVE,
  KIND_FILL,
  KIND_SCORE,
  KIND_TRAVEL,
  drawnCount,
  outsideBed,
  pathStartMarkers,
  prepareToolpath,
} from '@/lib/toolpath';
import { TRAVEL_OPACITY, shouldDrawKind } from '@/lib/previewOptions';
import { usePreviewOptions } from '@/state/previewStore';
import type { PreviewSegment } from '@/types/domain';

interface Props {
  segments: PreviewSegment[];
  /** Fraction of the toolpath to draw, 0..1 (replay). */
  fraction: number;
  bedWidth: number;
  bedHeight: number;
  viewScale: number;
}

const STYLES: Array<{ kind: number; color: string; width: number; dash?: number[]; opacity?: number }> = [
  // Laser-off moves (travel between shapes, overscan run-ups) are drawn faintly: there can be thousands.
  { kind: KIND_TRAVEL, color: '#7d8a97', width: 1, dash: [3, 4], opacity: TRAVEL_OPACITY },
  { kind: KIND_FILL, color: '#2fd57b', width: 1 },
  { kind: KIND_SCORE, color: '#4d9bff', width: 1.5 },
  { kind: KIND_CUT, color: '#ff4d4d', width: 1.6 },
];

interface RasterBitmap {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Turns powered engraving runs into one bitmap. This deliberately shows deposited energy rather
 * than every G-code boundary, so photographs read like photographs while zooming remains cheap.
 */
function rasterBitmap(prepared: ReturnType<typeof prepareToolpath>, limit: number): RasterBitmap | null {
  if (typeof document === 'undefined') return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxPower = 0;
  const rows = new Set<number>();

  for (let i = 0; i < limit; i++) {
    if (prepared.kinds[i] !== KIND_ENGRAVE || prepared.powers[i] <= 0) continue;
    const o = i * 4;
    minX = Math.min(minX, prepared.coords[o], prepared.coords[o + 2]);
    minY = Math.min(minY, prepared.coords[o + 1], prepared.coords[o + 3]);
    maxX = Math.max(maxX, prepared.coords[o], prepared.coords[o + 2]);
    maxY = Math.max(maxY, prepared.coords[o + 1], prepared.coords[o + 3]);
    maxPower = Math.max(maxPower, prepared.powers[i]);
    rows.add(Math.round(prepared.coords[o + 1] * 1000));
  }
  if (!Number.isFinite(minX) || maxPower <= 0) return null;

  const sortedRows = [...rows].sort((a, b) => a - b);
  let rowSpacing = 0.1;
  if (sortedRows.length > 1) {
    const gaps = sortedRows.slice(1).map((v, i) => (v - sortedRows[i]) / 1000).filter((v) => v > 0.001);
    if (gaps.length) {
      gaps.sort((a, b) => a - b);
      rowSpacing = gaps[Math.floor(gaps.length / 2)];
    }
  }

  // One source pixel per scan row where possible, capped to avoid oversized browser canvases.
  const pad = rowSpacing / 2;
  const widthMm = Math.max(0.01, maxX - minX);
  const heightMm = Math.max(rowSpacing, maxY - minY + rowSpacing);
  const idealScale = Math.min(1 / rowSpacing, 16);
  const scale = Math.max(1, Math.min(idealScale, 2048 / widthMm, 2048 / heightMm));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(widthMm * scale));
  canvas.height = Math.max(1, Math.ceil(heightMm * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#d8b8ff';
  const rowPixels = Math.max(1, Math.ceil(rowSpacing * scale) + 1);
  for (let i = 0; i < limit; i++) {
    if (prepared.kinds[i] !== KIND_ENGRAVE || prepared.powers[i] <= 0) continue;
    const o = i * 4;
    const x0 = Math.min(prepared.coords[o], prepared.coords[o + 2]);
    const x1 = Math.max(prepared.coords[o], prepared.coords[o + 2]);
    const y = (prepared.coords[o + 1] - (minY - pad)) * scale;
    // Normalise to the job's selected maximum power: the strongest tone should look solid even
    // when a material test uses, for example, 40% as its maximum laser power.
    const energy = Math.max(0, Math.min(1, prepared.powers[i] / maxPower));
    ctx.globalAlpha = 0.04 + 0.9 * Math.pow(energy, 0.82);
    ctx.fillRect(
      Math.floor((x0 - minX) * scale),
      Math.floor(y - rowPixels / 2),
      Math.max(1, Math.ceil((x1 - x0) * scale)),
      rowPixels,
    );
  }
  ctx.globalAlpha = 1;

  return { canvas, x: minX, y: minY - pad, width: widthMm, height: heightMm };
}

/**
 * Draws the toolpath preview. Vector moves are batched by kind. Raster engraving is composited as
 * a bitmap so a 100k+ move photograph remains fast and visually represents tonal coverage.
 */
export function ToolpathOverlay({ segments, fraction, bedWidth, bedHeight, viewScale }: Props) {
  const { showTravel } = usePreviewOptions();
  const prepared = useMemo(() => prepareToolpath(segments), [segments]);
  const markers = useMemo(() => pathStartMarkers(prepared), [prepared]);
  const outside = useMemo(() => outsideBed(prepared, bedWidth, bedHeight), [prepared, bedWidth, bedHeight]);
  const limit = drawnCount(prepared, fraction);
  const raster = useMemo(() => rasterBitmap(prepared, limit), [prepared, limit]);

  const head = useMemo(() => {
    if (limit === 0) return null;
    const o = (limit - 1) * 4;
    return { x: prepared.coords[o + 2] * PX_PER_MM, y: prepared.coords[o + 3] * PX_PER_MM };
  }, [prepared, limit]);

  return (
    <Group listening={false}>
      {raster && (
        <KonvaImage
          image={raster.canvas}
          x={raster.x * PX_PER_MM}
          y={raster.y * PX_PER_MM}
          width={raster.width * PX_PER_MM}
          height={raster.height * PX_PER_MM}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}

      {STYLES.filter((s) => shouldDrawKind(s.kind, showTravel)).map((s) => (
        <Shape
          key={s.kind}
          listening={false}
          stroke={s.color}
          strokeWidth={s.width}
          dash={s.dash}
          opacity={s.opacity ?? 1}
          strokeScaleEnabled={false}
          perfectDrawEnabled={false}
          sceneFunc={(ctx, shape) => {
            ctx.beginPath();
            for (let i = 0; i < limit; i++) {
              if (prepared.kinds[i] !== s.kind) continue;
              const o = i * 4;
              ctx.moveTo(prepared.coords[o] * PX_PER_MM, prepared.coords[o + 1] * PX_PER_MM);
              ctx.lineTo(prepared.coords[o + 2] * PX_PER_MM, prepared.coords[o + 3] * PX_PER_MM);
            }
            ctx.fillStrokeShape(shape);
          }}
        />
      ))}

      {outside.length > 0 && (
        <Shape
          listening={false}
          stroke="#ffb020"
          strokeWidth={3}
          strokeScaleEnabled={false}
          sceneFunc={(ctx, shape) => {
            ctx.beginPath();
            for (const i of outside) {
              const o = i * 4;
              ctx.moveTo(prepared.coords[o] * PX_PER_MM, prepared.coords[o + 1] * PX_PER_MM);
              ctx.lineTo(prepared.coords[o + 2] * PX_PER_MM, prepared.coords[o + 3] * PX_PER_MM);
            }
            ctx.fillStrokeShape(shape);
          }}
        />
      )}

      {markers.map((m) => (
        <Text
          key={m.n}
          x={m.x * PX_PER_MM + 3 / viewScale}
          y={m.y * PX_PER_MM - 12 / viewScale}
          text={String(m.n)}
          fontSize={11 / viewScale}
          fill="#ffd166"
          listening={false}
        />
      ))}

      {head && fraction < 1 && (
        <Circle x={head.x} y={head.y} radius={5 / viewScale} fill="#ffffff" stroke="#ff4d4d" strokeWidth={1} />
      )}
    </Group>
  );
}
