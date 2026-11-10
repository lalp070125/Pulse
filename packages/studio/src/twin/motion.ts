/**
 * Motion rules for the 3D scene. Pure functions: no clock, no browser, no physics,
 * so they are tested directly with Vitest. The scene supplies the time step.
 */

/** Where an actuator is: 0 = fully retracted (home), 1 = fully extended. */
export type Position = number;

/**
 * Moves an actuator toward the position its command asks for.
 * ON drives toward 1, OFF drives toward 0, at a constant speed that takes
 * `travelMs` to cross the whole range. It never overshoots.
 */
export function stepActuator(
  pos: Position,
  commandOn: boolean,
  dtMs: number,
  travelMs: number,
): Position {
  if (travelMs <= 0) return commandOn ? 1 : 0;
  const delta = dtMs / travelMs;
  const next = commandOn ? pos + delta : pos - delta;
  return Math.min(1, Math.max(0, next));
}

export interface ActuatorFeedback {
  /** True only when fully extended. */
  extended: boolean;
  /** True only when fully retracted. */
  retracted: boolean;
}

/** Both feedbacks are false while the actuator is travelling. */
export function actuatorFeedback(pos: Position): ActuatorFeedback {
  return { extended: pos >= 1, retracted: pos <= 0 };
}

/** Linear blend between the two positions of an actuator (metres). */
export function lerp(retracted: number, extended: number, pos: Position): number {
  return retracted + (extended - retracted) * pos;
}

/** Speed (m/s) to apply to a box standing on a belt. */
export function beltVelocity(running: boolean, speed: number): number {
  return running ? speed : 0;
}
