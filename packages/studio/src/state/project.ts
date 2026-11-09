import { create } from 'zustand';
import { compileProject, type Problem, type Project } from '@pulso/core';
import { useShell } from './store';

/* ----------------------------------------------------------------------------
 * The open project, held in the browser while it is edited. The runtime owns the
 * files; this is a working copy. `save()` sends it back. There is exactly one copy
 * of the variable space: it is derived from this project (never typed twice).
 * -------------------------------------------------------------------------- */

interface ProjectState {
  name: string | null;
  project: Project | null;
  /** JSON of the last saved version, to know whether anything changed. */
  saved: string;
  problems: Problem[];
  loading: boolean;
  /** Entity the user asked to look at (tree click, message click). Editors scroll to it. */
  focus: { id: string; nonce: number } | null;

  load(): Promise<void>;
  save(): Promise<boolean>;
  /** Changes the working copy. `fn` mutates a private copy. */
  update(fn: (draft: Project) => void): void;
  setFocus(id: string | null): void;
  newProject(name: string): Promise<boolean>;
  openProject(name: string): Promise<boolean>;
}

function check(project: Project | null): Problem[] {
  return project ? compileProject(project).problems : [];
}

export const useProject = create<ProjectState>((set, get) => ({
  name: null,
  project: null,
  saved: '',
  problems: [],
  loading: true,
  focus: null,

  async load() {
    try {
      const res = await fetch('/api/project');
      const body = (await res.json()) as { name: string | null; project: Project | null };
      set({
        name: body.name,
        project: body.project,
        saved: JSON.stringify(body.project),
        problems: check(body.project),
        loading: false,
      });
      useShell
        .getState()
        .setRuntimeInfo(useShell.getState().runtimeAddress, body.project?.info.name ?? null);
    } catch {
      set({ loading: false });
    }
  },

  async save() {
    const { project } = get();
    if (!project) return false;
    const res = await fetch('/api/project', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project }),
    });
    const body = (await res.json()) as { ok: boolean; error?: string; written?: string[] };
    if (!body.ok) {
      useShell.getState().log('error', 'Save', body.error ?? 'The project could not be saved.');
      return false;
    }
    set({ saved: JSON.stringify(project) });
    useShell.getState().log('info', 'Save', `Saved ${body.written?.length ?? 0} changed file(s).`);
    return true;
  },

  update(fn) {
    const current = get().project;
    if (!current) return;
    const draft = structuredClone(current);
    fn(draft);
    set({ project: draft, problems: check(draft) });
  },

  setFocus(id) {
    set({ focus: id ? { id, nonce: Date.now() } : null });
  },

  async newProject(name) {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const body = (await res.json()) as { ok: boolean; error?: string };
    if (!body.ok) {
      useShell.getState().log('error', 'Project', body.error ?? 'Could not create the project.');
      return false;
    }
    useShell.setState((s) => ({
      tabsByApp: { ...s.tabsByApp, studio: { tabs: [], activeId: null } },
    }));
    await get().load();
    return true;
  },

  async openProject(name) {
    const res = await fetch('/api/projects/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const body = (await res.json()) as { ok: boolean; error?: string };
    if (!body.ok) {
      useShell.getState().log('error', 'Project', body.error ?? 'Could not open the project.');
      return false;
    }
    useShell.setState((s) => ({
      tabsByApp: { ...s.tabsByApp, studio: { tabs: [], activeId: null } },
    }));
    await get().load();
    return true;
  },
}));

export function isDirty(): boolean {
  const { project, saved } = useProject.getState();
  return project !== null && JSON.stringify(project) !== saved;
}

export function useDirty(): boolean {
  return useProject((s) => s.project !== null && JSON.stringify(s.project) !== s.saved);
}
