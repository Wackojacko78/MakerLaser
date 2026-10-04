// User-level flows shared by the toolbar, the keyboard shortcuts and drag-and-drop.
import { ask, open, save } from '@tauri-apps/plugin-dialog';
import { errorMessage } from '@/lib/format';
import { api } from '@/lib/tauri';
import { useJobStore } from '@/state/jobStore';
import { useNoticeStore } from '@/state/noticeStore';
import { useProjectStore } from '@/state/projectStore';
import { useViewStore } from '@/state/viewStore';

export const ARTWORK_EXTENSIONS = ['svg', 'dxf', 'png', 'jpg', 'jpeg', 'bmp'];
const PROJECT_FILTER = [{ name: 'MakerLaser project', extensions: ['mlp'] }];

const notify = (kind: 'info' | 'warning' | 'error', text: string) =>
  useNoticeStore.getState().show(kind, text);

export async function confirmDiscard(): Promise<boolean> {
  if (!useProjectStore.getState().isDirty()) return true;
  return ask('You have unsaved changes. Discard them?', {
    title: 'Unsaved changes',
    kind: 'warning',
    okLabel: 'Discard',
    cancelLabel: 'Cancel',
  });
}

export async function newProjectFlow(): Promise<void> {
  if (!(await confirmDiscard())) return;
  try {
    const project = await api.newProject();
    useProjectStore.getState().loadProject(project, null);
    useJobStore.getState().clearResult();
    useViewStore.getState().requestFit();
  } catch (e) {
    notify('error', `Could not create a project: ${errorMessage(e)}`);
  }
}

export async function openProjectFlow(): Promise<void> {
  if (!(await confirmDiscard())) return;
  try {
    const path = await open({ multiple: false, directory: false, filters: PROJECT_FILTER });
    if (typeof path !== 'string') return;
    const project = await api.openProject(path);
    useProjectStore.getState().loadProject(project, path);
    useJobStore.getState().clearResult();
    useViewStore.getState().requestFit();
  } catch (e) {
    notify('error', `Could not open the project: ${errorMessage(e)}`);
  }
}

/** Saves the project; asks for a file name when it has none yet (or `saveAs`). */
export async function saveFlow(saveAs = false): Promise<boolean> {
  const store = useProjectStore.getState();
  if (!store.project) return false;
  try {
    await store.sync();
    let path = store.filePath;
    if (saveAs || !path) {
      const chosen = await save({ defaultPath: `${store.project.name}.mlp`, filters: PROJECT_FILTER });
      if (!chosen) return false;
      path = await api.saveProjectAs(chosen);
    } else {
      await api.saveProject();
    }
    useProjectStore.getState().markSaved(path);
    notify('info', 'Project saved.');
    return true;
  } catch (e) {
    notify('error', `Save failed: ${errorMessage(e)}`);
    return false;
  }
}

export async function importPaths(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      const store = useProjectStore.getState();
      const imported = await api.importArtwork(path, store.nextZIndex());
      store.addObject(imported.object);
      if (imported.warnings.length > 0) {
        notify('warning', `${imported.object.name}: ${imported.warnings.join(' ')}`);
      }
    } catch (e) {
      notify('error', errorMessage(e));
    }
  }
}

export async function importFromDialog(): Promise<void> {
  const picked = await open({
    multiple: true,
    directory: false,
    filters: [{ name: 'Artwork', extensions: ARTWORK_EXTENSIONS }],
  });
  if (picked === null) return;
  await importPaths(Array.isArray(picked) ? picked : [picked]);
}

/** Plans operations, generates the toolpath and G-code, and runs the safety checks. */
export async function generateFlow(): Promise<void> {
  const job = useJobStore.getState();
  if (job.busy) return;
  job.setBusy(true);
  job.setStatus('Generating...');
  try {
    await useProjectStore.getState().sync();
    const revision = useProjectStore.getState().revision;
    const result = await api.generate();
    const jobs = useJobStore.getState();
    jobs.setResult(result, revision);
    jobs.addLog(`Generated ${result.line_count} G-code lines.`);
    for (const w of result.warnings) jobs.addLog(`Warning: ${w}`);
    for (const w of result.safety.warnings) jobs.addLog(`Warning: ${w}`);
    for (const e of result.safety.errors) jobs.addLog(`SAFETY: ${e}`);
    if (result.safety.errors.length > 0) {
      jobs.setStatus('Not safe to run');
      notify('error', result.safety.errors[0]);
    } else {
      jobs.setStatus('Ready to run');
      if (result.segments.length === 0) {
        notify('warning', result.warnings[0] ?? 'Nothing to run: assign artwork to an enabled layer.');
      }
    }
  } catch (e) {
    useJobStore.getState().setStatus('Generate failed');
    useJobStore.getState().addLog(`Generate failed: ${errorMessage(e)}`);
    notify('error', `Generate failed: ${errorMessage(e)}`);
  } finally {
    useJobStore.getState().setBusy(false);
  }
}

export async function startJobFlow(): Promise<void> {
  const jobs = useJobStore.getState();
  // Mark running first: the job thread can emit events before `start` returns.
  jobs.setRunning(true);
  jobs.setStatus('Starting...');
  try {
    await useProjectStore.getState().sync();
    await api.start();
    useJobStore.getState().addLog('Job started.');
  } catch (e) {
    useJobStore.getState().setRunning(false);
    useJobStore.getState().setStatus('Ready');
    useJobStore.getState().addLog(`Start failed: ${errorMessage(e)}`);
    notify('error', `Start failed: ${errorMessage(e)}`);
  }
}

export async function frameFlow(): Promise<void> {
  try {
    await useProjectStore.getState().sync();
    await api.frame();
    useJobStore.getState().addLog('Framing the job outline (laser off).');
  } catch (e) {
    useJobStore.getState().addLog(`Frame failed: ${errorMessage(e)}`);
    notify('error', `Frame failed: ${errorMessage(e)}`);
  }
}

export async function stopFlow(): Promise<void> {
  try {
    await api.stop();
    useJobStore.getState().addLog('STOP sent: machine reset.');
  } catch (e) {
    useJobStore.getState().addLog(`Stop failed: ${errorMessage(e)}`);
    notify('error', `Stop failed: ${errorMessage(e)}`);
  }
}
