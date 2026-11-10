import { describe, expect, it } from 'vitest';
import { actuatorFeedback, beltVelocity, lerp, stepActuator } from './motion';

describe('stepActuator', () => {
  it('takes exactly its travel time to cross the range', () => {
    let pos = 0;
    for (let i = 0; i < 40; i++) pos = stepActuator(pos, true, 10, 400);
    expect(pos).toBeCloseTo(1, 9);
  });

  it('is halfway after half the travel time', () => {
    expect(stepActuator(0, true, 200, 400)).toBeCloseTo(0.5, 9);
  });

  it('never overshoots either end', () => {
    expect(stepActuator(0.95, true, 1000, 400)).toBe(1);
    expect(stepActuator(0.05, false, 1000, 400)).toBe(0);
  });

  it('turns around mid-travel when the command changes', () => {
    const out = stepActuator(0, true, 200, 400);
    expect(stepActuator(out, false, 100, 400)).toBeCloseTo(0.25, 9);
  });

  it('holds still when already at the commanded end', () => {
    expect(stepActuator(1, true, 50, 400)).toBe(1);
    expect(stepActuator(0, false, 50, 400)).toBe(0);
  });

  it('jumps at once when the travel time is zero', () => {
    expect(stepActuator(0, true, 10, 0)).toBe(1);
    expect(stepActuator(1, false, 10, 0)).toBe(0);
  });
});

describe('actuatorFeedback', () => {
  it('reports each end only when fully there, and neither while moving', () => {
    expect(actuatorFeedback(0)).toEqual({ extended: false, retracted: true });
    expect(actuatorFeedback(1)).toEqual({ extended: true, retracted: false });
    expect(actuatorFeedback(0.4)).toEqual({ extended: false, retracted: false });
  });

  it('never reports both ends at once', () => {
    for (let p = 0; p <= 1; p += 0.05) {
      const f = actuatorFeedback(p);
      expect(f.extended && f.retracted).toBe(false);
    }
  });
});

describe('helpers', () => {
  it('lerp blends between the two positions', () => {
    expect(lerp(0.3, 0, 0)).toBeCloseTo(0.3, 9);
    expect(lerp(0.3, 0, 1)).toBeCloseTo(0, 9);
    expect(lerp(0.3, 0, 0.5)).toBeCloseTo(0.15, 9);
  });

  it('beltVelocity is the belt speed only while running', () => {
    expect(beltVelocity(true, 0.5)).toBe(0.5);
    expect(beltVelocity(false, 0.5)).toBe(0);
  });
});
