import { describe, expect, it } from 'vitest';
import { SimDriver } from './driver';

/* The simulated driver and its built-in device models (SPEC 5.9). */

function run(sim: SimDriver, fromMs: number, toMs: number, stepMs = 10) {
  for (let t = fromMs; t <= toMs; t += stepMs) sim.advance(t * 1000);
}

describe('SimDriver', () => {
  it('holds values in memory; unknown paths are left out', () => {
    const sim = new SimDriver();
    sim.inject('A', 5);
    expect(sim.readInputs(['A', 'B'])).toEqual({ A: 5 });
    sim.writeOutputs({ C: true });
    expect(sim.peek('C')).toBe(true);
  });

  it('cylinder: Extended becomes true after the travel time, Retracted after travelling back', () => {
    const sim = new SimDriver([
      { kind: 'cylinder', command: 'Ext', extended: 'Out', retracted: 'In', travelMs: 400 },
    ]);
    sim.advance(0);
    expect(sim.readInputs(['Out', 'In'])).toEqual({ Out: false, In: true });
    sim.writeOutputs({ Ext: true });
    run(sim, 10, 390);
    expect(sim.readInputs(['Out', 'In'])).toEqual({ Out: false, In: false }); // travelling
    run(sim, 400, 400);
    expect(sim.readInputs(['Out', 'In'])).toEqual({ Out: true, In: false }); // 400 ms
    sim.writeOutputs({ Ext: false });
    run(sim, 410, 790);
    expect(sim.peek('In')).toBe(false);
    run(sim, 800, 800);
    expect(sim.readInputs(['Out', 'In'])).toEqual({ Out: false, In: true });
  });

  it('follow: the feedback copies the command after the delay', () => {
    const sim = new SimDriver([
      { kind: 'follow', command: 'Run', feedback: 'Running', delayMs: 100 },
    ]);
    sim.advance(0);
    sim.writeOutputs({ Run: true });
    run(sim, 10, 100);
    expect(sim.peek('Running')).toBeUndefined(); // seen at 10 ms, due at 110 ms
    run(sim, 110, 110);
    expect(sim.peek('Running')).toBe(true);
  });

  it('a frozen signal ignores the model (stuck-sensor fault)', () => {
    const sim = new SimDriver([
      { kind: 'cylinder', command: 'Ext', extended: 'Out', retracted: 'In', travelMs: 100 },
    ]);
    sim.advance(0);
    sim.freeze('Out', false);
    sim.writeOutputs({ Ext: true });
    run(sim, 10, 500);
    expect(sim.peek('Out')).toBe(false);
    sim.unfreeze('Out');
    run(sim, 510, 510);
    expect(sim.peek('Out')).toBe(true);
  });
});
