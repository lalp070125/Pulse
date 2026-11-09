/* ----------------------------------------------------------------------------
 * Trace and log events (SPEC 5.11). Logging is always on.
 * -------------------------------------------------------------------------- */

export type TraceType = 'TRANS' | 'ACTION' | 'COND' | 'LOGIC' | 'BUS' | 'INJECT' | 'SET' | 'FAULT';

export interface TraceEvent {
  /** Engine base tick number. */
  tick: number;
  /** Virtual time in microseconds. */
  timeUs: number;
  /** Machine name, or null for project-wide events (globals, injections). */
  machine: string | null;
  /** Active state of that machine when the event happened (null before Init). */
  state: string | null;
  type: TraceType;
  /** One readable line: what the log viewer shows in its Details column. */
  text: string;
  /** Structured details for tools (term values, the value written, etc.). */
  data?: Record<string, unknown>;
}

/**
 * How often COND events are logged:
 *  - 'onChange': when the result changes, plus once per second while unchanged (default)
 *  - 'every':    every evaluation
 */
export type CondLogMode = 'onChange' | 'every';
