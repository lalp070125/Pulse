import { create } from 'zustand';

/* ----------------------------------------------------------------------------
 * Monitor UI state (SPEC 7): which state is focused, which signals are pinned,
 * where the waveform cursor is, and which state the log points at. The three
 * parts of the Monitor tab (plan, waveform, log) read and move it together.
 * -------------------------------------------------------------------------- */

export type MonitorPart = 'plan' | 'wave' | 'log';

interface MonitorState {
  /** The part the user asked for last (the tree click); it gets the larger share. */
  part: MonitorPart;
  /** The state clicked on the live plan: its signals fill the waveform (SPEC 7.2). */
  focus: { machine: string; machineName: string; node: string; nodeName: string } | null;
  /** Signals pinned by hand, kept across focus changes. */
  pinned: string[];
  /** Waveform cursor in virtual µs; null follows the newest value. */
  cursorUs: number | null;
  /** Visible time span of the waveform in µs. */
  spanUs: number;
  /** End of the visible window; null follows live time. */
  endUs: number | null;
  /** A log row points here: the plan highlights this state. */
  highlight: { machine: string; state: string | null; nonce: number } | null;

  showPart(p: MonitorPart): void;
  setFocus(f: MonitorState['focus']): void;
  pin(path: string): void;
  unpin(path: string): void;
  setCursor(us: number | null): void;
  setSpan(us: number): void;
  setEnd(us: number | null): void;
  pointAt(machine: string | null, state: string | null, timeUs: number): void;
}

export const useMonitor = create<MonitorState>((set, get) => ({
  part: 'plan',
  focus: null,
  pinned: [],
  cursorUs: null,
  spanUs: 10_000_000,
  endUs: null,
  highlight: null,

  showPart: (part) => set({ part }),
  setFocus: (focus) => set({ focus }),
  pin: (path) => set((s) => (s.pinned.includes(path) ? s : { pinned: [...s.pinned, path] })),
  unpin: (path) => set((s) => ({ pinned: s.pinned.filter((p) => p !== path) })),
  setCursor: (cursorUs) => set({ cursorUs }),
  setSpan: (spanUs) => set({ spanUs: Math.max(50_000, Math.min(3_600_000_000, spanUs)) }),
  setEnd: (endUs) => set({ endUs }),
  pointAt: (machine, state, timeUs) => {
    const s = get();
    // Move the window so the instant is in view, and put the cursor on it.
    const end = s.endUs;
    const inView = end === null ? false : timeUs <= end && timeUs >= end - s.spanUs;
    set({
      cursorUs: timeUs,
      endUs: inView ? end : timeUs + s.spanUs / 2,
      highlight: machine ? { machine, state, nonce: Date.now() } : s.highlight,
    });
  },
}));
