import { BELT, BOX, SEAL, STATION } from './layout';

/** A position in the scene (the centre of a box). */
export interface Pose {
  x: number;
  y: number;
  z: number;
}

/**
 * True when a box breaks the beam: the beam line (x, y, running across the belt)
 * passes through the box's length and height.
 */
export function blocksBeam(box: Pose, beamX: number, beamY: number): boolean {
  return (
    box.x - BOX.halfL <= beamX && box.x + BOX.halfL >= beamX && Math.abs(box.y - beamY) <= BOX.halfH
  );
}

/** True when a box is standing on the belt (so the belt carries it). */
export function onBelt(box: Pose): boolean {
  return (
    box.x >= BELT.x0 &&
    box.x <= BELT.x1 &&
    Math.abs(box.z) <= BELT.halfZ + 0.05 &&
    box.y >= BELT.top &&
    box.y <= BELT.top + 0.35
  );
}

/** True when a box is directly under the seal head. */
export function underSealHead(box: Pose): boolean {
  return Math.abs(box.x - STATION.x) <= SEAL.halfX && Math.abs(box.z - SEAL.z) <= SEAL.halfZ;
}

/** True when a box has left the belt for good and can be removed from the scene. */
export function isGone(box: Pose): boolean {
  return box.y < 0.35 || box.x > BELT.x1 + 1;
}
