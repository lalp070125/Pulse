import type { Action, Expr, Operand, Project, Role, TimerRef, VarRef } from './schema';
import { typeName, valueText, type TypeSpec } from './types';

/* ----------------------------------------------------------------------------
 * What a library template (a condition or a state) can refer to, and how it reads
 * as text. Derived from the project every time: there is no second copy of the
 * variable list (SPEC 15). A template has no concrete devices; it talks about its
 * ROLES ("a motor"), which a machine binds to real instances later (SPEC 5.4).
 * -------------------------------------------------------------------------- */

export interface CatalogVar {
  ref: VarRef;
  /** Readable address: `Global.Stop`, `Pusher.ICylinder.Extended`, `Flag`. */
  text: string;
  type: TypeSpec;
  category: 'Equipment' | 'Globals';
  /** `command` / `feedback` / `param` for device signals; absent for globals and variable roles. */
  direction?: 'command' | 'feedback' | 'param';
}

/** Every variable a template with these roles can name. */
export function templateVariables(project: Project, roles: Role[]): CatalogVar[] {
  const out: CatalogVar[] = [];
  for (const g of project.globals) {
    out.push({
      ref: { kind: 'global', global: g.id },
      text: `Global.${g.name}`,
      type: g.type,
      category: 'Globals',
    });
  }
  for (const role of roles) {
    if (role.kind === 'equipment') {
      const eq = project.equipment.find((e) => e.id === role.equipment);
      for (const ifId of eq?.interfaces ?? []) {
        const iface = project.interfaces.find((i) => i.id === ifId);
        for (const s of iface?.signals ?? []) {
          out.push({
            ref: { kind: 'roleSignal', role: role.id, interface: iface!.id, signal: s.id },
            text: `${role.name}.${iface!.name}.${s.name}`,
            type: s.type,
            category: 'Equipment',
            direction: s.direction,
          });
        }
      }
    } else if (role.kind === 'variable') {
      out.push({
        ref: { kind: 'roleVar', role: role.id },
        text: role.name,
        type: role.type,
        category: 'Equipment',
      });
    }
  }
  return out;
}

/** Readable address of a reference inside a template, or null when it points at nothing. */
export function refText(project: Project, roles: Role[], ref: VarRef): string | null {
  return templateVariables(project, roles).find((v) => sameRef(v.ref, ref))?.text ?? null;
}

export function refType(project: Project, roles: Role[], ref: VarRef): TypeSpec | null {
  return templateVariables(project, roles).find((v) => sameRef(v.ref, ref))?.type ?? null;
}

export function sameRef(a: VarRef, b: VarRef): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const CMP_TEXT = { eq: '=', ne: '≠', lt: '<', le: '≤', gt: '>', ge: '≥' } as const;
const MISSING = '(missing)';

function timerText(roles: Role[], ref: TimerRef): string {
  if (ref.kind === 'roleTimer') return roles.find((r) => r.id === ref.role)?.name ?? MISSING;
  return MISSING; // a template has no machine timers; it uses timer roles
}

/** The rule as text, in the same form the compiler shows: `Pusher.ICylinder.Extended AND NOT Global.Stop`. */
export function exprText(project: Project, roles: Role[], e: Expr): string {
  const t = (x: Expr) => exprText(project, roles, x);
  const ref = (r: VarRef) => refText(project, roles, r) ?? MISSING;
  switch (e.op) {
    case 'and':
    case 'or': {
      const other = e.op === 'and' ? 'or' : 'and';
      return e.args
        .map((a) => (a.op === other ? `(${t(a)})` : t(a)))
        .join(e.op === 'and' ? ' AND ' : ' OR ');
    }
    case 'not': {
      const inner = t(e.arg);
      return `NOT ${inner.includes(' ') ? `(${inner})` : inner}`;
    }
    case 'cmp':
      return `${t(e.left)} ${CMP_TEXT[e.cmp]} ${t(e.right)}`;
    case 'var':
      return ref(e.ref);
    case 'lit':
      return valueText(e.value);
    case 'rising':
    case 'falling':
    case 'changed':
    case 'any':
    case 'all':
    case 'count':
      return `${e.op}(${ref(e.ref)})`;
    case 'inState': {
      const m = project.machines.find((x) => x.machine.id === e.machine)?.machine;
      const s = m?.states.find((x) => x.id === e.state);
      return `inState(${m?.name ?? MISSING}, ${s?.name ?? MISSING})`;
    }
    case 'timerDone':
      return `timer.done('${timerText(roles, e.timer)}')`;
    case 'timerRunning':
      return `timer.running('${timerText(roles, e.timer)}')`;
    case 'timerElapsed':
      return `timer.elapsed('${timerText(roles, e.timer)}')`;
    case 'todo':
      return 'TO DO';
  }
}

/** `IF( Pusher.ICylinder.Extended AND NOT Global.Stop )` (SPEC 5.5). */
export function conditionSummary(project: Project, roles: Role[], e: Expr): string {
  return `IF( ${exprText(project, roles, e)} )`;
}

function operandText(project: Project, roles: Role[], o: Operand): string {
  return o.from === 'literal' ? valueText(o.value) : (refText(project, roles, o.ref) ?? MISSING);
}

/** The text form of an action, as shown in the States editor (SPEC 5.6). */
export function actionText(project: Project, roles: Role[], a: Action): string {
  if (a.kind === 'timer') {
    const name = timerText(roles, a.timer);
    if (a.op === 'setPreset') return `Timer.SetPreset('${name}', ${a.presetMs ?? 0})`;
    return `Timer.${a.op[0]!.toUpperCase()}${a.op.slice(1)}('${name}')`;
  }
  const value = operandText(project, roles, a.value);
  if (a.kind === 'global') {
    const g = project.globals.find((x) => x.id === a.target);
    return `Global.Set${g?.name ?? MISSING}(${value})`;
  }
  if (a.kind === 'generic') {
    const r = roles.find((x) => x.id === a.target);
    const type = r?.kind === 'variable' ? typeName(r.type) : '?';
    return `Generic.Set[${type}](${value}) → ${r?.name ?? MISSING}`;
  }
  const text = refText(project, roles, a.target);
  if (!text) return `${MISSING}(${value})`;
  const parts = text.split('.');
  const signal = parts.pop();
  return `${parts.join('.')}.Set${signal}(${value})`;
}
