import { useEffect, useRef } from 'react';
import { ChevronUp } from 'lucide-react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { PRODUCT_NAME } from '@pulso/core';
import logoUrl from '../assets/logo.svg';
import { useShell } from '../state/store';
import { Inspector } from './Inspector';
import { MessagesPanel } from './MessagesPanel';
import { Sidebar } from './Sidebar';
import { Tabs } from './Tabs';

// Shell sizes in px (SPEC 4.3). The panel library works in percent, so the
// starting sizes are converted once from the real window size.
const SIDEBAR_PX = 260;
const INSPECTOR_PX = 280;
const BOTTOM_PX = 220;
const CHROME_PX = 28 + 26 + 24 + 22; // title + menu + strip + status

function percent(px: number, of: number): number {
  return Math.min(45, Math.max(8, (px / Math.max(of, 1)) * 100));
}

function Document() {
  const set = useShell((s) => s.tabsByApp[s.app]);
  const active = set.tabs.find((t) => t.id === set.activeId);
  return (
    <div className="document" data-testid="document">
      {active ? (
        <div className="doc-placeholder">
          <div className="doc-title">{active.title}</div>
          <div className="doc-note">{active.note}</div>
        </div>
      ) : (
        <div className="doc-placeholder">
          <img src={logoUrl} alt="" className="doc-mark" />
          <div className="doc-title">{PRODUCT_NAME} Studio</div>
          <div className="doc-note">
            Nothing is open. Click an item in the project tree on the left to open it here.
          </div>
        </div>
      )}
    </div>
  );
}

/** Left sidebar · centre documents · optional right inspector · bottom panel. */
export function Workspace() {
  const sidebarOpen = useShell((s) => s.sidebarOpen);
  const inspectorOpen = useShell((s) => s.inspectorOpen);
  const bottomOpen = useShell((s) => s.bottomOpen);
  const bottomRef = useRef<ImperativePanelHandle>(null);

  const width = Math.max(window.innerWidth, 1280);
  const height = Math.max(window.innerHeight - CHROME_PX, 300);
  const sidebarSize = percent(SIDEBAR_PX, width);
  const bottomSize = percent(BOTTOM_PX, height);

  // The bottom panel stays mounted and collapses, so its content is kept.
  useEffect(() => {
    const panel = bottomRef.current;
    if (!panel) return;
    if (bottomOpen && panel.isCollapsed()) panel.expand();
    if (!bottomOpen && !panel.isCollapsed()) panel.collapse();
  }, [bottomOpen]);

  return (
    <main className="workspace" data-testid="workspace">
      <PanelGroup direction="horizontal">
        {sidebarOpen && (
          <>
            <Panel id="sidebar" order={1} defaultSize={sidebarSize} minSize={12} maxSize={40}>
              <Sidebar />
            </Panel>
            <PanelResizeHandle className="handle handle-v" />
          </>
        )}
        <Panel id="centre" order={2} minSize={30}>
          <PanelGroup direction="vertical">
            <Panel id="docs" order={1} minSize={20}>
              <PanelGroup direction="horizontal">
                <Panel id="documents" order={1} minSize={30}>
                  <div className="doc-area">
                    <Tabs />
                    <Document />
                  </div>
                </Panel>
                {inspectorOpen && (
                  <>
                    <PanelResizeHandle className="handle handle-v" />
                    <Panel
                      id="inspector"
                      order={2}
                      defaultSize={percent(INSPECTOR_PX, width * (1 - sidebarSize / 100))}
                      minSize={15}
                      maxSize={45}
                    >
                      <Inspector />
                    </Panel>
                  </>
                )}
              </PanelGroup>
            </Panel>
            <PanelResizeHandle className="handle handle-h" />
            <Panel
              id="bottom"
              order={2}
              ref={bottomRef}
              defaultSize={bottomSize}
              minSize={12}
              maxSize={70}
              collapsible
              collapsedSize={0}
              onCollapse={() => useShell.getState().setBottomOpen(false)}
              onExpand={() => useShell.getState().setBottomOpen(true)}
            >
              <MessagesPanel />
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>
      {!bottomOpen && (
        <button
          type="button"
          className="bottom-reopen"
          title="Show the bottom panel (Ctrl+J)"
          onClick={() => useShell.getState().setBottomOpen(true)}
        >
          <ChevronUp size={14} strokeWidth={1.5} /> Messages
        </button>
      )}
    </main>
  );
}
