import type { Problem } from './files';
import type { SimModelSpec } from './driver';
import {
  TRANSPORTS,
  type Action,
  type Binding,
  type CmpOp,
  type ConcreteVarRef,
  type Direction,
  type Expr,
  type Machine,
  type Operand,
  type Project,
  type Role,
  type RouteDir,
  type TimerRef,
  type Transport,
  type VarRef,
} from './schema';
import {
  assignable,
  checkValue,
  cloneValue,
  defaultValue,
  isNumeric,
  typeName,
  valueText,
  valuesEqual,
  type TypeSpec,
  type Value,
} from './types';

/* ----------------------------------------------------------------------------
 * Compiler: turns the project model (IDs, templates, roles, bindings) into
 * ready-to-run machines with every reference resolved to a variable path.
 * Every problem found is named in plain language; nothing runs while any
 * error remains.
 * -------------------------------------------------------------------------- */

/** Thrown when a machine meets something it cannot handle at run time. Faults that machine only. */
export class EngineFault extends Error {}

export interface TimerState {
  name: string;
  presetMs: number;
  elapsedMs: number;
  running: boolean;
  done: boolean;
}

/** What compiled code can do while a machine runs. Implemented by the engine. */
export interface ExecContext {
  get(path: string): Value;
  write(path: string, value: Value): void;
  /** Edge detector for `path` in the running machine: value at the previous and this tick. */
  edge(path: string): { prev: Value; cur: Value };
  isActive(machineId: string, nodeId: string): boolean;
  timer(index: number): TimerState;
}

export type VarOwner = 'global' | Direction;

export interface VarInfo {
  /** Full address: `Global.BoxCount`, `Sealer.Pusher.ICylinder.Extended`. */
  path: string;
  /** Short label used inside one machine: `Pusher.ICylinder.Extended`. */
  label: string;
  type: TypeSpec;
  initial: Value;
  owner: VarOwner;
  /** Machine ID for signals; null for globals. */
  machine: string | null;
}

export interface CExpr {
  kind: 'bool' | 'num' | 'str' | 'other';
  type: TypeSpec | null;
  text: string;
  ev(ctx: ExecContext): Value;
}

export interface CCondition {
  /** Condition instance ID within the machine. */
  id: string;
  name: string;
  /** Read-only summary line: `IF( Pusher.ICylinder.Extended AND NOT Global.Stop )`. */
  summary: string;
  expr: CExpr;
  /** Terms whose values are logged with every COND event. */
  terms: CExpr[];
}

export interface CAction {
  id: string;
  /** Text form: `Conveyor.IMotor.SetRun(true)`. */
  text: string;
  /** Path of the variable written, for variable writes. */
  target?: string;
  /** Runs the action and returns the value written (or a timer's new state). */
  run(ctx: ExecContext): Value;
}

export interface CNode {
  id: string;
  name: string;
  onEntry: CAction[];
  steps: CAction[];
  onExit: CAction[];
}

export interface CTransition {
  id: string;
  to: number;
  priority: number;
  condition: CCondition;
}

export interface CMachine {
  id: string;
  name: string;
  cycleMs: number;
  timers: { id: string; name: string; presetMs: number }[];
  nodes: CNode[];
  initial: number;
  /** Per node index: outgoing transitions in the order they are checked. */
  transitionsFrom: CTransition[][];
  aborts: { id: string; condition: CCondition; to: number }[];
  interrupts: { id: string; trigger: CCondition; resume: CCondition; onHold: CAction[] }[];
  /** Every condition instance of the machine (used or not), for on-demand checks. */
  conditions: CCondition[];
  /** Variables read through edge detectors (rising/falling/changed). */
  edgePaths: string[];
  /** Feedback signals of this machine's instances (read in scan step 1). */
  inputs: string[];
  /** Command signals of this machine's instances (written in scan step 6). */
  outputs: string[];
}

export interface Route {
  read: Transport[];
  write: Transport[];
}

export interface CompiledProject {
  vars: Map<string, VarInfo>;
  machines: CMachine[];
  simModels: SimModelSpec[];
  routes: Map<string, Route>;
  problems: Problem[];
}

const CMP_TEXT: Record<CmpOp, string> = { eq: '=', ne: '≠', lt: '<', le: '≤', gt: '>', ge: '≥' };

function kindOf(t: TypeSpec): CExpr['kind'] {
  if (t.kind === 'bool') return 'bool';
  if (isNumeric(t)) return 'num';
  if (t.kind === 'string' || t.kind === 'enum') return 'str';
  return 'other';
}

function asBool(v: Value, what: string): boolean {
  if (typeof v !== 'boolean')
    throw new EngineFault(`${what} is not true/false (got ${valueText(v)})`);
  return v;
}
function asNum(v: Value, what: string): number {
  if (typeof v !== 'number') throw new EngineFault(`${what} is not a number (got ${valueText(v)})`);
  return v;
}

/** Everything one template needs to resolve its references inside one machine. */
interface Scope {
  where: string;
  machine: Machine;
  roles: Map<string, Role>;
  bindings: Map<string, Binding>;
  edgePaths: Set<string>;
}

export function compileProject(project: Project): CompiledProject {
  const problems: Problem[] = [];
  const err = (where: string, message: string) => problems.push({ level: 'error', where, message });
  const warn = (where: string, message: string) =>
    problems.push({ level: 'warning', where, message });

  const interfaces = new Map(project.interfaces.map((i) => [i.id, i]));
  const equipment = new Map(project.equipment.map((e) => [e.id, e]));
  const conditionTemplates = new Map(project.conditions.map((c) => [c.id, c]));
  const stateTemplates = new Map(project.states.map((s) => [s.id, s]));
  const machinesById = new Map(project.machines.map(({ machine }) => [machine.id, machine]));

  /* --- 1. the variable space --------------------------------------------- */
  const vars = new Map<string, VarInfo>();
  const globalPath = new Map<string, string>(); // global id → path
  const signalPath = new Map<string, string>(); // `${instance}/${interface}/${signal}` → path

  function addVar(info: VarInfo, where: string) {
    if (vars.has(info.path)) {
      err(where, `two variables have the same address ${info.path}; rename one of them`);
      return;
    }
    vars.set(info.path, info);
  }

  checkUniqueNames(project.globals, 'Globals', err);
  for (const g of project.globals) {
    const where = `Global '${g.name}'`;
    const bad = checkValue(g.type, g.default, 'default value');
    if (bad) err(where, bad);
    const path = `Global.${g.name}`;
    globalPath.set(g.id, path);
    addVar(
      {
        path,
        label: path,
        type: g.type,
        initial: bad ? defaultValue(g.type) : g.default,
        owner: 'global',
        machine: null,
      },
      where,
    );
  }

  for (const i of project.interfaces) {
    checkUniqueNames(i.signals, `Interface '${i.name}'`, err);
    for (const s of i.signals) {
      if (s.default !== undefined) {
        const bad = checkValue(s.type, s.default, 'default value');
        if (bad) err(`Interface '${i.name}' › signal '${s.name}'`, bad);
      }
    }
  }
  for (const e of project.equipment) {
    for (const ifId of e.interfaces) {
      if (!interfaces.has(ifId))
        err(`Equipment '${e.name}'`, `uses an interface that does not exist (${ifId})`);
    }
  }

  checkUniqueNames(
    project.machines.map((m) => m.machine),
    'Machines',
    err,
  );
  for (const { machine: m } of project.machines) {
    const where = `Machine '${m.name}'`;
    if (m.name === 'Global') err(where, `the name "Global" is reserved`);
    checkUniqueNames(m.instances, `${where} › instances`, err);
    for (const inst of m.instances) {
      const eq = equipment.get(inst.equipment);
      if (!eq) {
        err(
          `${where} › instance '${inst.name}'`,
          `its equipment type does not exist (${inst.equipment})`,
        );
        continue;
      }
      for (const ifId of eq.interfaces) {
        const iface = interfaces.get(ifId);
        if (!iface) continue;
        for (const s of iface.signals) {
          const path = `${m.name}.${inst.name}.${iface.name}.${s.name}`;
          signalPath.set(`${inst.id}/${iface.id}/${s.id}`, path);
          const okDefault = s.default !== undefined && checkValue(s.type, s.default) === null;
          addVar(
            {
              path,
              label: `${inst.name}.${iface.name}.${s.name}`,
              type: s.type,
              initial: okDefault ? (s.default as Value) : defaultValue(s.type),
              owner: s.direction,
              machine: m.id,
            },
            `${where} › instance '${inst.name}'`,
          );
        }
      }
    }
  }

  /* --- 2. reference resolution ------------------------------------------- */

  function resolveConcrete(ref: ConcreteVarRef, machine: Machine, where: string): VarInfo | null {
    if (ref.kind === 'global') {
      const path = globalPath.get(ref.global);
      if (!path) {
        err(where, `refers to a global that does not exist (${ref.global})`);
        return null;
      }
      return vars.get(path) ?? null;
    }
    const inst = machine.instances.find((i) => i.id === ref.instance);
    if (!inst) {
      err(
        where,
        `refers to an instance that is not in machine '${machine.name}' (${ref.instance})`,
      );
      return null;
    }
    const path = signalPath.get(`${ref.instance}/${ref.interface}/${ref.signal}`);
    if (!path) {
      err(where, `refers to a signal that instance '${inst.name}' does not have`);
      return null;
    }
    return vars.get(path) ?? null;
  }

  function roleOf(scope: Scope, roleId: string, kind: Role['kind']): Role | null {
    const role = scope.roles.get(roleId);
    if (!role) {
      err(scope.where, `uses a role that the template does not declare (${roleId})`);
      return null;
    }
    if (role.kind !== kind) {
      err(scope.where, `role '${role.name}' is a ${role.kind} role, but is used as a ${kind} role`);
      return null;
    }
    return role;
  }

  function bindingOf(scope: Scope, role: Role): Binding | null {
    const b = scope.bindings.get(role.id);
    if (!b) {
      err(
        scope.where,
        `role '${role.name}' is not bound — pick what it stands for in this machine`,
      );
      return null;
    }
    return b;
  }

  function resolveVar(ref: VarRef, scope: Scope): VarInfo | null {
    switch (ref.kind) {
      case 'global':
      case 'signal':
        return resolveConcrete(ref, scope.machine, scope.where);
      case 'roleSignal': {
        const role = roleOf(scope, ref.role, 'equipment');
        if (!role || role.kind !== 'equipment') return null;
        const b = bindingOf(scope, role);
        if (!b) return null;
        if (b.kind !== 'instance') {
          err(scope.where, `role '${role.name}' must be bound to an instance`);
          return null;
        }
        const inst = scope.machine.instances.find((i) => i.id === b.instance);
        if (!inst) {
          err(
            scope.where,
            `role '${role.name}' is bound to an instance that is not in this machine`,
          );
          return null;
        }
        if (inst.equipment !== role.equipment) {
          const want = equipment.get(role.equipment)?.name ?? role.equipment;
          err(
            scope.where,
            `role '${role.name}' needs a ${want}, but '${inst.name}' is a different type`,
          );
          return null;
        }
        return resolveConcrete(
          { kind: 'signal', instance: inst.id, interface: ref.interface, signal: ref.signal },
          scope.machine,
          scope.where,
        );
      }
      case 'roleVar': {
        const role = roleOf(scope, ref.role, 'variable');
        if (!role || role.kind !== 'variable') return null;
        const b = bindingOf(scope, role);
        if (!b) return null;
        if (b.kind !== 'variable') {
          err(scope.where, `role '${role.name}' must be bound to a variable`);
          return null;
        }
        const v = resolveConcrete(b.ref, scope.machine, scope.where);
        if (v && typeName(v.type) !== typeName(role.type)) {
          err(
            scope.where,
            `role '${role.name}' needs a ${typeName(role.type)} but is bound to ${v.label} (${typeName(v.type)})`,
          );
          return null;
        }
        return v;
      }
    }
  }

  function resolveTimer(ref: TimerRef, scope: Scope): number | null {
    let timerId: string;
    if (ref.kind === 'timer') timerId = ref.timer;
    else {
      const role = roleOf(scope, ref.role, 'timer');
      if (!role) return null;
      const b = bindingOf(scope, role);
      if (!b) return null;
      if (b.kind !== 'timer') {
        err(scope.where, `role '${role.name}' must be bound to a timer`);
        return null;
      }
      timerId = b.timer;
    }
    const index = scope.machine.timers.findIndex((t) => t.id === timerId);
    if (index < 0) {
      err(scope.where, `refers to a timer that is not in machine '${scope.machine.name}'`);
      return null;
    }
    return index;
  }

  /* --- 3. expressions ----------------------------------------------------- */

  function compileExpr(e: Expr, scope: Scope, terms: CExpr[]): CExpr | null {
    switch (e.op) {
      case 'and':
      case 'or': {
        const args = e.args.map((a) => compileExpr(a, scope, terms));
        if (args.some((a) => !a)) return null;
        const ok = args as CExpr[];
        for (const a of ok) {
          if (a.kind !== 'bool')
            err(
              scope.where,
              `"${a.text}" is not true/false, so it cannot be used with ${e.op.toUpperCase()}`,
            );
        }
        const word = e.op === 'and' ? ' AND ' : ' OR ';
        // Bracket a nested AND inside OR (and vice versa) so the summary reads unambiguously.
        const other = e.op === 'and' ? 'or' : 'and';
        const text = ok
          .map((a, i) => (e.args[i]!.op === other ? `(${a.text})` : a.text))
          .join(word);
        const isAnd = e.op === 'and';
        return {
          kind: 'bool',
          type: { kind: 'bool' },
          text,
          ev: (ctx) => {
            for (const a of ok) {
              const v = asBool(a.ev(ctx), a.text);
              if (isAnd && !v) return false;
              if (!isAnd && v) return true;
            }
            return isAnd;
          },
        };
      }
      case 'not': {
        const a = compileExpr(e.arg, scope, terms);
        if (!a) return null;
        if (a.kind !== 'bool')
          err(scope.where, `"${a.text}" is not true/false, so NOT cannot be applied`);
        const inner = a.text.includes(' ') ? `(${a.text})` : a.text;
        return {
          kind: 'bool',
          type: { kind: 'bool' },
          text: `NOT ${inner}`,
          ev: (ctx) => !asBool(a.ev(ctx), a.text),
        };
      }
      case 'cmp': {
        const l = compileExpr(e.left, scope, terms);
        const r = compileExpr(e.right, scope, terms);
        if (!l || !r) return null;
        const text = `${l.text} ${CMP_TEXT[e.cmp]} ${r.text}`;
        const ordered = e.cmp !== 'eq' && e.cmp !== 'ne';
        if (ordered && (l.kind !== 'num' || r.kind !== 'num')) {
          err(scope.where, `"${text}": only numbers can be compared with ${CMP_TEXT[e.cmp]}`);
        } else if (!ordered && l.kind !== r.kind) {
          err(scope.where, `"${text}": the two sides are different kinds of value`);
        }
        // An enum compared with a literal: the literal must be one of its values.
        for (const [a, b] of [
          [l, e.right],
          [r, e.left],
        ] as const) {
          if (a.type?.kind === 'enum' && b.op === 'lit') {
            const bad = checkValue(a.type, b.value, 'the value');
            if (bad) err(scope.where, `"${text}": ${bad}`);
          }
        }
        const cmp = e.cmp;
        return {
          kind: 'bool',
          type: { kind: 'bool' },
          text,
          ev: (ctx) => {
            const a = l.ev(ctx);
            const b = r.ev(ctx);
            if (cmp === 'eq') return valuesEqual(a, b);
            if (cmp === 'ne') return !valuesEqual(a, b);
            const x = asNum(a, l.text);
            const y = asNum(b, r.text);
            if (cmp === 'lt') return x < y;
            if (cmp === 'le') return x <= y;
            if (cmp === 'gt') return x > y;
            return x >= y;
          },
        };
      }
      case 'var': {
        const v = resolveVar(e.ref, scope);
        if (!v) return null;
        const path = v.path;
        const c: CExpr = {
          kind: kindOf(v.type),
          type: v.type,
          text: v.label,
          ev: (ctx) => ctx.get(path),
        };
        terms.push(c);
        return c;
      }
      case 'lit': {
        const v = e.value;
        const kind: CExpr['kind'] =
          typeof v === 'boolean'
            ? 'bool'
            : typeof v === 'number'
              ? 'num'
              : typeof v === 'string'
                ? 'str'
                : 'other';
        const type: TypeSpec | null =
          kind === 'bool'
            ? { kind: 'bool' }
            : kind === 'num'
              ? { kind: 'real' }
              : kind === 'str'
                ? { kind: 'string' }
                : null;
        return { kind, type, text: valueText(v), ev: () => v };
      }
      case 'rising':
      case 'falling':
      case 'changed': {
        const v = resolveVar(e.ref, scope);
        if (!v) return null;
        if (e.op !== 'changed' && v.type.kind !== 'bool') {
          err(
            scope.where,
            `${e.op}(${v.label}): only true/false signals have rising and falling edges`,
          );
        }
        scope.edgePaths.add(v.path);
        const path = v.path;
        const op = e.op;
        const c: CExpr = {
          kind: 'bool',
          type: { kind: 'bool' },
          text: `${op}(${v.label})`,
          ev: (ctx) => {
            const { prev, cur } = ctx.edge(path);
            if (op === 'rising') return cur === true && prev === false;
            if (op === 'falling') return cur === false && prev === true;
            return !valuesEqual(prev, cur);
          },
        };
        terms.push(c);
        return c;
      }
      case 'any':
      case 'all':
      case 'count': {
        const v = resolveVar(e.ref, scope);
        if (!v) return null;
        if (v.type.kind !== 'array' || v.type.of.kind !== 'bool') {
          err(scope.where, `${e.op}(${v.label}): needs an array of true/false values`);
        }
        const path = v.path;
        const op = e.op;
        const c: CExpr = {
          kind: op === 'count' ? 'num' : 'bool',
          type: op === 'count' ? { kind: 'int' } : { kind: 'bool' },
          text: `${op}(${v.label})`,
          ev: (ctx) => {
            const arr = ctx.get(path);
            if (!Array.isArray(arr)) throw new EngineFault(`${v.label} is not an array`);
            if (op === 'any') return arr.some((x) => x === true);
            if (op === 'all') return arr.every((x) => x === true);
            return arr.filter((x) => x === true).length;
          },
        };
        terms.push(c);
        return c;
      }
      case 'inState': {
        const m = machinesById.get(e.machine);
        const node = m?.states.find((s) => s.id === e.state);
        if (!m || !node) {
          err(scope.where, `inState(…) refers to a machine or state that does not exist`);
          return null;
        }
        const machineId = m.id;
        const nodeId = node.id;
        const c: CExpr = {
          kind: 'bool',
          type: { kind: 'bool' },
          text: `inState(${m.name}, ${node.name})`,
          ev: (ctx) => ctx.isActive(machineId, nodeId),
        };
        terms.push(c);
        return c;
      }
      case 'timerDone':
      case 'timerRunning':
      case 'timerElapsed': {
        const index = resolveTimer(e.timer, scope);
        if (index === null) return null;
        const name = scope.machine.timers[index]!.name;
        const op = e.op;
        const field = op === 'timerDone' ? 'done' : op === 'timerRunning' ? 'running' : 'elapsed';
        const c: CExpr = {
          kind: op === 'timerElapsed' ? 'num' : 'bool',
          type: op === 'timerElapsed' ? { kind: 'duration' } : { kind: 'bool' },
          text: `timer.${field}('${name}')`,
          ev: (ctx) => {
            const t = ctx.timer(index);
            return op === 'timerDone' ? t.done : op === 'timerRunning' ? t.running : t.elapsedMs;
          },
        };
        terms.push(c);
        return c;
      }
    }
  }

  /* --- 4. actions --------------------------------------------------------- */

  function compileOperand(
    op: Operand,
    target: VarInfo,
    scope: Scope,
  ): { text: string; ev: (ctx: ExecContext) => Value } | null {
    if (op.from === 'literal') {
      // A whole number written into a real is fine.
      const bad = checkValue(target.type, op.value, `the value for ${target.label}`);
      if (bad) {
        err(scope.where, bad);
        return null;
      }
      const v = op.value;
      return { text: valueText(v), ev: () => cloneValue(v) };
    }
    const src = resolveVar(op.ref, scope);
    if (!src) return null;
    if (!assignable(src.type, target.type)) {
      err(
        scope.where,
        `cannot write ${src.label} (${typeName(src.type)}) into ${target.label} (${typeName(target.type)})`,
      );
      return null;
    }
    const path = src.path;
    return { text: src.label, ev: (ctx) => cloneValue(ctx.get(path)) };
  }

  function writable(target: VarInfo, scope: Scope): boolean {
    if (target.owner === 'feedback') {
      err(
        scope.where,
        `writes to ${target.label}, which is a feedback signal. Feedback is read from the machine, never written by the logic`,
      );
      return false;
    }
    return true;
  }

  function compileAction(a: Action, scope: Scope): CAction | null {
    if (a.kind === 'timer') {
      const index = resolveTimer(a.timer, scope);
      if (index === null) return null;
      const name = scope.machine.timers[index]!.name;
      const opName = a.op === 'setPreset' ? 'SetPreset' : a.op[0]!.toUpperCase() + a.op.slice(1);
      if (a.op === 'setPreset' && a.presetMs === undefined) {
        err(scope.where, `Timer.SetPreset('${name}') needs a preset in milliseconds`);
        return null;
      }
      const op = a.op;
      const preset = a.presetMs ?? 0;
      return {
        id: a.id,
        text:
          op === 'setPreset'
            ? `Timer.SetPreset('${name}', ${preset})`
            : `Timer.${opName}('${name}')`,
        run: (ctx) => {
          const t = ctx.timer(index);
          switch (op) {
            case 'start':
              if (!t.done) t.running = true;
              break;
            case 'stop':
              t.running = false;
              break;
            case 'restart':
              t.elapsedMs = 0;
              t.done = false;
              t.running = true;
              break;
            case 'reset':
              t.elapsedMs = 0;
              t.done = false;
              t.running = false;
              break;
            case 'setPreset':
              t.presetMs = preset;
              if (t.elapsedMs >= preset && (t.running || t.done)) {
                t.elapsedMs = preset;
                t.done = true;
                t.running = false;
              }
              break;
          }
          return { elapsedMs: t.elapsedMs, running: t.running, done: t.done };
        },
      };
    }

    let target: VarInfo | null;
    let textHead: string;
    if (a.kind === 'equipment') {
      if (a.target.kind === 'global' || a.target.kind === 'roleVar') {
        err(scope.where, `an Equipment action must target a device signal`);
        return null;
      }
      target = resolveVar(a.target, scope);
      if (!target) return null;
      const parts = target.label.split('.');
      const signal = parts.pop();
      textHead = `${parts.join('.')}.Set${signal}`;
    } else if (a.kind === 'global') {
      target = resolveVar({ kind: 'global', global: a.target }, scope);
      if (!target) return null;
      textHead = `Global.Set${target.label.slice('Global.'.length)}`;
    } else {
      target = resolveVar({ kind: 'roleVar', role: a.target }, scope);
      if (!target) return null;
      textHead = `Generic.Set[${typeName(target.type)}]`;
    }
    if (!writable(target, scope)) return null;
    const value = compileOperand(a.value, target, scope);
    if (!value) return null;
    const path = target.path;
    const suffix = a.kind === 'generic' ? ` → ${target.label}` : '';
    return {
      id: a.id,
      text: `${textHead}(${value.text})${suffix}`,
      target: path,
      run: (ctx) => {
        const v = value.ev(ctx);
        ctx.write(path, v);
        return v;
      },
    };
  }

  /* --- 5. machines -------------------------------------------------------- */

  function scopeFor(
    machine: Machine,
    where: string,
    roles: Role[],
    bindings: Binding[],
    edgePaths: Set<string>,
  ): Scope {
    const roleMap = new Map(roles.map((r) => [r.id, r]));
    const bindingMap = new Map<string, Binding>();
    for (const b of bindings) {
      if (!roleMap.has(b.role))
        warn(where, `has a binding for a role the template no longer has (${b.role})`);
      bindingMap.set(b.role, b);
    }
    // Every declared role must be bound, even if no action uses it yet.
    for (const r of roles) {
      if (!bindingMap.has(r.id)) {
        err(where, `role '${r.name}' is not bound — pick what it stands for in this machine`);
      }
    }
    return { where, machine, roles: roleMap, bindings: bindingMap, edgePaths };
  }

  const machines: CMachine[] = [];
  for (const { machine: m } of project.machines) {
    const mWhere = `Machine '${m.name}'`;
    const edgePaths = new Set<string>();
    checkUniqueNames(m.states, `${mWhere} › states`, err);
    checkUniqueNames(m.timers, `${mWhere} › timers`, err);

    const nodeIndex = new Map(m.states.map((s, i) => [s.id, i]));
    const nodes: CNode[] = m.states.map((node) => {
      const where = `${mWhere} › state '${node.name}'`;
      const tpl = stateTemplates.get(node.template);
      if (!tpl) {
        err(where, `uses a state template that does not exist (${node.template})`);
        return { id: node.id, name: node.name, onEntry: [], steps: [], onExit: [] };
      }
      const scope = scopeFor(m, where, tpl.roles, node.bindings, edgePaths);
      const actions = (list: Action[]) =>
        list.map((a) => compileAction(a, scope)).filter((a): a is CAction => a !== null);
      const onEntry = actions(tpl.onEntry);
      const steps = actions(tpl.steps);
      const onExit = actions(tpl.onExit);
      checkTwoWriters(where, [...onEntry, ...steps], warn);
      return { id: node.id, name: node.name, onEntry, steps, onExit };
    });

    const condCache = new Map<string, CCondition | null>();
    const conditionInstance = (id: string, usedBy: string): CCondition | null => {
      if (condCache.has(id)) return condCache.get(id)!;
      const inst = m.conditions.find((c) => c.id === id);
      let result: CCondition | null = null;
      if (!inst) {
        err(usedBy, `uses a condition that is not in machine '${m.name}' (${id})`);
      } else {
        const tpl = conditionTemplates.get(inst.template);
        if (!tpl) {
          err(usedBy, `uses a condition template that does not exist (${inst.template})`);
        } else {
          const where = `${mWhere} › condition '${tpl.name}'`;
          const scope = scopeFor(m, where, tpl.roles, inst.bindings, edgePaths);
          const terms: CExpr[] = [];
          const expr = compileExpr(tpl.expr, scope, terms);
          if (expr && expr.kind !== 'bool') err(where, `the rule "${expr.text}" is not true/false`);
          if (expr) {
            result = { id: inst.id, name: tpl.name, summary: `IF( ${expr.text} )`, expr, terms };
          }
        }
      }
      condCache.set(id, result);
      return result;
    };

    const transitionsFrom: CTransition[][] = nodes.map(() => []);
    m.transitions.forEach((t) => {
      const where = `${mWhere} › transition`;
      const from = nodeIndex.get(t.from);
      const to = nodeIndex.get(t.to);
      if (from === undefined || to === undefined) {
        err(where, `starts or ends at a state that is not in this machine`);
        return;
      }
      const label = `${mWhere} › transition ${nodes[from]!.name} → ${nodes[to]!.name}`;
      const condition = conditionInstance(t.condition, label);
      if (!condition) return;
      transitionsFrom[from]!.push({ id: t.id, to, priority: t.priority, condition });
    });
    transitionsFrom.forEach((list, i) => {
      // Ascending priority; equal priorities keep drawing order (stable sort).
      list.sort((a, b) => a.priority - b.priority);
      for (let k = 1; k < list.length; k++) {
        if (list[k]!.priority === list[k - 1]!.priority) {
          warn(
            `${mWhere} › state '${nodes[i]!.name}'`,
            `two transitions share priority ${list[k]!.priority}; the one drawn first is checked first`,
          );
        }
      }
    });

    const aborts: CMachine['aborts'] = [];
    for (const a of m.aborts) {
      const to = nodeIndex.get(a.to);
      if (to === undefined) {
        err(`${mWhere} › abort`, `goes to a state that is not in this machine`);
        continue;
      }
      const condition = conditionInstance(a.condition, `${mWhere} › abort`);
      if (condition) aborts.push({ id: a.id, condition, to });
    }

    const interrupts: CMachine['interrupts'] = [];
    for (const it of m.interrupts) {
      const where = `${mWhere} › interrupt`;
      const trigger = conditionInstance(it.trigger, `${where} trigger`);
      const resume = conditionInstance(it.resume, `${where} resume`);
      const scope = scopeFor(m, `${where} hold actions`, [], [], edgePaths);
      const onHold = it.onHold
        .map((a) => compileAction(a, scope))
        .filter((a): a is CAction => a !== null);
      if (trigger && resume) interrupts.push({ id: it.id, trigger, resume, onHold });
    }

    // Compile every condition instance, used or not, so all of them are validated.
    const conditions = m.conditions
      .map((ci) => conditionInstance(ci.id, mWhere))
      .filter((c): c is CCondition => c !== null);

    let initial = -1;
    if (m.initial === null) err(mWhere, `the Init node is not connected to a first state`);
    else {
      initial = nodeIndex.get(m.initial) ?? -1;
      if (initial < 0) err(mWhere, `the Init node points at a state that is not in this machine`);
    }

    const own = [...vars.values()].filter((v) => v.machine === m.id);
    machines.push({
      id: m.id,
      name: m.name,
      cycleMs: m.cycleMs,
      timers: m.timers.map((t) => ({ ...t })),
      nodes,
      initial,
      transitionsFrom,
      aborts,
      interrupts,
      conditions,
      edgePaths: [...edgePaths],
      inputs: own.filter((v) => v.owner === 'feedback').map((v) => v.path),
      outputs: own.filter((v) => v.owner === 'command').map((v) => v.path),
    });
  }

  /* --- 6. simulated device models ---------------------------------------- */
  const simModels: SimModelSpec[] = [];
  for (const { machine: m } of project.machines) {
    for (const inst of m.instances) {
      const model = equipment.get(inst.equipment)?.simModel;
      if (!model) continue;
      const where = `Equipment '${equipment.get(inst.equipment)!.name}' › simulation model`;
      const p = (sel: { interface: string; signal: string }) => {
        const path = signalPath.get(`${inst.id}/${sel.interface}/${sel.signal}`);
        if (!path) err(where, `refers to a signal the equipment does not have`);
        return path ?? '';
      };
      if (model.kind === 'follow') {
        simModels.push({
          kind: 'follow',
          command: p(model.command),
          feedback: p(model.feedback),
          delayMs: model.delayMs,
        });
      } else {
        simModels.push({
          kind: 'cylinder',
          command: p(model.command),
          extended: p(model.extended),
          retracted: p(model.retracted),
          travelMs: model.travelMs,
        });
      }
    }
  }

  /* --- 7. routing ---------------------------------------------------------- */
  const routes = new Map<string, Route>();
  for (const v of vars.values()) {
    if (v.owner === 'feedback') routes.set(v.path, { read: ['sim'], write: [] });
    else if (v.owner === 'command') routes.set(v.path, { read: [], write: ['sim'] });
    else routes.set(v.path, { read: [], write: [] });
  }
  for (const r of project.routing.routes) {
    const where = 'Routing';
    let path: string | undefined;
    if (r.ref.kind === 'global') path = globalPath.get(r.ref.global);
    else path = signalPath.get(`${r.ref.instance}/${r.ref.interface}/${r.ref.signal}`);
    if (!path) {
      err(where, `has a row for a variable that does not exist`);
      continue;
    }
    const route: Route = { read: [], write: [] };
    for (const t of TRANSPORTS) {
      const dir: RouteDir = r[t];
      if (dir === 'read') route.read.push(t);
      if (dir === 'write') route.write.push(t);
    }
    if (vars.get(path)!.owner === 'command' && route.read.length > 0) {
      err(where, `${path} is a command signal; it can only be written to a transport`);
    }
    if (route.read.length > 1) err(where, `${path} is read from more than one transport`);
    routes.set(path, route);
  }

  return { vars, machines, simModels, routes, problems };
}

function checkUniqueNames(
  items: { name: string }[],
  where: string,
  err: (where: string, message: string) => void,
) {
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.name)) err(where, `the name '${it.name}' is used twice`);
    seen.add(it.name);
  }
}

/** Two actions of one state writing the same variable (SPEC 6.5). */
function checkTwoWriters(
  where: string,
  actions: CAction[],
  warn: (where: string, message: string) => void,
) {
  const seen = new Set<string>();
  for (const a of actions) {
    if (!a.target) continue;
    if (seen.has(a.target)) warn(where, `${a.target} is written by two actions in this state`);
    seen.add(a.target);
  }
}
