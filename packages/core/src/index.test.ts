import { describe, expect, it } from 'vitest';
import { APPS, DEFAULT_PORT, PRODUCT_NAME, appTitle } from './index';

describe('product identity', () => {
  it('has one product name used for every app title', () => {
    expect(appTitle('studio')).toBe(`${PRODUCT_NAME} Studio`);
    expect(appTitle('panel')).toBe(`${PRODUCT_NAME} Panel`);
    expect(appTitle('twin')).toBe(`${PRODUCT_NAME} Twin`);
  });

  it('declares the three app routes and the single port', () => {
    expect(APPS.map((a) => a.route)).toEqual(['/studio', '/panel', '/twin']);
    expect(DEFAULT_PORT).toBe(4600);
  });
});
