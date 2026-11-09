import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { WebSocketServer } from 'ws';
import {
  DEFAULT_PORT,
  PRODUCT_NAME,
  type ClientMessage,
  type HealthInfo,
  type ServerMessage,
} from '@pulso/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(here, '../../studio');
const VERSION = '0.0.1';

export interface PulsoServerOptions {
  port?: number;
  /**
   * How the UI is served:
   *  - 'dev'    Vite in middleware mode (live reload) on the same port
   *  - 'static' the built files from packages/studio/dist
   *  - 'none'   API and WebSocket only (used by tests)
   */
  ui?: 'dev' | 'static' | 'none';
}

export interface PulsoServer {
  app: Express;
  http: Server;
  port: number;
  close(): Promise<void>;
}

/** Starts the one server that carries everything: UI, /api, /ws and /panels (SPEC 3.1). */
export async function startServer(options: PulsoServerOptions = {}): Promise<PulsoServer> {
  const requestedPort = options.port ?? DEFAULT_PORT;
  const ui = options.ui ?? 'dev';

  const app = express();
  const http = createServer(app);
  app.disable('x-powered-by');
  app.use(express.json());

  // --- REST API -----------------------------------------------------------
  const api = express.Router();
  api.get('/health', (_req, res) => {
    const info: HealthInfo = {
      ok: true,
      product: PRODUCT_NAME,
      version: VERSION,
      address: `127.0.0.1:${boundPort()}`,
      project: null,
    };
    res.json(info);
  });
  api.use((_req, res) => {
    res.status(404).json({ ok: false, error: 'Unknown API route' });
  });
  app.use('/api', api);

  // --- Built operator panels (Phase 7) --------------------------------------
  app.get('/panels/:name', (req, res) => {
    res
      .status(404)
      .type('text/plain')
      .send(
        `No built panel named "${req.params.name}". Panels are built in ${PRODUCT_NAME} Panel.`,
      );
  });

  // --- Live WebSocket at /ws ------------------------------------------------
  // noServer mode: we only take upgrades for /ws, so Vite's live-reload socket
  // can share the same port in development.
  const wss = new WebSocketServer({ noServer: true });
  http.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname !== '/ws') {
      // In development Vite owns the remaining upgrades (live reload); otherwise refuse.
      if (ui !== 'dev') socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    const send = (msg: ServerMessage) => ws.send(JSON.stringify(msg));
    send({ type: 'hello', product: PRODUCT_NAME, version: VERSION });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as ClientMessage;
        if (msg.type === 'ping') send({ type: 'pong' });
      } catch {
        // Ignore anything that is not valid JSON.
      }
    });
  });

  // --- UI -------------------------------------------------------------------
  let closeVite: (() => Promise<void>) | undefined;
  if (ui !== 'none') {
    app.get('/', (_req, res) => res.redirect('/studio'));
  }
  if (ui === 'dev') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: studioRoot,
      configFile: path.join(studioRoot, 'vite.config.ts'),
      appType: 'spa',
      server: { middlewareMode: true, hmr: { server: http }, allowedHosts: true },
    });
    app.use(vite.middlewares);
    closeVite = () => vite.close();
  } else if (ui === 'static') {
    const dist = path.join(studioRoot, 'dist');
    if (!existsSync(path.join(dist, 'index.html'))) {
      throw new Error('UI is not built yet. Run "npm run build" first.');
    }
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  function boundPort(): number {
    const addr = http.address();
    return addr && typeof addr === 'object' ? addr.port : requestedPort;
  }

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(requestedPort, '0.0.0.0', () => resolve());
  });

  return {
    app,
    http,
    port: boundPort(),
    async close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
      await closeVite?.();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
