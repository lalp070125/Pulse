import { describe, expect, it } from 'vitest';
import { BEAM, BELT, BOX, SEAL, STATION } from './layout';
import { blocksBeam, isGone, onBelt, underSealHead } from './sensing';

const rest = { x: STATION.x, y: BELT.top + BOX.halfH, z: 0 };

describe('blocksBeam', () => {
  it('a box resting at the station blocks the beam', () => {
    expect(blocksBeam(rest, BEAM.x, BEAM.y)).toBe(true);
  });

  it('a box still upstream does not block it, and one arriving does as its front reaches it', () => {
    expect(blocksBeam({ ...rest, x: BEAM.x - BOX.halfL - 0.05 }, BEAM.x, BEAM.y)).toBe(false);
    expect(blocksBeam({ ...rest, x: BEAM.x - BOX.halfL + 0.001 }, BEAM.x, BEAM.y)).toBe(true);
  });

  it('a box that has passed the beam entirely does not block it', () => {
    expect(blocksBeam({ ...rest, x: BEAM.x + BOX.halfL + 0.05 }, BEAM.x, BEAM.y)).toBe(false);
  });

  it('a box lifted above the beam does not block it', () => {
    expect(blocksBeam({ ...rest, y: BEAM.y + BOX.halfH + 0.05 }, BEAM.x, BEAM.y)).toBe(false);
  });

  it('pushing the box sideways keeps it in the beam (the beam runs across the belt)', () => {
    expect(blocksBeam({ ...rest, z: -0.1 }, BEAM.x, BEAM.y)).toBe(true);
  });
});

describe('onBelt', () => {
  it('knows a box on the belt, and one that fell off', () => {
    expect(onBelt(rest)).toBe(true);
    expect(onBelt({ ...rest, y: 0.1 })).toBe(false);
    expect(onBelt({ ...rest, x: BELT.x1 + 0.5 })).toBe(false);
  });
});

describe('underSealHead', () => {
  it('is true for a clamped box and false for an unclamped one', () => {
    expect(underSealHead({ ...rest, z: SEAL.z })).toBe(true);
    expect(underSealHead({ ...rest, z: 0.2 })).toBe(false);
  });
});

describe('isGone', () => {
  it('removes boxes that fell to the floor or ran far past the end', () => {
    expect(isGone(rest)).toBe(false);
    expect(isGone({ ...rest, y: 0.1 })).toBe(true);
    expect(isGone({ ...rest, x: BELT.x1 + 2 })).toBe(true);
  });
});
