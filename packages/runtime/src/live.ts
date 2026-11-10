import {
  CompileError,
  Engine,
  compileProject,
  type LiveBatch,
  type LiveMachine,
  type LiveTiming,
  type LiveVar,
  type Project,
  type RuntimeSnapshot,
  type ServerMessage,
  type TraceEvent,
  type Value,
} from '@pulso/core';

/* ----------------------------------------------------------------------------
 * The live runtime (SPEC 5.8, 7): runs the deployed project on the wall clock,
 * one engine per Deploy, and streams what happens. Each machine keeps its own
 * cycle time; the engine runs on the base tick (their common divisor).
 *
 * Time never comes from inside the engine. This host turns wall-clock time into
 * a number of engine ticks, so the logic stays deterministic: the same inputs and
 * the same tick count give the same result.
 * -------------------------------------------------------------------------- */

/** The host's clock and timer, replaceable in tests. */
export interface LiveClock {
  /** Milliseconds, fractional, monotonic. */
  now(): number;
  every(ms: number, fn: () => void): () => void;
}

export const realClock: LiveClock = {
  now: () => performance.now(),
  every: (ms, fn) => {
    const h = setInterval(fn, ms);
    return () => clearInterval(h);
  },
};

export interface LiveOptions {
  clock?: LiveClock;
  /** How often a batch is sent to the Studio (ms). */
  batchMs?: number;
  /** Most events sent in one batch; the rest are counted as dropped (still in the session file). */
  maxEventsPerBatch?: number;
  /** Events kept in memory for a Studio that connects late. */
  keepEvents?: number;
  /** Ticks the loop may catch up in one go before it counts the rest as overruns and skips them. */
  maxCatchUp?: number;
  /** Receives every event (the session file writer). */
  onEvent?: (e: TraceEvent) => void;
}

interface JitterStat {
  sum: number;
  max: number;
  n: number;
  overruns: number;
}

export class LiveRuntime {
  private engine: Engine | null = null;
  private project: string | null = null;
  private deployedAt: string | null = null;
  private vars: LiveVar[] = [];
  private running = false;
  private stopLoop: (() => void) | null = null;
  private stopBatch: (() => void) | null = null;
  /** Wall time at which tick 0 would have run, for the running loop. */
  private t0 = 0;
  private lastLoop = 0;
  private jitter = new Map<string, JitterStat>();
  private pending: TraceEvent[] = [];
  private dropped = 0;
  private recent: TraceEvent[] = [];
  private sent = new Map<string, Value>();
  private listeners = new Set<(m: ServerMessage) => void>();
  private readonly clock: LiveClock;
  private readonly batchMs: number;
  private readonly maxEvents: number;
  private readonly keep: number;
  private readonly maxCatchUp: number;
  private readonly onEvent?: (e: TraceEvent) => void;
  session: string | null = null;

  constructor(options: LiveOptions = {}) {
    this.clock = options.clock ?? realClock;
    this.batchMs = options.batchMs ?? 50;
    this.maxEvents = options.maxEventsPerBatch ?? 2000;
    this.keep = options.keepEvents ?? 5000;
    this.maxCatchUp = options.maxCatchUp ?? 20;
    this.onEvent = options.onEvent;
  }

  /** Everyone who gets the stream (one per connected Studio or panel). */
  subscribe(fn: (m: ServerMessage) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  private broadcast(m: ServerMessage) {
    for (const fn of this.listeners) fn(m);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get current(): Engine | null {
    return this.engine;
  }

  /**
   * Compiles the project and loads it, stopped at tick 0. Refuses a project with errors,
   * and says which.
   */
  deploy(project: Project, folder: string): { ok: true } | { ok: false; message: string } {
    const compiled = compileProject(project);
    const errors = compiled.problems.filter((p) => p.level === 'error');
    if (errors.length) {
      const message = `Deploy refused: ${errors.length} error(s). First: ${errors[0]!.where}: ${errors[0]!.message}`;
      this.broadcast({ type: 'error', message, problems: errors });
      return { ok: false, message };
    }
    this.stop();
    let engine: Engine;
    try {
      engine = new Engine(project, {
        now: () => this.clock.now(),
        onEvent: (e) => this.event(e),
      });
    } catch (e) {
      const message =
        e instanceof CompileError ? 'Deploy refused: the project has errors' : String(e);
      this.broadcast({ type: 'error', message });
      return { ok: false, message };
    }
    this.engine = engine;
    this.project = folder;
    this.deployedAt = new Date().toISOString();
    this.vars = [...engine.compiled.vars.values()].map((v) => ({
      path: v.path,
      type: v.type,
      owner: v.owner,
      machine: v.machine
        ? (engine.compiled.machines.find((m) => m.id === v.machine)?.name ?? null)
        : null,
    }));
    this.jitter = new Map(
      engine.machineNames().map((n) => [n, { sum: 0, max: 0, n: 0, overruns: 0 }]),
    );
    this.pending = [];
    this.recent = [];
    this.dropped = 0;
    this.sent = new Map(this.vars.map((v) => [v.path, engine.get(v.path)]));
    this.broadcast(this.snapshot());
    return { ok: true };
  }

  start(): boolean {
    const engine = this.engine;
    if (!engine || this.running) return false;
    this.running = true;
    // Continue from the current tick: tick k is due at t0 + k * baseMs.
    const now = this.clock.now();
    this.t0 = now - engine.tick * engine.baseMs;
    this.lastLoop = now;
    this.stopLoop = this.clock.every(engine.baseMs, () => this.loop());
    this.stopBatch = this.clock.every(this.batchMs, () => this.flush());
    this.flush();
    return true;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.stopLoop?.();
    this.stopBatch?.();
    this.stopLoop = this.stopBatch = null;
    this.flush();
  }

  /** Exactly n base ticks, only while stopped (Step button). */
  step(n: number): boolean {
    if (!this.engine || this.running) return false;
    this.engine.step(Math.max(1, Math.min(10_000, Math.trunc(n))));
    this.flush();
    return true;
  }

  force(path: string, value: Value): { ok: true } | { ok: false; message: string } {
    if (!this.engine) return { ok: false, message: 'Nothing is deployed' };
    try {
      this.engine.inject(path, value);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
    if (!this.running) this.flush();
    return { ok: true };
  }

  /** Runs every tick that is due by now; late ticks are caught up, very late ones skipped. */
  private loop() {
    const engine = this.engine;
    if (!engine || !this.running) return;
    const now = this.clock.now();
    const due = Math.floor((now - this.t0) / engine.baseMs);
    let n = due - engine.tick;
    // Jitter: how much later than one base cycle this loop ran.
    const late = Math.max(0, now - this.lastLoop - engine.baseMs);
    this.lastLoop = now;
    const skipped = Math.max(0, n - this.maxCatchUp);
    if (skipped > 0) {
      // Too far behind: run what we can and move the time base so we do not spiral.
      this.t0 += skipped * engine.baseMs;
      n = this.maxCatchUp;
    }
    for (const m of engine.compiled.machines) {
      const j = this.jitter.get(m.name)!;
      j.sum += late;
      j.n++;
      j.max = Math.max(j.max, late);
      if (n > 1) j.overruns += n - 1;
      if (skipped > 0) j.overruns += skipped;
    }
    if (n > 0) engine.step(n);
  }

  private event(e: TraceEvent) {
    this.onEvent?.(e);
    if (this.pending.length < this.maxEvents) this.pending.push(e);
    else this.dropped++;
    this.recent.push(e);
    if (this.recent.length > this.keep) this.recent.splice(0, this.recent.length - this.keep);
  }

  private machines(): LiveMachine[] {
    const engine = this.engine;
    if (!engine) return [];
    return engine.machineNames().map((name) => {
      const v = engine.machine(name);
      return {
        name: v.name,
        status: v.status,
        state: v.state,
        held: v.held,
        faulted: v.faulted,
        fault: v.fault ? { message: v.fault.message } : null,
        ticks: v.ticks,
        timers: v.timers,
      };
    });
  }

  private timing(): LiveTiming[] {
    const engine = this.engine;
    if (!engine) return [];
    return engine.compiled.machines.map((m) => {
      const t = engine.timing(m.name);
      const j = this.jitter.get(m.name) ?? { sum: 0, max: 0, n: 0, overruns: 0 };
      return {
        machine: m.name,
        cycleMs: m.cycleMs,
        ticks: t.ticks,
        scanMinMs: t.scanMinMs,
        scanAvgMs: t.scanAvgMs,
        scanMaxMs: t.scanMaxMs,
        jitterAvgMs: j.n ? j.sum / j.n : 0,
        jitterMaxMs: j.max,
        overruns: j.overruns,
      };
    });
  }

  /** Sends what changed since the last batch. */
  flush(): void {
    const engine = this.engine;
    if (!engine) return;
    const values: Record<string, Value> = {};
    for (const v of this.vars) {
      const now = engine.get(v.path);
      if (JSON.stringify(now) !== JSON.stringify(this.sent.get(v.path))) {
        values[v.path] = now;
        this.sent.set(v.path, now);
      }
    }
    const batch: LiveBatch = {
      type: 'live',
      running: this.running,
      tick: engine.tick,
      timeUs: engine.timeUs,
      values,
      machines: this.machines(),
      events: this.pending,
      dropped: this.dropped,
      timing: this.timing(),
    };
    this.pending = [];
    this.dropped = 0;
    this.broadcast(batch);
  }

  snapshot(): RuntimeSnapshot {
    const engine = this.engine;
    const values: Record<string, Value> = {};
    if (engine) for (const v of this.vars) values[v.path] = engine.get(v.path);
    return {
      type: 'runtime',
      deployed: engine !== null,
      running: this.running,
      project: this.project,
      deployedAt: this.deployedAt,
      baseMs: engine?.baseMs ?? 0,
      tick: engine?.tick ?? 0,
      timeUs: engine?.timeUs ?? 0,
      vars: this.vars,
      values,
      machines: this.machines(),
      timing: this.timing(),
      events: [...this.recent],
      session: this.session,
    };
  }

  close(): void {
    this.stop();
    this.listeners.clear();
  }
}
