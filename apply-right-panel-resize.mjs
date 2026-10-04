// Adds a drag-to-resize handle to the MakerLaser right-hand panel (Selection / Layers / Materials).
// Run from C:\Dev\MakerLaser:   node apply-right-panel-resize.mjs
// Safe: checks every anchor first and writes nothing unless ALL edits can be applied.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(root, 'apps', 'desktop-ui', 'src', 'styles', 'app.css');
const appPath = path.join(root, 'apps', 'desktop-ui', 'src', 'App.tsx');

const css = fs.readFileSync(cssPath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');

if (app.includes('useRightPanelResize') || css.includes('.panel-resize')) {
  console.log('Already applied. Nothing to do.');
  process.exit(0);
}

const eolOf = (s) => (s.includes('\r\n') ? '\r\n' : '\n');
const fix = (text, eol) => text.replace(/\r?\n/g, eol);

function replaceOnce(src, find, replacement, label) {
  const first = src.indexOf(find);
  if (first === -1) throw new Error('Anchor not found: ' + label);
  if (src.indexOf(find, first + 1) !== -1) throw new Error('Anchor is not unique: ' + label);
  return src.slice(0, first) + replacement + src.slice(first + find.length);
}

// ---------- CSS ----------
const cssEol = eolOf(css);
let newCss = replaceOnce(
  css,
  'grid-template-columns: 74px minmax(0, 1fr) 340px;',
  'grid-template-columns: 74px minmax(0, 1fr) var(--right-w, 340px);',
  'app.css .body grid columns',
);
newCss = replaceOnce(newCss, '.body { min-height: 0;', '.body { position: relative; min-height: 0;', 'app.css .body');
const cssRules = fix(
  `/* drag handle on the left edge of the right panel */
.panel-resize { position: absolute; top: 0; bottom: 0; right: calc(var(--right-w, 340px) - 3px); width: 7px; cursor: ew-resize; z-index: 5; touch-action: none; }
.panel-resize::after { content: ''; position: absolute; top: 50%; left: 2px; height: 48px; width: 3px; margin-top: -24px; border-radius: 2px; background: var(--line); }
.panel-resize:hover::after, .panel-resize:active::after { background: var(--accent); }

`,
  cssEol,
);
newCss = replaceOnce(newCss, '/* right panels */', cssRules + '/* right panels */', 'app.css right panels comment');

// ---------- App.tsx ----------
const eol = eolOf(app);
let newApp = replaceOnce(
  app,
  "import { useEffect } from 'react';",
  "import { useEffect } from 'react';" + eol + "import type { PointerEvent as ReactPointerEvent } from 'react';",
  'react import',
);

const hook = fix(
  `const RIGHT_MIN = 300;
const RIGHT_DEFAULT = 340; // the old fixed width
const RIGHT_KEY = 'makerlaser.rightPanelWidth';
const clampRight = (w: number) =>
  Math.min(Math.max(RIGHT_MIN, Math.round(window.innerWidth * 0.5)), Math.max(RIGHT_MIN, Math.round(w)));
const applyRightWidth = (w: number) => document.documentElement.style.setProperty('--right-w', w + 'px');

/** Drag-to-resize for the right-hand panel. The width is a CSS variable, remembered between sessions. */
function useRightPanelResize() {
  useEffect(() => {
    const saved = Number(localStorage.getItem(RIGHT_KEY));
    if (saved > 0) applyRightWidth(clampRight(saved));
    const onWindowResize = () => {
      const cur = parseFloat(document.documentElement.style.getPropertyValue('--right-w'));
      if (cur > 0) applyRightWidth(clampRight(cur));
    };
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const aside = handle.parentElement?.querySelector('aside.right') as HTMLElement | null;
    const startX = e.clientX;
    const startW = aside ? aside.getBoundingClientRect().width : RIGHT_DEFAULT;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => applyRightWidth(clampRight(startW + (startX - ev.clientX)));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (aside) localStorage.setItem(RIGHT_KEY, String(Math.round(aside.getBoundingClientRect().width)));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const reset = () => {
    applyRightWidth(RIGHT_DEFAULT);
    localStorage.removeItem(RIGHT_KEY);
  };

  return { onPointerDown, reset };
}

`,
  eol,
);
newApp = replaceOnce(
  newApp,
  'export default function App() {',
  hook + 'export default function App() {' + eol + '  const rightResize = useRightPanelResize();',
  'App function',
);

const handle = fix(
  `<div className="body">
        <div
          className="panel-resize"
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize · double-click to reset"
          onPointerDown={rightResize.onPointerDown}
          onDoubleClick={rightResize.reset}
        />`,
  eol,
);
newApp = replaceOnce(newApp, '<div className="body">', handle, 'body element');

fs.writeFileSync(cssPath, newCss, 'utf8');
fs.writeFileSync(appPath, newApp, 'utf8');
console.log('Done. Edited app.css and App.tsx.');
console.log('Next: npm run ui:typecheck ; npm run ui:test ; npm run dev');
