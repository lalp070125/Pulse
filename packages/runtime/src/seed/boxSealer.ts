import type {
  Action,
  Binding,
  Condition,
  Expr,
  Interface,
  Machine,
  Operand,
  Project,
  Role,
  StateTemplate,
  TimerRef,
  VarRef,
} from '@pulso/core';

/* ----------------------------------------------------------------------------
 * The seed project `box-sealer-demo` (SPEC 12), Phase 1 part: the Sealer machine.
 *
 * This builder was used once to write /projects/box-sealer-demo. From then on the
 * files are the truth; run `npm run seed -w @pulso/runtime` only to regenerate
 * them from scratch. IDs are fixed so the files never churn.
 * -------------------------------------------------------------------------- */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Fixed, valid ULIDs for the seed: 01JSEED + a number. */
function id(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor(x / 32)) s = CROCKFORD[x % 32] + s;
  return `01JSEED${s.padStart(19, '0')}`;
}

const bool = { kind: 'bool' } as const;
const int = { kind: 'int' } as const;

export function buildBoxSealer(): Project {
  /* --- interfaces ----------------------------------------------------------- */
  const IMotor: Interface = {
    id: id(100),
    name: 'IMotor',
    description: 'A motor that can be switched on and reports that it runs.',
    signals: [
      {
        id: id(101),
        name: 'Run',
        type: bool,
        direction: 'command',
        description: 'Switch the motor on',
      },
      {
        id: id(102),
        name: 'Running',
        type: bool,
        direction: 'feedback',
        description: 'The motor is turning',
      },
    ],
  };
  const IFault: Interface = {
    id: id(110),
    name: 'IFault',
    description: 'A device that can report its own fault.',
    signals: [{ id: id(111), name: 'Fault', type: bool, direction: 'feedback' }],
  };
  const ISensor: Interface = {
    id: id(120),
    name: 'ISensor',
    description: 'A presence sensor.',
    signals: [
      {
        id: id(121),
        name: 'Present',
        type: bool,
        direction: 'feedback',
        description: 'Something is in front of the sensor',
      },
    ],
  };
  const ICylinder: Interface = {
    id: id(130),
    name: 'ICylinder',
    description: 'A pneumatic cylinder with end-position sensors.',
    signals: [
      {
        id: id(131),
        name: 'Extend',
        type: bool,
        direction: 'command',
        description: 'Push out (false = pull back)',
      },
      {
        id: id(132),
        name: 'Extended',
        type: bool,
        direction: 'feedback',
        description: 'Fully out',
      },
      {
        id: id(133),
        name: 'Retracted',
        type: bool,
        direction: 'feedback',
        description: 'Fully back',
      },
    ],
  };
  const IIndicator: Interface = {
    id: id(140),
    name: 'IIndicator',
    description: 'A lamp.',
    signals: [{ id: id(141), name: 'On', type: bool, direction: 'command' }],
  };
  const sel = (i: Interface, n: number) => ({ interface: i.id, signal: i.signals[n]!.id });

  /* --- equipment ------------------------------------------------------------ */
  const Motor = {
    id: id(200),
    name: 'Motor',
    description: 'Motor with fault feedback. Simulated: Running follows Run after 100 ms.',
    interfaces: [IMotor.id, IFault.id],
    simModel: {
      kind: 'follow' as const,
      command: sel(IMotor, 0),
      feedback: sel(IMotor, 1),
      delayMs: 100,
    },
  };
  const Sensor = { id: id(210), name: 'Sensor', interfaces: [ISensor.id] };
  const Cylinder = {
    id: id(220),
    name: 'Cylinder',
    description: 'Simulated: takes 400 ms to travel out or back.',
    interfaces: [ICylinder.id],
    simModel: {
      kind: 'cylinder' as const,
      command: sel(ICylinder, 0),
      extended: sel(ICylinder, 1),
      retracted: sel(ICylinder, 2),
      travelMs: 400,
    },
  };
  const Indicator = { id: id(230), name: 'Indicator', interfaces: [IIndicator.id] };

  /* --- globals -------------------------------------------------------------- */
  const g = {
    Start: id(300),
    Stop: id(301),
    Running: id(302),
    BoxCount: id(303),
    FaultReset: id(304),
  };
  const globals = [
    { id: g.Start, name: 'Start', type: bool, default: false, description: 'Start button' },
    { id: g.Stop, name: 'Stop', type: bool, default: false, description: 'Stop button' },
    {
      id: g.Running,
      name: 'Running',
      type: bool,
      default: false,
      description: 'The machine is producing',
    },
    {
      id: g.BoxCount,
      name: 'BoxCount',
      type: int,
      default: 0,
      unit: 'boxes',
      description: 'Boxes sealed (counting arrives with logic blocks)',
    },
    {
      id: g.FaultReset,
      name: 'FaultReset',
      type: bool,
      default: false,
      description: 'Fault reset button',
    },
  ];
  const glob = (gid: string): VarRef => ({ kind: 'global', global: gid });

  /* --- roles used by the library templates ---------------------------------- */
  const role = {
    conveyor: { id: id(400), name: 'Conveyor', kind: 'equipment', equipment: Motor.id } as Role,
    lamp: { id: id(401), name: 'Lamp', kind: 'equipment', equipment: Indicator.id } as Role,
    pusher: { id: id(402), name: 'Pusher', kind: 'equipment', equipment: Cylinder.id } as Role,
    sealHead: { id: id(403), name: 'SealHead', kind: 'equipment', equipment: Cylinder.id } as Role,
    sensor: { id: id(404), name: 'Sensor', kind: 'equipment', equipment: Sensor.id } as Role,
    cylinder: { id: id(405), name: 'Cylinder', kind: 'equipment', equipment: Cylinder.id } as Role,
    watchdog: { id: id(406), name: 'Watchdog', kind: 'timer' } as Role,
    sealTimer: { id: id(407), name: 'SealTimer', kind: 'timer' } as Role,
    timer: { id: id(408), name: 'Timer', kind: 'timer' } as Role,
  };
  const rs = (r: Role, i: Interface, n: number): VarRef => ({
    kind: 'roleSignal',
    role: r.id,
    interface: i.id,
    signal: i.signals[n]!.id,
  });
  const rt = (r: Role): TimerRef => ({ kind: 'roleTimer', role: r.id });

  let actionNo = 500;
  const lit = (value: boolean | number): Operand => ({ from: 'literal', value });
  const setSig = (target: VarRef, value: boolean): Action => ({
    id: id(actionNo++),
    kind: 'equipment',
    target,
    value: lit(value),
  });
  const setGlob = (gid: string, value: boolean | number): Action => ({
    id: id(actionNo++),
    kind: 'global',
    target: gid,
    value: lit(value),
  });
  const timer = (op: 'restart', t: TimerRef): Action => ({
    id: id(actionNo++),
    kind: 'timer',
    op,
    timer: t,
  });

  /* --- state templates (library) -------------------------------------------- */
  const st = (
    n: number,
    name: string,
    description: string,
    roles: Role[],
    groups: Partial<Pick<StateTemplate, 'onEntry' | 'steps' | 'onExit'>>,
  ): StateTemplate => ({
    id: id(n),
    name,
    description,
    roles,
    onEntry: groups.onEntry ?? [],
    steps: groups.steps ?? [],
    onExit: groups.onExit ?? [],
  });
  const Idle = st(600, 'Idle', 'Waiting for Start. Everything off.', [role.conveyor, role.lamp], {
    onEntry: [
      setSig(rs(role.conveyor, IMotor, 0), false),
      setGlob(g.Running, false),
      setSig(rs(role.lamp, IIndicator, 0), false),
    ],
  });
  const Feed = st(
    610,
    'Feed',
    'Conveyor runs until a box reaches the stop.',
    [role.conveyor, role.lamp],
    {
      onEntry: [setGlob(g.Running, true), setSig(rs(role.lamp, IIndicator, 0), true)],
      steps: [setSig(rs(role.conveyor, IMotor, 0), true)],
    },
  );
  const Push = st(
    620,
    'Push',
    'Conveyor stops, the pusher moves the box under the seal head.',
    [role.conveyor, role.pusher, role.watchdog],
    {
      onEntry: [
        setSig(rs(role.conveyor, IMotor, 0), false),
        setSig(rs(role.pusher, ICylinder, 0), true),
        timer('restart', rt(role.watchdog)),
      ],
    },
  );
  const Seal = st(
    630,
    'Seal',
    'The seal head presses for the seal time.',
    [role.sealHead, role.sealTimer],
    {
      onEntry: [
        setSig(rs(role.sealHead, ICylinder, 0), true),
        timer('restart', rt(role.sealTimer)),
      ],
      onExit: [setSig(rs(role.sealHead, ICylinder, 0), false)],
    },
  );
  const Release = st(640, 'Release', 'The pusher pulls back.', [role.pusher], {
    onEntry: [setSig(rs(role.pusher, ICylinder, 0), false)],
  });
  const Faulted = st(
    650,
    'Faulted',
    'Everything off, lamp on, wait for Fault Reset.',
    [role.conveyor, role.pusher, role.sealHead, role.lamp],
    {
      onEntry: [
        setSig(rs(role.conveyor, IMotor, 0), false),
        setSig(rs(role.pusher, ICylinder, 0), false),
        setSig(rs(role.sealHead, ICylinder, 0), false),
        setGlob(g.Running, false),
        setSig(rs(role.lamp, IIndicator, 0), true),
      ],
    },
  );

  /* --- condition templates (library) ---------------------------------------- */
  const ct = (
    n: number,
    name: string,
    description: string,
    roles: Role[],
    expr: Expr,
    alarm?: Condition['alarm'],
  ): Condition => {
    const c: Condition = { id: id(n), name, description, roles, expr };
    if (alarm) c.alarm = alarm;
    return c;
  };
  const StartPressed = ct(700, 'StartPressed', 'Start button pressed (rising edge).', [], {
    op: 'rising',
    ref: glob(g.Start),
  });
  const StopPressed = ct(701, 'StopPressed', 'Stop button pressed (rising edge).', [], {
    op: 'rising',
    ref: glob(g.Stop),
  });
  const BoxArrived = ct(702, 'BoxArrived', 'A box is at the stop.', [role.sensor], {
    op: 'var',
    ref: rs(role.sensor, ISensor, 0),
  });
  const PusherOut = ct(703, 'PusherOut', 'The cylinder is fully extended.', [role.cylinder], {
    op: 'var',
    ref: rs(role.cylinder, ICylinder, 1),
  });
  const SealDone = ct(704, 'SealDone', 'The timer has finished.', [role.timer], {
    op: 'timerDone',
    timer: rt(role.timer),
  });
  const PusherHome = ct(705, 'PusherHome', 'The cylinder is fully retracted.', [role.cylinder], {
    op: 'var',
    ref: rs(role.cylinder, ICylinder, 2),
  });
  const PusherStuck = ct(
    706,
    'PusherStuck',
    'Extend was commanded but the cylinder did not report Extended before the watchdog ran out.',
    [role.cylinder, role.watchdog],
    {
      op: 'and',
      args: [
        { op: 'var', ref: rs(role.cylinder, ICylinder, 0) },
        { op: 'not', arg: { op: 'var', ref: rs(role.cylinder, ICylinder, 1) } },
        { op: 'timerDone', timer: rt(role.watchdog) },
      ],
    },
    { group: 'Sealer', severity: 'alarm', message: 'Pusher did not extend within 2 s' },
  );
  const ResetPressed = ct(707, 'ResetPressed', 'Fault Reset pressed (rising edge).', [], {
    op: 'rising',
    ref: glob(g.FaultReset),
  });

  /* --- the Sealer machine ---------------------------------------------------- */
  const inst = {
    Conveyor: id(800),
    BoxAtStop: id(801),
    Pusher: id(802),
    SealHead: id(803),
    Lamp: id(804),
  };
  const tmr = { SealTime: id(810), PusherWatch: id(811) };
  const bi = (r: Role, instance: string): Binding => ({ role: r.id, kind: 'instance', instance });
  const bt = (r: Role, t: string): Binding => ({ role: r.id, kind: 'timer', timer: t });

  const node = {
    Idle: id(820),
    Feed: id(821),
    Push: id(822),
    Seal: id(823),
    Release: id(824),
    Faulted: id(825),
  };
  const cond = {
    StartPressed: id(830),
    StopPressed: id(831),
    BoxArrived: id(832),
    PusherOut: id(833),
    SealDone: id(834),
    PusherHome: id(835),
    PusherStuck: id(836),
    ResetPressed: id(837),
  };

  const sealer: Machine = {
    id: id(900),
    name: 'Sealer',
    description: 'Feeds a box to the stop, pushes it under the seal head, seals it, releases it.',
    cycleMs: 10,
    instances: [
      { id: inst.Conveyor, name: 'Conveyor', equipment: Motor.id },
      { id: inst.BoxAtStop, name: 'BoxAtStop', equipment: Sensor.id },
      { id: inst.Pusher, name: 'Pusher', equipment: Cylinder.id },
      { id: inst.SealHead, name: 'SealHead', equipment: Cylinder.id },
      { id: inst.Lamp, name: 'Lamp', equipment: Indicator.id },
    ],
    timers: [
      { id: tmr.SealTime, name: 'SealTime', presetMs: 1500 },
      { id: tmr.PusherWatch, name: 'PusherWatch', presetMs: 2000 },
    ],
    states: [
      {
        id: node.Idle,
        name: 'Idle',
        template: Idle.id,
        bindings: [bi(role.conveyor, inst.Conveyor), bi(role.lamp, inst.Lamp)],
      },
      {
        id: node.Feed,
        name: 'Feed',
        template: Feed.id,
        bindings: [bi(role.conveyor, inst.Conveyor), bi(role.lamp, inst.Lamp)],
      },
      {
        id: node.Push,
        name: 'Push',
        template: Push.id,
        bindings: [
          bi(role.conveyor, inst.Conveyor),
          bi(role.pusher, inst.Pusher),
          bt(role.watchdog, tmr.PusherWatch),
        ],
      },
      {
        id: node.Seal,
        name: 'Seal',
        template: Seal.id,
        bindings: [bi(role.sealHead, inst.SealHead), bt(role.sealTimer, tmr.SealTime)],
      },
      {
        id: node.Release,
        name: 'Release',
        template: Release.id,
        bindings: [bi(role.pusher, inst.Pusher)],
      },
      {
        id: node.Faulted,
        name: 'Faulted',
        template: Faulted.id,
        bindings: [
          bi(role.conveyor, inst.Conveyor),
          bi(role.pusher, inst.Pusher),
          bi(role.sealHead, inst.SealHead),
          bi(role.lamp, inst.Lamp),
        ],
      },
    ],
    conditions: [
      { id: cond.StartPressed, template: StartPressed.id, bindings: [] },
      { id: cond.StopPressed, template: StopPressed.id, bindings: [] },
      { id: cond.BoxArrived, template: BoxArrived.id, bindings: [bi(role.sensor, inst.BoxAtStop)] },
      { id: cond.PusherOut, template: PusherOut.id, bindings: [bi(role.cylinder, inst.Pusher)] },
      { id: cond.SealDone, template: SealDone.id, bindings: [bt(role.timer, tmr.SealTime)] },
      { id: cond.PusherHome, template: PusherHome.id, bindings: [bi(role.cylinder, inst.Pusher)] },
      {
        id: cond.PusherStuck,
        template: PusherStuck.id,
        bindings: [bi(role.cylinder, inst.Pusher), bt(role.watchdog, tmr.PusherWatch)],
      },
      { id: cond.ResetPressed, template: ResetPressed.id, bindings: [] },
    ],
    initial: node.Idle,
    transitions: [
      { id: id(850), from: node.Idle, to: node.Feed, condition: cond.StartPressed, priority: 1 },
      { id: id(851), from: node.Feed, to: node.Push, condition: cond.BoxArrived, priority: 1 },
      { id: id(852), from: node.Push, to: node.Seal, condition: cond.PusherOut, priority: 1 },
      { id: id(853), from: node.Seal, to: node.Release, condition: cond.SealDone, priority: 1 },
      { id: id(854), from: node.Release, to: node.Feed, condition: cond.PusherHome, priority: 1 },
      { id: id(855), from: node.Faulted, to: node.Idle, condition: cond.ResetPressed, priority: 1 },
    ],
    aborts: [{ id: id(860), condition: cond.PusherStuck, to: node.Faulted }],
    interrupts: [
      {
        id: id(870),
        trigger: cond.StopPressed,
        resume: cond.StartPressed,
        onHold: [
          {
            id: id(871),
            kind: 'equipment',
            target: {
              kind: 'signal',
              instance: inst.Conveyor,
              interface: IMotor.id,
              signal: IMotor.signals[0]!.id,
            },
            value: lit(false),
          },
        ],
      },
    ],
  };

  const plan = {
    machine: sealer.id,
    nodes: [
      { id: node.Idle, x: 240, y: 80 },
      { id: node.Feed, x: 240, y: 240 },
      { id: node.Push, x: 240, y: 400 },
      { id: node.Seal, x: 240, y: 560 },
      { id: node.Release, x: 240, y: 720 },
      { id: node.Faulted, x: 520, y: 80 },
    ],
  };

  return {
    info: { formatVersion: 1, id: id(1), name: 'box-sealer-demo', defaultCycleMs: 10 },
    globals,
    interfaces: [IMotor, IFault, ISensor, ICylinder, IIndicator],
    equipment: [Motor, Sensor, Cylinder, Indicator],
    conditions: [
      StartPressed,
      StopPressed,
      BoxArrived,
      PusherOut,
      SealDone,
      PusherHome,
      PusherStuck,
      ResetPressed,
    ],
    states: [Idle, Feed, Push, Seal, Release, Faulted],
    machines: [{ machine: sealer, plan }],
    routing: { routes: [] },
  };
}
