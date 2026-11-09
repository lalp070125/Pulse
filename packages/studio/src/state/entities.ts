import { NameSchema, findUsages, type Project } from '@pulso/core';
import { newId } from '../lib/ulid';
import { askConfirm, askText, showInfo } from './dialogs';
import { useProject } from './project';
import { useShell } from './store';

/* ----------------------------------------------------------------------------
 * The six kinds of named things the Studio edits, and the five tree actions
 * (New, Rename, Duplicate, Delete, Find usages) that work the same on all of them.
 * References are by ID: renaming never breaks anything (SPEC 5.1).
 * -------------------------------------------------------------------------- */

export type EntityKind = 'global' | 'interface' | 'equipment' | 'condition' | 'state' | 'machine';

interface Named {
  id: string;
  name: string;
}

export const KINDS: Record<
  EntityKind,
  { label: string; plural: string; editor: string; base: string }
> = {
  global: {
    label: 'global variable',
    plural: 'Global Variables',
    editor: 'lib.globals',
    base: 'NewGlobal',
  },
  interface: { label: 'interface', plural: 'Interfaces', editor: 'lib.interfaces', base: 'INew' },
  equipment: {
    label: 'equipment type',
    plural: 'Equipment',
    editor: 'lib.equipment',
    base: 'NewEquipment',
  },
  condition: {
    label: 'condition',
    plural: 'Conditions',
    editor: 'lib.conditions',
    base: 'NewCondition',
  },
  state: { label: 'state', plural: 'States', editor: 'lib.states', base: 'NewState' },
  machine: { label: 'machine', plural: 'Machines', editor: 'machines', base: 'NewMachine' },
};

export function listOf(p: Project, kind: EntityKind): Named[] {
  switch (kind) {
    case 'global':
      return p.globals;
    case 'interface':
      return p.interfaces;
    case 'equipment':
      return p.equipment;
    case 'condition':
      return p.conditions;
    case 'state':
      return p.states;
    case 'machine':
      return p.machines.map((m) => m.machine);
  }
}

export function nameError(
  p: Project,
  kind: EntityKind,
  name: string,
  ownId?: string,
): string | null {
  const parsed = NameSchema.safeParse(name);
  if (!parsed.success) return parsed.error.issues[0]!.message;
  if (kind === 'machine' && name === 'Global') return 'the name "Global" is reserved';
  if (listOf(p, kind).some((e) => e.name === name && e.id !== ownId)) {
    return `a ${KINDS[kind].label} called ${name} already exists`;
  }
  return null;
}

export function freshName(names: string[], base: string): string {
  if (!names.includes(base)) return base;
  for (let i = 2; ; i++) if (!names.includes(`${base}${i}`)) return `${base}${i}`;
}

/** Looks up what an ID is, for messages: "Global 'Start'". */
export function describeId(p: Project, id: string): string | null {
  for (const kind of Object.keys(KINDS) as EntityKind[]) {
    const e = listOf(p, kind).find((x) => x.id === id);
    if (e) return `${KINDS[kind].label} '${e.name}'`;
  }
  return null;
}

function blank(p: Project, kind: EntityKind, name: string): Named {
  const id = newId();
  switch (kind) {
    case 'global':
      return { id, name, type: { kind: 'bool' }, default: false } as Named;
    case 'interface':
      return { id, name, signals: [] } as Named;
    case 'equipment':
      return { id, name, interfaces: [] } as Named;
    case 'condition':
      return { id, name, roles: [], expr: { op: 'lit', value: true } } as Named;
    case 'state':
      return { id, name, roles: [], onEntry: [], steps: [], onExit: [] } as Named;
    case 'machine':
      return {
        id,
        name,
        cycleMs: p.info.defaultCycleMs,
        instances: [],
        timers: [],
        states: [],
        conditions: [],
        initial: null,
        transitions: [],
        aborts: [],
        interrupts: [],
      } as Named;
  }
}

/** Opens the editor of a kind (and optionally scrolls to one entity). */
export function openEditor(kind: EntityKind, id?: string): void {
  const k = KINDS[kind];
  useShell.getState().openTab({ id: `doc:${k.editor}`, title: k.plural, closable: true, note: '' });
  useProject.getState().setFocus(id ?? null);
}

/** Adds an entity with a free name and returns its ID. */
export function addEntity(kind: EntityKind, name?: string): string | null {
  const store = useProject.getState();
  if (!store.project) return null;
  const base = KINDS[kind].base;
  const chosen =
    name ??
    freshName(
      listOf(store.project, kind).map((e) => e.name),
      base,
    );
  const entity = blank(store.project, kind, chosen);
  store.update((p) => {
    if (kind === 'global') p.globals.push(entity as never);
    else if (kind === 'interface') p.interfaces.push(entity as never);
    else if (kind === 'equipment') p.equipment.push(entity as never);
    else if (kind === 'condition') p.conditions.push(entity as never);
    else if (kind === 'state') p.states.push(entity as never);
    else p.machines.push({ machine: entity as never, plan: { machine: entity.id, nodes: [] } });
  });
  return entity.id;
}

export async function newEntity(kind: EntityKind): Promise<string | null> {
  const p = useProject.getState().project;
  if (!p) return null;
  const name = await askText(
    `New ${KINDS[kind].label}`,
    'Name',
    freshName(
      listOf(p, kind).map((e) => e.name),
      KINDS[kind].base,
    ),
    (t) => nameError(useProject.getState().project!, kind, t),
  );
  if (name === null) return null;
  const id = addEntity(kind, name);
  if (id) openEditor(kind, id);
  return id;
}

export function renameEntity(kind: EntityKind, id: string, name: string): void {
  useProject.getState().update((p) => {
    if (kind === 'machine') {
      const m = p.machines.find((x) => x.machine.id === id);
      if (m) m.machine.name = name;
    } else {
      const e = listOf(p, kind).find((x) => x.id === id);
      if (e) e.name = name;
    }
  });
}

export async function askRename(kind: EntityKind, id: string): Promise<void> {
  const p = useProject.getState().project;
  const e = p && listOf(p, kind).find((x) => x.id === id);
  if (!p || !e) return;
  const name = await askText(`Rename ${KINDS[kind].label}`, 'New name', e.name, (t) =>
    nameError(useProject.getState().project!, kind, t, id),
  );
  if (name !== null && name !== e.name) renameEntity(kind, id, name);
}

/** Gives every nested `id` in a copy a fresh value and re-points references inside the copy. */
function reid<T>(value: T): T {
  const ids = new Set<string>();
  const collect = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'id' && typeof x === 'string') ids.add(x);
        else collect(x);
      }
    }
  };
  collect(value);
  const map = new Map([...ids].map((old) => [old, newId()]));
  const swap = (v: unknown): unknown => {
    if (typeof v === 'string') return map.get(v) ?? v;
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
    }
    return v;
  };
  return swap(value) as T;
}

export function duplicateEntity(kind: EntityKind, id: string): string | null {
  const store = useProject.getState();
  const p = store.project;
  if (!p) return null;
  let newIdOut: string | null = null;
  store.update((draft) => {
    const names = listOf(draft, kind).map((e) => e.name);
    if (kind === 'machine') {
      const src = draft.machines.find((m) => m.machine.id === id);
      if (!src) return;
      const copy = reid(structuredClone(src));
      copy.machine.name = freshName(names, `${src.machine.name}Copy`);
      copy.plan.machine = copy.machine.id;
      // Instances of a machine are renamed paths, so a copy of a machine is a clean second machine.
      draft.machines.push(copy);
      newIdOut = copy.machine.id;
      return;
    }
    const list = listOf(draft, kind);
    const src = list.find((e) => e.id === id);
    if (!src) return;
    const copy = reid(structuredClone(src));
    copy.name = freshName(names, `${src.name}Copy`);
    (list as Named[]).push(copy);
    newIdOut = copy.id;
  });
  return newIdOut;
}

/** What refers to an entity, in plain words. */
export function usageLines(p: Project, id: string): string[] {
  const lines = new Set<string>();
  for (const u of findUsages(p, id)) {
    const owner = u.file.match(/^(?:[a-z-]+|machines)\/([0-9A-Z]{26})/)?.[1];
    const what = owner ? describeId(p, owner) : null;
    lines.add(what ?? u.file);
  }
  return [...lines].sort();
}

export async function showUsages(kind: EntityKind, id: string): Promise<void> {
  const p = useProject.getState().project;
  const e = p && listOf(p, kind).find((x) => x.id === id);
  if (!p || !e) return;
  const lines = usageLines(p, id);
  useShell
    .getState()
    .log(
      'info',
      'Usages',
      lines.length === 0
        ? `${KINDS[kind].label} '${e.name}' is not used anywhere.`
        : `${KINDS[kind].label} '${e.name}' is used by: ${lines.join('; ')}.`,
    );
  await showInfo(
    `Usages of '${e.name}'`,
    lines.length ? lines : ['Nothing refers to it. It can be deleted safely.'],
  );
}

/** Deletes after listing what depends on it and asking (SPEC 5.1). */
export async function askDelete(kind: EntityKind, id: string): Promise<boolean> {
  const p = useProject.getState().project;
  const e = p && listOf(p, kind).find((x) => x.id === id);
  if (!p || !e) return false;
  const lines = usageLines(p, id);
  const ok = await askConfirm(
    `Delete ${KINDS[kind].label} '${e.name}'?`,
    lines.length
      ? [`These depend on it and will show errors until fixed:`, ...lines.map((l) => `• ${l}`)]
      : ['Nothing depends on it.'],
    'Delete',
    true,
  );
  if (!ok) return false;
  useProject.getState().update((draft) => {
    if (kind === 'global') draft.globals = draft.globals.filter((x) => x.id !== id);
    else if (kind === 'interface') draft.interfaces = draft.interfaces.filter((x) => x.id !== id);
    else if (kind === 'equipment') draft.equipment = draft.equipment.filter((x) => x.id !== id);
    else if (kind === 'condition') draft.conditions = draft.conditions.filter((x) => x.id !== id);
    else if (kind === 'state') draft.states = draft.states.filter((x) => x.id !== id);
    else draft.machines = draft.machines.filter((x) => x.machine.id !== id);
  });
  return true;
}
