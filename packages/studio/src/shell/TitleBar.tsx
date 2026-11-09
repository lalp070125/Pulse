import { APPS, appTitle } from '@pulso/core';
import logoUrl from '../assets/logo.svg';
import { navigateToApp, useShell } from '../state/store';

/** 28 px title bar: product mark, "<App> — <project> — [Connected | Disconnected]", app switcher. */
export function TitleBar() {
  const app = useShell((s) => s.app);
  const projectName = useShell((s) => s.projectName);
  const connection = useShell((s) => s.connection);
  const linkText = connection === 'connected' ? 'Connected' : 'Disconnected';

  return (
    <header className="titlebar" data-testid="titlebar">
      <img className="titlebar-mark" src={logoUrl} alt="" />
      <div className="titlebar-text" data-testid="title-text">
        <strong>{appTitle(app)}</strong>
        <span className="sep">—</span>
        <span>{projectName ?? 'No project'}</span>
        <span className="sep">—</span>
        <span className={`titlebar-link ${connection}`}>[{linkText}]</span>
      </div>
      <nav className="app-switcher" aria-label="Switch application">
        {APPS.map((a, i) => (
          <button
            key={a.id}
            type="button"
            className={a.id === app ? 'active' : ''}
            aria-current={a.id === app ? 'page' : undefined}
            title={`${appTitle(a.id)} (Alt+${i + 1})`}
            onClick={() => navigateToApp(a.id)}
          >
            {a.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
