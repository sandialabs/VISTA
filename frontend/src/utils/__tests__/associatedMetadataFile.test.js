import {
  buildAssociatedMetadataBundle,
  buildAssociatedMetadataImageReference,
  buildMetadataWithAssociatedReference,
  getFileExtension,
  isAssociatedMetadataFile,
  parseAssociatedMetadataText,
} from '../associatedMetadataFile';

describe('associatedMetadataFile', () => {
  test('recognizes .json and .nsipro metadata files case-insensitively', () => {
    expect(getFileExtension('Run.JSON')).toBe('.json');
    expect(isAssociatedMetadataFile({ name: 'scan.nsipro' })).toBe(true);
    expect(isAssociatedMetadataFile({ name: 'image.png' })).toBe(false);
  });

  test('parses JSON metadata and rejects empty, invalid, or unsupported files', () => {
    expect(parseAssociatedMetadataText('{"a":1}', 'meta.json')).toEqual({ parser: 'json', metadata: { a: 1 } });
    expect(() => parseAssociatedMetadataText('  ', 'meta.json')).toThrow('Metadata file is empty.');
    expect(() => parseAssociatedMetadataText('{', 'meta.json')).toThrow('Invalid JSON metadata file.');
    expect(() => parseAssociatedMetadataText('x', 'meta.csv')).toThrow(/Unsupported metadata file type/);
  });

  test('builds a stable content-addressed bundle and a lightweight image reference', () => {
    const file = { name: 'my meta.json', size: 7 };
    const bundle = buildAssociatedMetadataBundle(file, '{"a":1}', { parser: 'json', metadata: { a: 1 } });
    expect(bundle.key).toMatch(/^associated_upload_metadata:my_meta\.json:[0-9a-f]{8}$/);
    expect(buildAssociatedMetadataBundle(file, '{"a":1}', { parser: 'json', metadata: { a: 1 } }).key).toBe(bundle.key);
    const reference = buildAssociatedMetadataImageReference(bundle);
    expect(reference).toEqual(expect.objectContaining({ reference_type: 'project_metadata', project_metadata_key: bundle.key, file_type: 'json' }));
    expect(reference).not.toHaveProperty('metadata');
    expect(buildMetadataWithAssociatedReference({ lot: 'L1' }, reference)).toEqual({
      lot: 'L1', associated_metadata_ref: bundle.key, associated_metadata: reference,
    });
    expect(buildMetadataWithAssociatedReference(null, null)).toBeNull();
  });
});
