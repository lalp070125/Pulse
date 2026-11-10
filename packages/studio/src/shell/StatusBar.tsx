import { useDirty } from '../state/project';
import { useLive } from '../state/live';
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
  const dirty = useDirty();
  const deployed = useLive((s) => s.deployed);
  const tick = useLive((s) => s.tick);
  const timing = useLive((s) => s.timing);

  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className={`status-conn ${connection}`} data-testid="status-connection">
        <span className="status-dot" />
        {TEXT[connection]}
        {connection === 'connected' && address ? ` — runtime ${address}` : ''}
      </span>
      <span className="status-right">
        {app === 'panel' && <span>Runtime target: Web</span>}
        <span title="Unsaved changes" data-testid="status-saved" className={dirty ? 'unsaved' : ''}>
          {dirty ? 'Unsaved changes' : 'No unsaved changes'}
        </span>
        <span title="Cycle time of each deployed machine" data-testid="status-cycle">
          Cycle: {timing.length ? timing.map((t) => `${t.cycleMs} ms`).join(' / ') : '—'}
        </span>
        <span title="Base ticks executed by the runtime" data-testid="status-tick">
          Tick: {deployed ? tick : '—'}
        </span>
      </span>
    </footer>
  );
}
