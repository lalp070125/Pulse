/* ----------------------------------------------------------------------------
 * Test kit: builds small projects in a few lines. Test-only code.
 * IDs are deterministic ULID-shaped strings, so runs are repeatable.
 * -------------------------------------------------------------------------- */
import type {
  Action,
  Binding,
  Condition,
  Equipment,
  Expr,
  Global,
  Interface,
  Machine,
  Operand,
  Project,
  Role,
  SimModel,
  StateTemplate,
  TimerOp,
  TimerRef,
  VarRef,
} from '../schema';
import type { TypeSpec, Value } from '../types';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function makeIdFactory(prefix = '01TEST') {
  let n = 0;
  return () => {
    n++;
    let s = '';
    let x = n;
    while (x > 0) {
      s = CROCKFORD[x % 32] + s;
      x = Math.floor(x / 32);
    }
    return prefix + s.padStart(26 - prefix.length, '0');
  };
}

export const T = {
  bool: { kind: 'bool' } as TypeSpec,
  int: { kind: 'int' } as TypeSpec,
  real: { kind: 'real' } as TypeSpec,
  boolArray: (length: number): TypeSpec => ({ kind: 'array', of: { kind: 'bool' }, length }),
};

/* expressions */
export const v = (ref: VarRef): Expr => ({ op: 'var', ref });
export const lit = (value: Value): Expr => ({ op: 'lit', value });
export const and = (...args: Expr[]): Expr => ({ op: 'and', args });
export const or = (...args: Expr[]): Expr => ({ op: 'or', args });
export const not = (arg: Expr): Expr => ({ op: 'not', arg });
export const eq = (left: Expr, right: Expr): Expr => ({ op: 'cmp', cmp: 'eq', left, right });
export const ge = (left: Expr, right: Expr): Expr => ({ op: 'cmp', cmp: 'ge', left, right });
export const rising = (ref: VarRef): Expr => ({ op: 'rising', ref });
export const falling = (ref: VarRef): Expr => ({ op: 'falling', ref });
export const changed = (ref: VarRef): Expr => ({ op: 'changed', ref });
export const timerDone = (timer: TimerRef): Expr => ({ op: 'timerDone', timer });
export const timerElapsed = (timer: TimerRef): Expr => ({ op: 'timerElapsed', timer });
export const TRUE: Expr = { op: 'lit', value: true };

export class ProjectBuilder {
  readonly id = makeIdFactory();
  private globals: Global[] = [];
  private interfaces: Interface[] = [];
  private equipment: Equipment[] = [];
  private conditions: Condition[] = [];
  private states: StateTemplate[] = [];
  private machines: MachineBuilder[] = [];
  private projectId = this.id();

  global(name: string, type: TypeSpec, def?: Value): VarRef & { kind: 'global' } {
    const g: Global = {
      id: this.id(),
      name,
      type,
      default: def ?? (type.kind === 'bool' ? false : type.kind === 'array' ? [] : 0),
    };
    this.globals.push(g);
    return { kind: 'global', global: g.id };
  }

  iface(name: string, signals: [string, TypeSpec, 'command' | 'feedback' | 'param'][]) {
    const i: Interface = {
      id: this.id(),
      name,
      signals: signals.map(([n, type, direction]) => ({ id: this.id(), name: n, type, direction })),
    };
    this.interfaces.push(i);
    return i;
  }

  equip(name: string, interfaces: Interface[], simModel?: SimModel): Equipment {
    const e: Equipment = { id: this.id(), name, interfaces: interfaces.map((i) => i.id) };
    if (simModel) e.simModel = simModel;
    this.equipment.push(e);
    return e;
  }

  /** Library state template (with roles). */
  stateTemplate(
    name: string,
    groups: { onEntry?: Action[]; steps?: Action[]; onExit?: Action[] },
    roles: Role[] = [],
  ): StateTemplate {
    const s: StateTemplate = {
      id: this.id(),
      name,
      roles,
      onEntry: groups.onEntry ?? [],
      steps: groups.steps ?? [],
      onExit: groups.onExit ?? [],
    };
    this.states.push(s);
    return s;
  }

  /** Library condition template (with roles). */
  conditionTemplate(
    name: string,
    expr: Expr,
    roles: Role[] = [],
    alarm?: Condition['alarm'],
  ): Condition {
    const c: Condition = { id: this.id(), name, roles, expr };
    if (alarm) c.alarm = alarm;
    this.conditions.push(c);
    return c;
  }

  machine(name: string, cycleMs = 10): MachineBuilder {
    const m = new MachineBuilder(this, name, cycleMs);
    this.machines.push(m);
    return m;
  }

  /* actions */
  setGlobal(ref: VarRef & { kind: 'global' }, value: Value | VarRef): Action {
    return { id: this.id(), kind: 'global', target: ref.global, value: operand(value) };
  }
  setSignal(ref: VarRef, value: Value | VarRef): Action {
    return { id: this.id(), kind: 'equipment', target: ref, value: operand(value) };
  }
  timer(op: TimerOp, timer: TimerRef, presetMs?: number): Action {
    const a: Action = { id: this.id(), kind: 'timer', op, timer };
    if (presetMs !== undefined) a.presetMs = presetMs;
    return a;
  }

  build(): Project {
    return {
      info: { formatVersion: 1, id: this.projectId, name: 'test', defaultCycleMs: 10 },
      globals: this.globals,
      interfaces: this.interfaces,
      equipment: this.equipment,
      conditions: this.conditions,
      states: this.states,
      machines: this.machines.map((m) => ({
        machine: m.m,
        plan: { machine: m.m.id, nodes: [] },
      })),
      routing: { routes: [] },
    };
  }
}

function operand(value: Value | VarRef): Operand {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'kind' in value) {
    return { from: 'variable', ref: value as VarRef };
  }
  return { from: 'literal', value: value as Value };
}

export class MachineBuilder {
  readonly m: Machine;
  constructor(
    private b: ProjectBuilder,
    name: string,
    cycleMs: number,
  ) {
    this.m = {
      id: b.id(),
      name,
      cycleMs,
      instances: [],
      timers: [],
      states: [],
      conditions: [],
      initial: null,
      transitions: [],
      aborts: [],
      interrupts: [],
    };
  }

  instance(name: string, equipment: Equipment) {
    const inst = { id: this.b.id(), name, equipment: equipment.id };
    this.m.instances.push(inst);
    return {
      id: inst.id,
      sig: (iface: Interface, signal: string): VarRef => {
        const s = iface.signals.find((x) => x.name === signal);
        if (!s) throw new Error(`no signal ${signal}`);
        return { kind: 'signal', instance: inst.id, interface: iface.id, signal: s.id };
      },
    };
  }

  timer(name: string, presetMs: number): TimerRef & { kind: 'timer' } {
    const t = { id: this.b.id(), name, presetMs };
    this.m.timers.push(t);
    return { kind: 'timer', timer: t.id };
  }

  /** A state node. Pass a template, or action groups to create a role-free template. */
  state(
    name: string,
    groups: StateTemplate | { onEntry?: Action[]; steps?: Action[]; onExit?: Action[] } = {},
    bindings: Binding[] = [],
  ): string {
    const tpl = 'roles' in groups ? groups : this.b.stateTemplate(name, groups);
    const node = { id: this.b.id(), name, template: tpl.id, bindings };
    this.m.states.push(node);
    if (this.m.initial === null) this.m.initial = node.id;
    return node.id;
  }

  /** A condition instance. Pass a template, or an expression to create a role-free template. */
  cond(nameOrTemplate: string | Condition, expr?: Expr, bindings: Binding[] = []): string {
    const tpl =
      typeof nameOrTemplate === 'string'
        ? this.b.conditionTemplate(nameOrTemplate, expr ?? TRUE)
        : nameOrTemplate;
    const inst = { id: this.b.id(), template: tpl.id, bindings };
    this.m.conditions.push(inst);
    return inst.id;
  }

  initial(state: string) {
    this.m.initial = state;
  }

  trans(from: string, to: string, condition: string, priority?: number) {
    const p = priority ?? this.m.transitions.filter((t) => t.from === from).length + 1;
    this.m.transitions.push({ id: this.b.id(), from, to, condition, priority: p });
  }

  abort(condition: string, to: string) {
    this.m.aborts.push({ id: this.b.id(), condition, to });
  }

  interrupt(trigger: string, resume: string, onHold: Action[] = []) {
    this.m.interrupts.push({ id: this.b.id(), trigger, resume, onHold });
  }
}
