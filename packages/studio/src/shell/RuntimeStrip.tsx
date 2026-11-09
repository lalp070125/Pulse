import { Play, Square, StepForward, Upload } from 'lucide-react';
import { useShell } from '../state/store';

type LampState = 'ok' | 'warn' | 'err' | 'off';

function Lamp({ label, state, tip }: { label: string; state: LampState; tip: string }) {
  return (
    <span className="lamp" title={tip} data-state={state}>
      <span className="lamp-dot" />
      <span className="lamp-label">{label}</span>
    </span>
  );
}

const ICON = { size: 14, strokeWidth: 1.5 } as const;

/** 24 px strip: Runtime / Simulation / Twin lamps, then Deploy, Start, Stop, Step. */
export function RuntimeStrip() {
  const connection = useShell((s) => s.connection);
  const reachable = connection === 'connected';
  const soon = 'Arrives in Phase 4 (runtime and monitor)';

  return (
    <div className="strip" data-testid="runtime-strip">
      <div className="strip-lamps">
        <Lamp
          label="Runtime"
          state={reachable ? 'off' : connection === 'connecting' ? 'warn' : 'err'}
          tip={
            reachable
              ? 'Runtime: stopped (no machine is running yet)'
              : connection === 'connecting'
                ? 'Runtime: connecting…'
                : 'Runtime: not reachable'
          }
        />
        <Lamp label="Simulation" state="off" tip="Simulation link: not in use yet (Phase 4)" />
        <Lamp label="Twin" state="off" tip="Twin link: not in use yet (Phase 8)" />
      </div>
      <div className="strip-buttons">
        <button type="button" disabled title={`Deploy — ${soon}`}>
          <Upload {...ICON} /> Deploy
        </button>
        <button type="button" disabled title={`Start — ${soon}`}>
          <Play {...ICON} /> Start
        </button>
        <button type="button" disabled title={`Stop — ${soon}`}>
          <Square {...ICON} /> Stop
        </button>
        <button type="button" disabled title={`Step one tick — ${soon}`}>
          <StepForward {...ICON} /> Step
        </button>
      </div>
    </div>
  );
}
