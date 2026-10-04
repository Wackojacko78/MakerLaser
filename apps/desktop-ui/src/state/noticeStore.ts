import { create } from 'zustand';

export type NoticeKind = 'info' | 'warning' | 'error';

interface NoticeState {
  notice: { kind: NoticeKind; text: string; id: number } | null;
  show: (kind: NoticeKind, text: string) => void;
  dismiss: () => void;
}

let counter = 0;

export const useNoticeStore = create<NoticeState>((set) => ({
  notice: null,
  show: (kind, text) => {
    const id = ++counter;
    set({ notice: { kind, text, id } });
    // Errors stay until dismissed; everything else clears itself.
    if (kind !== 'error') {
      setTimeout(() => set((s) => (s.notice?.id === id ? { notice: null } : s)), 6000);
    }
  },
  dismiss: () => set({ notice: null }),
}));
