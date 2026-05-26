import { isUserMetadataKey } from '../metadataKeys';

describe('metadataKeys', () => {
  test('filters internal keys', () => {
    expect(isUserMetadataKey('measurements')).toBe(false);
    expect(isUserMetadataKey('calibration_override')).toBe(false);
  });

  test('allows user-defined metadata keys', () => {
    expect(isUserMetadataKey('part_number')).toBe(true);
    expect(isUserMetadataKey('')).toBe(true);
  });
});
