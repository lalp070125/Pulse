import type { z } from 'zod';
import {
  ConditionSchema,
  EquipmentSchema,
  GlobalSchema,
  InterfaceSchema,
  MachineSchema,
  PlanSchema,
  ProjectInfoSchema,
  RoutingSchema,
  StateSchema,
  type Project,
} from './schema';

/* ----------------------------------------------------------------------------
 * A project is a folder of small JSON files, one per entity (SPEC 5.1).
 * This module converts between that folder (as a map of relative path → text)
 * and the in-memory Project. It does no I/O: the runtime reads and writes disk.
 * -------------------------------------------------------------------------- */

export type ProjectFiles = Record<string, string>;

export interface Problem {
  level: 'error' | 'warning';
  /** Where the problem is, in plain words (file or machine/state/condition). */
  where: string;
  message: string;
}

/** Folders whose files this module owns. Other folders (tests, panels, twin…) are left alone. */
export const ENTITY_FOLDERS = [
  'globals',
  'interfaces',
  'equipment',
  'conditions',
  'states',
  'machines',
] as const;

/** Fixed key order (from the schema) and 2-space indentation, so diffs stay clean. */
export function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function write<T>(schema: z.ZodType<T>, value: T): string {
  // Parsing rebuilds every object in the schema's key order.
  return serialize(schema.parse(value));
}

export function projectToFiles(p: Project): ProjectFiles {
  const files: ProjectFiles = {};
  files['project.json'] = write(ProjectInfoSchema, p.info);
  files['routing.json'] = write(RoutingSchema, p.routing);
  for (const g of p.globals) files[`globals/${g.id}.json`] = write(GlobalSchema, g);
  for (const i of p.interfaces) files[`interfaces/${i.id}.json`] = write(InterfaceSchema, i);
  for (const e of p.equipment) files[`equipment/${e.id}.json`] = write(EquipmentSchema, e);
  for (const c of p.conditions) files[`conditions/${c.id}.json`] = write(ConditionSchema, c);
  for (const s of p.states) files[`states/${s.id}.json`] = write(StateSchema, s);
  for (const { machine, plan } of p.machines) {
    files[`machines/${machine.id}/machine.json`] = write(MachineSchema, machine);
    files[`machines/${machine.id}/plan.json`] = write(PlanSchema, plan);
  }
  return files;
}

function zodProblems(file: string, error: z.ZodError): Problem[] {
  return error.issues.map((issue) => ({
    level: 'error' as const,
    where: file,
    message: `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`,
  }));
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Reads a project from its files. Returns the project when every file is valid;
 * otherwise `project` is null and `problems` names each broken file and field.
 */
export function projectFromFiles(files: ProjectFiles): {
  project: Project | null;
  problems: Problem[];
} {
  const problems: Problem[] = [];

  function parse<T>(file: string, schema: z.ZodType<T>, idFromName?: string): T | null {
    let raw: unknown;
    try {
      raw = JSON.parse(files[file]!);
    } catch (e) {
      problems.push({
        level: 'error',
        where: file,
        message: `not valid JSON (${e instanceof Error ? e.message : 'parse error'})`,
      });
      return null;
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      problems.push(...zodProblems(file, result.error));
      return null;
    }
    const data = result.data as T & { id?: string };
    if (idFromName !== undefined && data.id !== idFromName) {
      problems.push({
        level: 'error',
        where: file,
        message: `the file name says ID ${idFromName} but the file contains ID ${data.id}`,
      });
      return null;
    }
    return result.data;
  }

  if (files['project.json'] === undefined) {
    return {
      project: null,
      problems: [{ level: 'error', where: 'project.json', message: 'the file is missing' }],
    };
  }
  const info = parse('project.json', ProjectInfoSchema);
  const routing =
    files['routing.json'] === undefined ? { routes: [] } : parse('routing.json', RoutingSchema);

  const project: Project = {
    info: info ?? {
      formatVersion: 1,
      id: '00000000000000000000000000',
      name: '',
      defaultCycleMs: 10,
    },
    globals: [],
    interfaces: [],
    equipment: [],
    conditions: [],
    states: [],
    machines: [],
    routing: routing ?? { routes: [] },
  };

  const simple: [RegExp, (file: string, id: string) => void][] = [
    [/^globals\/([^/]+)\.json$/, (f, id) => push(project.globals, parse(f, GlobalSchema, id))],
    [
      /^interfaces\/([^/]+)\.json$/,
      (f, id) => push(project.interfaces, parse(f, InterfaceSchema, id)),
    ],
    [
      /^equipment\/([^/]+)\.json$/,
      (f, id) => push(project.equipment, parse(f, EquipmentSchema, id)),
    ],
    [
      /^conditions\/([^/]+)\.json$/,
      (f, id) => push(project.conditions, parse(f, ConditionSchema, id)),
    ],
    [/^states\/([^/]+)\.json$/, (f, id) => push(project.states, parse(f, StateSchema, id))],
  ];
  function push<T>(list: T[], item: T | null) {
    if (item) list.push(item);
  }

  const machineIds = new Set<string>();
  for (const file of Object.keys(files).sort()) {
    for (const [pattern, handle] of simple) {
      const m = pattern.exec(file);
      if (m) handle(file, m[1]!);
    }
    const mm = /^machines\/([^/]+)\/machine\.json$/.exec(file);
    if (mm) machineIds.add(mm[1]!);
  }
  for (const id of [...machineIds].sort()) {
    const machine = parse(`machines/${id}/machine.json`, MachineSchema, id);
    const planFile = `machines/${id}/plan.json`;
    const plan =
      files[planFile] === undefined ? { machine: id, nodes: [] } : parse(planFile, PlanSchema);
    if (machine && plan) {
      if (plan.machine !== id) {
        problems.push({
          level: 'error',
          where: planFile,
          message: `belongs to machine ${plan.machine}, not ${id}`,
        });
      } else {
        project.machines.push({ machine, plan });
      }
    }
  }

  project.globals.sort(byId);
  project.interfaces.sort(byId);
  project.equipment.sort(byId);
  project.conditions.sort(byId);
  project.states.sort(byId);
  project.machines.sort((a, b) => byId(a.machine, b.machine));

  const ok = info !== null && routing !== null && !problems.some((p) => p.level === 'error');
  return { project: ok ? project : null, problems };
}

/* ----------------------------------------------------------------------------
 * Find usages: everything that refers to an ID (SPEC 5.1: deleting a referenced
 * entity must list what depends on it). IDs are unique ULIDs, so a plain walk of
 * every value is exact.
 * -------------------------------------------------------------------------- */

export interface Usage {
  /** File that holds the reference. */
  file: string;
  /** Field path inside the file, e.g. `states.2.bindings.0.instance`. */
  path: string;
}

export function findUsages(project: Project, id: string): Usage[] {
  const out: Usage[] = [];
  const files = projectToFiles(project);
  for (const [file, text] of Object.entries(files)) {
    walk(JSON.parse(text) as unknown, [], (value, path) => {
      // A field called `id` defines an entity; it is not a reference to it.
      if (value === id && path[path.length - 1] !== 'id') out.push({ file, path: path.join('.') });
    });
  }
  return out;
}

function walk(
  value: unknown,
  path: (string | number)[],
  visit: (value: unknown, path: (string | number)[]) => void,
) {
  visit(value, path);
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, i], visit));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, [...path, k], visit);
  }
}
