import type { CSSProperties, ReactNode } from 'react';

// ---- small layout pieces for the narrow right-hand panel ----------------------------------------
// Everything is built from a two-column grid whose columns may shrink (minmax(0, 1fr)) and fields with
// their label ABOVE the box, so nothing is squeezed or cut off. None of it depends on the .field-row
// styles of the other panels. Used by the Shape tools and Trace tabs.

export const twoColumns: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, alignItems: 'end' };
export const fullWidth: CSSProperties = { width: '100%', minWidth: 0, boxSizing: 'border-box' };
export const hintStyle: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.35, overflowWrap: 'anywhere' };

export function PanelGroup({ title, first, children }: { title: string; first?: boolean; children: ReactNode }) {
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

export function PanelField({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <label title={title} style={{ display: 'grid', gap: 2, minWidth: 0, fontSize: 12 }}>
      <span style={{ opacity: 0.75 }}>{label}</span>
      {children}
    </label>
  );
}

export function PanelTick({ checked, onChange, title, children }: { checked: boolean; onChange: (v: boolean) => void; title?: string; children: ReactNode }) {
  return (
    <label title={title} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, minWidth: 0 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 'auto', margin: 0, flex: '0 0 auto' }} />
      <span>{children}</span>
    </label>
  );
}

/** A slider with its value written above it. */
export function PanelSlider({
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
