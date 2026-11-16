import {
  formatNcrCodeOption,
  getConfiguredNcrCodes,
  isValidOptionalNcrConfiguration,
  normalizeNcrConfiguration,
  validateNcrConfiguration,
} from '../ncrConfiguration';
import { normalizeProjectConfiguration, validateConfiguration } from '../configurationSchema';

describe('ncrConfiguration helpers', () => {
  test('normalizes missing or malformed sections to empty lists', () => {
    expect(normalizeNcrConfiguration(undefined)).toEqual({ failure_codes: [], disposition_codes: [] });
    expect(normalizeNcrConfiguration([])).toEqual({ failure_codes: [], disposition_codes: [] });
    expect(normalizeNcrConfiguration({ failure_codes: 'x', disposition_codes: [null, { code: 5 }] })).toEqual({
      failure_codes: [],
      disposition_codes: [{ code: '', description: '' }, { code: '', description: '' }],
    });
  });

  test('normalizeProjectConfiguration adds the section with defaults', () => {
    expect(normalizeProjectConfiguration({}, 'PT2').ncr_configuration).toEqual({
      failure_codes: [],
      disposition_codes: [],
    });
  });

  test('validates blank, duplicate, and oversized codes', () => {
    expect(validateNcrConfiguration({ failure_codes: [{ code: 'A' }], disposition_codes: [{ code: 'B' }] })).toEqual([]);
    expect(validateNcrConfiguration({ failure_codes: [{ code: ' ' }] })).toEqual([
      'Each entry in Failure Codes requires a code.',
    ]);
    expect(validateNcrConfiguration({ disposition_codes: [{ code: 'rwk' }, { code: ' RWK ' }] })).toEqual([
      'Disposition Codes must be unique (case-insensitive).',
    ]);
    expect(validateNcrConfiguration({ failure_codes: [{ code: 'x'.repeat(65) }] })).toEqual([
      'Failure Codes must be 64 characters or fewer.',
    ]);
    expect(validateNcrConfiguration({ failure_codes: [{ code: 'A', description: 'd'.repeat(256) }] })).toEqual([
      'Failure Codes descriptions must be 255 characters or fewer.',
    ]);
  });

  test('validateConfiguration includes NCR errors', () => {
    const config = normalizeProjectConfiguration({ ncr_configuration: { failure_codes: [{ code: '' }] } }, 'PT2');
    expect(validateConfiguration(config)).toContain('Each entry in Failure Codes requires a code.');
  });

  test('getConfiguredNcrCodes trims and drops blank codes', () => {
    const config = {
      ncr_configuration: {
        failure_codes: [{ code: ' FC-1 ', description: ' Porosity ' }, { code: '  ' }],
        disposition_codes: [],
      },
    };
    expect(getConfiguredNcrCodes(config, 'failure_codes')).toEqual([{ code: 'FC-1', description: 'Porosity' }]);
    expect(getConfiguredNcrCodes(null, 'failure_codes')).toEqual([]);
  });

  test('formatNcrCodeOption includes the description when present', () => {
    expect(formatNcrCodeOption({ code: 'FC-1', description: 'Porosity' })).toBe('FC-1 - Porosity');
    expect(formatNcrCodeOption({ code: 'FC-1', description: '' })).toBe('FC-1');
  });

  test('isValidOptionalNcrConfiguration accepts absent sections and rejects malformed ones', () => {
    expect(isValidOptionalNcrConfiguration(undefined)).toBe(true);
    expect(isValidOptionalNcrConfiguration({ failure_codes: [{ code: 'A', description: 'x' }] })).toBe(true);
    expect(isValidOptionalNcrConfiguration(null)).toBe(false);
    expect(isValidOptionalNcrConfiguration({ failure_codes: 'A' })).toBe(false);
    expect(isValidOptionalNcrConfiguration({ failure_codes: [{ code: 1 }] })).toBe(false);
    expect(isValidOptionalNcrConfiguration({ failure_codes: [{ code: 'A' }, { code: 'a' }] })).toBe(false);
  });
});
