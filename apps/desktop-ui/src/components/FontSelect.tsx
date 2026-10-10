import { useMemo } from 'react';
import { fontOptionGroups } from '@/lib/fontPicker';
import { installedFonts } from '@/lib/fonts';

interface Props {
  /** The font the text uses now. */
  value: string;
  onChange: (family: string) => void;
  width?: number;
}

const fieldStyle = {
  background: 'var(--panel)',
  color: 'inherit',
  border: '1px solid var(--line)',
  borderRadius: 4,
  padding: '3px 5px',
  font: 'inherit',
} as const;

/**
 * The font list: the fonts installed on this computer, then the ones that come with MakerLaser
 * grouped by kind (sans-serif, serif, display, script, monospace), then the generic families. Each
 * name is shown in its own font where the window allows it. With the list focused, typing the first
 * letters of a name jumps to it.
 */
export function FontSelect({ value, onChange, width = 150 }: Props) {
  const installed = useMemo(() => installedFonts(), []);
  const picker = useMemo(() => fontOptionGroups(installed, value), [installed, value]);
  return (
    <select
      value={picker.selected}
      aria-label="Font"
      title="Fonts installed on this computer, and the fonts that come with MakerLaser"
      style={{ ...fieldStyle, width }}
      onChange={(e) => onChange(e.target.value)}
    >
      {picker.groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((o) => (
            <option key={o.value} value={o.value} style={o.css ? { fontFamily: o.css } : undefined}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
