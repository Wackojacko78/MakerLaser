// The decisions behind the "save before closing" prompt. Pure TypeScript (no React or Tauri),
// so it is unit-tested in plain Node (tests/closeGuard.test.ts).

export type CloseStep = 'close' | 'stop-job' | 'save';

/**
 * What must happen before the window may close.
 * A running job comes first: closing MakerLaser does not by itself stop a laser that is
 * already burning, because the controller keeps running the moves it has received.
 */
export function nextCloseStep(jobRunning: boolean, hasUnsavedChanges: boolean): CloseStep {
  if (jobRunning) return 'stop-job';
  if (hasUnsavedChanges) return 'save';
  return 'close';
}

/** The step after the job has been stopped. */
export function stepAfterStop(hasUnsavedChanges: boolean): CloseStep {
  return hasUnsavedChanges ? 'save' : 'close';
}

/** "Save changes to “name”?", with a long name shortened. */
export function saveQuestion(projectName: string, maxName = 40): string {
  const name = projectName.trim();
  if (name === '') return 'Save changes to this project?';
  const shown = name.length > maxName ? `${name.slice(0, maxName)}\u2026` : name;
  return `Save changes to \u201c${shown}\u201d?`;
}
