import { useMemo } from 'react';
import { Circle, Group, Shape, Text } from 'react-konva';
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
  { kind: KIND_ENGRAVE, color: '#b57bff', width: 1 },
  { kind: KIND_SCORE, color: '#4d9bff', width: 1.5 },
  { kind: KIND_CUT, color: '#ff4d4d', width: 1.6 },
];

/**
 * Draws the toolpath preview. Moves are batched into one canvas path per kind (a raster job
 * can have 100k+ moves, far too many for one Konva node each) and the overlay never takes
 * part in hit testing.
 */
export function ToolpathOverlay({ segments, fraction, bedWidth, bedHeight, viewScale }: Props) {
  const { showTravel } = usePreviewOptions();
  const prepared = useMemo(() => prepareToolpath(segments), [segments]);
  const markers = useMemo(() => pathStartMarkers(prepared), [prepared]);
  const outside = useMemo(() => outsideBed(prepared, bedWidth, bedHeight), [prepared, bedWidth, bedHeight]);
  const limit = drawnCount(prepared, fraction);

  const head = useMemo(() => {
    if (limit === 0) return null;
    const o = (limit - 1) * 4;
    return { x: prepared.coords[o + 2] * PX_PER_MM, y: prepared.coords[o + 3] * PX_PER_MM };
  }, [prepared, limit]);

  return (
    <Group listening={false}>
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
