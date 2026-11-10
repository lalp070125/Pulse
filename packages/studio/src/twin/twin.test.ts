import { describe, expect, it } from 'vitest';
import { createMemoryTwinIO } from './io';
import { actuatorFeedback, SPAWNER_START, stepActuator, stepSpawner } from './motion';
import { SEALER_BINDINGS, SEALER_STATION } from './sealer';
import {
  checkBindings,
  initialState,
  pathsByPort,
  portsOf,
  stepStation,
  type StationState,
} from './station';

const STEP = 1000 / 60; // one physics step

describe('Sealer binding table', () => {
  it('binds every port of the station exactly once, with no problems', () => {
    expect(checkBindings(SEALER_STATION, SEALER_BINDINGS)).toEqual([]);
  });

  it('holds exactly the ten paths of the plan, with the right directions', () => {
    const dir = new Map(portsOf(SEALER_STATION).map((p) => [p.port, p.direction]));
    const rows = SEALER_BINDINGS.map((b) => [dir.get(b.port), b.path]);
    expect(rows).toEqual([
      ['command', 'Sealer.Conveyor.IMotor.Run'],
      ['command', 'Sealer.Pusher.ICylinder.Extend'],
      ['command', 'Sealer.SealHead.ICylinder.Extend'],
      ['command', 'Sealer.Lamp.IIndicator.On'],
      ['sensor', 'Sealer.Conveyor.IMotor.Running'],
      ['sensor', 'Sealer.BoxAtStop.ISensor.Present'],
      ['sensor', 'Sealer.Pusher.ICylinder.Extended'],
      ['sensor', 'Sealer.Pusher.ICylinder.Retracted'],
      ['sensor', 'Sealer.SealHead.ICylinder.Extended'],
      ['sensor', 'Sealer.SealHead.ICylinder.Retracted'],
    ]);
  });

  it('names a missing port, an unknown port, a double binding and two sensors on one path', () => {
    const table = [
      ...SEALER_BINDINGS.filter((b) => b.port !== 'lamp.on').map((b) =>
        b.port === 'sealHead.retracted' ? { ...b, path: 'Sealer.Pusher.ICylinder.Retracted' } : b,
      ),
      { port: 'pusher.extended', path: 'X.Y' },
      { port: 'nozzle.open', path: 'Sealer.Nozzle.IValve.Open' },
    ];
    const problems = checkBindings(SEALER_STATION, table);
    expect(problems).toContain('"lamp.on" is not bound to anything.');
    expect(problems).toContain('"nozzle.open" is not a port of this station.');
    expect(problems).toContain('"pusher.extended" is bound twice.');
    expect(problems).toContain(
      '"pusher.retracted" and "sealHead.retracted" both write "Sealer.Pusher.ICylinder.Retracted".',
    );
  });

  it('a different table drives the same scene code with other paths', () => {
    const io = createMemoryTwinIO();
    const table = SEALER_BINDINGS.map((b) => ({ ...b, path: b.path.replace('Sealer', 'Closer') }));
    io.command('Closer.Conveyor.IMotor.Run', true);
    stepStation(SEALER_STATION, pathsByPort(table), io, initialState(SEALER_STATION), STEP, {});
    expect(io.get('Closer.Conveyor.IMotor.Running')).toBe(true);
    expect(io.get('Sealer.Conveyor.IMotor.Running')).toBeUndefined();
  });
});

describe('actuator timing', () => {
  it('reaches the far end in exactly its travel time, not one step earlier', () => {
    let s = { position: 0 };
    let ms = 0;
    while (!actuatorFeedback(s).extended) {
      s = stepActuator(s, true, 10, 400);
      ms += 10;
    }
    expect(ms).toBe(400);
  });

  it('leaves the retracted switch on the first step and comes back in the same time', () => {
    let s = stepActuator({ position: 0 }, true, 10, 400);
    expect(actuatorFeedback(s)).toEqual({ extended: false, retracted: false });
    for (let i = 0; i < 39; i++) s = stepActuator(s, true, 10, 400);
    expect(actuatorFeedback(s)).toEqual({ extended: true, retracted: false });
    for (let i = 0; i < 39; i++) s = stepActuator(s, false, 10, 400);
    expect(actuatorFeedback(s).retracted).toBe(false);
    s = stepActuator(s, false, 10, 400);
    expect(actuatorFeedback(s)).toEqual({ extended: false, retracted: true });
  });

  it('turns back mid-stroke from where it is', () => {
    let s = { position: 0 };
    for (let i = 0; i < 10; i++) s = stepActuator(s, true, 10, 400); // 100 ms out
    for (let i = 0; i < 10; i++) s = stepActuator(s, false, 10, 400); // 100 ms back
    expect(actuatorFeedback(s).retracted).toBe(true);
  });

  it('lands exactly on the end with 1/60 s physics steps', () => {
    let s = { position: 0 };
    for (let i = 0; i < 48; i++) s = stepActuator(s, true, STEP, 800); // 48 × 16.67 ms = 800 ms
    expect(s.position).toBe(1);
  });
});

describe('Sealer station through the in-memory TwinIO', () => {
  it('extends the pusher in 800 ms and reports both end switches on the bound paths', () => {
    const io = createMemoryTwinIO();
    const paths = pathsByPort(SEALER_BINDINGS);
    let state: StationState = initialState(SEALER_STATION);
    state = stepStation(SEALER_STATION, paths, io, state, STEP, {});
    expect(io.get('Sealer.Pusher.ICylinder.Retracted')).toBe(true);
    expect(io.get('Sealer.Pusher.ICylinder.Extended')).toBe(false);

    io.command('Sealer.Pusher.ICylinder.Extend', true);
    for (let i = 0; i < 47; i++) state = stepStation(SEALER_STATION, paths, io, state, STEP, {});
    expect(io.get('Sealer.Pusher.ICylinder.Retracted')).toBe(false);
    expect(io.get('Sealer.Pusher.ICylinder.Extended')).toBe(false);
    state = stepStation(SEALER_STATION, paths, io, state, STEP, {});
    expect(io.get('Sealer.Pusher.ICylinder.Extended')).toBe(true);
    expect(io.get('Sealer.SealHead.ICylinder.Retracted')).toBe(true);
  });

  it('writes what the beam sees and the conveyor running feedback', () => {
    const io = createMemoryTwinIO();
    const paths = pathsByPort(SEALER_BINDINGS);
    const s0 = initialState(SEALER_STATION);
    stepStation(SEALER_STATION, paths, io, s0, STEP, { boxAtStop: true });
    expect(io.get('Sealer.BoxAtStop.ISensor.Present')).toBe(true);
    expect(io.get('Sealer.Conveyor.IMotor.Running')).toBe(false);
    io.command('Sealer.Conveyor.IMotor.Run', true);
    stepStation(SEALER_STATION, paths, io, s0, STEP, { boxAtStop: false });
    expect(io.get('Sealer.BoxAtStop.ISensor.Present')).toBe(false);
    expect(io.get('Sealer.Conveyor.IMotor.Running')).toBe(true);
  });

  it('notifies listeners only when a value really changes', () => {
    const io = createMemoryTwinIO();
    let calls = 0;
    io.subscribe(() => calls++);
    io.write('A.B', true);
    io.write('A.B', true);
    io.write('A.B', false);
    expect(calls).toBe(2);
    expect(io.read('Never.Set')).toBe(false);
  });
});

describe('box spawner', () => {
  it('drops a box at once when switched on, then one every period', () => {
    let s = SPAWNER_START;
    const times: number[] = [];
    for (let t = 0; t < 10_000; t += 100) {
      const r = stepSpawner(s, true, 100, 3000);
      s = r.state;
      for (let i = 0; i < r.due; i++) times.push(t + 100); // when the step ends
    }
    expect(times).toEqual([100, 3000, 6000, 9000]); // first box on the first step
  });

  it('drops nothing while off, and starts over when switched on again', () => {
    let s = stepSpawner(SPAWNER_START, true, 100, 3000).state;
    s = stepSpawner(s, true, 1000, 3000).state;
    const off = stepSpawner(s, false, 5000, 3000);
    expect(off.due).toBe(0);
    expect(stepSpawner(off.state, true, 16, 3000).due).toBe(1);
  });
});
