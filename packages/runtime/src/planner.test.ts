import { describe, expect, it } from 'vitest';
import {
  Engine,
  addJunction,
  addNode,
  compileProject,
  connect,
  construct,
  copyNodes,
  deleteNodes,
  entryOf,
  nodesOf,
  pasteNodes,
  projectFromFiles,
  projectToFiles,
  read,
  renumber,
  setAbortTarget,
  setBlockCondition,
  setHoldActions,
  setInit,
  setWireCondition,
  addAbort,
  addInterrupt,
  validateProject,
  type Project,
} from '@pulso/core';
import { buildBoxSealer } from './seed/boxSealer';

/* The Planner's model (SPEC 6.3), driven without a browser. */

function ids(prefix = '01PXAN') {
  let n = 0;
  return () => `${prefix}${String(++n).padStart(26 - prefix.length, '0')}`;
}

/** The seed library with an empty machine `name` (no states, no wiring). */
function libraryWithEmptyMachine(name = 'Line'): Project {
  const p = buildBoxSealer();
  p.machines = [];
  p.machines.push({
    machine: {
      id: '01MACHN0000000000000000000',
      name,
      cycleMs: 10,
      instances: [],
      timers: [],
      states: [],
      conditions: [],
      initial: null,
      transitions: [],
      aborts: [],
      interrupts: [],
    },
    plan: { machine: '01MACHN0000000000000000000', nodes: [] },
  });
  return p;
}
const MID = '01MACHN0000000000000000000';

describe('placeholders', () => {
  it('a name with no state template becomes a placeholder in plan.json, a known one is real at once', () => {
    const p = libraryWithEmptyMachine();
    const newId = ids();
    const a = addNode(p, MID, 'Warmup', { x: 0, y: 0 }, newId);
    const b = addNode(p, MID, 'Idle', { x: 0, y: 160 }, newId);
    const e = entryOf(p, MID);
    expect(e.plan.placeholders!.states).toEqual([{ id: a, name: 'Warmup' }]);
    expect(e.machine.states.map((s) => s.name)).toEqual(['Idle']);
    expect(e.machine.states[0]!.id).toBe(b);
    expect(() => addNode(p, MID, 'Idle', { x: 0, y: 0 }, newId)).toThrow(/already has/);
  });

  it('a wire stays a placeholder until both ends and its condition are real', () => {
    const p = libraryWithEmptyMachine();
    const newId = ids();
    const idle = addNode(p, MID, 'Idle', { x: 0, y: 0 }, newId);
    const feed = addNode(p, MID, 'Feed', { x: 0, y: 160 }, newId);
    const e = entryOf(p, MID);
    const w = connect(e, idle, feed, newId)!;
    expect(e.machine.transitions).toEqual([]);
    expect(e.plan.placeholders!.transitions[0]).toMatchObject({ id: w, condition: null });

    setWireCondition(p, MID, w, { name: 'Ignition' }, newId); // not in the library
    expect(e.plan.placeholders!.transitions[0]!.condition).toEqual({
      kind: 'placeholder',
      name: 'Ignition',
    });

    setWireCondition(p, MID, w, { name: 'StartPressed' }, newId); // in the library: real at once
    expect(e.plan.placeholders).toBeUndefined();
    expect(e.machine.transitions).toEqual([
      { id: w, from: idle, to: feed, condition: e.machine.conditions[0]!.id, priority: 1 },
    ]);
  });

  it('the engine and the validator never read placeholders', () => {
    const p = libraryWithEmptyMachine();
    const newId = ids();
    // A state template that needs no devices, so the machine can run without bindings.
    p.states.push({ id: newId(), name: 'Ready', roles: [], onEntry: [], steps: [], onExit: [] });
    const idle = addNode(p, MID, 'Ready', { x: 0, y: 0 }, newId);
    const x = addNode(p, MID, 'Mystery', { x: 0, y: 160 }, newId);
    const e = entryOf(p, MID);
    setInit(e, idle);
    const w = connect(e, idle, x, newId)!;
    setWireCondition(p, MID, w, { name: 'Unknown' }, newId);
    expect(e.plan.placeholders).toBeDefined();

    const withoutPlan = structuredClone(p);
    withoutPlan.machines[0]!.plan = { machine: MID, nodes: [] };
    expect(validateProject(p)).toEqual(validateProject(withoutPlan));
    expect(compileProject(p).problems).toEqual(compileProject(withoutPlan).problems);
    const engine = new Engine(p);
    engine.step(3);
    expect(engine.machine('Line').state).toBe('Ready');
  });

  it('placeholders survive a save and load (files round trip)', () => {
    const p = libraryWithEmptyMachine();
    const newId = ids();
    const a = addNode(p, MID, 'Alpha', { x: 10, y: 20 }, newId);
    const b = addNode(p, MID, 'Beta', { x: 10, y: 200 }, newId);
    const e = entryOf(p, MID);
    setInit(e, a);
    const w = connect(e, a, b, newId)!;
    setWireCondition(p, MID, w, { name: 'Go' }, newId);
    const abort = addAbort(e, newId);
    setBlockCondition(p, MID, abort, 'abort', { name: 'Trouble' }, newId);
    setAbortTarget(e, abort, b);
    const loaded = projectFromFiles(projectToFiles(p));
    expect(loaded.problems).toEqual([]);
    expect(loaded.project!.machines[0]!.plan).toEqual(e.plan);
  });
});

describe('priorities', () => {
  it('are given in drawing order and can be renumbered; the others close up', () => {
    const p = libraryWithEmptyMachine();
    const newId = ids();
    const s = ['Idle', 'Feed', 'Push', 'Seal'].map((n, i) =>
      addNode(p, MID, n, { x: 0, y: i * 160 }, newId),
    );
    const e = entryOf(p, MID);
    const w1 = connect(e, s[0]!, s[1]!, newId)!;
    const w2 = connect(e, s[0]!, s[2]!, newId)!;
    const w3 = connect(e, s[0]!, s[3]!, newId)!;
    const prio = () =>
      Object.fromEntries(read(e).wires.map((w) => [w.id, w.priority])) as Record<string, number>;
    expect(prio()).toEqual({ [w1]: 1, [w2]: 2, [w3]: 3 });
    renumber(e, w3, 1);
    expect(prio()).toEqual({ [w3]: 1, [w1]: 2, [w2]: 3 });
    expect(connect(e, s[0]!, s[0]!, newId)).toBeNull(); // no wire from a state to itself
  });
});

describe('deleting', () => {
  it('a state removes the wires to and from it, Init and abort targets that pointed at it', () => {
    const p = libraryWithEmptyMachine();
    const newId = ids();
    const idle = addNode(p, MID, 'Idle', { x: 0, y: 0 }, newId);
    const feed = addNode(p, MID, 'Feed', { x: 0, y: 160 }, newId);
    const e = entryOf(p, MID);
    setInit(e, feed);
    const w = connect(e, idle, feed, newId)!;
    setWireCondition(p, MID, w, { name: 'StartPressed' }, newId);
    const a = addAbort(e, newId);
    setAbortTarget(e, a, feed);
    deleteNodes(e, [feed]);
    expect(nodesOf(e).map((n) => n.name)).toEqual(['Idle']);
    expect(read(e)).toMatchObject({
      initial: null,
      wires: [],
      aborts: [{ id: a, condition: null, to: null }],
    });
    expect(e.plan.nodes.map((n) => n.id)).toEqual([idle]);
    expect(p.states.some((s) => s.name === 'Feed')).toBe(true); // the template stays in the library
  });
});

describe('Construct Machine', () => {
  it('creates what is new, reuses what exists by name, and makes the wiring real', () => {
    const p = libraryWithEmptyMachine();
    const newId = ids();
    const idle = addNode(p, MID, 'Idle', { x: 0, y: 0 }, newId); // exists: real
    const warm = addNode(p, MID, 'Warmup', { x: 0, y: 160 }, newId); // new: placeholder
    const e = entryOf(p, MID);
    setInit(e, idle);
    const w1 = connect(e, idle, warm, newId)!;
    setWireCondition(p, MID, w1, { name: 'Heat' }, newId);
    const w2 = connect(e, warm, idle, newId)!;
    setWireCondition(p, MID, w2, { name: 'StopPressed' }, newId);
    const it0 = addInterrupt(e, newId);
    setBlockCondition(p, MID, it0, 'trigger', { name: 'Pause' }, newId);
    setBlockCondition(p, MID, it0, 'resume', { name: 'StartPressed' }, newId);
    const before = { states: p.states.length, conditions: p.conditions.length };

    const report = construct(p, MID, newId);
    expect(report).toEqual({
      statesCreated: ['Warmup'],
      statesReused: [],
      conditionsCreated: ['Heat', 'Pause'],
      conditionsReused: [],
      stillOpen: 0,
    });
    expect(p.states.length).toBe(before.states + 1);
    expect(p.conditions.length).toBe(before.conditions + 2);
    const heat = p.conditions.find((c) => c.name === 'Heat')!;
    expect(heat.expr).toEqual({ op: 'todo' });
    // The node keeps its ID, so the drawing does not move.
    expect(e.machine.states.find((s) => s.name === 'Warmup')!.id).toBe(warm);
    expect(e.plan.placeholders).toBeUndefined();
    expect(e.machine.transitions.map((t) => t.id)).toEqual([w1, w2]);
    expect(e.machine.interrupts).toHaveLength(1);
    // StartPressed is used twice in this machine but has one instance.
    const tplIds = e.machine.conditions.map((c) => c.template);
    expect(new Set(tplIds).size).toBe(tplIds.length);

    // A TO DO condition is a warning, never an error, and stays false.
    const problems = compileProject(p).problems.filter((x) => x.where.includes('Heat'));
    expect(problems).toEqual([
      expect.objectContaining({ level: 'warning', message: expect.stringContaining('TO DO') }),
    ]);

    // Running it again adds only what is new.
    const again = addNode(p, MID, 'Cooldown', { x: 300, y: 160 }, newId);
    const w3 = connect(e, warm, again, newId)!;
    setWireCondition(p, MID, w3, { name: 'Heat' }, newId); // exists now: real at once
    const second = construct(p, MID, newId);
    expect(second.statesCreated).toEqual(['Cooldown']);
    expect(second.conditionsCreated).toEqual([]);
    expect(p.states.filter((s) => s.name === 'Warmup')).toHaveLength(1);
  });

  it('leaves wires with no condition open and says how many', () => {
    const p = libraryWithEmptyMachine();
    const newId = ids();
    const a = addNode(p, MID, 'A1', { x: 0, y: 0 }, newId);
    const b = addNode(p, MID, 'B1', { x: 0, y: 160 }, newId);
    connect(entryOf(p, MID), a, b, newId);
    expect(construct(p, MID, newId).stillOpen).toBe(1);
  });
});

describe('the Sealer, wired with the Planner model', () => {
  it('gives exactly the seed machine and runs the happy path', () => {
    const seed = buildBoxSealer();
    const p = structuredClone(seed);
    const e = p.machines[0]!;
    const m = e.machine;
    m.initial = null;
    m.transitions = [];
    m.aborts = [];
    m.interrupts = [];
    const node = (n: string) => m.states.find((s) => s.name === n)!.id;
    const newId = ids();
    setInit(e, node('Idle'));
    const wire = (from: string, to: string, cond: string) => {
      const w = connect(e, node(from), node(to), newId)!;
      setWireCondition(p, m.id, w, { name: cond }, newId);
      return w;
    };
    wire('Idle', 'Feed', 'StartPressed');
    wire('Feed', 'Push', 'BoxArrived');
    wire('Push', 'Seal', 'PusherOut');
    wire('Seal', 'Release', 'SealDone');
    wire('Release', 'Feed', 'PusherHome');
    wire('Faulted', 'Idle', 'ResetPressed');
    const a = addAbort(e, newId);
    setBlockCondition(p, m.id, a, 'abort', { name: 'PusherStuck' }, newId);
    setAbortTarget(e, a, node('Faulted'));
    const i = addInterrupt(e, newId);
    setBlockCondition(p, m.id, i, 'trigger', { name: 'StopPressed' }, newId);
    setBlockCondition(p, m.id, i, 'resume', { name: 'StartPressed' }, newId);
    setHoldActions(e, i, seed.machines[0]!.machine.interrupts[0]!.onHold);

    // Same logic as the seed, apart from the new IDs of the wires and blocks.
    const noId = <T extends { id: string }>(list: T[]) =>
      list.map((t) => Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'id')));
    const strip = (x: typeof m) => ({
      ...x,
      transitions: noId(x.transitions),
      aborts: noId(x.aborts),
      interrupts: noId(x.interrupts),
    });
    expect(strip(m)).toEqual(strip(seed.machines[0]!.machine));
    expect(e.plan.placeholders).toBeUndefined();

    const engine = new Engine(p);
    engine.step(1);
    expect(engine.machine('Sealer').state).toBe('Idle');
    engine.inject('Global.Start', true);
    engine.step(1);
    expect(engine.machine('Sealer').state).toBe('Feed');
  });
});

describe('copy and paste', () => {
  it('copies states and the wires between them; conditions travel by name', () => {
    const p = libraryWithEmptyMachine();
    const newId = ids();
    const idle = addNode(p, MID, 'Idle', { x: 0, y: 0 }, newId);
    const feed = addNode(p, MID, 'Feed', { x: 0, y: 160 }, newId);
    const e = entryOf(p, MID);
    const w = connect(e, idle, feed, newId)!;
    setWireCondition(p, MID, w, { name: 'StartPressed' }, newId);
    const clip = copyNodes(p, e, [idle, feed]);
    const made = pasteNodes(p, MID, clip, { x: 20, y: 20 }, newId);
    expect(nodesOf(e).map((n) => n.name)).toEqual(['Idle', 'Feed', 'Idle2', 'Feed2']);
    expect(e.machine.transitions).toHaveLength(2);
    expect(e.machine.conditions).toHaveLength(1); // the same StartPressed instance is reused
    expect(e.plan.nodes.find((n) => n.id === made[1])).toEqual({ id: made[1], x: 20, y: 180 });
  });
});

describe('junctions (drawing only)', () => {
  it('combiners join wires to one state; an expander fans one state out to at most four', () => {
    const p = libraryWithEmptyMachine();
    const newId = ids();
    const s = ['Idle', 'Feed', 'Push', 'Seal', 'Release', 'Faulted'].map((n, i) =>
      addNode(p, MID, n, { x: i * 200, y: 0 }, newId),
    );
    const e = entryOf(p, MID);
    const toFaulted = [0, 1, 2].map((i) => connect(e, s[i]!, s[5]!, newId)!);
    const fromIdle = [1, 2, 3, 4, 5].map((i) => connect(e, s[0]!, s[i]!, newId)!);
    const logicBefore = structuredClone(e.machine);

    expect(addJunction(e, 'h', toFaulted, { x: 0, y: 0 }, newId)).toBeNull();
    expect(addJunction(e, 'v', [toFaulted[0]!, fromIdle[0]!], { x: 0, y: 0 }, newId)).toMatch(
      /same state/,
    );
    expect(addJunction(e, 'exp', fromIdle, { x: 0, y: 0 }, newId)).toMatch(/at most four/);
    expect(addJunction(e, 'exp', fromIdle.slice(1), { x: 0, y: 0 }, newId)).toBeNull();
    expect(e.plan.junctions).toHaveLength(2);
    expect(e.machine).toEqual(logicBefore); // no effect on the logic
  });
});

describe('focused signals (SPEC 7.2)', () => {
  it("lists what the seed's Push state writes, the timers it uses and what its exits read", async () => {
    const { focusedSignals } = await import('@pulso/core');
    const p = buildBoxSealer();
    const m = p.machines[0]!.machine;
    const push = m.states.find((s) => s.name === 'Push')!;
    const f = focusedSignals(p, m.id, push.id);
    expect(f.paths).toEqual([
      'Sealer.Conveyor.IMotor.Run',
      'Sealer.Pusher.ICylinder.Extend',
      'Sealer.Pusher.ICylinder.Extended', // PusherOut, and the PusherStuck abort
    ]);
    expect(f.timers).toEqual(['PusherWatch']);
    const idle = m.states.find((s) => s.name === 'Idle')!;
    expect(focusedSignals(p, m.id, idle.id).paths).toEqual([
      'Sealer.Conveyor.IMotor.Run',
      'Global.Running',
      'Sealer.Lamp.IIndicator.On',
      'Global.Start',
      'Sealer.Pusher.ICylinder.Extend',
      'Sealer.Pusher.ICylinder.Extended',
    ]);
  });
});
