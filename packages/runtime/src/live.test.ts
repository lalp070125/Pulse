import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { LiveBatch, Project, RuntimeSnapshot, ServerMessage } from '@pulso/core';
import { LiveRuntime, type LiveClock } from './live';
import { buildBoxSealer } from './seed/boxSealer';
import { startServer, type PulsoServer } from './server';
import { saveProject } from './store';

/* The live runtime (SPEC 5.8, 7) on a manual clock: time passes only when the test says so. */

class ManualClock implements LiveClock {
  t = 1000;
  private timers: { every: number; next: number; fn: () => void; on: boolean }[] = [];
  now = () => this.t;
  every = (ms: number, fn: () => void) => {
    const timer = { every: ms, next: this.t + ms, fn, on: true };
    this.timers.push(timer);
    return () => {
      timer.on = false;
    };
  };
  /** Moves time forward, firing every timer that falls due on the way, in order. */
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers
        .filter((x) => x.on && x.next <= end)
        .sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      this.t = due.next;
      due.next += due.every;
      due.fn();
    }
    this.t = end;
  }
  /** Moves time forward without any timer firing (a stalled host). */
  jump(ms: number) {
    this.t += ms;
    for (const x of this.timers) x.next = Math.max(x.next, this.t);
  }
}

function setup() {
  const clock = new ManualClock();
  const rt = new LiveRuntime({ clock });
  const got: ServerMessage[] = [];
  rt.subscribe((m) => got.push(m));
  return { clock, rt, got };
}
const batches = (got: ServerMessage[]) => got.filter((m): m is LiveBatch => m.type === 'live');

describe('live runtime', () => {
  it('deploys stopped at tick 0 and sends a snapshot with variables and machines', () => {
    const { rt, got } = setup();
    expect(rt.deploy(buildBoxSealer(), 'demo')).toEqual({ ok: true });
    const snap = got.filter((m): m is RuntimeSnapshot => m.type === 'runtime').at(-1)!;
    expect(snap).toMatchObject({
      deployed: true,
      running: false,
      project: 'demo',
      tick: 0,
      baseMs: 10,
    });
    expect(snap.vars.find((v) => v.path === 'Sealer.BoxAtStop.ISensor.Present')).toMatchObject({
      owner: 'feedback',
      machine: 'Sealer',
    });
    expect(snap.machines[0]).toMatchObject({ name: 'Sealer', state: null, status: 'idle' });
  });

  it('runs on the clock: 100 ms of time is 10 ticks of 10 ms; Stop freezes it', () => {
    const { clock, rt } = setup();
    rt.deploy(buildBoxSealer(), 'demo');
    rt.start();
    clock.advance(100);
    expect(rt.current!.tick).toBe(10);
    expect(rt.current!.machine('Sealer').state).toBe('Idle');
    rt.stop();
    clock.advance(500);
    expect(rt.current!.tick).toBe(10);
    rt.start(); // continues where it was
    clock.advance(50);
    expect(rt.current!.tick).toBe(15);
  });

  it('streams batches with only the changed values and the new events', () => {
    const { clock, rt, got } = setup();
    rt.deploy(buildBoxSealer(), 'demo');
    rt.start();
    clock.advance(30);
    rt.force('Global.Start', true);
    clock.advance(100);
    const all = batches(got);
    const events = all.flatMap((b) => b.events);
    expect(events.some((e) => e.type === 'INJECT' && e.text === 'Global.Start = true')).toBe(true);
    expect(events.some((e) => e.type === 'TRANS' && e.text === 'Idle → Feed (StartPressed)')).toBe(
      true,
    );
    const changed = all.flatMap((b) => Object.keys(b.values));
    expect(changed).toContain('Global.Running');
    expect(changed).not.toContain('Global.BoxCount'); // never changed
    expect(all.at(-1)!.machines[0]!.state).toBe('Feed');
  });

  it('Step runs exact ticks only while stopped; forcing a sensor fires the transition', () => {
    const { rt } = setup();
    rt.deploy(buildBoxSealer(), 'demo');
    expect(rt.step(1)).toBe(true);
    rt.force('Global.Start', true);
    rt.step(1);
    expect(rt.current!.machine('Sealer').state).toBe('Feed');
    rt.force('Sealer.BoxAtStop.ISensor.Present', true);
    rt.step(1);
    expect(rt.current!.machine('Sealer').state).toBe('Push');
    rt.start();
    expect(rt.step(1)).toBe(false);
  });

  it('refuses to deploy a project with errors and says which', () => {
    const { rt, got } = setup();
    const p: Project = buildBoxSealer();
    p.machines[0]!.machine.initial = null;
    const r = rt.deploy(p, 'broken');
    expect(r.ok).toBe(false);
    expect(got.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('Init node'),
    });
  });

  it('measures jitter and counts overruns when the host stalls', () => {
    const { clock, rt } = setup();
    rt.deploy(buildBoxSealer(), 'demo');
    rt.start();
    clock.advance(100);
    expect(rt.snapshot().timing[0]).toMatchObject({
      machine: 'Sealer',
      overruns: 0,
      jitterMaxMs: 0,
    });
    clock.jump(400); // the host was blocked for 400 ms (40 ticks late)
    clock.advance(10);
    const t = rt.snapshot().timing[0]!;
    expect(t.overruns).toBeGreaterThan(0);
    expect(t.jitterMaxMs).toBeGreaterThanOrEqual(390);
    // 41 ticks were due: 20 are caught up, the other 20 are skipped and counted as overruns.
    expect(rt.current!.tick).toBe(31);
  });
});

describe('live runtime over the WebSocket, with session files', () => {
  let server: PulsoServer;
  let tmp: string;
  const clock = new ManualClock();

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), 'pulso-live-'));
    const seed = buildBoxSealer();
    seed.info.name = 'demo';
    await saveProject(path.join(tmp, 'demo'), seed);
    server = await startServer({ port: 0, ui: 'none', projectsDir: tmp, project: 'demo', clock });
  });
  afterAll(async () => {
    await server.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('Deploy, Start, force, Stop from a client; the run is written to a session file', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    const got: ServerMessage[] = [];
    ws.on('message', (raw) => got.push(JSON.parse(String(raw)) as ServerMessage));
    await new Promise<void>((r) => ws.on('open', () => r()));
    const send = (m: object) => ws.send(JSON.stringify(m));
    const until = async (ok: () => boolean) => {
      for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
      expect(ok()).toBe(true);
    };

    send({ type: 'deploy' });
    await until(() => got.some((m) => m.type === 'runtime' && m.deployed));
    send({ type: 'start' });
    await until(() => server.live.isRunning);
    clock.advance(50);
    send({ type: 'force', path: 'Global.Start', value: true });
    await until(() => server.live.current!.get('Global.Start') === true);
    clock.advance(50);
    send({ type: 'stop' });
    await until(() => !server.live.isRunning);
    await until(() => batches(got).some((b) => b.machines[0]?.state === 'Feed'));

    const list = (await (await fetch(`http://127.0.0.1:${server.port}/api/sessions`)).json()) as {
      current: string;
      sessions: { name: string }[];
    };
    expect(list.sessions.map((s) => s.name)).toContain(list.current);
    // Give the file stream a moment to flush, then read it back.
    await new Promise((r) => setTimeout(r, 100));
    const text = readFileSync(path.join(tmp, '.sessions', list.current), 'utf8')
      .trim()
      .split('\n');
    const header = JSON.parse(text[0]!) as { type: string; vars: unknown[] };
    expect(header.type).toBe('session');
    expect(header.vars.length).toBeGreaterThan(10);
    expect(text.some((l) => l.includes('"Idle → Feed (StartPressed)"'))).toBe(true);
    const viaApi = await (
      await fetch(`http://127.0.0.1:${server.port}/api/sessions/${list.current}`)
    ).text();
    expect(viaApi.split('\n')[0]).toBe(text[0]);
    expect(
      (await fetch(`http://127.0.0.1:${server.port}/api/sessions/..%2Fsecret.jsonl`)).status,
    ).toBe(404);
    ws.close();
  });
});
