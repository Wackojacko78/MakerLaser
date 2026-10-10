import { Group, Line, Text } from 'react-konva';
import { PX_PER_MM } from '@/lib/constants';
import { dimensionLabel, gestureBox, isDragGesture, type Draft } from '@/lib/inlineEdit';
import { clampShape, defaultShape, shapePaths } from '@/lib/shapes';

interface Props {
  draft: Draft | null;
  viewScale: number;
}

/** The outline and live size shown while a shape is being dragged out with a drawing tool. */
export function DrawPreview({ draft, viewScale }: Props) {
  if (!draft || draft.tool === 'text') return null;
  const a = { x: draft.x0, y: draft.y0 };
  const b = { x: draft.x1, y: draft.y1 };
  if (!isDragGesture(a, b, PX_PER_MM * viewScale)) return null;
  const box = gestureBox(a, b, draft.square);
  const source = clampShape({ ...defaultShape(draft.tool), width_mm: box.w, height_mm: box.h });
  const outline = shapePaths(source)[0];
  if (!outline) return null;
  const points = outline.points.flatMap((p) => [(box.x + p.x) * PX_PER_MM, (box.y + p.y) * PX_PER_MM]);
  const font = 12 / viewScale;
  return (
    <Group listening={false}>
      <Line
        points={points}
        closed
        stroke="#58d7ee"
        strokeWidth={1.4}
        strokeScaleEnabled={false}
        dash={[5, 3]}
        fill="rgba(88,215,238,0.10)"
      />
      <Text
        x={(box.x + box.w) * PX_PER_MM + 6 / viewScale}
        y={(box.y + box.h) * PX_PER_MM + 4 / viewScale}
        text={dimensionLabel(box.w, box.h)}
        fontSize={font}
        fill="#58d7ee"
      />
    </Group>
  );
}
