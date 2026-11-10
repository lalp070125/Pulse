import { useLive } from '../state/live';
import { EditorPage } from '../editors/common';
import './monitor.css';

/* Inspectors (SPEC 7.5): live tables for timers, queues and the timing figures of each machine. */

const ms = (n: number | null) => (n === null ? '–' : `${n.toFixed(n < 10 ? 2 : 1)} ms`);

export function InspectorsView() {
  const machines = useLive((s) => s.machines);
  const timing = useLive((s) => s.timing);
  const deployed = useLive((s) => s.deployed);

  const timers = machines.flatMap((m) =>
    Object.values(m.timers).map((t) => ({ machine: m.name, ...t })),
  );

  return (
    <EditorPage
      testId="editor-inspectors"
      title="Inspectors"
      hint="Live timers, queues and timing figures of the deployed project"
    >
      {!deployed ? (
        <div className="editor-empty" data-testid="insp-empty">
          Nothing is deployed. Press Deploy in the strip above, then Start.
        </div>
      ) : (
        <>
          <h3 className="insp-title">Timers</h3>
          <table className="grid" data-testid="insp-timers">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Timer</th>
                <th>Preset</th>
                <th>Elapsed</th>
                <th>Running</th>
                <th>Done</th>
              </tr>
            </thead>
            <tbody>
              {timers.length === 0 && (
                <tr>
                  <td colSpan={6} className="insp-none">
                    No machine uses a timer.
                  </td>
                </tr>
              )}
              {timers.map((t) => (
                <tr
                  key={`${t.machine}.${t.name}`}
                  data-testid={`insp-timer-${t.machine}.${t.name}`}
                >
                  <td className="mono">{t.machine}</td>
                  <td className="mono">{t.name}</td>
                  <td className="mono">{t.presetMs} ms</td>
                  <td className="mono" data-testid="insp-elapsed">
                    {Math.round(t.elapsedMs)} ms
                  </td>
                  <td data-state={t.running ? 'ok' : 'off'}>{t.running ? 'yes' : 'no'}</td>
                  <td data-state={t.done ? 'ok' : 'off'}>{t.done ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="insp-title">Queues</h3>
          <div className="insp-none" data-testid="insp-queues">
            Queues arrive in Phase 6. Their depth and contents will be listed here.
          </div>

          <h3 className="insp-title">Timing per machine</h3>
          <table className="grid" data-testid="insp-timing">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Cycle</th>
                <th>Ticks</th>
                <th>Scan min / avg / max</th>
                <th>Jitter avg / max</th>
                <th>Overruns</th>
              </tr>
            </thead>
            <tbody>
              {timing.map((t) => (
                <tr key={t.machine} data-testid={`insp-timing-${t.machine}`}>
                  <td className="mono">{t.machine}</td>
                  <td className="mono">{t.cycleMs} ms</td>
                  <td className="mono">{t.ticks}</td>
                  <td className="mono">
                    {ms(t.scanMinMs)} / {ms(t.scanAvgMs)} / {ms(t.scanMaxMs)}
                  </td>
                  <td className="mono">
                    {ms(t.jitterAvgMs)} / {ms(t.jitterMaxMs)}
                  </td>
                  <td className="mono" data-state={t.overruns > 0 ? 'warn' : 'ok'}>
                    {t.overruns}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </EditorPage>
  );
}
