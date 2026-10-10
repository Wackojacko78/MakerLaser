// The console command box: small pure helpers for the typed-command history and for reading the
// controller's replies. Pure TypeScript (no React or Tauri imports), so it is unit-tested in plain
// Node (tests/consoleCommand.test.ts). The rules about what may be sent live on the Rust side
// (apps/rust-core/src/console.rs); this file only tidies what is typed and shown.

/** How many typed commands are remembered for the up/down arrow keys. */
export const COMMAND_HISTORY_LIMIT = 50;

/** The text to send: what was typed, without the spaces around it. */
export function normaliseCommand(raw: string): string {
  return raw.trim();
}

/** The history with a command added at the end. Empty input and an immediate repeat are not kept. */
export function addToHistory(history: readonly string[], command: string, limit: number = COMMAND_HISTORY_LIMIT): string[] {
  const text = normaliseCommand(command);
  if (text === '' || history[history.length - 1] === text) return [...history];
  return [...history, text].slice(-Math.max(1, limit));
}

export interface HistoryStep {
  /** Where in the history the box now is, or null when it is back to a fresh line. */
  readonly index: number | null;
  /** What the box should show, or null to leave what is typed alone. */
  readonly text: string | null;
}

/**
 * Moves through the history with the arrow keys: 'older' is the up arrow, 'newer' the down arrow.
 * The history runs oldest to newest. Going newer past the last command gives a fresh, empty line.
 */
export function stepHistory(history: readonly string[], index: number | null, direction: 'older' | 'newer'): HistoryStep {
  if (history.length === 0) return { index: null, text: null };
  if (direction === 'older') {
    const next = index === null ? history.length - 1 : Math.max(0, Math.min(index, history.length - 1) - 1);
    return { index: next, text: commandAt(history, next) };
  }
  if (index === null) return { index: null, text: null };
  if (index >= history.length - 1) return { index: null, text: '' };
  return { index: index + 1, text: commandAt(history, index + 1) };
}

/** The command at a position in the history, or null when there is none (safe whatever the tsconfig says about indexing). */
function commandAt(history: readonly string[], position: number): string | null {
  const [command = null] = history.slice(position, position + 1);
  return command;
}

/** The `$32` (laser mode) line in a `$$` reply, as 0 or 1, or null when the reply has none. */
export function laserModeSetting(replies: readonly string[]): 0 | 1 | null {
  for (const line of replies) {
    const match = /^\$32\s*=\s*(\d+)/.exec(line.trim());
    if (match) return match[1] === '1' ? 1 : match[1] === '0' ? 0 : null;
  }
  return null;
}

/** A line for the console log after `$$`: what laser mode is set to, and whether framing needs a change. */
export function laserModeNote(replies: readonly string[]): string | null {
  const mode = laserModeSetting(replies);
  if (mode === 1) return 'Laser mode ($32=1) is ON: the beam drops to nothing whenever the head is not moving.';
  if (mode === 0) return 'Laser mode ($32=0) is OFF. Frame with laser on needs it ON: send $32=1 to change it.';
  return null;
}

/** The placeholder inside the command box, for each state the box can be in. */
export function commandPlaceholder(state: { connected: boolean; simulated: boolean; running: boolean }): string {
  if (!state.connected) return 'Connect to the machine to send commands';
  if (state.simulated) return 'Typed commands are not available with the simulator';
  if (state.running) return 'A job is running: use Pause or STOP';
  return 'Type a command, for example $$ to list the settings, then press Enter';
}
