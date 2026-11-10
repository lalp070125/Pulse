import type { VarOwner } from './compile';
import type { MachineStatus } from './engine';
import type { Problem } from './files';
import type { TimerState } from './compile';
import type { TraceEvent } from './trace';
import type { TypeSpec, Value } from './types';

/* ----------------------------------------------------------------------------
 * The live connection between the runtime and the Studio (SPEC 3.1, 7): what
 * travels over /ws. The runtime streams; the Studio sends commands.
 * -------------------------------------------------------------------------- */

/** One variable of the deployed machine set, as the Studio needs to show it. */
export interface LiveVar {
  path: string;
  type: TypeSpec;
  owner: VarOwner;
  /** Machine name for signals; null for globals. */
  machine: string | null;
}

export interface LiveMachine {
  name: string;
  status: MachineStatus;
  state: string | null;
  held: boolean;
  faulted: boolean;
  fault: { message: string } | null;
  ticks: number;
  timers: Record<string, TimerState>;
}

/** Timing figures per machine (SPEC 5.12). */
export interface LiveTiming {
  machine: string;
  cycleMs: number;
  ticks: number;
  scanMinMs: number | null;
  scanAvgMs: number | null;
  scanMaxMs: number | null;
  /** How far the tick loop ran late against the target cycle, in ms. */
  jitterAvgMs: number;
  jitterMaxMs: number;
  /** Ticks that could not run on time (the loop had to catch up or skip). */
  overruns: number;
}

/** Everything the Studio needs to start showing the runtime (sent on connect and after Deploy). */
export interface RuntimeSnapshot {
  type: 'runtime';
  deployed: boolean;
  running: boolean;
  /** Folder name of the project that was deployed. */
  project: string | null;
  /** Wall-clock time of the Deploy, ISO text. */
  deployedAt: string | null;
  baseMs: number;
  tick: number;
  timeUs: number;
  vars: LiveVar[];
  values: Record<string, Value>;
  machines: LiveMachine[];
  timing: LiveTiming[];
  /** The latest events (so a Studio that connects late still has a log). */
  events: TraceEvent[];
  /** Name of the session file being written, if any. */
  session: string | null;
}

/** A batch of what happened since the last batch (about 20 per second). */
export interface LiveBatch {
  type: 'live';
  running: boolean;
  tick: number;
  timeUs: number;
  /** Only the values that changed. */
  values: Record<string, Value>;
  machines: LiveMachine[];
  events: TraceEvent[];
  /** Events left out of this batch because there were too many (they are still in the session file). */
  dropped: number;
  timing: LiveTiming[];
}

/** Messages the runtime sends over the live WebSocket (/ws). */
export type ServerMessage =
  | { type: 'hello'; product: string; version: string }
  | { type: 'pong' }
  | RuntimeSnapshot
  | LiveBatch
  | { type: 'error'; message: string; problems?: Problem[] };

/** Messages the Studio sends over the live WebSocket (/ws). */
export type ClientMessage =
  | { type: 'ping' }
  /** Send the full runtime state again (after looking at a recorded session). */
  | { type: 'snapshot' }
  /** Compile the saved project and load it into the runtime (stopped, at tick 0). */
  | { type: 'deploy' }
  | { type: 'start' }
  | { type: 'stop' }
  /** Advance exactly n base ticks while stopped. */
  | { type: 'step'; n: number }
  /** Force a value (logged as INJECT). */
  | { type: 'force'; path: string; value: Value };
