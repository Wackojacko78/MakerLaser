import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  ARTWORK_EXTENSIONS,
  generateFlow,
  importFromDialog,
  importPaths,
  newProjectFlow,
  openProjectFlow,
  saveFlow,
} from '@/lib/actions';
import { useJobStore } from '@/state/jobStore';
import { useProjectStore } from '@/state/projectStore';
import type { JobEventPayload } from '@/types/domain';

/** Job progress events emitted by the Rust job thread. */
export function useJobEvents(): void {
  useEffect(() => {
    const unlisten = listen<JobEventPayload>('job-event', (e) => useJobStore.getState().applyEvent(e.payload));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
}

/** Native OS file drops (Tauri hands us real file paths). */
export function useDragDropImport(): void {
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop') return;
      const paths = event.payload.paths.filter((p) =>
        ARTWORK_EXTENSIONS.includes(p.split('.').pop()?.toLowerCase() ?? ''),
      );
      if (paths.length > 0) void importPaths(paths);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
}

function isEditingText(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** Keyboard shortcuts. Ignored while typing in a field. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditingText(e.target)) return;
      const store = useProjectStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod) {
        if (!['z', 'y', 'd', 's', 'o', 'n', 'i', 'enter'].includes(key)) return;
        e.preventDefault();
        if (key === 'z') {
          if (e.shiftKey) store.redo();
          else store.undo();
        } else if (key === 'y') store.redo();
        else if (key === 'd') store.duplicateSelected();
        else if (key === 's') void saveFlow(e.shiftKey);
        else if (key === 'o') void openProjectFlow();
        else if (key === 'n') void newProjectFlow();
        else if (key === 'i') void importFromDialog();
        else void generateFlow();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        store.removeSelected();
      } else if (e.key === 'Escape') {
        store.clearSelection();
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        store.nudgeSelected(dx, dy);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
