import type { Action, Binding, Expr, Machine, Operand, Project, Role, VarRef } from './schema';

/* ----------------------------------------------------------------------------
 * Focused signals (SPEC 7.2): clicking a state shows exactly the signals that
 * state and its transitions touch, resolved through the machine's bindings to
 * real addresses. Nobody builds a watch list by hand.
 * -------------------------------------------------------------------------- */

export interface Focus {
  /** Variable addresses, in a sensible order: what the state writes, then what its exits read. */
  paths: string[];
  /** Timers (by name) the state starts or its exits wait on. */
  timers: string[];
  /** Other machines whose state its exits look at (inState). */
  machines: string[];
}

function resolver(project: Project, m: Machine, roles: Role[], bindings: Binding[]) {
  const inst = (id: string) => m.instances.find((i) => i.id === id);
  const iface = (id: string) => project.interfaces.find((i) => i.id === id);
  const signalPath = (instId: string, ifId: string, sigId: string): string | null => {
    const i = inst(instId);
    const f = iface(ifId);
    const s = f?.signals.find((x) => x.id === sigId);
    return i && f && s ? `${m.name}.${i.name}.${f.name}.${s.name}` : null;
  };
  const globalPath = (id: string) => {
    const g = project.globals.find((x) => x.id === id);
    return g ? `Global.${g.name}` : null;
  };
  const bound = (roleId: string) => bindings.find((b) => b.role === roleId);
  const ref = (r: VarRef): string | null => {
    switch (r.kind) {
      case 'global':
        return globalPath(r.global);
      case 'signal':
        return signalPath(r.instance, r.interface, r.signal);
      case 'roleSignal': {
        const b = bound(r.role);
        return b?.kind === 'instance' ? signalPath(b.instance, r.interface, r.signal) : null;
      }
      case 'roleVar': {
        const b = bound(r.role);
        if (b?.kind !== 'variable') return null;
        return b.ref.kind === 'global'
          ? globalPath(b.ref.global)
          : signalPath(b.ref.instance, b.ref.interface, b.ref.signal);
      }
    }
  };
  const timer = (t: { kind: 'timer'; timer: string } | { kind: 'roleTimer'; role: string }) => {
    const id =
      t.kind === 'timer'
        ? t.timer
        : (() => {
            const b = bound(t.role);
            return b?.kind === 'timer' ? b.timer : null;
          })();
    return m.timers.find((x) => x.id === id)?.name ?? null;
  };
  void roles;
  return { ref, timer, globalPath };
}

export function focusedSignals(project: Project, machineId: string, nodeId: string): Focus {
  const entry = project.machines.find((e) => e.machine.id === machineId);
  const out: Focus = { paths: [], timers: [], machines: [] };
  if (!entry) return out;
  const m = entry.machine;
  const node = m.states.find((s) => s.id === nodeId);
  if (!node) return out;
  const add = (list: string[], v: string | null) => {
    if (v && !list.includes(v)) list.push(v);
  };

  // What the state writes (and reads as operand values).
  const tpl = project.states.find((t) => t.id === node.template);
  if (tpl) {
    const r = resolver(project, m, tpl.roles, node.bindings);
    const operand = (o: Operand) =>
      o.from === 'variable' ? add(out.paths, r.ref(o.ref)) : undefined;
    const action = (a: Action) => {
      if (a.kind === 'equipment') {
        add(out.paths, r.ref(a.target));
        operand(a.value);
      } else if (a.kind === 'global') {
        add(out.paths, r.globalPath(a.target));
        operand(a.value);
      } else if (a.kind === 'generic') {
        add(out.paths, r.ref({ kind: 'roleVar', role: a.target }));
        operand(a.value);
      } else if (a.kind === 'timer') {
        add(out.timers, r.timer(a.timer));
      }
    };
    [...tpl.onEntry, ...tpl.steps, ...tpl.onExit].forEach(action);
  }

  // What its transitions (and the machine's aborts) read.
  const conditionIds = [
    ...m.transitions.filter((t) => t.from === nodeId).map((t) => t.condition),
    ...m.aborts.map((a) => a.condition),
  ];
  for (const cid of conditionIds) {
    const ci = m.conditions.find((c) => c.id === cid);
    const ct = ci && project.conditions.find((t) => t.id === ci.template);
    if (!ci || !ct) continue;
    const r = resolver(project, m, ct.roles, ci.bindings);
    const walk = (e: Expr): void => {
      switch (e.op) {
        case 'and':
        case 'or':
          return e.args.forEach(walk);
        case 'not':
          return walk(e.arg);
        case 'cmp':
          walk(e.left);
          return walk(e.right);
        case 'var':
        case 'rising':
        case 'falling':
        case 'changed':
        case 'any':
        case 'all':
        case 'count':
          return add(out.paths, r.ref(e.ref));
        case 'timerDone':
        case 'timerRunning':
        case 'timerElapsed':
          return add(out.timers, r.timer(e.timer));
        case 'inState': {
          const other = project.machines.find((x) => x.machine.id === e.machine)?.machine;
          return add(out.machines, other?.name ?? null);
        }
        default:
          return;
      }
    };
    walk(ct.expr);
  }
  return out;
}
