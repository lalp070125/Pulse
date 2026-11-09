import { useEffect } from 'react';
import { APPS, appTitle } from '@pulso/core';
import { startConnection } from './lib/connection';
import { AboutDialog } from './shell/AboutDialog';
import { MenuBar } from './shell/MenuBar';
import { RuntimeStrip } from './shell/RuntimeStrip';
import { StatusBar } from './shell/StatusBar';
import { TitleBar } from './shell/TitleBar';
import { Workspace } from './shell/Workspace';
import { appFromPath, navigateToApp, useShell } from './state/store';

export function App() {
  const app = useShell((s) => s.app);
  const projectName = useShell((s) => s.projectName);

  // One runtime connection for the whole app.
  useEffect(() => startConnection(), []);

  // Keep the app in step with the address bar (back / forward buttons).
  useEffect(() => {
    const known = APPS.some((a) => a.route === window.location.pathname);
    if (!known) window.history.replaceState(null, '', '/studio');
    const onPop = () => useShell.getState().setApp(appFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    document.title = `${appTitle(app)} — ${projectName ?? 'No project'}`;
  }, [app, projectName]);

  // Global keyboard shortcuts (the same ones shown in the menus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shell = useShell.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && e.altKey && key === 'b') shell.toggle('inspectorOpen');
      else if (ctrl && !e.altKey && key === 'b') shell.toggle('sidebarOpen');
      else if (ctrl && key === 'j') shell.toggle('bottomOpen');
      else if (e.altKey && !ctrl && ['1', '2', '3'].includes(key)) {
        const target = APPS[Number(key) - 1];
        if (target) navigateToApp(target.id);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="shell" data-app={app}>
      <TitleBar />
      <MenuBar />
      <RuntimeStrip />
      <Workspace />
      <StatusBar />
      <AboutDialog />
    </div>
  );
}
