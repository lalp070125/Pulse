import { create } from 'zustand';
import { APPS, type AppId } from '@pulso/core';

/* ----------------------------------------------------------------------------
 * One UI store for the shell. It holds only UI state (which app, which tabs,
 * which panels are open, the message list, the connection status).
 * Machine data never lives here: it will come from the runtime (SPEC 0.4).
 * -------------------------------------------------------------------------- */

export type StudioMode = 'plan' | 'monitor' | 'test';
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';
export type MessageLevel = 'error' | 'warning' | 'info';

export interface DocTab {
  id: string;
  title: string;
  /** Fixed tabs (Panel: Design / Variable Mapping, Twin: builders) cannot be closed. */
  closable: boolean;
  /** Plain-language note shown in the empty document until the real editor exists. */
  note: string;
}

export interface Message {
  id: number;
  time: number;
  level: MessageLevel;
  source: string;
  text: string;
}

interface TabSet {
  tabs: DocTab[];
  activeId: string | null;
}

const fixed = (id: string, title: string, note: string): DocTab => ({
  id,
  title,
  closable: false,
  note,
});

const initialTabs: Record<AppId, TabSet> = {
  studio: { tabs: [], activeId: null },
  panel: {
    tabs: [
      fixed('panel:design', 'Design', 'The operator screen designer is built in Phase 7.'),
      fixed(
        'panel:mapping',
        'Variable Mapping',
        'The variable mapping report is built in Phase 7.',
      ),
    ],
    activeId: 'panel:design',
  },
  twin: {
    tabs: [
      fixed('twin:station', 'Station Builder', 'The 3D station builder is built in Phase 8.'),
      fixed('twin:line', 'Line Builder', 'The 3D line builder is built in Phase 8.'),
    ],
    activeId: 'twin:station',
  },
};

export function appFromPath(pathname: string): AppId {
  const found = APPS.find((a) => pathname === a.route || pathname.startsWith(`${a.route}/`));
  return found ? found.id : 'studio';
}

const MAX_MESSAGES = 2000;
let nextMessageId = 1;

export interface ShellState {
  app: AppId;
  mode: StudioMode;
  connection: ConnectionStatus;
  runtimeAddress: string | null;
  projectName: string | null;

  sidebarOpen: boolean;
  inspectorOpen: boolean;
  bottomOpen: boolean;
  aboutOpen: boolean;

  selectedTreeId: string | null;
  tabsByApp: Record<AppId, TabSet>;

  messages: Message[];
  /** Messages that arrived while paused; shown when the user resumes. */
  heldMessages: Message[];
  messagesPaused: boolean;

  setApp(app: AppId): void;
  setMode(mode: StudioMode): void;
  setConnection(status: ConnectionStatus): void;
  setRuntimeInfo(address: string | null, projectName: string | null): void;
  toggle(panel: 'sidebarOpen' | 'inspectorOpen' | 'bottomOpen'): void;
  setBottomOpen(open: boolean): void;
  setAboutOpen(open: boolean): void;
  selectTreeNode(id: string | null): void;

  openTab(tab: DocTab): void;
  closeTab(id: string): void;
  activateTab(id: string): void;
  moveTab(id: string, beforeId: string): void;

  log(level: MessageLevel, source: string, text: string): void;
  clearMessages(): void;
  setMessagesPaused(paused: boolean): void;
}

export const useShell = create<ShellState>((set, get) => ({
  app: typeof window === 'undefined' ? 'studio' : appFromPath(window.location.pathname),
  mode: 'plan',
  connection: 'connecting',
  runtimeAddress: null,
  projectName: null,

  sidebarOpen: true,
  inspectorOpen: true,
  bottomOpen: true,
  aboutOpen: false,

  selectedTreeId: null,
  tabsByApp: initialTabs,

  messages: [],
  heldMessages: [],
  messagesPaused: false,

  setApp: (app) => set({ app, selectedTreeId: null }),
  setMode: (mode) => set({ mode, selectedTreeId: null }),
  setConnection: (connection) => set({ connection }),
  setRuntimeInfo: (runtimeAddress, projectName) => set({ runtimeAddress, projectName }),
  toggle: (panel) => set((s) => ({ [panel]: !s[panel] }) as Partial<ShellState>),
  setBottomOpen: (bottomOpen) => set({ bottomOpen }),
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  selectTreeNode: (selectedTreeId) => set({ selectedTreeId }),

  openTab: (tab) =>
    set((s) => {
      const current = s.tabsByApp[s.app];
      const exists = current.tabs.some((t) => t.id === tab.id);
      const tabs = exists ? current.tabs : [...current.tabs, tab];
      return { tabsByApp: { ...s.tabsByApp, [s.app]: { tabs, activeId: tab.id } } };
    }),

  closeTab: (id) =>
    set((s) => {
      const current = s.tabsByApp[s.app];
      const index = current.tabs.findIndex((t) => t.id === id);
      const target = current.tabs[index];
      if (!target || !target.closable) return s;
      const tabs = current.tabs.filter((t) => t.id !== id);
      let activeId = current.activeId;
      if (activeId === id) {
        const neighbour = tabs[index] ?? tabs[index - 1];
        activeId = neighbour ? neighbour.id : null;
      }
      return { tabsByApp: { ...s.tabsByApp, [s.app]: { tabs, activeId } } };
    }),

  activateTab: (id) =>
    set((s) => ({
      tabsByApp: { ...s.tabsByApp, [s.app]: { ...s.tabsByApp[s.app], activeId: id } },
    })),

  moveTab: (id, beforeId) =>
    set((s) => {
      const current = s.tabsByApp[s.app];
      const from = current.tabs.findIndex((t) => t.id === id);
      const to = current.tabs.findIndex((t) => t.id === beforeId);
      const moved = current.tabs[from];
      if (!moved || to < 0 || from === to) return s;
      const tabs = current.tabs.filter((t) => t.id !== id);
      tabs.splice(to, 0, moved);
      return { tabsByApp: { ...s.tabsByApp, [s.app]: { ...current, tabs } } };
    }),

  log: (level, source, text) => {
    const message: Message = { id: nextMessageId++, time: Date.now(), level, source, text };
    if (get().messagesPaused) {
      set((s) => ({ heldMessages: [...s.heldMessages, message].slice(-MAX_MESSAGES) }));
    } else {
      set((s) => ({ messages: [...s.messages, message].slice(-MAX_MESSAGES) }));
    }
  },
  clearMessages: () => set({ messages: [], heldMessages: [] }),
  setMessagesPaused: (paused) =>
    set((s) =>
      paused
        ? { messagesPaused: true }
        : {
            messagesPaused: false,
            messages: [...s.messages, ...s.heldMessages].slice(-MAX_MESSAGES),
            heldMessages: [],
          },
    ),
}));

/** Switches app and keeps the browser address in step (/studio, /panel, /twin). */
export function navigateToApp(app: AppId): void {
  const route = APPS.find((a) => a.id === app)?.route ?? '/studio';
  if (window.location.pathname !== route) window.history.pushState(null, '', route);
  useShell.getState().setApp(app);
}
