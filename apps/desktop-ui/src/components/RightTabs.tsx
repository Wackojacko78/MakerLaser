import type { KeyboardEvent, ReactNode } from 'react';
import { LayersPanel } from '@/components/LayersPanel';
import { MaterialsPanel } from '@/components/MaterialsPanel';
import { PropertiesPanel } from '@/components/PropertiesPanel';
import { ShapeToolsPanel } from '@/components/ShapeToolsPanel';
import { TracePanel } from '@/components/TracePanel';
import { RIGHT_TABS, nextTab, type RightTab } from '@/lib/rightTabs';
import { useRightTabStore } from '@/state/rightTabStore';

/** A panel that is not showing is hidden, not removed, so what you typed in it is still there when you come back. */
function TabPanel({ id, tab, children }: { id: RightTab; tab: RightTab; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`right-panel-${id}`} aria-labelledby={`right-tab-${id}`} hidden={tab !== id} style={{ minWidth: 0 }}>
      {children}
    </div>
  );
}

/**
 * The right-hand panel: a row of tabs (Properties, Shape tools, Trace) that stays at the top while the
 * panel scrolls, and the panel of the tab that is showing. The toolbar buttons "Shape tools…" and "Trace…"
 * switch to their tabs. The left and right arrow keys move between the tabs when one has the focus.
 */
export function RightTabs() {
  const tab = useRightTabStore((s) => s.tab);
  const setTab = useRightTabStore((s) => s.setTab);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTab(tab, e.key);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation(); // the arrow keys must not also nudge the selected artwork
    setTab(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  };

  return (
    <>
      <div
        role="tablist"
        aria-label="Right-hand panel"
        onKeyDown={onKeyDown}
        style={{ position: 'sticky', top: 0, zIndex: 3, display: 'flex', background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}
      >
        {RIGHT_TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              role="tab"
              id={`right-tab-${t.id}`}
              data-tab={t.id}
              aria-selected={active}
              aria-controls={`right-panel-${t.id}`}
              tabIndex={active ? 0 : -1}
              title={t.title}
              onClick={() => setTab(t.id)}
              style={{
                flex: '1 1 0',
                minWidth: 0,
                padding: '8px 6px',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                borderRadius: 0,
                color: active ? 'var(--accent)' : 'var(--muted)',
                fontWeight: active ? 600 : 400,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <TabPanel id="properties" tab={tab}>
        <PropertiesPanel />
        <LayersPanel />
        <MaterialsPanel />
      </TabPanel>
      <TabPanel id="shape" tab={tab}>
        <ShapeToolsPanel active={tab === 'shape'} />
      </TabPanel>
      <TabPanel id="trace" tab={tab}>
        <TracePanel active={tab === 'trace'} />
      </TabPanel>
    </>
  );
}
