import { useShell } from '../state/store';

const HEAD = { studio: 'INSPECTOR', panel: 'PROPERTIES', twin: 'PROPERTIES' } as const;
const EMPTY = {
  studio: 'Nothing selected',
  panel: 'No widget selected',
  twin: 'Nothing selected',
} as const;

/** Optional right inspector (280 px). Empty in Phase 0. */
export function Inspector() {
  const app = useShell((s) => s.app);
  return (
    <aside className="inspector" data-testid="inspector">
      <div className="panel-head">{HEAD[app]}</div>
      <div className="panel-empty">{EMPTY[app]}</div>
    </aside>
  );
}
