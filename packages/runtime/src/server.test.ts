import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PRODUCT_NAME, type Project } from '@pulso/core';
import { startServer, type PulsoServer } from './server';

let server: PulsoServer;
let base: string;
let tmp: string;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'pulso-'));
  server = await startServer({ port: 0, ui: 'none', projectsDir: tmp });
  base = `127.0.0.1:${server.port}`;
});
afterAll(async () => {
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('runtime server (single port)', () => {
  it('answers GET /api/health', async () => {
    const res = await fetch(`http://${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, product: PRODUCT_NAME, project: null });
  });

  it('answers unknown API routes with a JSON 404', async () => {
    const res = await fetch(`http://${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it('says hello on the /ws WebSocket and answers ping', async () => {
    const ws = new WebSocket(`ws://${base}/ws`);
    const received: unknown[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('error', reject);
      ws.on('message', (raw) => {
        received.push(JSON.parse(String(raw)));
        if (received.length === 1) ws.send(JSON.stringify({ type: 'ping' }));
        if (received.length === 2) resolve();
      });
    });
    ws.close();
    expect(received[0]).toMatchObject({ type: 'hello', product: PRODUCT_NAME });
    expect(received[1]).toEqual({ type: 'pong' });
  });

  it('does not accept WebSocket connections on other paths', async () => {
    const ws = new WebSocket(`ws://${base}/other`, { handshakeTimeout: 500 });
    const outcome = await new Promise<string>((resolve) => {
      ws.on('open', () => resolve('open'));
      ws.on('error', () => resolve('refused'));
    });
    ws.terminate();
    expect(outcome).toBe('refused');
  });

  it('answers /panels/<name> with a clear "not built" message', async () => {
    const res = await fetch(`http://${base}/panels/demo`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('demo');
  });
});

describe('project API', () => {
  const json = (method: string, url: string, body?: unknown) =>
    fetch(`http://${base}/api${url}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('creates an empty project, saves a change and reads it back', async () => {
    expect((await json('POST', '/projects', { name: 'empty-one' })).status).toBe(200);
    const got = (await (await json('GET', '/project')).json()) as {
      name: string;
      project: Project;
    };
    expect(got.name).toBe('empty-one');
    expect(got.project.globals).toEqual([]);

    got.project.globals.push({
      id: '01JSEED0000000000000000001',
      name: 'Count',
      type: { kind: 'int' },
      default: 0,
    });
    expect((await json('PUT', '/project', { project: got.project })).status).toBe(200);
    const again = (await (await json('GET', '/project')).json()) as { project: Project };
    expect(again.project.globals[0]!.name).toBe('Count');
  });

  it('refuses a project that breaks the schema and keeps the old one', async () => {
    const got = (await (await json('GET', '/project')).json()) as { project: Project };
    got.project.globals[0]!.name = '1 bad name';
    const res = await json('PUT', '/project', { project: got.project });
    expect(res.status).toBe(400);
    const again = (await (await json('GET', '/project')).json()) as { project: Project };
    expect(again.project.globals[0]!.name).toBe('Count');
  });

  it('rejects unsafe project folder names', async () => {
    expect((await json('POST', '/projects', { name: '../evil' })).status).toBe(400);
  });
});
