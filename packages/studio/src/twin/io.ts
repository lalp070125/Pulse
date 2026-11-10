import type { Value } from '@pulso/core';

/* ----------------------------------------------------------------------------
 * The scene's only door to the outside world (docs/parallel-twin-plan.md §1).
 *
 *   read(path)         a command written by the logic   (logic → scene)
 *   write(path, value) a sensor reading from the scene  (scene → logic)
 *
 * Paths use the normal address form, e.g. `Sealer.Pusher.ICylinder.Extend`.
 * Today the only implementation is the in-memory one below, driven by the hand
 * panel. The live one over the runtime's WebSocket comes after Phase 4.
 * -------------------------------------------------------------------------- */

export interface TwinIO {
  read(path: string): Value;
  write(path: string, value: Value): void;
}

/** An in-memory TwinIO. The hand panel plays the logic's part through `command`. */
export interface MemoryTwinIO extends TwinIO {
  /** Sets a command value, as the logic would (hand panel switches). */
  command(path: string, value: Value): void;
  /** The current value of any path: a command or a sensor reading. */
  get(path: string): Value | undefined;
  /** Called after any value changes. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** A number that grows on every change, for React's useSyncExternalStore. */
  version(): number;
  /** Forgets every value. */
  clear(): void;
}

/** A command that was never set reads as off. Every command in the seed table is a bool. */
const UNSET: Value = false;

export function createMemoryTwinIO(): MemoryTwinIO {
  const values = new Map<string, Value>();
  const listeners = new Set<() => void>();
  let changes = 0;

  const set = (path: string, value: Value) => {
    if (values.get(path) === value) return; // only real changes notify
    values.set(path, value);
    changes++;
    for (const l of listeners) l();
  };

  return {
    read: (path) => values.get(path) ?? UNSET,
    write: set,
    command: set,
    get: (path) => values.get(path),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => changes,
    clear() {
      values.clear();
      changes++;
      for (const l of listeners) l();
    },
  };
}
