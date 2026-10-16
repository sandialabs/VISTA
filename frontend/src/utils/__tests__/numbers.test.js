import { clamp, clampFinite, finiteNumber } from '../numbers';

describe('clamp', () => {
  it('bounds values into the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('propagates NaN without coercion', () => {
    expect(clamp(NaN, 0, 1)).toBeNaN();
    expect(clamp(undefined, 0, 1)).toBeNaN();
  });
});

describe('clampFinite', () => {
  it('coerces numeric strings and clamps', () => {
    expect(clampFinite('7', 0, 5)).toBe(5);
    expect(clampFinite('2.5', 0, 5)).toBe(2.5);
  });

  it('uses minimum as the default fallback for non-finite input', () => {
    expect(clampFinite(undefined, 2, 5)).toBe(2);
    expect(clampFinite('abc', 2, 5)).toBe(2);
    expect(clampFinite(Infinity, 2, 5)).toBe(2);
  });

  it('clamps an explicit fallback into range', () => {
    expect(clampFinite(null, 0.5, 4, 3)).toBe(0.5);
    expect(clampFinite(NaN, 0.5, 4, 3)).toBe(3);
    expect(clampFinite(NaN, 0.5, 4, 10)).toBe(4);
  });
});

describe('finiteNumber', () => {
  it('returns finite coerced numbers', () => {
    expect(finiteNumber(3)).toBe(3);
    expect(finiteNumber('4.5')).toBe(4.5);
    expect(finiteNumber(null)).toBe(0);
  });

  it('returns null by default for non-finite input', () => {
    expect(finiteNumber(undefined)).toBeNull();
    expect(finiteNumber('abc')).toBeNull();
    expect(finiteNumber(Infinity)).toBeNull();
  });

  it('returns an explicit fallback for non-finite input', () => {
    expect(finiteNumber(undefined, 0)).toBe(0);
    expect(finiteNumber(NaN, 0.24)).toBe(0.24);
  });
});
