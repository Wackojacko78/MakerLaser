import { ShapeDialog } from '@/components/ShapeDialog';
import { TextDialog } from '@/components/TextDialog';
import { useEditStore } from '@/state/editStore';
import { useProjectStore } from '@/state/projectStore';

/** Opens the edit box for the text or shape object chosen with the Edit button or a double-click. */
export function ObjectEditor() {
  const id = useEditStore((s) => s.editingId);
  const close = useEditStore((s) => s.close);
  const object = useProjectStore((s) => (id ? s.project?.objects.find((o) => o.id === id) : undefined));
  if (!id || !object || object.kind.type !== 'vector' || !object.kind.source) return null;
  return object.kind.source.type === 'text' ? (
    <TextDialog key={id} editId={id} onClose={close} />
  ) : (
    <ShapeDialog key={id} editId={id} onClose={close} />
  );
}
