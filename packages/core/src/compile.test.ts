import { describe, expect, it } from 'vitest';
import { compileProject } from './compile';
import { Engine } from './engine';
import type { Role } from './schema';
import { ProjectBuilder, T, and, lit, not, timerDone, v } from './test/kit';

/* Library templates, roles and bindings (SPEC 5.4) and the problems the compiler names. */

function motorLibrary() {
  const b = new ProjectBuilder();
  const iMot = b.iface('IMotor', [
    ['Run', T.bool, 'command'],
    ['Running', T.bool, 'feedback'],
  ]);
  const motor = b.equip('Motor', [iMot]);
  const role: Role = { id: b.id(), name: 'TheMotor', kind: 'equipment', equipment: motor.id };
  const runSig = {
    kind: 'roleSignal' as const,
    role: role.id,
    interface: iMot.id,
    signal: iMot.signals[0]!.id,
  };
  const running = b.stateTemplate('Running', { onEntry: [b.setSignal(runSig, true)] }, [role]);
  return { b, iMot, motor, role, running };
}

const errors = (b: ProjectBuilder) =>
  compileProject(b.build())
    .problems.filter((p) => p.level === 'error')
    .map((p) => `${p.where}: ${p.message}`);

describe('library templates and role bindings', () => {
  it('one Running template drives three different motors in three machines', () => {
    const { b, motor, role, running } = motorLibrary();
    for (const [machine, inst] of [
      ['Line1', 'Conveyor'],
      ['Line2', 'Fan'],
      ['Line3', 'Pump'],
    ] as const) {
      const m = b.machine(machine);
      const i = m.instance(inst, motor);
      m.state('Run', running, [{ role: role.id, kind: 'instance', instance: i.id }]);
    }
    const e = new Engine(b.build());
    e.step(1);
    expect(e.get('Line1.Conveyor.IMotor.Run')).toBe(true);
    expect(e.get('Line2.Fan.IMotor.Run')).toBe(true);
    expect(e.get('Line3.Pump.IMotor.Run')).toBe(true);
  });

  it('names exactly which binding is missing', () => {
    const { b, motor, running } = motorLibrary();
    const m = b.machine('Sealer');
    m.instance('Conveyor', motor);
    m.state('Run', running, []);
    expect(errors(b)).toContain(
      "Machine 'Sealer' › state 'Run': role 'TheMotor' is not bound — pick what it stands for in this machine",
    );
  });

  it('rejects a binding to the wrong kind of equipment', () => {
    const { b, role, running } = motorLibrary();
    const iSen = b.iface('ISensor', [['Present', T.bool, 'feedback']]);
    const sensor = b.equip('Sensor', [iSen]);
    const m = b.machine('Sealer');
    const s = m.instance('Eye', sensor);
    m.state('Run', running, [{ role: role.id, kind: 'instance', instance: s.id }]);
    expect(errors(b).join('\n')).toContain(
      "role 'TheMotor' needs a Motor, but 'Eye' is a different type",
    );
  });

  it('a generic setter writes whatever variable the machine binds to its role', () => {
    const b = new ProjectBuilder();
    const flag = b.global('Flag', T.bool);
    const role: Role = { id: b.id(), name: 'Target', kind: 'variable', type: T.bool };
    const tpl = b.stateTemplate(
      'SetIt',
      {
        onEntry: [
          { id: b.id(), kind: 'generic', target: role.id, value: { from: 'literal', value: true } },
        ],
      },
      [role],
    );
    const m = b.machine('M');
    m.state('S', tpl, [{ role: role.id, kind: 'variable', ref: flag }]);
    const e = new Engine(b.build());
    e.step(1);
    expect(e.get('Global.Flag')).toBe(true);
    expect(e.trace().find((x) => x.type === 'ACTION')?.text).toBe(
      'entry: Generic.Set[bool](true) → Global.Flag → true',
    );
  });

  it('a timer role binds to one of the machine timers', () => {
    const b = new ProjectBuilder();
    const role: Role = { id: b.id(), name: 'Delay', kind: 'timer' };
    const waitTpl = b.stateTemplate(
      'Wait',
      { onEntry: [b.timer('start', { kind: 'roleTimer', role: role.id })] },
      [role],
    );
    const doneTpl = b.conditionTemplate(
      'DelayDone',
      timerDone({ kind: 'roleTimer', role: role.id }),
      [role],
    );
    const m = b.machine('M');
    const t = m.timer('Short', 20);
    const w = m.state('Wait', waitTpl, [{ role: role.id, kind: 'timer', timer: t.timer }]);
    m.trans(
      w,
      m.state('After'),
      m.cond(doneTpl, undefined, [{ role: role.id, kind: 'timer', timer: t.timer }]),
    );
    const e = new Engine(b.build());
    e.step(3);
    expect(e.machine('M').state).toBe('After');
  });
});

describe('problems the compiler names', () => {
  it('writing a feedback signal is refused with an explanation', () => {
    const b = new ProjectBuilder();
    const iSen = b.iface('ISensor', [['Present', T.bool, 'feedback']]);
    const m = b.machine('M');
    const s = m.instance('Eye', b.equip('Sensor', [iSen]));
    m.state('A', { onEntry: [b.setSignal(s.sig(iSen, 'Present'), true)] });
    expect(errors(b).join('\n')).toContain('Eye.ISensor.Present, which is a feedback signal');
  });

  it('a value of the wrong type is refused', () => {
    const b = new ProjectBuilder();
    const n = b.global('Count', T.int);
    b.machine('M').state('A', { onEntry: [b.setGlobal(n, 'many')] });
    expect(errors(b).join('\n')).toContain('the value for Global.Count must be a whole number');
  });

  it('comparing a number with true/false is refused', () => {
    const b = new ProjectBuilder();
    const n = b.global('Count', T.int);
    const m = b.machine('M');
    m.cond('Odd', { op: 'cmp', cmp: 'eq', left: v(n), right: lit(true) });
    m.state('A');
    expect(errors(b).join('\n')).toContain('the two sides are different kinds of value');
  });

  it('a condition that is not true/false is refused', () => {
    const b = new ProjectBuilder();
    const n = b.global('Count', T.int);
    const m = b.machine('M');
    m.state('A');
    m.cond('JustANumber', v(n));
    expect(errors(b).join('\n')).toContain('is not true/false');
  });

  it('a reference to something that does not exist is named', () => {
    const b = new ProjectBuilder();
    const m = b.machine('M');
    m.state('A');
    m.cond('Ghost', v({ kind: 'global', global: '01ZZZZZZZZZZZZZZZZZZZZZZZZ' }));
    expect(errors(b).join('\n')).toContain('refers to a global that does not exist');
  });

  it('builds the read-only summary line of a condition', () => {
    const b = new ProjectBuilder();
    const stop = b.global('Stop', T.bool);
    const start = b.global('Start', T.bool);
    const m = b.machine('M');
    m.state('A');
    m.cond('Go', and(v(start), not(v(stop))));
    const c = compileProject(b.build()).machines[0]!.conditions[0]!;
    expect(c.summary).toBe('IF( Global.Start AND NOT Global.Stop )');
  });
});
