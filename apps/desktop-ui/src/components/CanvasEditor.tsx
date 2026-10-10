import { useEffect, type KeyboardEvent } from 'react';
import { ObjectFields } from '@/components/ObjectFields';
import { PX_PER_MM } from '@/lib/constants';
import { boundsToClientRect, overlayPlacement, wrapTab, type Rect } from '@/lib/inlineEdit';
import { worldBounds } from '@/lib/transform';
import { useEditStore } from '@/state/editStore';
import { useProjectStore } from '@/state/projectStore';
import { useViewStore } from '@/state/viewStore';

interface Props {
  /** Where the canvas is on the screen, in pixels. */
  container: Rect;
}

// Rough sizes, used only to keep the editor on screen.
const SHAPE_BAR = { width: 340, height: 118 };
const TEXT_BOX = { width: 360, height: 232 };

/**
 * The floating editor next to a text or shape object on the canvas: the boxes for a shape's sides,
 * or the text box for text. It opens straight after drawing and when you double-click an object.
 * Tab goes round the boxes, Enter (Ctrl+Enter for text) or Esc finishes, and clicking away closes it.
 */
export function CanvasEditor({ container }: Props) {
  const id = useEditStore((s) => s.editingId);
  const close = useEditStore((s) => s.close);
  const selected = useProjectStore((s) => s.selected);
  const object = useProjectStore((s) => (id ? s.project?.objects.find((o) => o.id === id) : undefined));
  const view = useViewStore();

  const source = object && object.kind.type === 'vector' ? object.kind.source : undefined;
  const open = !!object && !!source && !object.locked && selected.length === 1 && selected[0] === id;

  // Selecting something else (or deleting the object) closes the editor.
  useEffect(() => {
    if (id !== null && !open) close();
  }, [id, open, close]);

  if (!open || !object || !source || !id) return null;
  const bounds = worldBounds(object);
  if (!bounds) return null;

  const isText = source.type === 'text';
  const size = isText ? TEXT_BOX : SHAPE_BAR;
  const place = overlayPlacement(boundsToClientRect(bounds, view, container, PX_PER_MM), size, container);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation(); // typing here must not trigger the app's shortcuts (Delete, arrows, Ctrl+Z ...)
    const finish = e.key === 'Escape' || (e.key === 'Enter' && (!isText || e.ctrlKey || e.metaKey));
    if (finish) {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const boxes = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input, select, textarea'));
      const next = wrapTab(boxes.indexOf(document.activeElement as HTMLElement), boxes.length, e.shiftKey);
      if (next !== null) {
        e.preventDefault();
        boxes[next]?.focus();
      }
    }
  };

  return (
    <div
      role="group"
      aria-label={isText ? 'Edit text' : 'Edit shape'}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: place.left,
        top: place.top,
        width: size.width,
        zIndex: 30,
        boxSizing: 'border-box',
        padding: '6px 10px 8px',
        background: 'var(--panel)',
        color: 'inherit',
        border: '1px solid var(--accent)',
        borderRadius: 6,
        boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
      }}
    >
      <ObjectFields id={id} variant="bar" />
      <div style={{ opacity: 0.65, fontSize: '0.85em' }}>
        {isText ? 'Type your text \u00b7 Ctrl+Enter or Esc: done' : 'Type a size \u00b7 Tab: next box \u00b7 Enter: done'}
      </div>
    </div>
  );
}
