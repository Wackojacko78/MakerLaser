// Adds a drag-to-resize handle to the MakerLaser bottom console.
// Run from C:\Dev\MakerLaser:   node apply-console-resize.mjs
// Safe: checks every anchor first and writes nothing unless ALL edits can be applied.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(root, 'apps', 'desktop-ui', 'src', 'styles', 'app.css');
const tsxPath = path.join(root, 'apps', 'desktop-ui', 'src', 'components', 'MachineConsole.tsx');

const css = fs.readFileSync(cssPath, 'utf8');
const tsx = fs.readFileSync(tsxPath, 'utf8');

if (tsx.includes('useConsoleResize') || css.includes('.console-resize')) {
  console.log('Already applied. Nothing to do.');
  process.exit(0);
}

const eolOf = (s) => (s.includes('\r\n') ? '\r\n' : '\n');
const fix = (text, eol) => text.replace(/\r?\n/g, eol);

function replaceOnce(src, find, replacement, label) {
  const first = src.indexOf(find);
  if (first === -1) throw new Error(`Anchor not found: ${label}`);
  if (src.indexOf(find, first + 1) !== -1) throw new Error(`Anchor is not unique: ${label}`);
  return src.slice(0, first) + replacement + src.slice(first + find.length);
}

// ---------- CSS ----------
const cssEol = eolOf(css);
let newCss = replaceOnce(
  css,
  'grid-template-rows: auto minmax(0, 1fr) 236px;',
  'grid-template-rows: auto minmax(0, 1fr) var(--console-h, 236px);',
  'app.css .app grid rows',
);
const cssRules = fix(
  `.console-resize { position: absolute; top: -3px; left: 0; right: 0; height: 7px; cursor: ns-resize; z-index: 5; touch-action: none; }
.console-resize::after { content: ''; position: absolute; left: 50%; top: 2px; width: 48px; height: 3px; margin-left: -24px; border-radius: 2px; background: var(--line); }
.console-resize:hover::after, .console-resize:active::after { background: var(--accent); }
`,
  cssEol,
);
newCss = replaceOnce(newCss, '.console-controls {', cssRules + '.console-controls {', 'app.css .console-controls');

// ---------- TSX ----------
const tsxEol = eolOf(tsx);
let newTsx = replaceOnce(
  tsx,
  "import { useEffect, useState } from 'react';",
  "import { useEffect, useState } from 'react';" + tsxEol + "import type { PointerEvent as ReactPointerEvent } from 'react';",
  'react import',
);

const hook = fix(
  `const CONSOLE_MIN = 236; // the old fixed height: never smaller than the controls need
const CONSOLE_KEY = 'makerlaser.consoleHeight';
const clampConsole = (h: number) =>
  Math.min(Math.max(CONSOLE_MIN, Math.round(window.innerHeight * 0.7)), Math.max(CONSOLE_MIN, Math.round(h)));
const applyConsoleHeight = (h: number) => document.documentElement.style.setProperty('--console-h', \`\${h}px\`);

/** Drag-to-resize for the bottom console. The height is a CSS variable, remembered between sessions. */
function useConsoleResize() {
  useEffect(() => {
    const saved = Number(localStorage.getItem(CONSOLE_KEY));
    if (saved > 0) applyConsoleHeight(clampConsole(saved));
    const onWindowResize = () => {
      const cur = parseFloat(document.documentElement.style.getPropertyValue('--console-h'));
      if (cur > 0) applyConsoleHeight(clampConsole(cur));
    };
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const footer = handle.parentElement as HTMLElement;
    const startY = e.clientY;
    const startH = footer.getBoundingClientRect().height;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => applyConsoleHeight(clampConsole(startH + (startY - ev.clientY)));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      localStorage.setItem(CONSOLE_KEY, String(Math.round(footer.getBoundingClientRect().height)));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const reset = () => {
    applyConsoleHeight(CONSOLE_MIN);
    localStorage.removeItem(CONSOLE_KEY);
  };

  return { onPointerDown, reset };
}

`,
  tsxEol,
);
newTsx = replaceOnce(
  newTsx,
  'export function MachineConsole() {',
  hook + 'export function MachineConsole() {' + tsxEol + '  const resize = useConsoleResize();',
  'MachineConsole function',
);

const handle = fix(
  `<footer className="console">
      <div
        className="console-resize"
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize · double-click to reset"
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.reset}
      />`,
  tsxEol,
);
newTsx = replaceOnce(newTsx, '<footer className="console">', handle, 'footer element');

// All anchors matched: now write (UTF-8, existing BOM/line endings preserved).
fs.writeFileSync(cssPath, newCss, 'utf8');
fs.writeFileSync(tsxPath, newTsx, 'utf8');
console.log('Done. Edited app.css and MachineConsole.tsx.');
console.log('Next: npm run ui:typecheck ; npm run ui:test ; npm run dev');
