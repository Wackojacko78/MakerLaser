import { beforeEach, describe, expect, it } from 'vitest';
import { clone, useProjectStore } from '@/state/projectStore';
import { useJobStore } from '@/state/jobStore';
import { worldBounds } from '@/lib/transform';
import type { Layer, ProjectFile, WorkspaceObject } from '@/types/domain';

function layer(kind: Layer['kind'], name: string): Layer {
  return {
    id: `layer-${kind}`,
    name,
    kind,
    speed_mm_min: 300,
    power_percent: 50,
    passes: 1,
    air_assist: false,
    enabled: true,
    z_order: 0,
    color: '#fff',
    kerf_mm: 0,
    line_spacing_mm: 0.1,
    fill_angle_deg: 0,
    cross_hatch: false,
    raster: {
      dpi: 254,
      dither: 'floyd_steinberg',
      direction: 'horizontal',
      bidirectional: true,
      brightness: 0,
      contrast: 0,
      gamma: 1,
      invert: false,
    },
  };
}

function baseProject(): ProjectFile {
  return {
    schema_version: 1,
    id: 'p',
    name: 'Test',
    machine: {
      id: 'm',
      name: 'M',
      controller: 'grbl1_1',
      bed_width_mm: 300,
      bed_height_mm: 300,
      origin: 'bottom_left',
      max_feed_rate_mm_min: 10000,
      max_spindle_value: 1000,
      homing_supported: false,
      air_assist_supported: true,
      baud_rate: 115200,
    },
    layers: [layer('cut', 'Cut'), layer('score', 'Score'), layer('fill', 'Fill'), layer('image', 'Image')],
    objects: [],
    materials: { presets: [] },
    settings: { units: 'mm', grid_spacing_mm: 10, show_grid: true, show_origin: true },
  };
}

function vector(id: string, x = 0, y = 0, size = 10): WorkspaceObject {
  return {
    id,
    name: id,
    kind: {
      type: 'vector',
      paths: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: size, y: 0 },
            { x: size, y: size },
            { x: 0, y: size },
          ],
        },
      ],
    },
    transform: { a: 1, b: 0, c: 0, d: 1, e: x, f: y },
    layer_id: null,
    visible: true,
    locked: false,
    z_index: 0,
  };
}

function image(id: string): WorkspaceObject {
  return {
    ...vector(id),
    kind: { type: 'image', asset_id: 'asset-1', format: 'png', source_path: null, width_px: 100, height_px: 50, dpi: 254 },
  };
}

const store = () => useProjectStore.getState();

beforeEach(() => {
  store().loadProject(baseProject(), null);
  useJobStore.getState().clearResult();
});

describe('history', () => {
  it('undoes and redoes a change', () => {
    store().mutate((p) => {
      p.name = 'Changed';
    });
    expect(store().project?.name).toBe('Changed');
    store().undo();
    expect(store().project?.name).toBe('Test');
    store().redo();
    expect(store().project?.name).toBe('Changed');
  });

  it('a new edit after an undo clears the redo stack', () => {
    store().mutate((p) => {
      p.name = 'A';
    });
    store().undo();
    store().mutate((p) => {
      p.name = 'B';
    });
    store().redo();
    expect(store().project?.name).toBe('B');
  });

  it('coalesces a burst of edits to one field into a single undo step', () => {
    for (const v of [1, 2, 3, 4, 5]) {
      store().mutate((p) => {
        p.layers[0].power_percent = v;
      }, 'layer-power');
    }
    expect(store().project?.layers[0].power_percent).toBe(5);
    store().undo();
    expect(store().project?.layers[0].power_percent).toBe(50);
  });

  it('does not coalesce edits to different fields', () => {
    store().mutate((p) => {
      p.layers[0].power_percent = 10;
    }, 'a');
    store().mutate((p) => {
      p.layers[0].speed_mm_min = 99;
    }, 'b');
    store().undo();
    expect(store().project?.layers[0].speed_mm_min).toBe(300);
    expect(store().project?.layers[0].power_percent).toBe(10);
  });

  it('every change bumps the revision so a stale preview can be detected', () => {
    const before = store().revision;
    store().mutate((p) => {
      p.name = 'x';
    });
    expect(store().revision).toBeGreaterThan(before);
    const afterEdit = store().revision;
    store().undo();
    expect(store().revision).toBeGreaterThan(afterEdit);
  });

  it('tracks unsaved changes', () => {
    expect(store().isDirty()).toBe(false);
    store().mutate((p) => {
      p.name = 'x';
    });
    expect(store().isDirty()).toBe(true);
    store().markSaved('/tmp/a.mlp');
    expect(store().isDirty()).toBe(false);
  });

  it('history snapshots are independent copies', () => {
    const original = clone(store().project!);
    store().mutate((p) => {
      p.layers[0].name = 'Mutated';
    });
    store().undo();
    expect(store().project).toEqual(original);
  });
});

describe('objects', () => {
  it('imports vectors onto the Score layer and images onto the Image layer', () => {
    store().addObject(vector('v'));
    store().addObject(image('i'));
    const objs = store().project!.objects;
    expect(objs.find((o) => o.id === 'v')?.layer_id).toBe('layer-score');
    expect(objs.find((o) => o.id === 'i')?.layer_id).toBe('layer-image');
    expect(store().selected).toEqual(['i']);
  });

  it('keeps an explicit layer assignment', () => {
    const o = vector('v');
    o.layer_id = 'layer-cut';
    store().addObject(o);
    expect(store().project!.objects[0].layer_id).toBe('layer-cut');
  });

  it('duplicates share the image asset and are offset', () => {
    store().addObject(image('i'));
    store().duplicateSelected();
    const objs = store().project!.objects;
    expect(objs).toHaveLength(2);
    const [a, b] = objs;
    expect(a.kind.type === 'image' && b.kind.type === 'image' && a.kind.asset_id === b.kind.asset_id).toBe(true);
    expect(b.transform.e).toBe(a.transform.e + 5);
    expect(b.id === a.id).toBe(false);
    expect(store().selected).toEqual([b.id]);
  });

  it('delete removes selected unlocked objects only', () => {
    store().addObject(vector('a'));
    store().addObject(vector('b'));
    store().mutate((p) => {
      p.objects[1].locked = true;
    });
    store().setSelection(['a', 'b']);
    store().removeSelected();
    expect(store().project!.objects.map((o) => o.id)).toEqual(['b']);
  });

  it('transformMany applies several transforms in one undo step', () => {
    store().addObject(vector('a'));
    store().addObject(vector('b'));
    const before = store().past.length;
    store().transformMany({
      a: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 5 },
      b: { a: 1, b: 0, c: 0, d: 1, e: 9, f: 9 },
    });
    expect(store().past.length).toBe(before + 1);
    store().undo();
    expect(store().project!.objects[0].transform.e).toBe(0);
    expect(store().project!.objects[1].transform.e).toBe(0);
  });

  it('nudging moves the selection and skips locked objects', () => {
    store().addObject(vector('a', 10, 10));
    store().mutate((p) => {
      p.objects[0].locked = true;
    });
    store().nudgeSelected(1, 1);
    expect(store().project!.objects[0].transform.e).toBe(10);
    store().mutate((p) => {
      p.objects[0].locked = false;
    });
    store().nudgeSelected(1, -2);
    expect(store().project!.objects[0].transform.e).toBe(11);
    expect(store().project!.objects[0].transform.f).toBe(8);
  });

  it('resizing keeps the top-left corner fixed', () => {
    store().addObject(vector('a', 20, 30, 10));
    store().scaleSelectedAbout(2, 3);
    const b = worldBounds(store().project!.objects[0])!;
    expect([b.minX, b.minY, b.maxX, b.maxY]).toEqual([20, 30, 40, 60]);
  });

  it('rotating 90 degrees about the centre swaps width and height of a rectangle', () => {
    const o = vector('a', 0, 0, 10);
    if (o.kind.type === 'vector') o.kind.paths[0].points[1].x = 30; // 30 x 10
    store().addObject(o);
    store().rotateSelected(90);
    const b = worldBounds(store().project!.objects[0])!;
    expect(Math.abs(b.maxX - b.minX - 10) < 1e-6 && Math.abs(b.maxY - b.minY - 30) < 1e-6).toBe(true);
    // The centre (15, 5) must not move.
    expect(Math.abs((b.minX + b.maxX) / 2 - 15) < 1e-6 && Math.abs((b.minY + b.maxY) / 2 - 5) < 1e-6).toBe(true);
  });
});

describe('selection', () => {
  it('plain select replaces, additive select toggles', () => {
    store().select('a');
    store().select('b', true);
    expect(store().selected).toEqual(['a', 'b']);
    store().select('a', true);
    expect(store().selected).toEqual(['b']);
    store().select('c');
    expect(store().selected).toEqual(['c']);
  });
});

describe('job events', () => {
  it('tracks progress, pause and completion', () => {
    const job = () => useJobStore.getState();
    job().setRunning(true);
    job().applyEvent({ type: 'progress', done: 5, total: 10 });
    expect(job().progress).toEqual({ done: 5, total: 10 });
    job().applyEvent({ type: 'paused' });
    expect(job().paused).toBe(true);
    job().applyEvent({ type: 'resumed' });
    expect(job().paused).toBe(false);
    job().applyEvent({ type: 'completed' });
    expect(job().running).toBe(false);
    expect(job().status).toBe('Job complete');
  });

  it('a failure is recorded in the log and ends the run', () => {
    const job = () => useJobStore.getState();
    job().setRunning(true);
    job().applyEvent({ type: 'failed', message: 'error:22 Feed rate undefined' });
    expect(job().running).toBe(false);
    expect(job().log.some((l) => l.includes('Feed rate undefined'))).toBe(true);
  });
});
