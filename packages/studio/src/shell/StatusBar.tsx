import { useShell } from '../state/store';

const TEXT = {
  connected: 'Connected',
  connecting: 'Connecting…',
  disconnected: 'Disconnected',
} as const;

/** 22 px status bar: connection on the left; unsaved, cycle time and tick counter on the right. */
export function StatusBar() {
  const connection = useShell((s) => s.connection);
  const address = useShell((s) => s.runtimeAddress);
  const app = useShell((s) => s.app);

  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className={`status-conn ${connection}`} data-testid="status-connection">
        <span className="status-dot" />
        {TEXT[connection]}
        {connection === 'connected' && address ? ` — runtime ${address}` : ''}
      </span>
      <span className="status-right">
        {app === 'panel' && <span>Runtime target: Web</span>}
        <span title="Unsaved changes">No unsaved changes</span>
        <span title="Cycle time of the selected machine">Cycle: —</span>
        <span title="Ticks executed by the runtime">Tick: —</span>
      </span>
    </footer>
  );
}
