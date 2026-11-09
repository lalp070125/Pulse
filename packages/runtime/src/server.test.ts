import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PRODUCT_NAME } from '@pulso/core';
import { startServer, type PulsoServer } from './server';

let server: PulsoServer;
let base: string;

beforeAll(async () => {
  server = await startServer({ port: 0, ui: 'none' });
  base = `127.0.0.1:${server.port}`;
});
afterAll(async () => {
  await server.close();
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
