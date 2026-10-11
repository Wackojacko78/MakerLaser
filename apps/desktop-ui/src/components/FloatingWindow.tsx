import { useRef, useState, type CSSProperties, type ReactNode } from 'react';

// ---- small layout pieces for narrow windows ----------------------------------------------------
// Everything is built from a two-column grid whose columns may shrink (minmax(0, 1fr)) and fields with
// their label ABOVE the box, so nothing is squeezed or cut off. None of it depends on the .field-row
// styles of the other panels.

export const twoColumns: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, alignItems: 'end' };
export const fullWidth: CSSProperties = { width: '100%', minWidth: 0, boxSizing: 'border-box' };
export const hintStyle: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.35, overflowWrap: 'anywhere' };

export function WindowGroup({ title, first, children }: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
        marginTop: first ? 0 : 10,
        paddingTop: first ? 0 : 8,
        borderTop: first ? 'none' : '1px solid var(--border, rgba(255, 255, 255, 0.14))',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', opacity: 0.8 }}>{title}</div>
      {children}
    </div>
  );
}

export function WindowField({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <label title={title} style={{ display: 'grid', gap: 2, minWidth: 0, fontSize: 12 }}>
      <span style={{ opacity: 0.75 }}>{label}</span>
      {children}
    </label>
  );
}

export function WindowTick({ checked, onChange, title, children }: { checked: boolean; onChange: (v: boolean) => void; title?: string; children: ReactNode }) {
  return (
    <label title={title} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, minWidth: 0 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 'auto', margin: 0, flex: '0 0 auto' }} />
      <span>{children}</span>
    </label>
  );
}

/** A slider with its value written above it. */
export function WindowSlider({
  label,
  title,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  title?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label title={title} style={{ display: 'grid', gap: 2, minWidth: 0, fontSize: 12 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ opacity: 0.75 }}>{label}</span>
        <b>{value}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ...fullWidth, padding: 0, margin: 0 }} />
    </label>
  );
}

/**
 * A window that floats over the app and stays where it is while the selection changes: a title bar to
 * drag (double-click it to put the window back), a status text and a close button, and a body that
 * scrolls when the window is short. It sits beside the right-hand panel by default; `rightExtra` moves
 * it that many pixels further left, so two windows can be open side by side.
 *
 * The window draws only while it is mounted: whoever uses it decides when (a window that should keep
 * its settings keeps its own state and returns null while closed).
 */
export function FloatingWindow({
  title,
  status,
  onClose,
  rightExtra = 0,
  width = 320,
  children,
}: {
  title: string;
  status?: string;
  onClose: () => void;
  rightExtra?: number;
  width?: number;
  children: ReactNode;
}) {
  // Where the window is, once it has been dragged. null: its usual place.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const placement: CSSProperties = pos
    ? // Dragged: stay on screen if the window gets smaller.
      { left: `clamp(0px, ${Math.round(pos.left)}px, calc(100vw - 160px))`, top: `clamp(0px, ${Math.round(pos.top)}px, calc(100vh - 60px))` }
    : { top: 64, right: `calc(var(--right-w, 340px) + 12px + ${rightExtra}px)` };
  return (
    <div
      role="dialog"
      aria-label={title}
      style={{
        position: 'fixed',
        ...placement,
        width,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'calc(100vh - 140px)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
        boxSizing: 'border-box',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.55)',
      }}
    >
      <div
        title={'Drag to move \u00b7 double-click to put it back'}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 8px 12px', borderBottom: '1px solid var(--line)', cursor: 'grab', userSelect: 'none', touchAction: 'none' }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return; // the close button is not part of the handle
          const box = e.currentTarget.parentElement?.getBoundingClientRect();
          if (!box) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          grab.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
        }}
        onPointerMove={(e) => {
          const g = grab.current;
          if (g) setPos({ left: e.clientX - g.dx, top: e.clientY - g.dy });
        }}
        onPointerUp={() => {
          grab.current = null;
        }}
        onPointerCancel={() => {
          grab.current = null;
        }}
        onDoubleClick={() => setPos(null)}
      >
        <h3 style={{ margin: 0, flex: 1 }}>{title}</h3>
        {status !== undefined && (
          <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 0, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={status}>
            {status}
          </span>
        )}
        <button className="mini" aria-label={`Close ${title}`} title="Close (your settings are kept)" onClick={onClose}>
          {'\u00d7'}
        </button>
      </div>
      <div style={{ overflowY: 'auto', minWidth: 0, padding: '10px 12px 12px' }}>{children}</div>
    </div>
  );
}
