import { create } from 'zustand';
import type {
  LiveMachine,
  LiveTiming,
  LiveVar,
  RuntimeSnapshot,
  LiveBatch,
  TraceEvent,
  Value,
} from '@pulso/core';

/* ----------------------------------------------------------------------------
 * What the runtime is doing right now, as streamed over /ws (SPEC 7). This is
 * not a second copy of the variable list: it is filled only from the runtime's
 * own messages, and replaced on every Deploy.
 *
 * `history` keeps each variable's values over time (from SET events), and each
 * machine's state track (from TRANS events), for the waveform monitor.
 * -------------------------------------------------------------------------- */

export interface Sample {
  /** Virtual time in µs. */
  t: number;
  v: Value;
}

/** The pseudo-path of a machine's state track in `history`. */
export const stateTrack = (machine: string) => `${machine}.@state`;

const MAX_EVENTS = 20_000;
const MAX_SAMPLES = 20_000;

export interface LastTransition {
  machine: string;
  from: string;
  to: string;
  timeUs: number;
  /** Increases on every transition, so the plan can flash it once. */
  seq: number;
}

interface LiveState {
  deployed: boolean;
  running: boolean;
  project: string | null;
  deployedAt: string | null;
  baseMs: number;
  tick: number;
  timeUs: number;
  vars: LiveVar[];
  values: Record<string, Value>;
  machines: LiveMachine[];
  timing: LiveTiming[];
  events: TraceEvent[];
  dropped: number;
  history: Record<string, Sample[]>;
  lastTransition: Record<string, LastTransition>;
  session: string | null;
  /** True while showing a session file loaded from disk instead of the live runtime. */
  replay: string | null;

  applySnapshot(m: RuntimeSnapshot): void;
  applyBatch(m: LiveBatch): void;
  /** Shows a recorded session file (header + events) in place of the live runtime. */
  loadSession(name: string, lines: unknown[]): void;
  backToLive(): void;
}

let seq = 0;

function push(list: Sample[] | undefined, t: number, v: Value): Sample[] {
  const out = list ?? [];
  const last = out[out.length - 1];
  if (last && JSON.stringify(last.v) === JSON.stringify(v)) return out;
  if (last && last.t === t) out[out.length - 1] = { t, v };
  else out.push({ t, v });
  if (out.length > MAX_SAMPLES) out.splice(0, out.length - MAX_SAMPLES);
  return out;
}

/** Folds events into the history: SET gives a value, TRANS gives a machine's state. */
function absorb(
  history: Record<string, Sample[]>,
  last: Record<string, LastTransition>,
  events: TraceEvent[],
): void {
  for (const e of events) {
    if (e.type === 'SET' && e.data && typeof e.data.path === 'string') {
      history[e.data.path] = push(history[e.data.path], e.timeUs, e.data.value as Value);
    } else if (e.type === 'TRANS' && e.machine && e.data && typeof e.data.to === 'string') {
      const key = stateTrack(e.machine);
      history[key] = push(history[key], e.timeUs, e.data.to);
      last[e.machine] = {
        machine: e.machine,
        from: String(e.data.from ?? ''),
        to: e.data.to,
        timeUs: e.timeUs,
        seq: ++seq,
      };
    }
  }
}

export const useLive = create<LiveState>((set, get) => ({
  deployed: false,
  running: false,
  project: null,
  deployedAt: null,
  baseMs: 0,
  tick: 0,
  timeUs: 0,
  vars: [],
  values: {},
  machines: [],
  timing: [],
  events: [],
  dropped: 0,
  history: {},
  lastTransition: {},
  session: null,
  replay: null,

  applySnapshot(m) {
    if (get().replay) return;
    const history: Record<string, Sample[]> = {};
    for (const [p, v] of Object.entries(m.values)) history[p] = [{ t: 0, v }];
    const lastTransition: Record<string, LastTransition> = {};
    absorb(history, lastTransition, m.events);
    for (const mc of m.machines) {
      if (mc.state)
        history[stateTrack(mc.name)] = push(history[stateTrack(mc.name)], m.timeUs, mc.state);
    }
    set({
      deployed: m.deployed,
      running: m.running,
      project: m.project,
      deployedAt: m.deployedAt,
      baseMs: m.baseMs,
      tick: m.tick,
      timeUs: m.timeUs,
      vars: m.vars,
      values: m.values,
      machines: m.machines,
      timing: m.timing,
      events: m.events.slice(-MAX_EVENTS),
      dropped: 0,
      history,
      lastTransition,
      session: m.session,
    });
  },

  applyBatch(m) {
    const s = get();
    if (s.replay) return;
    const history = { ...s.history };
    const lastTransition = { ...s.lastTransition };
    absorb(history, lastTransition, m.events);
    // Values whose SET events were dropped from the batch still reach the history here.
    for (const [p, v] of Object.entries(m.values)) history[p] = push(history[p], m.timeUs, v);
    const events = m.events.length ? [...s.events, ...m.events] : s.events;
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    set({
      running: m.running,
      tick: m.tick,
      timeUs: m.timeUs,
      values: Object.keys(m.values).length ? { ...s.values, ...m.values } : s.values,
      machines: m.machines,
      timing: m.timing,
      events,
      dropped: s.dropped + m.dropped,
      history,
      lastTransition,
    });
  },

  loadSession(name, lines) {
    const header = lines[0] as {
      type: string;
      project: string;
      deployedAt: string;
      vars: LiveVar[];
      values: Record<string, Value>;
      timeUs: number;
    };
    if (!header || header.type !== 'session') throw new Error('This is not a session file');
    const events = lines.slice(1) as TraceEvent[];
    const history: Record<string, Sample[]> = {};
    for (const [p, v] of Object.entries(header.values)) history[p] = [{ t: header.timeUs, v }];
    const lastTransition: Record<string, LastTransition> = {};
    absorb(history, lastTransition, events);
    const values = { ...header.values };
    for (const e of events) {
      if (e.type === 'SET' && e.data && typeof e.data.path === 'string') {
        values[e.data.path] = e.data.value as Value;
      }
    }
    const end = events.length ? events[events.length - 1]!.timeUs : header.timeUs;
    set({
      replay: name,
      running: false,
      deployed: true,
      project: header.project,
      deployedAt: header.deployedAt,
      vars: header.vars,
      values,
      timeUs: end,
      events: events.slice(-MAX_EVENTS),
      history,
      lastTransition,
      timing: [],
    });
  },

  backToLive() {
    set({ replay: null });
  },
}));

/** Readable virtual time: 12.345 s. */
export function timeText(us: number): string {
  return `${(us / 1_000_000).toFixed(3)} s`;
}

/** Virtual time to the microsecond, for the event log: 12.345678 s. */
export function timeTextUs(us: number): string {
  return `${(us / 1_000_000).toFixed(6)} s`;
}
