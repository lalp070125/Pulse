import { Play, Square, StepForward, Upload } from 'lucide-react';
import { useShell } from '../state/store';
import { useProject } from '../state/project';
import { useLive } from '../state/live';
import { deploy, start, step, stop } from '../state/runtime';

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

/** 24 px strip: Runtime / Simulation / Twin lamps, then Deploy, Start, Stop, Step (SPEC 4.3). */
export function RuntimeStrip() {
  const connection = useShell((s) => s.connection);
  const hasProject = useProject((s) => s.project !== null);
  const deployed = useLive((s) => s.deployed);
  const running = useLive((s) => s.running);
  const replay = useLive((s) => s.replay);
  const machines = useLive((s) => s.machines);
  const reachable = connection === 'connected';
  const faulted = machines.some((m) => m.faulted);
  const held = machines.some((m) => m.held);

  const runtimeLamp: LampState = !reachable
    ? connection === 'connecting'
      ? 'warn'
      : 'err'
    : faulted
      ? 'err'
      : running
        ? held
          ? 'warn'
          : 'ok'
        : 'off';
  const runtimeTip = !reachable
    ? connection === 'connecting'
      ? 'Runtime: connecting…'
      : 'Runtime: not reachable'
    : faulted
      ? 'Runtime: a machine is faulted'
      : running
        ? held
          ? 'Runtime: running, a machine is held'
          : 'Runtime: running'
        : deployed
          ? 'Runtime: deployed, stopped'
          : 'Runtime: nothing deployed yet';

  return (
    <div className="strip" data-testid="runtime-strip">
      <div className="strip-lamps">
        <Lamp label="Runtime" state={runtimeLamp} tip={runtimeTip} />
        <Lamp
          label="Simulation"
          state={reachable && deployed ? 'ok' : 'off'}
          tip={
            reachable && deployed
              ? 'Simulation link: connected (simulated devices answer the logic)'
              : 'Simulation link: not in use (deploy first)'
          }
        />
        <Lamp label="Twin" state="off" tip="Twin link: not in use yet (Phase 8)" />
      </div>
      <div className="strip-buttons">
        <button
          type="button"
          data-testid="rt-deploy"
          disabled={!reachable || !hasProject}
          title="Deploy: save and load the project into the runtime (stopped, at tick 0)"
          onClick={() => void deploy()}
        >
          <Upload {...ICON} /> Deploy
        </button>
        <button
          type="button"
          data-testid="rt-start"
          disabled={!reachable || !deployed || running || replay !== null}
          title="Start: run on the clock"
          onClick={() => start()}
        >
          <Play {...ICON} /> Start
        </button>
        <button
          type="button"
          data-testid="rt-stop"
          disabled={!reachable || !running}
          title="Stop: freeze where it is"
          onClick={() => stop()}
        >
          <Square {...ICON} /> Stop
        </button>
        <button
          type="button"
          data-testid="rt-step"
          disabled={!reachable || !deployed || running || replay !== null}
          title="Step: run exactly one tick (Shift: ten ticks)"
          onClick={(e) => step(e.shiftKey ? 10 : 1)}
        >
          <StepForward {...ICON} /> Step
        </button>
      </div>
    </div>
  );
}
