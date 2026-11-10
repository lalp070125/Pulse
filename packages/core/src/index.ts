/**
 * @pulso/core — the engine.
 *
 * Pure TypeScript: no Node APIs, no browser APIs, no clock, no randomness (SPEC 5.8).
 */

/** The one place the product name lives. Rename here (and replace the logo file) to rebrand. */
export const PRODUCT_NAME = 'Pulso';

/** The single port everything is served on (SPEC 3.1). */
export const DEFAULT_PORT = 4600;

/** The three applications (SPEC 2). All are routes of the same web app. */
export const APPS = [
  { id: 'studio', label: 'Studio', route: '/studio' },
  { id: 'panel', label: 'Panel', route: '/panel' },
  { id: 'twin', label: 'Twin', route: '/twin' },
] as const;

export type AppId = (typeof APPS)[number]['id'];

/** Full display name of an app, e.g. "Pulso Studio". */
export function appTitle(app: AppId): string {
  const found = APPS.find((a) => a.id === app);
  return `${PRODUCT_NAME} ${found ? found.label : ''}`.trim();
}

/** Answer of GET /api/health. */
export interface HealthInfo {
  ok: true;
  product: string;
  version: string;
  /** Address the runtime listens on, e.g. "127.0.0.1:4600". */
  address: string;
  /** Name of the open project, or null when none is loaded. */
  project: string | null;
}

/** Messages the runtime sends over the live WebSocket (/ws). Grows in Phase 4. */
export type ServerMessage = { type: 'hello'; product: string; version: string } | { type: 'pong' };

/** Messages the UI sends over the live WebSocket (/ws). */
export type ClientMessage = { type: 'ping' };

export * from './types';
export * from './schema';
export * from './files';
export * from './trace';
export * from './driver';
export * from './compile';
export * from './engine';
export * from './catalog';
export * from './validate';
export * from './planner';
