/**
 * Where everything is in the scene, in metres. Pure numbers, shared by the scene
 * and by the sensing rules so the two can never disagree.
 * x runs along the belt (toward the sensor), y is up, z is across the belt.
 */

export const BELT = { x0: -2.0, x1: 1.3, halfZ: 0.25, top: 0.8, speed: 0.5 } as const;

/** A closed carton: 0.30 long (x), 0.20 high, 0.20 wide (z). Half sizes. */
export const BOX = { halfL: 0.15, halfH: 0.1, halfW: 0.1 } as const;

/** The work station: where a stopped box rests, under the seal head and beside the pusher. */
export const STATION = { x: 0.76 } as const;

/** The photoelectric beam runs across the belt (along z) at this x and height. */
export const BEAM = { x: 0.9, y: BELT.top + 0.1 } as const;

/** The pusher pushes the box sideways (toward -z) against the fence. Face positions in z. */
export const PUSHER = {
  retractedFace: 0.3,
  extendedFace: 0.0,
  thickness: 0.04,
  halfX: 0.12,
  halfY: 0.08,
  y: BELT.top + 0.1,
  travelMs: 600,
} as const;

/** The fence the box is clamped against; the clamped box sits at z -0.2 .. 0. */
export const FENCE = { z: -0.22, halfX: 0.13, halfY: 0.1, halfZ: 0.02 } as const;

/** The seal head lowers onto the clamped box. */
export const SEAL = {
  upY: BELT.top + 0.62,
  downY: BELT.top + 0.23,
  z: -0.1,
  halfX: 0.12,
  halfY: 0.03,
  halfZ: 0.12,
  travelMs: 500,
} as const;

export const SPAWN = { x: -1.85, y: BELT.top + 0.2, z: 0 } as const;
export const MAX_BOXES = 6;
