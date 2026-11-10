import type { Action, Condition, Machine, Plan, PlanCond, Project, StateTemplate } from './schema';

/* ----------------------------------------------------------------------------
 * The Planner's model (SPEC 6.3): every edit the canvas can make, as pure
 * functions on a project draft. No clock, no randomness: new IDs come from the
 * caller.
 *
 * One rule keeps the two files apart. Anything fully real (both ends are real
 * states, the condition is a real condition instance of the machine) lives in
 * machine.json, which is what the engine runs. Everything else is a placeholder
 * and lives in plan.json, which the engine and the validator never read.
 * `write()` re-applies that rule after every edit.
 * -------------------------------------------------------------------------- */

export type NewId = () => string;
type Entry = Project['machines'][number];
type Placeholders = NonNullable<Plan['placeholders']>;

export interface DrawWire {
  id: string;
  from: string;
  to: string;
  priority: number;
  condition: PlanCond | null;
}
export interface DrawAbort {
  id: string;
  condition: PlanCond | null;
  to: string | null;
}
export interface DrawInterrupt {
  id: string;
  trigger: PlanCond | null;
  resume: PlanCond | null;
  onHold: Action[];
}
/** The machine's logic as drawn: real and placeholder items together, in drawing order. */
export interface Drawing {
  initial: string | null;
  wires: DrawWire[];
  aborts: DrawAbort[];
  interrupts: DrawInterrupt[];
}

export interface DrawNode {
  id: string;
  name: string;
  /** The state template behind it; null for a placeholder. */
  template: string | null;
}

/** A condition choice from the UI: an instance of this machine, a library condition, or a typed name. */
export type CondChoice = { instance: string } | { template: string } | { name: string } | null;

export function emptyPlaceholders(): Placeholders {
  return { states: [], initial: null, transitions: [], aborts: [], interrupts: [] };
}

function ph(entry: Entry): Placeholders {
  if (!entry.plan.placeholders) entry.plan.placeholders = emptyPlaceholders();
  return entry.plan.placeholders;
}

export function entryOf(project: Project, machineId: string): Entry {
  const e = project.machines.find((m) => m.machine.id === machineId);
  if (!e) throw new Error(`no machine ${machineId}`);
  return e;
}

/** Every state node of the machine, real ones first. */
export function nodesOf(entry: Entry): DrawNode[] {
  return [
    ...entry.machine.states.map((s) => ({ id: s.id, name: s.name, template: s.template })),
    ...(entry.plan.placeholders?.states ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      template: null,
    })),
  ];
}

export function read(entry: Entry): Drawing {
  const m = entry.machine;
  const p = entry.plan.placeholders ?? emptyPlaceholders();
  const inst = (id: string): PlanCond => ({ kind: 'instance', id });
  return {
    initial: m.initial ?? p.initial,
    wires: [
      ...m.transitions.map((t) => ({ ...t, condition: inst(t.condition) })),
      ...p.transitions.map((t) => ({ ...t })),
    ],
    aborts: [
      ...m.aborts.map((a) => ({ id: a.id, condition: inst(a.condition), to: a.to })),
      ...p.aborts.map((a) => ({ ...a })),
    ],
    interrupts: [
      ...m.interrupts.map((i) => ({
        id: i.id,
        trigger: inst(i.trigger),
        resume: inst(i.resume),
        onHold: i.onHold,
      })),
      ...p.interrupts.map((i) => ({ ...i })),
    ],
  };
}

/** Writes a drawing back, splitting it into real (machine.json) and placeholder (plan.json) parts. */
export function write(entry: Entry, d: Drawing): void {
  const m = entry.machine;
  const p = ph(entry);
  const realNode = new Set(m.states.map((s) => s.id));
  const anyNode = new Set([...realNode, ...p.states.map((s) => s.id)]);
  const instances = new Set(m.conditions.map((c) => c.id));
  // A condition pointing at an instance that no longer exists is no condition at all.
  const clean = (c: PlanCond | null): PlanCond | null =>
    c && c.kind === 'instance' && !instances.has(c.id) ? null : c;
  const real = (c: PlanCond | null): c is { kind: 'instance'; id: string } =>
    c !== null && c.kind === 'instance';

  const wires = d.wires
    .filter((w) => anyNode.has(w.from) && anyNode.has(w.to))
    .map((w) => ({ ...w, condition: clean(w.condition) }));
  m.transitions = [];
  p.transitions = [];
  for (const w of wires) {
    const c = w.condition;
    if (real(c) && realNode.has(w.from) && realNode.has(w.to)) {
      m.transitions.push({
        id: w.id,
        from: w.from,
        to: w.to,
        condition: c.id,
        priority: w.priority,
      });
    } else {
      p.transitions.push(w);
    }
  }

  const init = d.initial !== null && anyNode.has(d.initial) ? d.initial : null;
  m.initial = init !== null && realNode.has(init) ? init : null;
  p.initial = init !== null && !realNode.has(init) ? init : null;

  m.aborts = [];
  p.aborts = [];
  for (const a0 of d.aborts) {
    const a = {
      ...a0,
      condition: clean(a0.condition),
      to: a0.to !== null && anyNode.has(a0.to) ? a0.to : null,
    };
    const c = a.condition;
    if (real(c) && a.to !== null && realNode.has(a.to)) {
      m.aborts.push({ id: a.id, condition: c.id, to: a.to });
    } else {
      p.aborts.push(a);
    }
  }

  m.interrupts = [];
  p.interrupts = [];
  for (const i0 of d.interrupts) {
    const i = { ...i0, trigger: clean(i0.trigger), resume: clean(i0.resume) };
    const t = i.trigger;
    const r = i.resume;
    if (real(t) && real(r)) {
      m.interrupts.push({ id: i.id, trigger: t.id, resume: r.id, onHold: i.onHold });
    } else {
      p.interrupts.push(i);
    }
  }

  // Positions only for nodes that exist; junctions only for wires that exist.
  entry.plan.nodes = entry.plan.nodes.filter((n) => anyNode.has(n.id));
  if (entry.plan.junctions) {
    const wireIds = new Set(wires.map((w) => w.id));
    entry.plan.junctions = entry.plan.junctions
      .map((j) => ({ ...j, wires: j.wires.filter((w) => wireIds.has(w)) }))
      .filter((j) => j.wires.length > 0);
    if (entry.plan.junctions.length === 0) delete entry.plan.junctions;
  }
  const empty =
    p.states.length === 0 &&
    p.initial === null &&
    p.transitions.length === 0 &&
    p.aborts.length === 0 &&
    p.interrupts.length === 0;
  if (empty) delete entry.plan.placeholders;
}

/** Applies a change to the drawing and re-sorts real and placeholder parts. */
export function edit(entry: Entry, fn: (d: Drawing) => void): void {
  const d = read(entry);
  fn(d);
  write(entry, d);
}

/* --- names ------------------------------------------------------------------- */

export function freeNodeName(entry: Entry, base: string): string {
  const taken = new Set(nodesOf(entry).map((n) => n.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}

/** The text shown for a condition slot: the condition's name, `[Name]` for a placeholder, or null. */
export function condLabel(project: Project, entry: Entry, c: PlanCond | null): string | null {
  if (!c) return null;
  if (c.kind === 'placeholder') return `[${c.name}]`;
  const inst = entry.machine.conditions.find((x) => x.id === c.id);
  const tpl = inst && project.conditions.find((t) => t.id === inst.template);
  return tpl?.name ?? '(missing)';
}

/* --- nodes ------------------------------------------------------------------- */

/**
 * Adds a state node called `name`. If a state template of that name exists the node is
 * real at once; otherwise it is a placeholder (SPEC 6.3). Returns the new node ID.
 */
export function addNode(
  project: Project,
  machineId: string,
  name: string,
  pos: { x: number; y: number },
  newId: NewId,
): string {
  const entry = entryOf(project, machineId);
  if (nodesOf(entry).some((n) => n.name === name)) {
    throw new Error(`machine '${entry.machine.name}' already has a state called ${name}`);
  }
  const id = newId();
  const tpl = project.states.find((s) => s.name === name);
  if (tpl) entry.machine.states.push({ id, name, template: tpl.id, bindings: [] });
  else ph(entry).states.push({ id, name });
  entry.plan.nodes.push({ id, x: pos.x, y: pos.y });
  write(entry, read(entry));
  return id;
}

/** Removes state nodes and everything drawn to or from them. Templates stay in the library. */
export function deleteNodes(entry: Entry, ids: string[]): void {
  const gone = new Set(ids);
  const d = read(entry);
  entry.machine.states = entry.machine.states.filter((s) => !gone.has(s.id));
  if (entry.plan.placeholders) {
    entry.plan.placeholders.states = entry.plan.placeholders.states.filter((s) => !gone.has(s.id));
  }
  d.wires = d.wires.filter((w) => !gone.has(w.from) && !gone.has(w.to));
  if (d.initial !== null && gone.has(d.initial)) d.initial = null;
  for (const a of d.aborts) if (a.to !== null && gone.has(a.to)) a.to = null;
  write(entry, d);
}

export function moveNode(entry: Entry, id: string, x: number, y: number): void {
  const pos = entry.plan.nodes.find((n) => n.id === id);
  if (pos) {
    pos.x = x;
    pos.y = y;
  } else {
    entry.plan.nodes.push({ id, x, y });
  }
}

/* --- wires ------------------------------------------------------------------- */

/** Draws a transition. Its priority is the next free number among wires leaving `from`. */
export function connect(entry: Entry, from: string, to: string, newId: NewId): string | null {
  if (from === to) return null;
  const ids = new Set(nodesOf(entry).map((n) => n.id));
  if (!ids.has(from) || !ids.has(to)) return null;
  const id = newId();
  edit(entry, (d) => {
    const next = Math.max(0, ...d.wires.filter((w) => w.from === from).map((w) => w.priority)) + 1;
    d.wires.push({ id, from, to, priority: next, condition: null });
  });
  return id;
}

/** Moves a wire to priority `n` among the wires leaving the same state; the others close up 1, 2, 3… */
export function renumber(entry: Entry, wireId: string, n: number): void {
  edit(entry, (d) => {
    const wire = d.wires.find((w) => w.id === wireId);
    if (!wire) return;
    const group = d.wires
      .filter((w) => w.from === wire.from && w.id !== wireId)
      .sort((a, b) => a.priority - b.priority);
    const at = Math.max(0, Math.min(group.length, Math.trunc(n) - 1));
    group.splice(at, 0, wire);
    group.forEach((w, i) => (w.priority = i + 1));
  });
}

export function setInit(entry: Entry, nodeId: string | null): void {
  edit(entry, (d) => (d.initial = nodeId));
}

export function deleteWires(entry: Entry, ids: string[]): void {
  const gone = new Set(ids);
  edit(entry, (d) => (d.wires = d.wires.filter((w) => !gone.has(w.id))));
}

/* --- conditions on wires and blocks ------------------------------------------ */

/** An instance of a library condition in this machine: the first existing one, or a new one. */
function instanceFor(entry: Entry, templateId: string, newId: NewId): string {
  const found = entry.machine.conditions.find((c) => c.template === templateId);
  if (found) return found.id;
  const id = newId();
  entry.machine.conditions.push({ id, template: templateId, bindings: [] });
  return id;
}

/** Turns a choice into a condition slot. A typed name that matches a library condition is used at once. */
export function resolveCond(
  project: Project,
  entry: Entry,
  choice: CondChoice,
  newId: NewId,
): PlanCond | null {
  if (choice === null) return null;
  if ('instance' in choice) return { kind: 'instance', id: choice.instance };
  if ('template' in choice) {
    return { kind: 'instance', id: instanceFor(entry, choice.template, newId) };
  }
  const tpl = project.conditions.find((c) => c.name === choice.name);
  if (tpl) return { kind: 'instance', id: instanceFor(entry, tpl.id, newId) };
  return { kind: 'placeholder', name: choice.name };
}

export function setWireCondition(
  project: Project,
  machineId: string,
  wireId: string,
  choice: CondChoice,
  newId: NewId,
): void {
  const entry = entryOf(project, machineId);
  const c = resolveCond(project, entry, choice, newId);
  edit(entry, (d) => {
    const w = d.wires.find((x) => x.id === wireId);
    if (w) w.condition = c;
  });
}

export function addAbort(entry: Entry, newId: NewId): string {
  const id = newId();
  edit(entry, (d) => d.aborts.push({ id, condition: null, to: null }));
  return id;
}

export function addInterrupt(entry: Entry, newId: NewId): string {
  const id = newId();
  edit(entry, (d) => d.interrupts.push({ id, trigger: null, resume: null, onHold: [] }));
  return id;
}

export type BlockSlot = 'abort' | 'trigger' | 'resume';

/** Sets the condition of an abort block or of an interrupt's trigger / resume block. */
export function setBlockCondition(
  project: Project,
  machineId: string,
  blockId: string,
  slot: BlockSlot,
  choice: CondChoice,
  newId: NewId,
): void {
  const entry = entryOf(project, machineId);
  const c = resolveCond(project, entry, choice, newId);
  edit(entry, (d) => {
    if (slot === 'abort') {
      const a = d.aborts.find((x) => x.id === blockId);
      if (a) a.condition = c;
    } else {
      const i = d.interrupts.find((x) => x.id === blockId);
      if (i) i[slot] = c;
    }
  });
}

export function setAbortTarget(entry: Entry, abortId: string, to: string | null): void {
  edit(entry, (d) => {
    const a = d.aborts.find((x) => x.id === abortId);
    if (a) a.to = to;
  });
}

export function setHoldActions(entry: Entry, interruptId: string, onHold: Action[]): void {
  edit(entry, (d) => {
    const i = d.interrupts.find((x) => x.id === interruptId);
    if (i) i.onHold = onHold;
  });
}

export function deleteBlocks(entry: Entry, ids: string[]): void {
  const gone = new Set(ids);
  edit(entry, (d) => {
    d.aborts = d.aborts.filter((a) => !gone.has(a.id));
    d.interrupts = d.interrupts.filter((i) => !gone.has(i.id));
  });
}

/* --- Construct Machine --------------------------------------------------------- */

export interface ConstructReport {
  statesCreated: string[];
  statesReused: string[];
  conditionsCreated: string[];
  conditionsReused: string[];
  /** Wires and blocks that still cannot run (no condition chosen, no target). */
  stillOpen: number;
}

/**
 * Construct Machine (SPEC 6.3): turns every placeholder of one machine into real
 * entities. Library items with the same name are reused, never duplicated. New
 * states are empty; new conditions hold one "TO DO" term. Running it again only
 * adds what is new.
 */
export function construct(project: Project, machineId: string, newId: NewId): ConstructReport {
  const entry = entryOf(project, machineId);
  const report: ConstructReport = {
    statesCreated: [],
    statesReused: [],
    conditionsCreated: [],
    conditionsReused: [],
    stillOpen: 0,
  };
  const d = read(entry);

  // States: each placeholder node becomes a real node (same ID, so the drawing stays put).
  for (const s of entry.plan.placeholders?.states ?? []) {
    let tpl = project.states.find((t) => t.name === s.name);
    if (tpl) {
      if (!report.statesReused.includes(s.name)) report.statesReused.push(s.name);
    } else {
      tpl = {
        id: newId(),
        name: s.name,
        description: `TO DO: made by Construct Machine for ${entry.machine.name}. Add its actions.`,
        roles: [],
        onEntry: [],
        steps: [],
        onExit: [],
      } satisfies StateTemplate;
      project.states.push(tpl);
      report.statesCreated.push(s.name);
    }
    entry.machine.states.push({ id: s.id, name: s.name, template: tpl.id, bindings: [] });
  }
  if (entry.plan.placeholders) entry.plan.placeholders.states = [];

  // Conditions: each placeholder name becomes an instance of a (new or existing) template.
  const real = (c: PlanCond | null): PlanCond | null => {
    if (!c || c.kind === 'instance') return c;
    let tpl = project.conditions.find((t) => t.name === c.name);
    if (tpl) {
      if (!report.conditionsReused.includes(c.name) && !report.conditionsCreated.includes(c.name)) {
        report.conditionsReused.push(c.name);
      }
    } else {
      tpl = {
        id: newId(),
        name: c.name,
        description: `TO DO: made by Construct Machine for ${entry.machine.name}. Build its rule.`,
        roles: [],
        expr: { op: 'todo' },
      } satisfies Condition;
      project.conditions.push(tpl);
      report.conditionsCreated.push(c.name);
    }
    return { kind: 'instance', id: instanceFor(entry, tpl.id, newId) };
  };
  for (const w of d.wires) w.condition = real(w.condition);
  for (const a of d.aborts) a.condition = real(a.condition);
  for (const i of d.interrupts) {
    i.trigger = real(i.trigger);
    i.resume = real(i.resume);
  }
  write(entry, d);

  const p = entry.plan.placeholders;
  report.stillOpen = p
    ? p.transitions.length + p.aborts.length + p.interrupts.length + (p.initial ? 1 : 0)
    : 0;
  return report;
}

/** True when a machine still has placeholders that Construct Machine would turn into real things. */
export function hasPlaceholders(entry: Entry): boolean {
  const p = entry.plan.placeholders;
  if (!p) return false;
  const named = (c: PlanCond | null) => c?.kind === 'placeholder';
  return (
    p.states.length > 0 ||
    p.transitions.some((w) => named(w.condition)) ||
    p.aborts.some((a) => named(a.condition)) ||
    p.interrupts.some((i) => named(i.trigger) || named(i.resume))
  );
}

/** Whether the machine was ever constructed (it has real states): the menu then says "Add New Items". */
export function isConstructed(machine: Machine): boolean {
  return machine.states.length > 0;
}

/* --- copy / paste ------------------------------------------------------------------ */

export interface Clip {
  nodes: { id: string; name: string; template: string | null; x: number; y: number }[];
  wires: { from: string; to: string; priority: number; condition: PlanCond | null }[];
}

/** Copies state nodes and the wires between them. Conditions are carried by name. */
export function copyNodes(project: Project, entry: Entry, ids: string[]): Clip {
  const pick = new Set(ids);
  const pos = new Map(entry.plan.nodes.map((n) => [n.id, n]));
  const nodes = nodesOf(entry)
    .filter((n) => pick.has(n.id))
    .map((n) => ({ ...n, x: pos.get(n.id)?.x ?? 0, y: pos.get(n.id)?.y ?? 0 }));
  const byName = (c: PlanCond | null): PlanCond | null => {
    if (!c || c.kind === 'placeholder') return c;
    const label = condLabel(project, entry, c);
    return label && label !== '(missing)' ? { kind: 'placeholder', name: label } : null;
  };
  const wires = read(entry)
    .wires.filter((w) => pick.has(w.from) && pick.has(w.to))
    .map((w) => ({ from: w.from, to: w.to, priority: w.priority, condition: byName(w.condition) }));
  return { nodes, wires };
}

/** Pastes a clip into a machine, shifted by `offset`. Returns the new node IDs. */
export function pasteNodes(
  project: Project,
  machineId: string,
  clip: Clip,
  offset: { x: number; y: number },
  newId: NewId,
): string[] {
  const entry = entryOf(project, machineId);
  const map = new Map<string, string>();
  for (const n of clip.nodes) {
    const id = newId();
    map.set(n.id, id);
    const name = freeNodeName(entry, n.name);
    if (n.template && project.states.some((t) => t.id === n.template)) {
      entry.machine.states.push({ id, name, template: n.template, bindings: [] });
    } else {
      ph(entry).states.push({ id, name });
    }
    entry.plan.nodes.push({ id, x: n.x + offset.x, y: n.y + offset.y });
  }
  edit(entry, (d) => {
    for (const w of clip.wires) {
      const from = map.get(w.from)!;
      const to = map.get(w.to)!;
      const condition =
        w.condition?.kind === 'placeholder'
          ? resolveCond(project, entry, { name: w.condition.name }, newId)
          : null;
      d.wires.push({ id: newId(), from, to, priority: w.priority, condition });
    }
  });
  return [...map.values()];
}

/* --- drawing-only junctions (H / V combiners, expander) ------------------------------ */

export type JunctionKind = 'h' | 'v' | 'exp';

/**
 * Routes wires through a new junction. Combiners (h, v) join wires that end at the same
 * state; the expander fans one state's wires out to up to four targets. Returns an
 * explanation when the selection does not fit.
 */
export function addJunction(
  entry: Entry,
  kind: JunctionKind,
  wireIds: string[],
  at: { x: number; y: number },
  newId: NewId,
): string | null {
  const wires = read(entry).wires.filter((w) => wireIds.includes(w.id));
  if (wires.length < 1) return 'Select one or more wires first.';
  if (kind === 'exp') {
    if (new Set(wires.map((w) => w.from)).size !== 1) {
      return 'An expander fans out wires that leave the same state.';
    }
    if (wires.length > 4) return 'An expander fans one wire out to at most four.';
  } else if (new Set(wires.map((w) => w.to)).size !== 1) {
    return 'A combiner joins wires that end at the same state.';
  }
  const ids = new Set(wires.map((w) => w.id));
  const list = (entry.plan.junctions ?? [])
    .map((j) => ({ ...j, wires: j.wires.filter((w) => !ids.has(w)) }))
    .filter((j) => j.wires.length > 0);
  list.push({ id: newId(), kind, x: at.x, y: at.y, wires: [...ids] });
  entry.plan.junctions = list;
  return null;
}

export function deleteJunctions(entry: Entry, ids: string[]): void {
  if (!entry.plan.junctions) return;
  entry.plan.junctions = entry.plan.junctions.filter((j) => !ids.includes(j.id));
  if (entry.plan.junctions.length === 0) delete entry.plan.junctions;
}

export function moveJunction(entry: Entry, id: string, x: number, y: number): void {
  const j = entry.plan.junctions?.find((x0) => x0.id === id);
  if (j) {
    j.x = x;
    j.y = y;
  }
}
