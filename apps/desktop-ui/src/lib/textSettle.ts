// Applies a change to a text object, waiting first for its font to load when it has not yet. Several
// changes made while a font is loading (typing, then picking another font) are merged and applied
// once, in order, so none is lost and an older one never overwrites a newer one. The browser and the
// project are passed in, so this is unit-tested in plain Node (tests/textSettle.test.ts).

export interface SettleDeps<Patch extends object, Form, Mode> {
  /** The settings the object would have with the patch applied, or null when the object is gone. */
  formWith(id: string, patch: Patch): Form | null;
  /** True when the fonts that form needs can be drawn with right now. */
  isReady(form: Form): boolean;
  /** Loads the fonts that form needs. Should not throw; a throw is treated as "tried". */
  load(form: Form): Promise<unknown>;
  /** Applies the patch for real. Returns false when there is nothing to draw. */
  apply(id: string, patch: Patch, mode: Mode): boolean;
}

/** How many times to wait for a font before drawing with whatever is available. */
export const MAX_FONT_WAITS = 3;

export function createTextSettler<Patch extends object, Form, Mode>(deps: SettleDeps<Patch, Form, Mode>, mergeMode: (older: Mode, newer: Mode) => Mode) {
  const queued = new Map<string, { patch: Patch; mode: Mode }>();

  async function settle(id: string): Promise<void> {
    for (let waits = 0; waits < MAX_FONT_WAITS; waits += 1) {
      const entry = queued.get(id);
      if (!entry) return;
      const form = deps.formWith(id, entry.patch);
      if (form === null) {
        queued.delete(id);
        return;
      }
      if (deps.isReady(form)) break;
      try {
        await deps.load(form);
      } catch {
        /* drawn with the fallback font */
      }
    }
    const entry = queued.get(id);
    queued.delete(id);
    if (entry) deps.apply(id, entry.patch, entry.mode);
  }

  return {
    /**
     * Asks for a change. Returns true when it was applied or is waiting for a font, and false when it
     * was applied immediately and there was nothing to draw (or the object no longer exists).
     */
    request(id: string, patch: Patch, mode: Mode): boolean {
      const waiting = queued.get(id);
      if (waiting) {
        queued.set(id, { patch: { ...waiting.patch, ...patch }, mode: mergeMode(waiting.mode, mode) });
        return true;
      }
      const form = deps.formWith(id, patch);
      if (form === null) return false;
      if (deps.isReady(form)) return deps.apply(id, patch, mode);
      queued.set(id, { patch, mode });
      void settle(id);
      return true;
    },
    /** True while a change for this object is waiting for a font. */
    isWaiting(id: string): boolean {
      return queued.has(id);
    },
  };
}
