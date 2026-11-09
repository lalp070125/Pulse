import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readdir } from 'node:fs/promises';
import express, { type Express } from 'express';
import { WebSocketServer } from 'ws';
import {
  DEFAULT_PORT,
  PRODUCT_NAME,
  type ClientMessage,
  type HealthInfo,
  type Project,
  type ServerMessage,
} from '@pulso/core';
import { loadProject, saveProject } from './store';
import { newId } from './ulid';

const here = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(here, '../../studio');
const VERSION = '0.0.1';
const defaultProjectsDir = path.resolve(here, '../../../projects');

export interface PulsoServerOptions {
  port?: number;
  /**
   * How the UI is served:
   *  - 'dev'    Vite in middleware mode (live reload) on the same port
   *  - 'static' the built files from packages/studio/dist
   *  - 'none'   API and WebSocket only (used by tests)
   */
  ui?: 'dev' | 'static' | 'none';
  /** Folder that holds the project folders. Defaults to /projects in the repo. */
  projectsDir?: string;
  /** Project folder to open first. Defaults to box-sealer-demo when it exists. */
  project?: string;
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
  app.use(express.json({ limit: '10mb' }));

  // --- Open project ---------------------------------------------------------
  const projectsDir = options.projectsDir ?? defaultProjectsDir;
  let currentName: string | null = null;
  let current: Project | null = null;
  const folderOf = (name: string) => path.join(projectsDir, name);
  const validFolder = (name: unknown): name is string =>
    typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name);

  async function openProject(name: string): Promise<string | null> {
    const { project, problems } = await loadProject(folderOf(name));
    if (!project) return problems.map((p) => `${p.where}: ${p.message}`).join('\n');
    currentName = name;
    current = project;
    return null;
  }
  const first = options.project ?? 'box-sealer-demo';
  if (validFolder(first) && existsSync(folderOf(first))) await openProject(first);

  // --- REST API -----------------------------------------------------------
  const api = express.Router();
  api.get('/health', (_req, res) => {
    const info: HealthInfo = {
      ok: true,
      product: PRODUCT_NAME,
      version: VERSION,
      address: `127.0.0.1:${boundPort()}`,
      project: current?.info.name ?? null,
    };
    res.json(info);
  });

  api.get('/projects', async (_req, res) => {
    const entries = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
    const names = entries
      .filter((e) => e.isDirectory() && existsSync(path.join(projectsDir, e.name, 'project.json')))
      .map((e) => e.name)
      .sort();
    res.json({ ok: true, current: currentName, projects: names });
  });
  api.get('/project', (_req, res) => {
    if (!current) return void res.json({ ok: true, name: null, project: null });
    res.json({ ok: true, name: currentName, project: current });
  });
  // Saves the whole project. Every file is checked against its schema first.
  api.put('/project', async (req, res) => {
    if (!currentName) return void res.status(409).json({ ok: false, error: 'No project is open' });
    try {
      const project = (req.body as { project: Project }).project;
      const result = await saveProject(folderOf(currentName), project);
      const reread = await loadProject(folderOf(currentName));
      if (!reread.project) {
        return void res.status(400).json({
          ok: false,
          error: reread.problems.map((p) => `${p.where}: ${p.message}`).join('\n'),
        });
      }
      current = reread.project;
      res.json({ ok: true, written: result.written, removed: result.removed });
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
  api.post('/projects', async (req, res) => {
    const name = (req.body as { name?: unknown }).name;
    if (!validFolder(name)) {
      return void res
        .status(400)
        .json({ ok: false, error: 'Use letters, digits, - and _ for the project folder name' });
    }
    if (existsSync(folderOf(name))) {
      return void res.status(409).json({ ok: false, error: `A project called ${name} exists` });
    }
    await mkdir(folderOf(name), { recursive: true });
    const empty: Project = {
      info: { formatVersion: 1, id: newId(), name, defaultCycleMs: 10 },
      globals: [],
      interfaces: [],
      equipment: [],
      conditions: [],
      states: [],
      machines: [],
      routing: { routes: [] },
    };
    await saveProject(folderOf(name), empty);
    await openProject(name);
    res.json({ ok: true, name });
  });
  api.post('/projects/open', async (req, res) => {
    const name = (req.body as { name?: unknown }).name;
    if (!validFolder(name) || !existsSync(folderOf(name))) {
      return void res.status(404).json({ ok: false, error: 'No such project' });
    }
    const error = await openProject(name);
    if (error) return void res.status(400).json({ ok: false, error });
    res.json({ ok: true, name });
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
