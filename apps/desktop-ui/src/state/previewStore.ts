import { useSyncExternalStore } from 'react';
import { createPreviewOptionsStore } from '@/lib/previewOptions';

/** Options for the toolpath preview. The choice is remembered between sessions. */
export const previewOptions = createPreviewOptionsStore(typeof localStorage === 'undefined' ? undefined : localStorage);

export function usePreviewOptions() {
  return useSyncExternalStore(previewOptions.subscribe, previewOptions.get);
}
