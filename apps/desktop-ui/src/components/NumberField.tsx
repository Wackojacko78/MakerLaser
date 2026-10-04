import { useEffect, useState } from 'react';
import { clamp, formatNumber } from '@/lib/format';

interface Props {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  title?: string;
  className?: string;
}

/**
 * A numeric input that keeps its own text while the user is typing, so the field can be
 * cleared and retyped ("0." on the way to "0.5") instead of snapping back on every key.
 * Valid values are committed as they are typed; the field is normalised on blur.
 */
export function NumberField({ value, onCommit, min, max, disabled, title, className }: Props) {
  const [text, setText] = useState(formatNumber(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(formatNumber(value));
  }, [value, editing]);

  const tryCommit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return;
    onCommit(clamp(n, min, max));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      className={`num ${className ?? ''}`}
      value={text}
      disabled={disabled}
      title={title}
      onFocus={(e) => {
        setEditing(true);
        e.target.select();
      }}
      onChange={(e) => {
        setText(e.target.value);
        tryCommit(e.target.value);
      }}
      onBlur={() => {
        setEditing(false);
        setText(formatNumber(value));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(formatNumber(value));
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
