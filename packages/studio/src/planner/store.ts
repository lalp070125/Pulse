import { create } from 'zustand';
import type { BlockSlot, Clip, Project } from '@pulso/core';
import { useProject } from '../state/project';
import { useShell } from '../state/store';

/* ----------------------------------------------------------------------------
 * The Planner's UI state: undo / redo, which view is shown, the clipboard, the
 * open condition chooser and where a click-to-go should take the canvas.
 *
 * Undo keeps whole earlier versions of the project, but only while the canvas is
 * the only thing editing it: any edit made elsewhere (an editor, a Save of a
 * changed file) starts a new history, so undo never takes back someone else's work.
 * -------------------------------------------------------------------------- */

const MAX_UNDO = 100;

export type ChooserTarget =
  { machine: string; wire: string } | { machine: string; block: string; slot: BlockSlot };

interface PlannerState {
  past: Project[];
  future: Project[];
  /** The project as the canvas last left it. */
  last: Project | null;
  view: 'fsm' | 'queues';
  clip: { machine: string; clip: Clip } | null;
  chooser: ChooserTarget | null;
  hold: { machine: string; interrupt: string } | null;
  /** The machine the State button adds to (last machine clicked). */
  machine: string | null;
  /** Where to look after a click-to-go: a machine and maybe one item inside it. */
  focus: { machine: string; item?: string; nonce: number } | null;

  /** Applies a canvas edit to the working copy, remembering the version before it. */
  act(fn: (draft: Project) => void): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  setView(view: 'fsm' | 'queues'): void;
  setClip(clip: PlannerState['clip']): void;
  setChooser(target: ChooserTarget | null): void;
  setHold(hold: PlannerState['hold']): void;
  setMachine(id: string | null): void;
  focusOn(machine: string, item?: string): void;
}

/** True when the project still is what the canvas last made it (no edit from elsewhere since). */
function sameAsLast(s: PlannerState): boolean {
  return s.last !== null && s.last === useProject.getState().project;
}

export const usePlanner = create<PlannerState>((set, get) => ({
  past: [],
  future: [],
  last: null,
  view: 'fsm',
  clip: null,
  chooser: null,
  hold: null,
  machine: null,
  focus: null,

  act(fn) {
    const before = useProject.getState().project;
    if (!before) return;
    const s = get();
    const past = sameAsLast(s) ? s.past : [];
    try {
      useProject.getState().update(fn);
    } catch (e) {
      useShell.getState().log('warning', 'Planner', e instanceof Error ? e.message : String(e));
      return;
    }
    const after = useProject.getState().project;
    if (after === before) return;
    set({ past: [...past, before].slice(-MAX_UNDO), future: [], last: after });
  },

  undo() {
    const s = get();
    const current = useProject.getState().project;
    if (!sameAsLast(s) || s.past.length === 0 || !current) return;
    const prev = s.past[s.past.length - 1]!;
    useProject.getState().replace(prev);
    set({ past: s.past.slice(0, -1), future: [current, ...s.future], last: prev });
  },

  redo() {
    const s = get();
    const current = useProject.getState().project;
    if (!sameAsLast(s) || s.future.length === 0 || !current) return;
    const next = s.future[0]!;
    useProject.getState().replace(next);
    set({ past: [...s.past, current], future: s.future.slice(1), last: next });
  },

  canUndo: () => sameAsLast(get()) && get().past.length > 0,
  canRedo: () => sameAsLast(get()) && get().future.length > 0,
  setView: (view) => set({ view }),
  setClip: (clip) => set({ clip }),
  setChooser: (chooser) => set({ chooser }),
  setHold: (hold) => set({ hold }),
  setMachine: (machine) => set({ machine }),
  focusOn: (machine, item) => set({ machine, focus: { machine, item, nonce: Date.now() } }),
}));

/** Opens the Planner tab and shows one machine (and maybe one state or wire in it). */
export function openPlanner(machine: string, item?: string): void {
  useShell.getState().openTab({ id: 'doc:planner', title: 'Planner', closable: true, note: '' });
  usePlanner.getState().focusOn(machine, item);
}
