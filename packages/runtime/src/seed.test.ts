import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine, compileProject, projectToFiles, type Project, type SimDriver } from '@pulso/core';
import { loadProject, readProjectFiles } from './store';

/* The seed project, loaded from /projects/box-sealer-demo on disk, runs as specified (SPEC 12). */

const dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../projects/box-sealer-demo',
);
let project: Project;

beforeAll(async () => {
  const loaded = await loadProject(dir);
  expect(loaded.problems).toEqual([]);
  project = loaded.project!;
});

const BOX = 'Sealer.BoxAtStop.ISensor.Present';
const EXTEND = 'Sealer.Pusher.ICylinder.Extend';
const EXTENDED = 'Sealer.Pusher.ICylinder.Extended';

function engine() {
  const e = new Engine(project);
  e.step(1); // Init → Idle
  return e;
}
/** Steps until the Sealer is in `state`; returns the number of ticks it took. */
function until(e: Engine, state: string, max = 1000): number {
  for (let n = 1; n <= max; n++) {
    e.step(1);
    if (e.machine('Sealer').state === state) return n;
  }
  throw new Error(
    `Sealer did not reach ${state} within ${max} ticks (is in ${e.machine('Sealer').state})`,
  );
}
function press(e: Engine, button: 'Start' | 'Stop' | 'FaultReset') {
  e.inject(`Global.${button}`, false);
  e.step(1);
  e.inject(`Global.${button}`, true);
  e.step(1);
}
const transitions = (e: Engine) =>
  e
    .trace()
    .filter((x) => x.type === 'TRANS')
    .map((x) => x.text);

describe('box-sealer-demo on disk', () => {
  it('loads with no problems, compiles with no errors or warnings', () => {
    expect(compileProject(project).problems).toEqual([]);
    expect(project.machines.map((m) => m.machine.name)).toEqual(['Sealer']);
  });

  it('is stored in canonical form (re-saving would not change a byte)', async () => {
    expect(projectToFiles(project)).toEqual(await readProjectFiles(dir));
  });

  it('declares PusherStuck as an alarm condition wired as the abort to Faulted', () => {
    const stuck = project.conditions.find((c) => c.name === 'PusherStuck')!;
    expect(stuck.alarm).toEqual({
      group: 'Sealer',
      severity: 'alarm',
      message: 'Pusher did not extend within 2 s',
    });
    const sealer = project.machines[0]!.machine;
    const abort = sealer.aborts[0]!;
    expect(sealer.conditions.find((c) => c.id === abort.condition)!.template).toBe(stuck.id);
    expect(sealer.states.find((s) => s.id === abort.to)!.name).toBe('Faulted');
  });
});

describe('Sealer runs', () => {
  it('happy path: Idle → Feed → Push → Seal → Release → Feed', () => {
    const e = engine();
    expect(e.machine('Sealer').state).toBe('Idle');
    press(e, 'Start');
    expect(e.machine('Sealer').state).toBe('Feed');
    expect(e.get('Global.Running')).toBe(true);
    e.step(12);
    expect(e.get('Sealer.Conveyor.IMotor.Run')).toBe(true);
    expect(e.get('Sealer.Conveyor.IMotor.Running')).toBe(true); // simulated motor followed after 100 ms

    e.inject(BOX, true);
    e.step(1);
    expect(e.machine('Sealer').state).toBe('Push');
    expect(e.get('Sealer.Conveyor.IMotor.Run')).toBe(false);
    expect(e.get(EXTEND)).toBe(true);

    const pushTicks = until(e, 'Seal'); // simulated cylinder needs 400 ms
    expect(pushTicks).toBeGreaterThanOrEqual(40);
    expect(pushTicks).toBeLessThanOrEqual(42);
    expect(e.get('Sealer.SealHead.ICylinder.Extend')).toBe(true);

    expect(until(e, 'Release')).toBe(150); // SealTime 1500 ms at 10 ms per tick, exactly
    expect(e.get('Sealer.SealHead.ICylinder.Extend')).toBe(false); // Seal's On Exit
    expect(e.get(EXTEND)).toBe(false);

    e.inject(BOX, false); // the box has been pushed on
    until(e, 'Feed');
    expect(transitions(e)).toEqual([
      'Init → Idle',
      'Idle → Feed (StartPressed)',
      'Feed → Push (BoxArrived)',
      'Push → Seal (PusherOut)',
      'Seal → Release (SealDone)',
      'Release → Feed (PusherHome)',
    ]);
  });

  it('stop and resume mid-cycle: Stop holds Seal with its timer frozen, Start continues it', () => {
    const e = engine();
    press(e, 'Start');
    e.inject(BOX, true);
    until(e, 'Seal');
    e.step(49);
    expect(e.machine('Sealer').timers.SealTime!.elapsedMs).toBe(490);

    press(e, 'Stop'); // two ticks: the second one holds
    expect(e.machine('Sealer')).toMatchObject({ state: 'Seal', held: true });
    const frozen = e.machine('Sealer').timers.SealTime!.elapsedMs;
    e.step(300); // 3 s of hold
    expect(e.machine('Sealer')).toMatchObject({ state: 'Seal', held: true });
    expect(e.machine('Sealer').timers.SealTime!.elapsedMs).toBe(frozen);
    expect(e.get('Sealer.Conveyor.IMotor.Run')).toBe(false); // hold action

    press(e, 'Start');
    expect(e.machine('Sealer')).toMatchObject({ state: 'Seal', held: false });
    const rest = until(e, 'Release');
    expect(rest).toBe((1500 - frozen) / 10); // only the remaining seal time
  });

  it('pusher stuck → the PusherStuck alarm aborts to Faulted after 2 s; Fault Reset returns to Idle', () => {
    const e = engine();
    e.driver<SimDriver>('sim').freeze(EXTENDED, false); // the cylinder never reports Extended
    press(e, 'Start');
    e.inject(BOX, true);
    e.step(1);
    expect(e.machine('Sealer').state).toBe('Push');
    expect(until(e, 'Faulted')).toBe(200); // PusherWatch 2000 ms, exactly
    const cond = e
      .trace()
      .filter((x) => x.type === 'COND' && x.data?.name === 'PusherStuck')
      .at(-1)!;
    expect(cond.text).toBe(
      "PusherStuck = true  [Pusher.ICylinder.Extend = true, Pusher.ICylinder.Extended = false, timer.done('PusherWatch') = true]",
    );
    expect(transitions(e).at(-1)).toBe('Push → Faulted (abort: PusherStuck)');
    expect(e.get(EXTEND)).toBe(false);
    expect(e.get('Global.Running')).toBe(false);
    expect(e.get('Sealer.Lamp.IIndicator.On')).toBe(true);

    e.step(100);
    expect(e.machine('Sealer').state).toBe('Faulted'); // stays until reset
    e.driver<SimDriver>('sim').unfreeze(EXTENDED);
    press(e, 'FaultReset');
    expect(e.machine('Sealer').state).toBe('Idle');
  });

  it('determinism: the same scenario twice gives an identical trace', () => {
    const run = () => {
      const e = engine();
      press(e, 'Start');
      e.inject(BOX, true);
      until(e, 'Release');
      e.inject(BOX, false);
      until(e, 'Feed');
      press(e, 'Stop');
      e.step(50);
      return JSON.stringify(e.trace());
    };
    const a = run();
    expect(a.length).toBeGreaterThan(10_000);
    expect(run()).toBe(a);
  });
});
