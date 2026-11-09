import { cloneValue, type Value } from './types';

/* ----------------------------------------------------------------------------
 * Drivers: the hardware seam (SPEC 5.9). Machine logic never names an address;
 * the routing table decides which driver carries which variable.
 * -------------------------------------------------------------------------- */

export type DriverStatus = 'connected' | 'connecting' | 'offline';

export interface Driver {
  id: string;
  connect(): Promise<void>;
  /** World → logic. Paths the driver does not know are left out of the result. */
  readInputs(paths: string[]): Record<string, Value>;
  /** Logic → world. */
  writeOutputs(values: Record<string, Value>): void;
  status(): DriverStatus;
  /** Optional: called once per engine base tick with virtual time, before any machine runs. */
  advance?(timeUs: number): void;
  /** Optional: a value forced by a user or a test (logged as INJECT by the engine). */
  inject?(path: string, value: Value): void;
}

/** A built-in device model with its variables resolved to full paths. */
export type SimModelSpec =
  | { kind: 'follow'; command: string; feedback: string; delayMs: number }
  | { kind: 'cylinder'; command: string; extended: string; retracted: string; travelMs: number };

interface FollowState {
  spec: Extract<SimModelSpec, { kind: 'follow' }>;
  /** Virtual time (µs) at which the command last changed. */
  changedAtUs: number;
  lastCommand: Value | undefined;
}
interface CylinderState {
  spec: Extract<SimModelSpec, { kind: 'cylinder' }>;
  /** Position in ms of travel: 0 = fully retracted, travelMs = fully extended. */
  positionMs: number;
}

/**
 * SimDriver: holds values in memory. Feedback can be set by the user, by tests
 * (inject), or by simple built-in device models. Deterministic: it only moves
 * when the engine calls `advance` with virtual time.
 */
export class SimDriver implements Driver {
  readonly id = 'sim';
  private values = new Map<string, Value>();
  private frozen = new Set<string>();
  private follows: FollowState[] = [];
  private cylinders: CylinderState[] = [];
  private lastTimeUs: number | null = null;

  constructor(models: SimModelSpec[] = []) {
    for (const spec of models) {
      if (spec.kind === 'follow') {
        this.follows.push({ spec, changedAtUs: 0, lastCommand: undefined });
      } else {
        this.cylinders.push({ spec, positionMs: 0 });
        this.values.set(spec.extended, false);
        this.values.set(spec.retracted, true);
      }
    }
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  status(): DriverStatus {
    return 'connected';
  }

  readInputs(paths: string[]): Record<string, Value> {
    const out: Record<string, Value> = {};
    for (const p of paths) {
      const v = this.values.get(p);
      if (v !== undefined) out[p] = cloneValue(v);
    }
    return out;
  }

  writeOutputs(values: Record<string, Value>): void {
    for (const [p, v] of Object.entries(values)) this.setValue(p, v);
  }

  inject(path: string, value: Value): void {
    this.values.set(path, cloneValue(value));
  }

  /** Current value held for a path (for inspection and tests). */
  peek(path: string): Value | undefined {
    return this.values.get(path);
  }

  /** Fault injection: the signal keeps its value; models and writes no longer change it. */
  freeze(path: string, value?: Value): void {
    if (value !== undefined) this.values.set(path, cloneValue(value));
    this.frozen.add(path);
  }

  unfreeze(path: string): void {
    this.frozen.delete(path);
  }

  advance(timeUs: number): void {
    const dtMs = this.lastTimeUs === null ? 0 : (timeUs - this.lastTimeUs) / 1000;
    this.lastTimeUs = timeUs;

    for (const f of this.follows) {
      const cmd = this.values.get(f.spec.command);
      if (cmd !== f.lastCommand) {
        f.lastCommand = cmd;
        f.changedAtUs = timeUs;
      }
      if (cmd !== undefined && timeUs - f.changedAtUs >= f.spec.delayMs * 1000) {
        this.setValue(f.spec.feedback, cmd);
      }
    }

    for (const c of this.cylinders) {
      const extend = this.values.get(c.spec.command) === true;
      c.positionMs = extend
        ? Math.min(c.spec.travelMs, c.positionMs + dtMs)
        : Math.max(0, c.positionMs - dtMs);
      this.setValue(c.spec.extended, c.positionMs >= c.spec.travelMs);
      this.setValue(c.spec.retracted, c.positionMs <= 0);
    }
  }

  private setValue(path: string, value: Value) {
    if (this.frozen.has(path)) return;
    this.values.set(path, cloneValue(value));
  }
}
