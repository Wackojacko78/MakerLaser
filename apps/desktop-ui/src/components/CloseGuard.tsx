import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { saveFlow } from '@/lib/actions';
import { nextCloseStep, saveQuestion, stepAfterStop } from '@/lib/closeGuard';
import { errorMessage } from '@/lib/format';
import { api } from '@/lib/tauri';
import { useJobStore } from '@/state/jobStore';
import { useNoticeStore } from '@/state/noticeStore';
import { useProjectStore } from '@/state/projectStore';

type Prompt = 'stop-job' | 'save';

/**
 * Stops the window from closing while a job is running or the project has unsaved changes,
 * and asks what to do first. Closing the window any way at all (X button, Alt+F4) passes
 * through here. Renders nothing until a prompt is needed.
 */
export function CloseGuard() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [busy, setBusy] = useState(false);
  const projectName = useProjectStore((s) => s.project?.name ?? '');
  const notify = useNoticeStore((s) => s.show);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        const step = nextCloseStep(useJobStore.getState().running, useProjectStore.getState().isDirty());
        if (step === 'close') return; // nothing to ask: let Tauri close the window
        event.preventDefault();
        setPrompt(step);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Escape means "never mind, keep working".
  useEffect(() => {
    if (prompt === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setPrompt(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt, busy]);

  if (prompt === null) return null;

  const closeNow = async () => {
    try {
      await getCurrentWindow().destroy();
    } catch (e) {
      notify('error', `Could not close the window: ${errorMessage(e)}`);
      setBusy(false);
    }
  };

  const stopJob = async () => {
    setBusy(true);
    try {
      await api.stop(); // soft reset: halts motion and switches the laser off
      await new Promise((resolve) => setTimeout(resolve, 300)); // let the reset reach the controller
    } catch (e) {
      notify('error', `Could not stop the job: ${errorMessage(e)}. The window was not closed.`);
      setBusy(false);
      return;
    }
    if (stepAfterStop(useProjectStore.getState().isDirty()) === 'save') {
      setBusy(false);
      setPrompt('save');
    } else {
      await closeNow();
    }
  };

  const save = async () => {
    setBusy(true);
    const saved = await saveFlow(false); // asks for a file name first if the project has none
    if (saved) await closeNow();
    else setBusy(false); // cancelled or failed: stay open (saveFlow shows the reason)
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" role="alertdialog" aria-modal="true" style={{ width: 440 }}>
        {prompt === 'stop-job' ? (
          <>
            <h2>A job is still running</h2>
            <p>
              If you close MakerLaser now, the controller may keep running the moves it has already received, with the laser on.
              Stop the job first: this resets the controller and switches the laser off.
            </p>
            <div className="modal-actions">
              <button disabled={busy} autoFocus onClick={() => setPrompt(null)}>
                Keep running
              </button>
              <button className="stop" disabled={busy} onClick={() => void stopJob()}>
                Stop job and close
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>{saveQuestion(projectName)}</h2>
            <p>Your changes will be lost if you do not save them.</p>
            <div className="modal-actions">
              <button disabled={busy} onClick={() => setPrompt(null)}>
                Cancel
              </button>
              <button disabled={busy} onClick={() => void closeNow()}>
                Don't save
              </button>
              <button className="primary" disabled={busy} autoFocus onClick={() => void save()}>
                {busy ? 'Saving\u2026' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
