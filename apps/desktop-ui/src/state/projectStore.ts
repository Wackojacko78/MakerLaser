import { create } from 'zustand';
import { api } from '@/lib/tauri';
import { rotateAbout, scaleAbout, translation, chain, worldBounds } from '@/lib/transform';
import type { ProjectFile, Transform2D, UUID, WorkspaceObject } from '@/types/domain';

const HISTORY_LIMIT = 100;
const COALESCE_WINDOW_MS = 1000;

/** Deep copy of plain JSON data (the whole project is JSON-serialisable by design). */
export const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Copy used for every edit and every undo snapshot. Everything is deep-copied EXCEPT each
 * object's `kind` (its vector paths / image reference), which is shared between
 * snapshots. By convention `kind` payloads are immutable: the UI only ever changes an
 * object's transform, layer, name and flags. This keeps 100 undo steps of a 50,000-point
 * SVG from costing 100 copies of its geometry, and lets the canvas memoise by reference.
 */
export function cloneProject(p: ProjectFile): ProjectFile {
  const rest = clone({ ...p, objects: [] as WorkspaceObject[] });
  return { ...rest, objects: p.objects.map((o) => ({ ...o, transform: { ...o.transform } })) };
}

interface ProjectState {
  project: ProjectFile | null;
  selected: UUID[];
  past: ProjectFile[];
  future: ProjectFile[];
  /** Incremented on every change; the toolpath preview is valid only for one revision. */
  revision: number;
  savedRevision: number;
  filePath: string | null;
  lastCoalesce: { key: string; at: number } | null;

  loadProject: (project: ProjectFile, filePath: string | null) => void;
  markSaved: (filePath: string | null) => void;
  mutate: (fn: (p: ProjectFile) => void, coalesceKey?: string) => void;
  select: (id: UUID, additive?: boolean) => void;
  setSelection: (ids: UUID[]) => void;
  clearSelection: () => void;
  addObject: (object: WorkspaceObject) => void;
  transformMany: (updates: Record<UUID, Transform2D>) => void;
  nudgeSelected: (dx: number, dy: number) => void;
  scaleSelectedAbout: (sx: number, sy: number) => void;
  rotateSelected: (deg: number) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  undo: () => void;
  redo: () => void;
  sync: () => Promise<void>;
  nextZIndex: () => number;
  isDirty: () => boolean;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  selected: [],
  past: [],
  future: [],
  revision: 0,
  savedRevision: 0,
  filePath: null,
  lastCoalesce: null,

  loadProject: (project, filePath) =>
    set((s) => {
      const revision = s.revision + 1;
      return {
        project,
        filePath,
        selected: [],
        past: [],
        future: [],
        revision,
        savedRevision: revision,
        lastCoalesce: null,
      };
    }),

  markSaved: (filePath) => set((s) => ({ savedRevision: s.revision, filePath })),

  mutate: (fn, coalesceKey) =>
    set((s) => {
      if (!s.project) return s;
      const next = cloneProject(s.project);
      fn(next);
      const now = Date.now();
      const coalesce =
        coalesceKey !== undefined &&
        s.lastCoalesce !== null &&
        s.lastCoalesce.key === coalesceKey &&
        now - s.lastCoalesce.at < COALESCE_WINDOW_MS;
      return {
        project: next,
        // A burst of edits to the same field (typing a number) is a single undo step.
        past: coalesce ? s.past : [...s.past.slice(-(HISTORY_LIMIT - 1)), s.project],
        future: [],
        revision: s.revision + 1,
        lastCoalesce: coalesceKey !== undefined ? { key: coalesceKey, at: now } : null,
      };
    }),

  select: (id, additive = false) =>
    set((s) => ({
      selected: additive
        ? s.selected.includes(id)
          ? s.selected.filter((x) => x !== id)
          : [...s.selected, id]
        : [id],
    })),

  setSelection: (ids) => set({ selected: ids }),
  clearSelection: () => set({ selected: [] }),

  addObject: (object) => {
    get().mutate((p) => {
      const o: WorkspaceObject = { ...object, transform: { ...object.transform } };
      if (o.layer_id === null) {
        // Vectors default to Score (non-destructive); the user promotes them to Cut.
        const wanted = o.kind.type === 'image' ? 'image' : 'score';
        o.layer_id = p.layers.find((l) => l.kind === wanted)?.id ?? null;
      }
      p.objects.push(o);
    });
    set({ selected: [object.id] });
  },

  transformMany: (updates) => {
    const ids = Object.keys(updates);
    if (ids.length === 0) return;
    get().mutate((p) => {
      for (const o of p.objects) {
        const t = updates[o.id];
        if (t) o.transform = t;
      }
    });
  },

  nudgeSelected: (dx, dy) => {
    const { project, selected } = get();
    if (!project || selected.length === 0) return;
    const updates: Record<UUID, Transform2D> = {};
    for (const o of project.objects) {
      if (selected.includes(o.id) && !o.locked) updates[o.id] = chain(o.transform, translation(dx, dy));
    }
    get().mutate((p) => {
      for (const o of p.objects) {
        if (updates[o.id]) o.transform = updates[o.id];
      }
    }, 'nudge');
  },

  scaleSelectedAbout: (sx, sy) => {
    const { project, selected } = get();
    if (!project || selected.length === 0) return;
    const boxes = project.objects.filter((o) => selected.includes(o.id)).map(worldBounds);
    let minX = Infinity;
    let minY = Infinity;
    for (const b of boxes) {
      if (b) {
        minX = Math.min(minX, b.minX);
        minY = Math.min(minY, b.minY);
      }
    }
    if (!Number.isFinite(minX)) return;
    get().mutate((p) => {
      for (const o of p.objects) {
        if (selected.includes(o.id) && !o.locked) o.transform = scaleAbout(o.transform, sx, sy, minX, minY);
      }
    }, 'resize');
  },

  rotateSelected: (deg) => {
    const { project, selected } = get();
    if (!project || selected.length === 0) return;
    const chosen = project.objects.filter((o) => selected.includes(o.id) && !o.locked);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const o of chosen) {
      const b = worldBounds(o);
      if (b) {
        minX = Math.min(minX, b.minX);
        minY = Math.min(minY, b.minY);
        maxX = Math.max(maxX, b.maxX);
        maxY = Math.max(maxY, b.maxY);
      }
    }
    if (!Number.isFinite(minX)) return;
    const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    get().mutate((p) => {
      for (const o of p.objects) {
        if (chosen.some((c) => c.id === o.id)) o.transform = rotateAbout(o.transform, deg, centre.x, centre.y);
      }
    });
  },

  removeSelected: () => {
    const ids = new Set(get().selected);
    if (ids.size === 0) return;
    get().mutate((p) => {
      p.objects = p.objects.filter((o) => !ids.has(o.id) || o.locked);
    });
    set({ selected: [] });
  },

  duplicateSelected: () => {
    const ids = new Set(get().selected);
    if (ids.size === 0) return;
    const created: UUID[] = [];
    get().mutate((p) => {
      let z = p.objects.reduce((m, o) => Math.max(m, o.z_index), -1);
      for (const o of p.objects.filter((x) => ids.has(x.id))) {
        const copy: WorkspaceObject = { ...o, transform: { ...o.transform } };
        copy.id = crypto.randomUUID();
        copy.name = `${o.name} copy`;
        copy.transform = chain(o.transform, translation(5, 5));
        copy.locked = false;
        copy.z_index = ++z;
        p.objects.push(copy);
        created.push(copy.id);
      }
    });
    set({ selected: created });
  },

  undo: () =>
    set((s) => {
      const previous = s.past[s.past.length - 1];
      if (!previous || !s.project) return s;
      return {
        project: previous,
        past: s.past.slice(0, -1),
        future: [s.project, ...s.future],
        selected: [],
        revision: s.revision + 1,
        lastCoalesce: null,
      };
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next || !s.project) return s;
      return {
        project: next,
        past: [...s.past, s.project],
        future: s.future.slice(1),
        selected: [],
        revision: s.revision + 1,
        lastCoalesce: null,
      };
    }),

  sync: async () => {
    const project = get().project;
    if (project) await api.syncProject(project);
  },

  nextZIndex: () => (get().project?.objects.reduce((m, o) => Math.max(m, o.z_index), -1) ?? -1) + 1,
  isDirty: () => get().revision !== get().savedRevision,
}));
