import {
  compileProject,
  EngineFault,
  type CAction,
  type CCondition,
  type CMachine,
  type CompiledProject,
  type ExecContext,
  type TimerState,
} from './compile';
import { SimDriver, type Driver } from './driver';
import type { Problem } from './files';
import type { Project } from './schema';
import type { CondLogMode, TraceEvent, TraceType } from './trace';
import { checkValue, cloneValue, valueText, valuesEqual, type Value } from './types';

/* ----------------------------------------------------------------------------
 * The engine: parallel state machines on a deterministic scan cycle (SPEC 5.8).
 *
 * Time comes only from the tick counter. The engine's base tick is the greatest
 * common divisor of all machine cycle times; each machine scans on the base
 * ticks where its own cycle is due.
 * -------------------------------------------------------------------------- */

export class CompileError extends Error {
  constructor(readonly problems: Problem[]) {
    super(
      `The project has ${problems.filter((p) => p.level === 'error').length} error(s):\n` +
        problems
          .filter((p) => p.level === 'error')
          .map((p) => `- ${p.where}: ${p.message}`)
          .join('\n'),
    );
  }
}

export interface EngineOptions {
  /** Drivers by id. Defaults to one SimDriver ('sim') built from the project's device models. */
  drivers?: Driver[];
  condLog?: CondLogMode;
  /** Called for every trace event. Without it, events are kept in memory (see `trace()`). */
  onEvent?: (e: TraceEvent) => void;
  /**
   * Optional wall clock (ms, fractional) supplied by the host, used only to measure
   * scan duration. The engine never reads a clock itself.
   */
  now?: () => number;
}

export type MachineStatus = 'idle' | 'running' | 'held' | 'faulted';

export interface MachineView {
  id: string;
  name: string;
  status: MachineStatus;
  /** Active state name; null before the first tick. */
  state: string | null;
  held: boolean;
  faulted: boolean;
  fault: { message: string; stack?: string } | null;
  ticks: number;
  timers: Record<string, TimerState>;
}

export interface MachineTiming {
  ticks: number;
  /** Scan duration in ms; null without a host clock. */
  scanMinMs: number | null;
  scanAvgMs: number | null;
  scanMaxMs: number | null;
}

interface MachineRun {
  c: CMachine;
  /** Active node index; -1 before Init. */
  active: number;
  held: number | null; // index of the interrupt that holds the machine
  faulted: { message: string; stack?: string } | null;
  ticks: number;
  timers: TimerState[];
  edges: Map<string, { prev: Value; cur: Value }>;
  /** Last value sent to each driver, per path (BUS events on change only). */
  sent: Map<string, Value>;
  scanTotalMs: number;
  scanMinMs: number;
  scanMaxMs: number;
}

const ONE_SECOND_US = 1_000_000;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export class Engine {
  readonly compiled: CompiledProject;
  /** Length of one engine tick in ms (GCD of all machine cycle times). */
  readonly baseMs: number;
  /** Number of base ticks executed. */
  tick = 0;

  private values = new Map<string, Value>();
  private machines: MachineRun[];
  private byName = new Map<string, MachineRun>();
  private byId = new Map<string, MachineRun>();
  private drivers = new Map<string, Driver>();
  private events: TraceEvent[] = [];
  private condMemory = new Map<string, { result: boolean; loggedUs: number }>();
  private busSeen = new Map<string, Value>();
  private current: MachineRun | null = null;
  private readonly condLog: CondLogMode;
  private readonly onEvent?: (e: TraceEvent) => void;
  private readonly now?: () => number;

  constructor(project: Project, options: EngineOptions = {}) {
    const compiled = compileProject(project);
    if (compiled.problems.some((p) => p.level === 'error'))
      throw new CompileError(compiled.problems);
    this.compiled = compiled;
    this.condLog = options.condLog ?? 'onChange';
    this.onEvent = options.onEvent;
    this.now = options.now;

    for (const d of options.drivers ?? [new SimDriver(compiled.simModels)])
      this.drivers.set(d.id, d);
    for (const v of compiled.vars.values()) this.values.set(v.path, cloneValue(v.initial));

    this.baseMs =
      compiled.machines.reduce((g, m) => gcd(g, m.cycleMs), 0) || project.info.defaultCycleMs;
    this.machines = compiled.machines.map((c) => {
      const run: MachineRun = {
        c,
        active: -1,
        held: null,
        faulted: null,
        ticks: 0,
        timers: c.timers.map((t) => ({
          name: t.name,
          presetMs: t.presetMs,
          elapsedMs: 0,
          running: false,
          done: false,
        })),
        edges: new Map(
          c.edgePaths.map((p) => {
            const v = this.values.get(p)!;
            return [p, { prev: v, cur: v }];
          }),
        ),
        sent: new Map(),
        scanTotalMs: 0,
        scanMinMs: Infinity,
        scanMaxMs: 0,
      };
      this.byName.set(c.name, run);
      this.byId.set(c.id, run);
      return run;
    });
  }

  /** Virtual time in microseconds. */
  get timeUs(): number {
    return this.tick * this.baseMs * 1000;
  }

  /** Advances exactly `n` base ticks, as fast as possible. */
  step(n = 1): void {
    for (let i = 0; i < n; i++) this.stepOnce();
  }

  /** Advances virtual time by `ms` (rounded up to whole base ticks). */
  runForMs(ms: number): void {
    this.step(Math.ceil(ms / this.baseMs));
  }

  private stepOnce() {
    this.tick++;
    const timeMs = this.tick * this.baseMs;
    for (const d of this.drivers.values()) d.advance?.(this.timeUs);
    for (const m of this.machines) {
      if (!m.faulted && timeMs % m.c.cycleMs === 0) this.scan(m);
    }
  }

  /* --- the scan cycle (SPEC 5.8) ----------------------------------------- */

  private scan(m: MachineRun) {
    const started = this.now?.();
    this.current = m;
    m.ticks++;
    try {
      // 1. Read the input snapshot from the drivers.
      this.readInputs(m);

      // 2. Advance timers (frozen while held); update edge detectors.
      if (m.held === null) {
        for (const t of m.timers) {
          if (!t.running) continue;
          t.elapsedMs += m.c.cycleMs;
          if (t.elapsedMs >= t.presetMs) {
            t.elapsedMs = t.presetMs;
            t.done = true;
            t.running = false;
          }
        }
      }
      for (const [path, mem] of m.edges) {
        mem.prev = mem.cur;
        mem.cur = cloneValue(this.values.get(path)!);
      }

      if (m.active < 0) {
        // First tick: Init enters the first state. That is this tick's one transition.
        this.enter(m, m.c.initial, 'Init');
      } else {
        let fired = false;

        // 3a. Abort handlers, checked in every state (except their own target).
        for (const ab of m.c.aborts) {
          if (m.active === ab.to) continue;
          if (this.evalCondition(m, ab.condition, `abort ${ab.id}`)) {
            const from = m.c.nodes[m.active]!.name;
            m.held = null;
            this.switchState(
              m,
              ab.to,
              `${from} → ${m.c.nodes[ab.to]!.name} (abort: ${ab.condition.name})`,
            );
            fired = true;
            break;
          }
        }

        // 3b. Interrupt handlers: hold on trigger, continue on resume.
        if (!fired) {
          if (m.held !== null) {
            const it = m.c.interrupts[m.held]!;
            if (this.evalCondition(m, it.resume, `resume ${it.id}`)) {
              m.held = null;
              this.emit(m, 'TRANS', `${this.stateName(m)}: resumed (${it.resume.name})`, {
                kind: 'resume',
                interrupt: it.id,
              });
            }
          } else {
            for (let i = 0; i < m.c.interrupts.length; i++) {
              const it = m.c.interrupts[i]!;
              if (this.evalCondition(m, it.trigger, `trigger ${it.id}`)) {
                m.held = i;
                this.emit(m, 'TRANS', `${this.stateName(m)}: held (${it.trigger.name})`, {
                  kind: 'hold',
                  interrupt: it.id,
                });
                this.runActions(m, it.onHold, 'hold');
                break;
              }
            }
          }
        }

        // 4. Transitions of the active state by priority; the first true one wins.
        if (!fired && m.held === null) {
          for (const t of m.c.transitionsFrom[m.active]!) {
            if (this.evalCondition(m, t.condition, `transition ${t.id}`)) {
              const from = m.c.nodes[m.active]!.name;
              this.switchState(m, t.to, `${from} → ${m.c.nodes[t.to]!.name} (${t.condition.name})`);
              fired = true;
              break;
            }
          }
        }

        // 5. No transition and not held: run Steps.
        if (!fired && m.held === null) this.runActions(m, m.c.nodes[m.active]!.steps, 'steps');
      }

      // 6. Write the output snapshot to the drivers.
      this.writeOutputs(m);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      m.faulted = { message, stack: e instanceof Error ? e.stack : undefined };
      this.emit(m, 'FAULT', `Machine ${m.c.name} faulted: ${message}`, {
        message,
        stack: m.faulted.stack,
        expected: e instanceof EngineFault,
      });
    } finally {
      this.current = null;
      // 7. Timing figures.
      if (started !== undefined && this.now) {
        const ms = this.now() - started;
        m.scanTotalMs += ms;
        m.scanMinMs = Math.min(m.scanMinMs, ms);
        m.scanMaxMs = Math.max(m.scanMaxMs, ms);
      }
    }
  }

  private readInputs(m: MachineRun) {
    const byDriver = new Map<string, string[]>();
    for (const path of m.c.inputs) {
      const route = this.compiled.routes.get(path);
      const from = route?.read[0];
      if (!from) continue;
      if (!byDriver.has(from)) byDriver.set(from, []);
      byDriver.get(from)!.push(path);
    }
    for (const [id, paths] of byDriver) {
      const driver = this.drivers.get(id);
      if (!driver) continue;
      const got = driver.readInputs(paths);
      for (const path of paths) {
        if (!(path in got)) continue;
        const v = got[path]!;
        const info = this.compiled.vars.get(path)!;
        const bad = checkValue(info.type, v, path);
        if (bad) throw new EngineFault(`driver '${id}' delivered a bad value: ${bad}`);
        const key = `${id}<${path}`;
        const seen = this.busSeen.get(key);
        if (seen === undefined || !valuesEqual(seen, v)) {
          this.busSeen.set(key, cloneValue(v));
          this.emit(m, 'BUS', `${id} → ${path} = ${valueText(v)}`, {
            driver: id,
            path,
            value: v,
            dir: 'read',
          });
        }
        this.setValue(m, path, v);
      }
    }
  }

  private writeOutputs(m: MachineRun) {
    const byDriver = new Map<string, Record<string, Value>>();
    for (const path of m.c.outputs) {
      const route = this.compiled.routes.get(path);
      if (!route) continue;
      const v = this.values.get(path)!;
      for (const id of route.write) {
        const key = `${id}>${path}`;
        const last = m.sent.get(key);
        if (last !== undefined && valuesEqual(last, v)) continue;
        m.sent.set(key, cloneValue(v));
        if (!byDriver.has(id)) byDriver.set(id, {});
        byDriver.get(id)![path] = cloneValue(v);
        this.emit(m, 'BUS', `${path} → ${id} = ${valueText(v)}`, {
          driver: id,
          path,
          value: v,
          dir: 'write',
        });
      }
    }
    for (const [id, values] of byDriver) this.drivers.get(id)?.writeOutputs(values);
  }

  /* --- states, actions, conditions ---------------------------------------- */

  private enter(m: MachineRun, index: number, from: string) {
    m.active = index;
    this.emit(m, 'TRANS', `${from} → ${m.c.nodes[index]!.name}`, {
      from,
      to: m.c.nodes[index]!.name,
    });
    this.runActions(m, m.c.nodes[index]!.onEntry, 'entry');
  }

  /** On Exit (old) → switch → On Entry (new). */
  private switchState(m: MachineRun, to: number, text: string) {
    const from = m.c.nodes[m.active]!;
    this.runActions(m, from.onExit, 'exit');
    m.active = to;
    this.emit(m, 'TRANS', text, { from: from.name, to: m.c.nodes[to]!.name });
    this.runActions(m, m.c.nodes[to]!.onEntry, 'entry');
  }

  private runActions(
    m: MachineRun,
    actions: CAction[],
    group: 'entry' | 'steps' | 'exit' | 'hold',
  ) {
    for (const a of actions) {
      const value = a.run(this.ctx(m));
      this.emit(m, 'ACTION', `${group}: ${a.text} → ${valueText(value)}`, {
        group,
        action: a.id,
        value,
      });
    }
  }

  private evalCondition(m: MachineRun, c: CCondition, role: string): boolean {
    const ctx = this.ctx(m);
    const result = c.expr.ev(ctx);
    if (typeof result !== 'boolean')
      throw new EngineFault(`condition ${c.name} did not give true/false`);
    const key = `${m.c.id}|${role}`;
    const mem = this.condMemory.get(key);
    const due =
      this.condLog === 'every' ||
      !mem ||
      mem.result !== result ||
      this.timeUs - mem.loggedUs >= ONE_SECOND_US;
    if (due) {
      const terms = c.terms.map((t) => ({ text: t.text, value: t.ev(ctx) }));
      const termText = terms.map((t) => `${t.text} = ${valueText(t.value)}`).join(', ');
      this.emit(m, 'COND', `${c.name} = ${result}  [${termText}]`, {
        condition: c.id,
        name: c.name,
        role,
        result,
        summary: c.summary,
        terms,
      });
      this.condMemory.set(key, { result, loggedUs: this.timeUs });
    } else {
      mem.result = result;
    }
    return result;
  }

  private ctx(m: MachineRun): ExecContext {
    return {
      get: (path) => {
        const v = this.values.get(path);
        if (v === undefined) throw new EngineFault(`unknown variable ${path}`);
        return v;
      },
      write: (path, value) => this.setValue(m, path, value),
      edge: (path) => {
        const e = m.edges.get(path);
        if (!e) throw new EngineFault(`no edge detector for ${path}`);
        return e;
      },
      isActive: (machineId, nodeId) => {
        const other = this.byId.get(machineId);
        return !!other && other.active >= 0 && other.c.nodes[other.active]!.id === nodeId;
      },
      timer: (index) => {
        const t = m.timers[index];
        if (!t) throw new EngineFault(`unknown timer #${index}`);
        return t;
      },
    };
  }

  private setValue(m: MachineRun | null, path: string, value: Value) {
    const old = this.values.get(path);
    if (old !== undefined && valuesEqual(old, value)) return;
    this.values.set(path, cloneValue(value));
    this.emit(m, 'SET', `${path} = ${valueText(value)}`, { path, value, old });
  }

  private stateName(m: MachineRun): string {
    return m.active >= 0 ? m.c.nodes[m.active]!.name : 'Init';
  }

  private emit(
    m: MachineRun | null,
    type: TraceType,
    text: string,
    data?: Record<string, unknown>,
  ) {
    const e: TraceEvent = {
      tick: this.tick,
      timeUs: this.timeUs,
      machine: m ? m.c.name : null,
      state: m && m.active >= 0 ? m.c.nodes[m.active]!.name : null,
      type,
      text,
    };
    if (data) e.data = data;
    if (this.onEvent) this.onEvent(e);
    else this.events.push(e);
  }

  /* --- public inspection and control -------------------------------------- */

  /** Current value of a variable by its address. */
  get(path: string): Value {
    const v = this.values.get(path);
    if (v === undefined) throw new Error(`Unknown variable ${path}`);
    return cloneValue(v);
  }

  /**
   * Forces a value (logged as INJECT). Feedback read from a driver is forced in that
   * driver too, so the next input snapshot keeps it.
   */
  inject(path: string, value: Value): void {
    const info = this.compiled.vars.get(path);
    if (!info) throw new Error(`Unknown variable ${path}`);
    const bad = checkValue(info.type, value, path);
    if (bad) throw new Error(bad);
    this.emit(null, 'INJECT', `${path} = ${valueText(value)}`, { path, value });
    const from = this.compiled.routes.get(path)?.read[0];
    if (from) this.drivers.get(from)?.inject?.(path, value);
    this.setValue(this.current, path, value);
  }

  /** Puts a machine straight into a state, without running any actions (test "inject state"). */
  injectState(machine: string, state: string): void {
    const m = this.machineRun(machine);
    const index = m.c.nodes.findIndex((n) => n.name === state);
    if (index < 0) throw new Error(`Machine ${machine} has no state ${state}`);
    m.active = index;
    m.held = null;
    this.emit(m, 'INJECT', `${machine} state = ${state}`, { machine, state });
  }

  /**
   * Evaluates a named condition of a machine now, without logging or side effects.
   * Edge terms report the edge seen on the machine's last scan.
   */
  condition(machine: string, name: string): boolean {
    const m = this.machineRun(machine);
    const c = m.c.conditions.find((x) => x.name === name);
    if (!c) throw new Error(`Machine ${machine} has no condition ${name}`);
    const v = c.expr.ev(this.ctx(m));
    if (typeof v !== 'boolean') throw new Error(`Condition ${name} did not give true/false`);
    return v;
  }

  driver<T extends Driver = Driver>(id: string): T {
    const d = this.drivers.get(id);
    if (!d) throw new Error(`No driver ${id}`);
    return d as T;
  }

  machine(name: string): MachineView {
    const m = this.machineRun(name);
    const timers: Record<string, TimerState> = {};
    for (const t of m.timers) timers[t.name] = { ...t };
    return {
      id: m.c.id,
      name: m.c.name,
      status: m.faulted ? 'faulted' : m.held !== null ? 'held' : m.active < 0 ? 'idle' : 'running',
      state: m.active >= 0 ? m.c.nodes[m.active]!.name : null,
      held: m.held !== null,
      faulted: m.faulted !== null,
      fault: m.faulted ? { ...m.faulted } : null,
      ticks: m.ticks,
      timers,
    };
  }

  machineNames(): string[] {
    return this.machines.map((m) => m.c.name);
  }

  timing(name: string): MachineTiming {
    const m = this.machineRun(name);
    const has = this.now !== undefined && m.ticks > 0;
    return {
      ticks: m.ticks,
      scanMinMs: has ? m.scanMinMs : null,
      scanAvgMs: has ? m.scanTotalMs / m.ticks : null,
      scanMaxMs: has ? m.scanMaxMs : null,
    };
  }

  /** Events kept in memory (only when no `onEvent` listener was given). */
  trace(): TraceEvent[] {
    return this.events;
  }

  clearTrace(): void {
    this.events = [];
  }

  private machineRun(name: string): MachineRun {
    const m = this.byName.get(name);
    if (!m) throw new Error(`No machine named ${name}`);
    return m;
  }
}

export function createEngine(project: Project, options?: EngineOptions): Engine {
  return new Engine(project, options);
}
