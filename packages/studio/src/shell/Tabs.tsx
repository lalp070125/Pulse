import { useRef } from 'react';
import { X } from 'lucide-react';
import { useShell } from '../state/store';

/** Flat 28 px document tabs: active one filled, each with a close "×", reorderable by drag. */
export function Tabs() {
  const set = useShell((s) => s.tabsByApp[s.app]);
  const drag = useRef<{ id: string; startX: number; moving: boolean } | null>(null);

  if (set.tabs.length === 0) return <div className="tabs" data-testid="tabs" />;

  return (
    <div className="tabs" role="tablist" data-testid="tabs">
      {set.tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === set.activeId}
          data-tab-id={tab.id}
          className={`tab ${tab.id === set.activeId ? 'active' : ''}`}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('.tab-close')) return;
            useShell.getState().activateTab(tab.id);
            drag.current = { id: tab.id, startX: e.clientX, moving: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            if (!d.moving && Math.abs(e.clientX - d.startX) < 6) return;
            d.moving = true;
            const under = document
              .elementsFromPoint(e.clientX, e.clientY)
              .map((el) => el.closest<HTMLElement>('[data-tab-id]'))
              .find((el) => el && el.dataset.tabId !== d.id);
            const overId = under?.dataset.tabId;
            if (overId) useShell.getState().moveTab(d.id, overId);
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          <span className="tab-title">{tab.title}</span>
          {tab.closable && (
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${tab.title}`}
              onClick={() => useShell.getState().closeTab(tab.id)}
            >
              <X size={12} strokeWidth={1.5} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
