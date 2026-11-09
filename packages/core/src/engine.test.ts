import { describe, expect, it } from 'vitest';
import { CompileError, Engine } from './engine';
import { SimDriver } from './driver';
import type { TraceEvent } from './trace';
import {
  ProjectBuilder,
  T,
  TRUE,
  and,
  changed,
  eq,
  falling,
  lit,
  not,
  rising,
  timerDone,
  v,
} from './test/kit';

/* Phase 1 acceptance (SPEC 14): the scan cycle behaviours, proven tick by tick. */

const at = (e: Engine, tick: number) => e.trace().filter((x) => x.tick === tick);
const ofType = (events: TraceEvent[], type: TraceEvent['type']) =>
  events.filter((x) => x.type === type);
const texts = (events: TraceEvent[]) => events.map((x) => x.text);

describe('priority order', () => {
  function build(prioToB: number, prioToC: number, cTrue = true) {
    const b = new ProjectBuilder();
    const goC = b.global('GoC', T.bool, cTrue);
    const m = b.machine('M');
    const a = m.state('A');
    const sb = m.state('B');
    const sc = m.state('C');
    m.trans(a, sb, m.cond('ToB', TRUE), prioToB); // drawn first
    m.trans(a, sc, m.cond('ToC', v(goC)), prioToC);
    return new Engine(b.build());
  }

  it('checks transitions in ascending priority and the first true one wins', () => {
    const e = build(2, 1);
    e.step(2);
    expect(e.machine('M').state).toBe('C');
  });

  it('renumbering the priorities changes the winner', () => {
    const e = build(1, 2);
    e.step(2);
    expect(e.machine('M').state).toBe('B');
  });

  it('a false higher-priority transition lets the next one fire', () => {
    const e = build(2, 1, false);
    e.step(2);
    expect(e.machine('M').state).toBe('B');
  });

  it('stops checking after the first true transition (lower priorities are not evaluated)', () => {
    const e = build(2, 1);
    e.step(2);
    const conds = ofType(at(e, 2), 'COND').map((x) => x.data?.name);
    expect(conds).toEqual(['ToC']);
  });

  it('warns about two transitions with the same priority', () => {
    const b = new ProjectBuilder();
    const m = b.machine('M');
    const a = m.state('A');
    m.trans(a, m.state('B'), m.cond('X', TRUE), 1);
    m.trans(a, m.state('C'), m.cond('Y', TRUE), 1);
    const e = new Engine(b.build());
    expect(e.compiled.problems.map((p) => p.message).join()).toContain('share priority 1');
  });
});

describe('one transition per tick', () => {
  it('moves at most one state per tick even when every condition is true', () => {
    const b = new ProjectBuilder();
    const m = b.machine('M');
    const [a, sb, c, d] = ['A', 'B', 'C', 'D'].map((n) => m.state(n));
    m.trans(a!, sb!, m.cond('AB', TRUE));
    m.trans(sb!, c!, m.cond('BC', TRUE));
    m.trans(c!, d!, m.cond('CD', TRUE));
    const e = new Engine(b.build());
    const seen: (string | null)[] = [];
    for (let i = 0; i < 5; i++) {
      e.step();
      seen.push(e.machine('M').state);
    }
    expect(seen).toEqual(['A', 'B', 'C', 'D', 'D']);
    for (let t = 1; t <= 4; t++) expect(ofType(at(e, t), 'TRANS')).toHaveLength(1);
  });
});

describe('On Entry / Steps / On Exit order', () => {
  function build() {
    const b = new ProjectBuilder();
    const go = b.global('Go', T.bool);
    const entryA = b.global('EntryA', T.int);
    const stepA = b.global('StepA', T.bool);
    const exitA = b.global('ExitA', T.int);
    const entryB = b.global('EntryB', T.int);
    const stepB = b.global('StepB', T.bool);
    const m = b.machine('M');
    const a = m.state('A', {
      onEntry: [b.setGlobal(entryA, 1)],
      steps: [b.setGlobal(stepA, true)],
      onExit: [b.setGlobal(exitA, 1)],
    });
    const sb = m.state('B', {
      onEntry: [b.setGlobal(entryB, 1)],
      steps: [b.setGlobal(stepB, true)],
    });
    m.trans(a, sb, m.cond('GoNow', v(go)));
    return new Engine(b.build());
  }

  it('runs On Entry once, Steps every following tick, and on the switch tick: Exit → switch → Entry', () => {
    const e = build();
    e.step(1); // Init → A
    expect(texts(ofType(at(e, 1), 'ACTION'))).toEqual(['entry: Global.SetEntryA(1) → 1']);

    e.step(2); // A stays: Steps run on ticks 2 and 3
    expect(texts(ofType(at(e, 2), 'ACTION'))).toEqual(['steps: Global.SetStepA(true) → true']);
    expect(texts(ofType(at(e, 3), 'ACTION'))).toEqual(['steps: Global.SetStepA(true) → true']);

    e.inject('Global.Go', true);
    e.step(1); // tick 4: transition
    const tick4 = at(e, 4).filter((x) => x.type === 'ACTION' || x.type === 'TRANS');
    expect(tick4.map((x) => `${x.type} ${x.text}`)).toEqual([
      'ACTION exit: Global.SetExitA(1) → 1',
      'TRANS A → B (GoNow)',
      'ACTION entry: Global.SetEntryB(1) → 1',
    ]);
    // Steps never run on a tick where a transition fired.
    expect(texts(ofType(at(e, 4), 'ACTION')).some((t) => t.startsWith('steps'))).toBe(false);

    e.step(1); // tick 5: B's Steps
    expect(texts(ofType(at(e, 5), 'ACTION'))).toEqual(['steps: Global.SetStepB(true) → true']);
    // On Entry of A ran exactly once.
    expect(e.trace().filter((x) => x.text.startsWith('entry: Global.SetEntryA'))).toHaveLength(1);
  });

  it('runs Init → first state on the first tick, with no Steps on that tick', () => {
    const e = build();
    e.step(1);
    expect(texts(ofType(at(e, 1), 'TRANS'))).toEqual(['Init → A']);
    expect(e.machine('M').state).toBe('A');
  });
});

describe('timers', () => {
  it('a 30 ms timer at a 10 ms cycle is done exactly 3 ticks after it starts', () => {
    const b = new ProjectBuilder();
    const m = b.machine('M', 10);
    const t = m.timer('T', 30);
    const a = m.state('A', { onEntry: [b.timer('start', t)] });
    m.trans(a, m.state('B'), m.cond('Done', timerDone(t)));
    const e = new Engine(b.build());

    e.step(1); // tick 1: Init → A, timer starts
    expect(e.machine('M').timers.T).toMatchObject({ elapsedMs: 0, running: true, done: false });
    e.step(2); // ticks 2, 3
    expect(e.machine('M').timers.T).toMatchObject({ elapsedMs: 20, running: true, done: false });
    expect(e.machine('M').state).toBe('A');
    e.step(1); // tick 4: elapsed reaches the preset, the transition fires this same tick
    expect(e.machine('M').timers.T).toMatchObject({ elapsedMs: 30, running: false, done: true });
    expect(e.machine('M').state).toBe('B');
  });

  it('Start, Stop (pause), Restart, Reset and SetPreset behave exactly', () => {
    // Each command is a state; an abort handler per state jumps there when Global.Cmd says so.
    const b = new ProjectBuilder();
    const cmd = b.global('Cmd', T.int);
    const m = b.machine('M', 10);
    const t = m.timer('T', 100);
    m.state('Idle');
    const states: [number, string, ReturnType<typeof b.timer>][] = [
      [1, 'Start', b.timer('start', t)],
      [2, 'Stop', b.timer('stop', t)],
      [3, 'Restart', b.timer('restart', t)],
      [4, 'Reset', b.timer('reset', t)],
      [5, 'Preset', b.timer('setPreset', t, 50)],
    ];
    for (const [n, name, action] of states) {
      const s = m.state(name, { onEntry: [action] });
      m.abort(m.cond(`Cmd${n}`, eq(v(cmd), lit(n))), s);
    }
    const e = new Engine(b.build());
    const timer = () => e.machine('M').timers.T!;
    const send = (n: number) => {
      e.inject('Global.Cmd', n);
      e.step(1);
    };

    e.step(1); // Init → Idle
    send(1); // Start
    expect(timer()).toMatchObject({ elapsedMs: 0, running: true });
    e.step(3);
    expect(timer().elapsedMs).toBe(30);
    send(2); // Stop: advanced to 40 at the top of the tick, then paused
    expect(timer()).toMatchObject({ elapsedMs: 40, running: false, done: false });
    e.step(5);
    expect(timer().elapsedMs).toBe(40); // paused
    send(1); // Start again continues from 40
    e.step(2);
    expect(timer()).toMatchObject({ elapsedMs: 60, running: true });
    send(5); // SetPreset(50): already past it → done at 50
    expect(timer()).toMatchObject({ presetMs: 50, elapsedMs: 50, running: false, done: true });
    send(3); // Restart: from zero, running
    expect(timer()).toMatchObject({ elapsedMs: 0, running: true, done: false });
    e.step(5);
    expect(timer()).toMatchObject({ elapsedMs: 50, running: false, done: true });
    send(4); // Reset
    expect(timer()).toMatchObject({ elapsedMs: 0, running: false, done: false });
  });
});

describe('edges', () => {
  function build() {
    const b = new ProjectBuilder();
    const btn = b.global('Btn', T.bool);
    const m = b.machine('M');
    m.state('A');
    m.cond('Rise', rising(btn));
    m.cond('Fall', falling(btn));
    m.cond('Change', changed(btn));
    return new Engine(b.build());
  }
  const sample = (e: Engine) => ({
    rise: e.condition('M', 'Rise'),
    fall: e.condition('M', 'Fall'),
    change: e.condition('M', 'Change'),
  });

  it('rising, falling and changed are true for exactly one tick', () => {
    const e = build();
    e.step(3);
    expect(sample(e)).toEqual({ rise: false, fall: false, change: false });
    e.inject('Global.Btn', true);
    e.step(1);
    expect(sample(e)).toEqual({ rise: true, fall: false, change: true });
    e.step(1);
    expect(sample(e)).toEqual({ rise: false, fall: false, change: false });
    e.step(5); // held true: no more edges
    expect(sample(e)).toEqual({ rise: false, fall: false, change: false });
    e.inject('Global.Btn', false);
    e.step(1);
    expect(sample(e)).toEqual({ rise: false, fall: true, change: true });
    e.step(1);
    expect(sample(e)).toEqual({ rise: false, fall: false, change: false });
  });

  it('an edge fires a transition once, not on every tick the input stays true', () => {
    const b = new ProjectBuilder();
    const btn = b.global('Btn', T.bool);
    const m = b.machine('M');
    const a = m.state('A');
    const sb = m.state('B');
    m.trans(a, sb, m.cond('Press', rising(btn)));
    m.trans(sb, a, m.cond('Press2', rising(btn)));
    const e = new Engine(b.build());
    e.step(1);
    e.inject('Global.Btn', true);
    e.step(10);
    expect(e.machine('M').state).toBe('B'); // went A → B once and stayed
    expect(ofType(e.trace(), 'TRANS').map((x) => x.text)).toEqual(['Init → A', 'A → B (Press)']);
  });
});

describe('abort handlers', () => {
  function build() {
    const b = new ProjectBuilder();
    const go = b.global('Go', T.bool);
    const bad = b.global('Bad', T.bool);
    const reset = b.global('Reset', T.bool);
    const exitRun = b.global('ExitRun', T.bool);
    const m = b.machine('M');
    const run = m.state('Run', { onExit: [b.setGlobal(exitRun, true)] });
    const next = m.state('Next');
    const fault = m.state('Faulted');
    m.trans(run, next, m.cond('GoOn', v(go)));
    m.trans(next, run, m.cond('Back', TRUE));
    m.trans(fault, run, m.cond('ResetPressed', rising(reset)));
    m.abort(m.cond('Broken', v(bad)), fault);
    return new Engine(b.build());
  }

  it('from any state: runs the active On Exit, then goes to the target', () => {
    const e = build();
    e.step(2);
    e.inject('Global.Bad', true);
    e.step(1);
    const t = at(e, 3).filter((x) => x.type === 'ACTION' || x.type === 'TRANS');
    expect(t.map((x) => x.text)).toEqual([
      'exit: Global.SetExitRun(true) → true',
      'Run → Faulted (abort: Broken)',
    ]);
    expect(e.machine('M').state).toBe('Faulted');
  });

  it('takes precedence over a normal transition on the same tick', () => {
    const e = build();
    e.step(1);
    e.inject('Global.Go', true);
    e.inject('Global.Bad', true);
    e.step(1);
    expect(e.machine('M').state).toBe('Faulted');
  });

  it('does not fire again while already in its target state', () => {
    const e = build();
    e.step(1);
    e.inject('Global.Bad', true);
    e.step(20);
    expect(ofType(e.trace(), 'TRANS').map((x) => x.text)).toEqual([
      'Init → Run',
      'Run → Faulted (abort: Broken)',
    ]);
  });

  it('fires again if the fault is still present after a reset', () => {
    const e = build();
    e.step(1);
    e.inject('Global.Bad', true);
    e.step(2);
    e.inject('Global.Reset', true);
    e.step(1);
    expect(e.machine('M').state).toBe('Run');
    e.step(1);
    expect(e.machine('M').state).toBe('Faulted');
  });
});

describe('interrupt handlers: hold and resume', () => {
  function build() {
    const b = new ProjectBuilder();
    const stop = b.global('Stop', T.bool);
    const resume = b.global('Resume', T.bool);
    const skip = b.global('Skip', T.bool);
    const held = b.global('HoldActionRan', T.bool);
    const tick = b.global('StepRan', T.bool);
    const m = b.machine('M', 10);
    const t = m.timer('Work', 100);
    const a = m.state('Working', {
      onEntry: [b.timer('start', t)],
      steps: [b.setGlobal(tick, true)],
    });
    m.trans(a, m.state('Skipped'), m.cond('SkipIt', v(skip)), 1);
    m.trans(a, m.state('Done'), m.cond('WorkDone', timerDone(t)), 2);
    m.interrupt(m.cond('StopPressed', v(stop)), m.cond('ResumePressed', v(resume)), [
      b.setGlobal(held, true),
    ]);
    return new Engine(b.build());
  }

  it('holds: state stays, Steps stop, timers freeze, transitions are not checked, hold actions run', () => {
    const e = build();
    e.step(4); // Init + 3 ticks: elapsed 30
    expect(e.machine('M').timers.Work!.elapsedMs).toBe(30);
    e.inject('Global.Stop', true);
    e.step(1); // tick 5: timer advances to 40 first, then the trigger holds
    expect(e.machine('M')).toMatchObject({ state: 'Working', held: true, status: 'held' });
    expect(e.get('Global.HoldActionRan')).toBe(true);
    expect(e.machine('M').timers.Work!.elapsedMs).toBe(40);

    e.inject('Global.Skip', true); // would fire a transition if it were checked
    e.step(30);
    expect(e.machine('M').state).toBe('Working');
    expect(e.machine('M').timers.Work!.elapsedMs).toBe(40); // frozen
    const stepsWhileHeld = e
      .trace()
      .filter((x) => x.tick > 5 && x.tick <= 35 && x.text.startsWith('steps:'));
    expect(stepsWhileHeld).toHaveLength(0);
  });

  it('resumes exactly where it was: same state, no re-entry, timer continues from the frozen value', () => {
    const e = build();
    e.step(4);
    e.inject('Global.Stop', true);
    e.step(10);
    e.inject('Global.Stop', false);
    e.inject('Global.Resume', true);
    e.step(1); // resume tick: transitions checked and Steps run again
    expect(e.machine('M')).toMatchObject({ state: 'Working', held: false });
    expect(e.machine('M').timers.Work!.elapsedMs).toBe(40);
    expect(texts(ofType(at(e, e.tick), 'TRANS'))).toEqual(['Working: resumed (ResumePressed)']);
    expect(texts(ofType(at(e, e.tick), 'ACTION'))).toEqual([
      'steps: Global.SetStepRan(true) → true',
    ]);

    e.inject('Global.Resume', false);
    e.step(5);
    expect(e.machine('M').timers.Work!.elapsedMs).toBe(90);
    expect(e.machine('M').state).toBe('Working');
    e.step(1);
    expect(e.machine('M').state).toBe('Done');
    // On Entry of Working ran only once, on the first tick.
    expect(e.trace().filter((x) => x.text.startsWith("entry: Timer.Start('Work')"))).toHaveLength(
      1,
    );
  });

  it('an abort ends a hold', () => {
    const b = new ProjectBuilder();
    const stop = b.global('Stop', T.bool);
    const bad = b.global('Bad', T.bool);
    const m = b.machine('M');
    m.state('Run');
    const f = m.state('Faulted');
    m.interrupt(m.cond('S', v(stop)), m.cond('R', lit(false)));
    m.abort(m.cond('B', v(bad)), f);
    const e = new Engine(b.build());
    e.step(1);
    e.inject('Global.Stop', true);
    e.step(1);
    expect(e.machine('M').held).toBe(true);
    e.inject('Global.Bad', true);
    e.step(1);
    expect(e.machine('M')).toMatchObject({ state: 'Faulted', held: false });
  });
});

describe('determinism', () => {
  function scenario(boxAtTick = 7) {
    const b = new ProjectBuilder();
    const iCyl = b.iface('ICylinder', [
      ['Extend', T.bool, 'command'],
      ['Extended', T.bool, 'feedback'],
      ['Retracted', T.bool, 'feedback'],
    ]);
    const iSen = b.iface('ISensor', [['Present', T.bool, 'feedback']]);
    const cyl = b.equip('Cylinder', [iCyl], {
      kind: 'cylinder',
      command: { interface: iCyl.id, signal: iCyl.signals[0]!.id },
      extended: { interface: iCyl.id, signal: iCyl.signals[1]!.id },
      retracted: { interface: iCyl.id, signal: iCyl.signals[2]!.id },
      travelMs: 120,
    });
    const sen = b.equip('Sensor', [iSen]);
    const count = b.global('Busy', T.bool);
    const m = b.machine('M', 10);
    const pusher = m.instance('Pusher', cyl);
    const box = m.instance('Box', sen);
    const t = m.timer('Dwell', 50);
    const wait = m.state('Wait', { onEntry: [b.setGlobal(count, false)] });
    const push = m.state('Push', {
      onEntry: [b.setSignal(pusher.sig(iCyl, 'Extend'), true), b.setGlobal(count, true)],
    });
    const dwell = m.state('Dwell', { onEntry: [b.timer('restart', t)] });
    const back = m.state('Back', { onEntry: [b.setSignal(pusher.sig(iCyl, 'Extend'), false)] });
    m.trans(wait, push, m.cond('BoxThere', v(box.sig(iSen, 'Present'))));
    m.trans(push, dwell, m.cond('Out', v(pusher.sig(iCyl, 'Extended'))));
    m.trans(dwell, back, m.cond('DwellDone', timerDone(t)));
    m.trans(
      back,
      wait,
      m.cond('Home', and(v(pusher.sig(iCyl, 'Retracted')), not(v(box.sig(iSen, 'Present'))))),
    );
    const m2 = b.machine('Watcher', 20);
    const w = m2.state('Watch');
    m2.trans(w, m2.state('SawBusy'), m2.cond('IsBusy', v(count)));

    const e = new Engine(b.build());
    for (let tick = 1; tick <= 300; tick++) {
      if (tick === boxAtTick) e.inject('M.Box.ISensor.Present', true);
      if (tick === 60) e.inject('M.Box.ISensor.Present', false);
      e.step(1);
    }
    return e;
  }

  it('the same inputs and tick count give an identical trace, event for event', () => {
    const first = scenario();
    const second = scenario();
    // The scenario really goes round the whole cycle, in both machines.
    expect(ofType(first.trace(), 'TRANS').map((x) => x.text)).toEqual([
      'Init → Wait',
      'Init → Watch',
      'Wait → Push (BoxThere)',
      'Watch → SawBusy (IsBusy)',
      'Push → Dwell (Out)',
      'Dwell → Back (DwellDone)',
      'Back → Wait (Home)',
    ]);
    expect(JSON.stringify(second.trace())).toBe(JSON.stringify(first.trace()));
    expect(first.machine('M').state).toBe('Wait');
  });

  it('a different input timing gives a different trace (the comparison is meaningful)', () => {
    expect(JSON.stringify(scenario(9).trace())).not.toBe(JSON.stringify(scenario(7).trace()));
  });
});

describe('parallel machines and scheduling', () => {
  it('each machine runs on its own cycle time', () => {
    const b = new ProjectBuilder();
    b.machine('Fast', 10).state('A');
    b.machine('Slow', 25).state('A');
    const e = new Engine(b.build());
    expect(e.baseMs).toBe(5);
    e.runForMs(100);
    expect(e.machine('Fast').ticks).toBe(10);
    expect(e.machine('Slow').ticks).toBe(4);
    expect(e.timeUs).toBe(100_000);
  });

  it('machines coordinate through inState(...)', () => {
    const b = new ProjectBuilder();
    const go = b.global('Go', T.bool);
    const m1 = b.machine('Leader');
    const l1 = m1.state('Wait');
    const l2 = m1.state('Ready');
    m1.trans(l1, l2, m1.cond('GoNow', v(go)));
    const m2 = b.machine('Follower');
    const f1 = m2.state('Wait');
    const f2 = m2.state('Follow');
    m2.trans(f1, f2, m2.cond('LeaderReady', { op: 'inState', machine: m1.m.id, state: l2 }));
    const e = new Engine(b.build());
    e.step(3);
    expect(e.machine('Follower').state).toBe('Wait');
    e.inject('Global.Go', true);
    e.step(1); // Leader moves; Follower (scanned after it) sees it on the same tick
    expect(e.machine('Leader').state).toBe('Ready');
    expect(e.machine('Follower').state).toBe('Follow');
  });

  it('a fault stops only the machine that faulted, with its name and message', () => {
    const b = new ProjectBuilder();
    const iSen = b.iface('ISensor', [['Level', T.int, 'feedback']]);
    const sen = b.equip('Sensor', [iSen]);
    const bad = b.machine('Bad');
    bad.instance('Tank', sen);
    bad.state('A');
    b.machine('Good').state('A');
    const e = new Engine(b.build());
    e.step(2);
    // A broken driver delivers text where a whole number is expected.
    e.driver<SimDriver>('sim').inject('Bad.Tank.ISensor.Level', 'oops');
    e.step(5);
    expect(e.machine('Bad')).toMatchObject({ faulted: true, status: 'faulted', ticks: 3 });
    expect(e.machine('Bad').fault?.message).toContain(
      'Bad.Tank.ISensor.Level must be a whole number',
    );
    expect(e.machine('Good').ticks).toBe(7);
    const fault = ofType(e.trace(), 'FAULT');
    expect(fault).toHaveLength(1);
    expect(fault[0]).toMatchObject({ machine: 'Bad', tick: 3 });
  });
});

describe('trace and COND logging', () => {
  function build(condLog?: 'every') {
    const b = new ProjectBuilder();
    const x = b.global('X', T.bool);
    const m = b.machine('M', 10);
    const a = m.state('A');
    m.trans(a, m.state('B'), m.cond('XOn', v(x)));
    return new Engine(b.build(), condLog ? { condLog } : {});
  }

  it('logs COND on change plus once per second while unchanged — including false results', () => {
    const e = build();
    e.step(251); // 2.5 s; condition evaluated on ticks 2..251
    const conds = ofType(e.trace(), 'COND');
    expect(conds.map((c) => c.tick)).toEqual([2, 102, 202]);
    expect(conds[0]!.text).toBe('XOn = false  [Global.X = false]');
    expect(conds[0]!.data).toMatchObject({
      result: false,
      terms: [{ text: 'Global.X', value: false }],
    });
  });

  it('"log every evaluation" logs every check', () => {
    const e = build('every');
    e.step(251);
    expect(ofType(e.trace(), 'COND')).toHaveLength(250);
  });

  it('every event carries tick, virtual time in µs, machine, state and type', () => {
    const e = build();
    e.step(3);
    e.inject('Global.X', true);
    e.step(1);
    const trans = ofType(e.trace(), 'TRANS').at(-1)!;
    expect(trans).toMatchObject({
      tick: 4,
      timeUs: 40_000,
      machine: 'M',
      state: 'B',
      type: 'TRANS',
      text: 'A → B (XOn)',
    });
    const inject = ofType(e.trace(), 'INJECT')[0]!;
    expect(inject).toMatchObject({ machine: null, text: 'Global.X = true' });
    expect(ofType(e.trace(), 'SET').some((x) => x.text === 'Global.X = true')).toBe(true);
  });

  it('BUS events show values crossing the simulated driver, on change only', () => {
    const b = new ProjectBuilder();
    const iMot = b.iface('IMotor', [
      ['Run', T.bool, 'command'],
      ['Running', T.bool, 'feedback'],
    ]);
    const motor = b.equip('Motor', [iMot], {
      kind: 'follow',
      command: { interface: iMot.id, signal: iMot.signals[0]!.id },
      feedback: { interface: iMot.id, signal: iMot.signals[1]!.id },
      delayMs: 50,
    });
    const m = b.machine('M', 10);
    const conv = m.instance('Conveyor', motor);
    m.state('On', { steps: [b.setSignal(conv.sig(iMot, 'Run'), true)] });
    const e = new Engine(b.build());
    e.step(20);
    const bus = texts(ofType(e.trace(), 'BUS'));
    expect(bus).toContain('M.Conveyor.IMotor.Run → sim = true');
    expect(bus).toContain('sim → M.Conveyor.IMotor.Running = true');
    expect(bus.filter((t) => t === 'M.Conveyor.IMotor.Run → sim = true')).toHaveLength(1);
    expect(e.get('M.Conveyor.IMotor.Running')).toBe(true);
  });
});

describe('the engine refuses to run a broken project', () => {
  it('throws a CompileError listing every problem', () => {
    const b = new ProjectBuilder();
    const m = b.machine('M');
    m.m.initial = null;
    expect(() => new Engine(b.build())).toThrow(CompileError);
    try {
      new Engine(b.build());
    } catch (err) {
      expect((err as CompileError).problems[0]!.message).toContain('Init node is not connected');
    }
  });
});
