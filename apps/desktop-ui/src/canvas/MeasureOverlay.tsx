import { Circle, Group, Label, Line, Rect, Tag, Text } from 'react-konva';
import { PX_PER_MM } from '@/lib/constants';
import { itemsToMeasure, measure, measurementLabel, type MeasureItem, type Measurement } from '@/lib/measure';
import { useMeasureStore } from '@/state/measureStore';
import { useProjectStore } from '@/state/projectStore';
import type { Point2 } from '@/types/domain';

const PICK = '#ffd166';
const HOVER = '#58d7ee';
const GUIDE = '#ffffff';

const flat = (...pts: Point2[]): number[] => pts.flatMap((p) => [p.x * PX_PER_MM, p.y * PX_PER_MM]);

/** Where the number goes: the middle of the measuring line, or at the point the lines cross. */
function labelAnchor(m: Measurement): Point2 | null {
  if (m.guide) return { x: (m.guide[0].x + m.guide[1].x) / 2, y: (m.guide[0].y + m.guide[1].y) / 2 };
  if (m.type === 'line-line' && m.intersection) return m.intersection;
  return null;
}

/** A picked or hovered item: a square on a corner, a diamond on a midpoint, a ring on a centre, a cross on a free point, a bold line for a line. */
function Marker({ item, viewScale, color, picked }: { item: MeasureItem; viewScale: number; color: string; picked: boolean }) {
  const r = 5 / viewScale;
  if (item.kind === 'line') {
    return (
      <Line
        listening={false}
        points={flat(item.a, item.b)}
        stroke={color}
        strokeWidth={picked ? 3.5 : 3}
        strokeScaleEnabled={false}
        lineCap="round"
        opacity={picked ? 1 : 0.85}
      />
    );
  }
  const x = item.p.x * PX_PER_MM;
  const y = item.p.y * PX_PER_MM;
  const dot = picked ? <Circle listening={false} x={x} y={y} radius={2.5 / viewScale} fill={color} /> : null;
  switch (item.snap) {
    case 'vertex':
      return (
        <Group listening={false}>
          <Rect listening={false} x={x - r} y={y - r} width={2 * r} height={2 * r} stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} />
          {dot}
        </Group>
      );
    case 'midpoint':
      return (
        <Group listening={false}>
          <Line listening={false} closed points={[x, y - r * 1.3, x + r * 1.3, y, x, y + r * 1.3, x - r * 1.3, y]} stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} />
          {dot}
        </Group>
      );
    case 'centre':
      return (
        <Group listening={false}>
          <Circle listening={false} x={x} y={y} radius={r} stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} />
          <Line listening={false} points={[x - r * 1.6, y, x + r * 1.6, y]} stroke={color} strokeWidth={1} strokeScaleEnabled={false} />
          <Line listening={false} points={[x, y - r * 1.6, x, y + r * 1.6]} stroke={color} strokeWidth={1} strokeScaleEnabled={false} />
          {dot}
        </Group>
      );
    default:
      return (
        <Group listening={false}>
          <Line listening={false} points={[x - r, y, x + r, y]} stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} />
          <Line listening={false} points={[x, y - r, x, y + r]} stroke={color} strokeWidth={1.5} strokeScaleEnabled={false} />
          {dot}
        </Group>
      );
  }
}

/**
 * The Measure tool's drawing: what you have clicked, what a click would pick, the measuring line
 * between them and its number. Never takes part in hit testing, so it cannot swallow a click.
 */
export function MeasureOverlay({ viewScale }: { viewScale: number }) {
  const picks = useMeasureStore((s) => s.picks);
  const hover = useMeasureStore((s) => s.hover);
  const units = useProjectStore((s) => s.project?.settings.units ?? 'mm');
  const m = measure(itemsToMeasure(picks, hover));
  const anchor = m ? labelAnchor(m) : null;
  const dash = [6 / viewScale, 4 / viewScale];
  return (
    <Group listening={false}>
      {m?.guide && (
        <>
          {m.type !== 'line' && (
            <Line listening={false} points={flat(m.guide[0], m.guide[1])} stroke={GUIDE} strokeWidth={1.5} strokeScaleEnabled={false} dash={dash} />
          )}
          <Circle listening={false} x={m.guide[0].x * PX_PER_MM} y={m.guide[0].y * PX_PER_MM} radius={3 / viewScale} fill={GUIDE} />
          <Circle listening={false} x={m.guide[1].x * PX_PER_MM} y={m.guide[1].y * PX_PER_MM} radius={3 / viewScale} fill={GUIDE} />
        </>
      )}
      {m?.extension && (
        <Line listening={false} points={flat(m.extension[0], m.extension[1])} stroke="#8ba2b3" strokeWidth={1} strokeScaleEnabled={false} dash={dash} />
      )}
      {m?.type === 'line-line' && m.intersection && (
        <Circle listening={false} x={m.intersection.x * PX_PER_MM} y={m.intersection.y * PX_PER_MM} radius={4 / viewScale} stroke={GUIDE} strokeWidth={1.5} strokeScaleEnabled={false} />
      )}
      {picks.map((item, i) => (
        <Marker key={i} item={item} viewScale={viewScale} color={PICK} picked />
      ))}
      {hover && <Marker item={hover} viewScale={viewScale} color={HOVER} picked={false} />}
      {m && anchor && (
        <Label listening={false} x={anchor.x * PX_PER_MM + 10 / viewScale} y={anchor.y * PX_PER_MM - 10 / viewScale}>
          <Tag listening={false} fill="#0b3a45" stroke="#36d8ed" strokeWidth={1} strokeScaleEnabled={false} cornerRadius={3 / viewScale} opacity={0.94} />
          <Text listening={false} text={measurementLabel(m, units)} fontSize={12 / viewScale} padding={4 / viewScale} fill="#dce9f3" />
        </Label>
      )}
    </Group>
  );
}
