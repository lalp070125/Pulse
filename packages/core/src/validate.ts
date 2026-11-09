import { actionText, exprText } from './catalog';
import { compileProject } from './compile';
import type { Problem } from './files';
import type { Machine, Project } from './schema';

/* ----------------------------------------------------------------------------
 * The continuous validator (SPEC 6.5). It lists every problem in plain language
 * with a place to go to. The compiler already finds unbound roles, type mismatches,
 * duplicate priorities, two writers of one command and missing references inside a
 * machine; this adds what only the whole picture shows (unreachable states, states
 * with no way out, library items pointing at things that were deleted) and works
 * out where each problem lives.
 * -------------------------------------------------------------------------- */

export type LocatorKind = 'global' | 'interface' | 'equipment' | 'condition' | 'state' | 'machine';

/** Where to take the user: the editor of this kind, scrolled to this entity. */
export interface Locator {
  kind: LocatorKind;
  id: string;
}

export interface Issue extends Problem {
  at?: Locator;
}

const WORD: Record<string, LocatorKind> = {
  Machine: 'machine',
  Global: 'global',
  Equipment: 'equipment',
  Interface: 'interface',
};

/** Reads "Machine 'Sealer' › state 'Push'" and finds the thing named first. Names are unique per kind. */
function locate(project: Project, where: string): Locator | undefined {
  const m = /^(Machine|Global|Equipment|Interface) '([^']+)'/.exec(where);
  if (!m) return undefined;
  const kind = WORD[m[1]!]!;
  const name = m[2]!;
  const list =
    kind === 'machine'
      ? project.machines.map((x) => x.machine)
      : kind === 'global'
        ? project.globals
        : kind === 'equipment'
          ? project.equipment
          : project.interfaces;
  const found = list.find((x) => x.name === name);
  return found ? { kind, id: found.id } : undefined;
}

/** The text helpers print "(missing)" where a reference points at nothing. */
function hasMissing(texts: string[]): boolean {
  return texts.some((t) => t.includes('(missing)'));
}

function reachability(m: Machine): { reachable: Set<string>; outgoing: Set<string> } {
  const out = new Map<string, string[]>();
  for (const t of m.transitions) out.set(t.from, [...(out.get(t.from) ?? []), t.to]);
  const reachable = new Set<string>();
  const queue: string[] = [];
  const add = (id: string | null) => {
    if (id && !reachable.has(id)) {
      reachable.add(id);
      queue.push(id);
    }
  };
  add(m.initial);
  // An abort can be taken from any state, so its target is reachable whenever the machine runs.
  for (const a of m.aborts) add(a.to);
  while (queue.length) for (const to of out.get(queue.pop()!) ?? []) add(to);
  return { reachable, outgoing: new Set(m.transitions.map((t) => t.from)) };
}

export function validateProject(project: Project): Issue[] {
  const issues: Issue[] = compileProject(project).problems.map((p) => ({
    ...p,
    at: locate(project, p.where),
  }));

  // Library items that still point at something that no longer exists.
  for (const c of project.conditions) {
    if (hasMissing([exprText(project, c.roles, c.expr)])) {
      issues.push({
        level: 'error',
        where: `Condition '${c.name}'`,
        message: `refers to something that no longer exists (shown as "(missing)"); pick it again`,
        at: { kind: 'condition', id: c.id },
      });
    }
    for (const r of c.roles) {
      if (r.kind === 'equipment' && !project.equipment.some((e) => e.id === r.equipment)) {
        issues.push({
          level: 'error',
          where: `Condition '${c.name}'`,
          message: `role '${r.name}' needs an equipment type that no longer exists`,
          at: { kind: 'condition', id: c.id },
        });
      }
    }
  }
  for (const s of project.states) {
    const texts = [...s.onEntry, ...s.steps, ...s.onExit].map((a) =>
      actionText(project, s.roles, a),
    );
    if (hasMissing(texts)) {
      issues.push({
        level: 'error',
        where: `State '${s.name}'`,
        message: `has an action that refers to something that no longer exists (shown as "(missing)")`,
        at: { kind: 'state', id: s.id },
      });
    }
    for (const r of s.roles) {
      if (r.kind === 'equipment' && !project.equipment.some((e) => e.id === r.equipment)) {
        issues.push({
          level: 'error',
          where: `State '${s.name}'`,
          message: `role '${r.name}' needs an equipment type that no longer exists`,
          at: { kind: 'state', id: s.id },
        });
      }
    }
  }

  // Shape of each machine's state graph.
  for (const { machine: m } of project.machines) {
    const at: Locator = { kind: 'machine', id: m.id };
    const where = `Machine '${m.name}'`;
    for (const t of m.transitions) {
      if (!m.conditions.some((c) => c.id === t.condition)) {
        const from = m.states.find((s) => s.id === t.from)?.name ?? '?';
        const to = m.states.find((s) => s.id === t.to)?.name ?? '?';
        issues.push({
          level: 'error',
          where,
          message: `the transition ${from} → ${to} has no condition`,
          at,
        });
      }
    }
    if (m.initial === null) continue; // already reported by the compiler
    const { reachable, outgoing } = reachability(m);
    for (const s of m.states) {
      if (!reachable.has(s.id)) {
        issues.push({
          level: 'warning',
          where: `${where} › state '${s.name}'`,
          message: `is unreachable: nothing leads to it from Init`,
          at,
        });
      } else if (!outgoing.has(s.id)) {
        issues.push({
          level: 'warning',
          where: `${where} › state '${s.name}'`,
          message: `has no way out: no transition leaves it`,
          at,
        });
      }
    }
  }

  // Errors first, then warnings, each in the order found.
  return [
    ...issues.filter((i) => i.level === 'error'),
    ...issues.filter((i) => i.level === 'warning'),
  ];
}
