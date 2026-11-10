/* ----------------------------------------------------------------------------
 * Motion and timing models of the Twin, without any 3D or physics code, so
 * they can be tested on their own (SPEC 10.2 step 3, 10.3).
 *
 * Time comes in as milliseconds from the physics step; nothing here reads a
 * clock.
 * -------------------------------------------------------------------------- */

/** An actuator with two end positions and a travel time (a pneumatic cylinder). */
export interface ActuatorState {
  /** 0 = fully retracted, 1 = fully extended. */
  position: number;
}

export interface ActuatorFeedback {
  extended: boolean;
  retracted: boolean;
}

/**
 * Moves the actuator toward the commanded end for `dtMs`. It goes from one end
 * to the other in exactly `travelMs`.
 */
export function stepActuator(
  state: ActuatorState,
  extend: boolean,
  dtMs: number,
  travelMs: number,
): ActuatorState {
  const delta = travelMs > 0 ? dtMs / travelMs : 1;
  const target = extend ? 1 : 0;
  const position =
    target > state.position
      ? Math.min(1, state.position + delta)
      : Math.max(0, state.position - delta);
  return { position: snap(position) };
}

/** Floating-point steps of 1/60 s must still land exactly on 0 and 1. */
function snap(p: number): number {
  if (p > 1 - 1e-9) return 1;
  if (p < 1e-9) return 0;
  return p;
}

/** End-position switches: each is on only when the actuator is fully at that end. */
export function actuatorFeedback(state: ActuatorState): ActuatorFeedback {
  return { extended: state.position >= 1, retracted: state.position <= 0 };
}

/** Linear blend between the two end positions (for placing the moving part). */
export function lerp3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** A box spawner: drops one box when switched on, then one every `periodMs`. */
export interface SpawnerState {
  /** Milliseconds until the next box. */
  untilNextMs: number;
}

export const SPAWNER_START: SpawnerState = { untilNextMs: 0 };

/** Advances the spawner by `dtMs` and says how many boxes are due now. */
export function stepSpawner(
  state: SpawnerState,
  on: boolean,
  dtMs: number,
  periodMs: number,
): { state: SpawnerState; due: number } {
  // Off resets the countdown, so switching on again drops a box at once.
  if (!on) return { state: SPAWNER_START, due: 0 };
  const period = Math.max(1, periodMs);
  let until = state.untilNextMs - dtMs;
  let due = 0;
  while (until <= 1e-9) {
    due++;
    until += period;
  }
  return { state: { untilNextMs: until }, due };
}
