import { NSIPRO_PARSERS, getConfiguredNsiproParserId, parseGenericNsiproKeyValueText, parseNsiproText } from '../nsiproParsers';

describe('nsiproParsers', () => {
  test('exports a registry with deployment parser identifiers', () => {
    expect(Object.keys(NSIPRO_PARSERS)).toEqual(expect.arrayContaining(['default', 'deployment_a', 'deployment_b']));
  });

  test('parses generic key-value .nsipro text with the stable result shape', () => {
    expect(parseGenericNsiproKeyValueText('[capture]\noperator=alice\nexposure: 12\nvalid=true', 'scan.nsipro')).toEqual({
      parser: 'nsipro-key-value',
      parser_id: 'default',
      parser_version: '1.0.0',
      parser_hash: 'sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df',
      metadata: {
        capture: {
          operator: 'alice',
          exposure: 12,
          valid: true,
        },
      },
      warnings: [],
      source_filename: 'scan.nsipro',
    });
  });

  test('parseNsiproText uses JSON first for the default parser', () => {
    expect(parseNsiproText('{"camera":"A1"}', 'scan.nsipro')).toEqual({
      parser: 'nsipro-json',
      parser_id: 'default',
      parser_version: '1.0.0',
      parser_hash: 'sha256:3295a8f571b23a6bb2a5ae1ef21e5500d39fdabf209ea122d7352f65d1b217df',
      metadata: { camera: 'A1' },
      warnings: [],
      source_filename: 'scan.nsipro',
    });
  });

  test('parseNsiproText uses parserId from options and falls back on unknown parser', () => {
    const result = parseNsiproText('operator=alice', 'scan.nsipro', { parserId: 'unknown_parser' });
    expect(result).toEqual(expect.objectContaining({
      parser: 'nsipro-key-value',
      parser_id: 'default',
      requested_parser_id: 'unknown_parser',
      metadata: { operator: 'alice' },
      source_filename: 'scan.nsipro',
    }));
    expect(result.warnings).toContain('Unknown .nsipro parser "unknown_parser"; used default parser instead.');
  });

  test('parseNsiproText can fail closed for unknown parser configuration', () => {
    expect(() => parseNsiproText('operator=alice', 'scan.nsipro', { parserId: 'unknown_parser', failClosed: true }))
      .toThrow('Unknown .nsipro parser configured: unknown_parser.');
  });

  test('parseNsiproText reads parser id from project configuration', () => {
    expect(getConfiguredNsiproParserId({
      metadata_parsers: { nsipro: { parser_id: 'deployment_a' } },
    })).toBe('deployment_a');
    expect(parseNsiproText('operator=alice', 'scan.nsipro', {
      projectConfiguration: { metadata_parsers: { nsipro: { parser_id: 'deployment_a' } } },
    })).toEqual(expect.objectContaining({
      parser: 'nsipro-key-value',
      parser_id: 'deployment_a',
      metadata: { operator: 'alice' },
    }));
  });
});
