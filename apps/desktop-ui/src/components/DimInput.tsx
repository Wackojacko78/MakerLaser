import { useState, type Ref } from 'react';
import { evalExpression, formatNumber } from '@/lib/inlineEdit';

interface Props {
  label: string;
  unit?: string | undefined;
  value: number;
  /** Called with every complete number typed, so the shape follows the keyboard live. */
  onValue: (value: number) => void;
  inputRef?: Ref<HTMLInputElement> | undefined;
  width?: number | undefined;
  title?: string | undefined;
}

/**
 * A size box. Type a number, or a little sum such as 12.5*2: the object changes as you type. Click
 * into it and the number is selected, so typing replaces it. Tab moves to the next box.
 */
export function DimInput({ label, unit, value, onValue, inputRef, width = 62, title }: Props) {
  // While the box has focus it shows exactly what is typed; otherwise it shows the real value.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={title}>
      <span style={{ minWidth: 14, opacity: 0.8 }}>{label}</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        maxLength={32}
        value={draft ?? formatNumber(value)}
        style={{
          width,
          background: 'var(--panel)',
          color: 'inherit',
          border: '1px solid var(--line)',
          borderRadius: 4,
          padding: '3px 5px',
          font: 'inherit',
        }}
        onFocus={(e) => {
          setDraft(formatNumber(value));
          e.target.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const typed = evalExpression(e.target.value);
          if (typed !== null) onValue(typed);
        }}
        onBlur={() => setDraft(null)}
      />
      {unit ? <span style={{ opacity: 0.7 }}>{unit}</span> : null}
    </label>
  );
}
