import type { Value } from '@pulso/core';
import { sendToRuntime } from '../lib/connection';
import { isDirty, useProject } from './project';
import { useLive } from './live';
import { useShell } from './store';

/* ----------------------------------------------------------------------------
 * The runtime commands behind the strip's buttons and the monitor (SPEC 4.3, 7).
 * Deploy runs what is saved, so it saves unsaved edits first and says so.
 * -------------------------------------------------------------------------- */

const log = (level: 'info' | 'warning' | 'error', text: string) =>
  useShell.getState().log(level, 'Runtime', text);

export async function deploy(): Promise<void> {
  if (useLive.getState().replay) backToLive();
  if (isDirty()) {
    log('info', 'Saving before deploy: the runtime runs the saved project.');
    if (!(await useProject.getState().save())) return;
  }
  const errors = useProject.getState().problems.filter((p) => p.level === 'error');
  if (errors.length) {
    log(
      'error',
      `Cannot deploy: ${errors.length} error(s) in the project. Fix them first (they are listed here).`,
    );
    return;
  }
  if (sendToRuntime({ type: 'deploy' })) log('info', 'Deployed. Press Start to run.');
}

export const start = () => sendToRuntime({ type: 'start' });
export const stop = () => sendToRuntime({ type: 'stop' });
export const step = (n = 1) => sendToRuntime({ type: 'step', n });

/** Forces a value (logged as INJECT by the runtime). */
export function force(path: string, value: Value): void {
  if (sendToRuntime({ type: 'force', path, value })) {
    log('info', `Forced ${path} = ${JSON.stringify(value)}`);
  }
}

/** Opens a recorded session file in place of the live runtime. */
export async function openSession(name: string): Promise<void> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(name)}`);
  if (!res.ok) return log('error', `Could not open session ${name}.`);
  const lines = (await res.text())
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as unknown);
  try {
    useLive.getState().loadSession(name, lines);
    log('info', `Showing recorded session ${name}. Use "Back to live" to return.`);
  } catch (e) {
    log('error', e instanceof Error ? e.message : String(e));
  }
}

export function backToLive(): void {
  useLive.getState().backToLive();
  sendToRuntime({ type: 'snapshot' });
}
