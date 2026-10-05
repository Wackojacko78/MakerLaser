// Asks "Save changes?" when you close MakerLaser with unsaved changes, and asks to stop the
// job first if one is running. Closing by the X button or Alt+F4 both go through it.
// Run from C:\Dev\MakerLaser:   node add-close-guard.mjs
// Safe: checks every edit point first and writes nothing unless ALL of them can be applied.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const ui = path.join(root, 'apps', 'desktop-ui');
const NEW_FILES = {
 "src/lib/closeGuard.ts": "// The decisions behind the \"save before closing\" prompt. Pure TypeScript (no React or Tauri),\n// so it is unit-tested in plain Node (tests/closeGuard.test.ts).\n\nexport type CloseStep = 'close' | 'stop-job' | 'save';\n\n/**\n * What must happen before the window may close.\n * A running job comes first: closing MakerLaser does not by itself stop a laser that is\n * already burning, because the controller keeps running the moves it has received.\n */\nexport function nextCloseStep(jobRunning: boolean, hasUnsavedChanges: boolean): CloseStep {\n  if (jobRunning) return 'stop-job';\n  if (hasUnsavedChanges) return 'save';\n  return 'close';\n}\n\n/** The step after the job has been stopped. */\nexport function stepAfterStop(hasUnsavedChanges: boolean): CloseStep {\n  return hasUnsavedChanges ? 'save' : 'close';\n}\n\n/** \"Save changes to \u201cname\u201d?\", with a long name shortened. */\nexport function saveQuestion(projectName: string, maxName = 40): string {\n  const name = projectName.trim();\n  if (name === '') return 'Save changes to this project?';\n  const shown = name.length > maxName ? `${name.slice(0, maxName)}\\u2026` : name;\n  return `Save changes to \\u201c${shown}\\u201d?`;\n}\n",
 "src/components/CloseGuard.tsx": "import { useEffect, useState } from 'react';\nimport { getCurrentWindow } from '@tauri-apps/api/window';\nimport { saveFlow } from '@/lib/actions';\nimport { nextCloseStep, saveQuestion, stepAfterStop } from '@/lib/closeGuard';\nimport { errorMessage } from '@/lib/format';\nimport { api } from '@/lib/tauri';\nimport { useJobStore } from '@/state/jobStore';\nimport { useNoticeStore } from '@/state/noticeStore';\nimport { useProjectStore } from '@/state/projectStore';\n\ntype Prompt = 'stop-job' | 'save';\n\n/**\n * Stops the window from closing while a job is running or the project has unsaved changes,\n * and asks what to do first. Closing the window any way at all (X button, Alt+F4) passes\n * through here. Renders nothing until a prompt is needed.\n */\nexport function CloseGuard() {\n  const [prompt, setPrompt] = useState<Prompt | null>(null);\n  const [busy, setBusy] = useState(false);\n  const projectName = useProjectStore((s) => s.project?.name ?? '');\n  const notify = useNoticeStore((s) => s.show);\n\n  useEffect(() => {\n    let cancelled = false;\n    let unlisten: (() => void) | undefined;\n    void getCurrentWindow()\n      .onCloseRequested((event) => {\n        const step = nextCloseStep(useJobStore.getState().running, useProjectStore.getState().isDirty());\n        if (step === 'close') return; // nothing to ask: let Tauri close the window\n        event.preventDefault();\n        setPrompt(step);\n      })\n      .then((fn) => {\n        if (cancelled) fn();\n        else unlisten = fn;\n      });\n    return () => {\n      cancelled = true;\n      unlisten?.();\n    };\n  }, []);\n\n  // Escape means \"never mind, keep working\".\n  useEffect(() => {\n    if (prompt === null) return;\n    const onKey = (e: KeyboardEvent) => {\n      if (e.key === 'Escape' && !busy) setPrompt(null);\n    };\n    window.addEventListener('keydown', onKey);\n    return () => window.removeEventListener('keydown', onKey);\n  }, [prompt, busy]);\n\n  if (prompt === null) return null;\n\n  const closeNow = async () => {\n    try {\n      await getCurrentWindow().destroy();\n    } catch (e) {\n      notify('error', `Could not close the window: ${errorMessage(e)}`);\n      setBusy(false);\n    }\n  };\n\n  const stopJob = async () => {\n    setBusy(true);\n    try {\n      await api.stop(); // soft reset: halts motion and switches the laser off\n      await new Promise((resolve) => setTimeout(resolve, 300)); // let the reset reach the controller\n    } catch (e) {\n      notify('error', `Could not stop the job: ${errorMessage(e)}. The window was not closed.`);\n      setBusy(false);\n      return;\n    }\n    if (stepAfterStop(useProjectStore.getState().isDirty()) === 'save') {\n      setBusy(false);\n      setPrompt('save');\n    } else {\n      await closeNow();\n    }\n  };\n\n  const save = async () => {\n    setBusy(true);\n    const saved = await saveFlow(false); // asks for a file name first if the project has none\n    if (saved) await closeNow();\n    else setBusy(false); // cancelled or failed: stay open (saveFlow shows the reason)\n  };\n\n  return (\n    <div className=\"modal-backdrop\">\n      <div className=\"modal\" role=\"alertdialog\" aria-modal=\"true\" style={{ width: 440 }}>\n        {prompt === 'stop-job' ? (\n          <>\n            <h2>A job is still running</h2>\n            <p>\n              If you close MakerLaser now, the controller may keep running the moves it has already received, with the laser on.\n              Stop the job first: this resets the controller and switches the laser off.\n            </p>\n            <div className=\"modal-actions\">\n              <button disabled={busy} autoFocus onClick={() => setPrompt(null)}>\n                Keep running\n              </button>\n              <button className=\"stop\" disabled={busy} onClick={() => void stopJob()}>\n                Stop job and close\n              </button>\n            </div>\n          </>\n        ) : (\n          <>\n            <h2>{saveQuestion(projectName)}</h2>\n            <p>Your changes will be lost if you do not save them.</p>\n            <div className=\"modal-actions\">\n              <button disabled={busy} onClick={() => setPrompt(null)}>\n                Cancel\n              </button>\n              <button disabled={busy} onClick={() => void closeNow()}>\n                Don't save\n              </button>\n              <button className=\"primary\" disabled={busy} autoFocus onClick={() => void save()}>\n                {busy ? 'Saving\\u2026' : 'Save'}\n              </button>\n            </div>\n          </>\n        )}\n      </div>\n    </div>\n  );\n}\n",
 "tests/closeGuard.test.ts": "import { describe, expect, it } from 'vitest';\nimport { nextCloseStep, saveQuestion, stepAfterStop } from '@/lib/closeGuard';\n\ndescribe('nextCloseStep', () => {\n  it('lets a clean, idle window close', () => {\n    expect(nextCloseStep(false, false)).toBe('close');\n  });\n  it('asks to save when there are unsaved changes', () => {\n    expect(nextCloseStep(false, true)).toBe('save');\n  });\n  it('asks about the running job first, whether or not there are unsaved changes', () => {\n    expect(nextCloseStep(true, false)).toBe('stop-job');\n    expect(nextCloseStep(true, true)).toBe('stop-job');\n  });\n});\n\ndescribe('stepAfterStop', () => {\n  it('goes on to the save question only when there is something to save', () => {\n    expect(stepAfterStop(true)).toBe('save');\n    expect(stepAfterStop(false)).toBe('close');\n  });\n});\n\ndescribe('saveQuestion', () => {\n  it('names the project', () => {\n    expect(saveQuestion('Coaster set')).toBe('Save changes to \\u201cCoaster set\\u201d?');\n  });\n  it('trims, shortens long names and copes with an empty name', () => {\n    expect(saveQuestion('  Box  ')).toBe('Save changes to \\u201cBox\\u201d?');\n    expect(saveQuestion('x'.repeat(60))).toBe(`Save changes to \\u201c${'x'.repeat(40)}\\u2026\\u201d?`);\n    expect(saveQuestion('   ')).toBe('Save changes to this project?');\n  });\n});\n"
};
const PERMISSION = 'core:window:allow-destroy';

const appPath = path.join(ui, 'src', 'App.tsx');
const capPath = path.join(root, 'apps', 'rust-core', 'capabilities', 'default.json');
const missing = [appPath, capPath].filter((f) => !fs.existsSync(f));
if (missing.length > 0) {
  console.log('Run this from the MakerLaser repo root. Not found:');
  for (const f of missing) console.log('  ' + path.relative(root, f).split(path.sep).join('/'));
  console.log('Nothing was changed.');
  process.exit(1);
}

const app = fs.readFileSync(appPath, 'utf8');
const capText = fs.readFileSync(capPath, 'utf8');
const targets = Object.keys(NEW_FILES).map((rel) => [rel, path.join(ui, ...rel.split('/'))]);
const existing = targets.filter(([, abs]) => fs.existsSync(abs));
if (existing.length > 0 || app.includes('CloseGuard')) {
  console.log('Already applied (or files exist). Nothing written.');
  process.exit(0);
}

const eolOf = (s) => (s.includes('\r\n') ? '\r\n' : '\n');
const fix = (text, eol) => text.replace(/\r?\n/g, eol);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function locate(text, find, label) {
  const lines = find.split(/\r?\n/).map((l) => l.trim());
  const re = new RegExp(lines.map(esc).join('[ \\t]*\\r?\\n[ \\t]*'), 'g');
  const hits = [...text.matchAll(re)];
  if (hits.length === 0) throw new Error('Could not find the place to edit in ' + label + '.');
  if (hits.length > 1) throw new Error('The place to edit is not unique in ' + label + '.');
  return hits[0];
}
const splice = (text, hit, replacement) => text.slice(0, hit.index) + replacement + text.slice(hit.index + hit[0].length);
function insertAfter(text, find, newLines, label) {
  const hit = locate(text, find, label);
  const eol = eolOf(text);
  // keep the indentation of the line the anchor is on
  const lineStart = text.lastIndexOf('\n', hit.index - 1) + 1;
  const indent = text.slice(lineStart, hit.index).match(/^[ \t]*/)[0];
  return splice(text, hit, hit[0] + eol + newLines.map((l) => indent + l).join(eol));
}

// ---- App.tsx ----
let newApp;
try {
  newApp = insertAfter(app, "import { MachineConsole } from '@/components/MachineConsole';", ["import { CloseGuard } from '@/components/CloseGuard';"], 'App.tsx: MachineConsole import');
  newApp = insertAfter(newApp, '<MachineConsole />', ['<CloseGuard />'], 'App.tsx: MachineConsole element');
} catch (e) {
  console.log(e.message + ' Nothing was changed.');
  process.exit(1);
}

// ---- capabilities/default.json ----
let cap;
try {
  cap = JSON.parse(capText.replace(/^\uFEFF/, ''));
} catch (e) {
  console.log('capabilities/default.json is not valid JSON (' + e.message + '). Nothing was changed.');
  process.exit(1);
}
if (!Array.isArray(cap.permissions)) {
  console.log('capabilities/default.json has no "permissions" list. Nothing was changed.');
  process.exit(1);
}
let newCap = null;
if (!cap.permissions.includes(PERMISSION)) {
  cap.permissions.push(PERMISSION);
  newCap = fix(JSON.stringify(cap, null, 2) + '\n', eolOf(capText));
}

// ---- everything matched: write ----
const eol = eolOf(app);
for (const [rel, abs] of targets) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, fix(NEW_FILES[rel], eol), 'utf8');
  console.log('created ' + path.relative(root, abs).split(path.sep).join('/'));
}
fs.writeFileSync(appPath, newApp, 'utf8');
console.log('edited  apps/desktop-ui/src/App.tsx');
if (newCap) {
  fs.writeFileSync(capPath, newCap, 'utf8');
  console.log('edited  apps/rust-core/capabilities/default.json (added ' + PERMISSION + ')');
} else {
  console.log('capabilities already allow ' + PERMISSION);
}
console.log('');
console.log('Next: npm run ui:typecheck ; npm run ui:test ; npm run dev   (the app rebuilds once for the permission)');
