import {
  appendFilenameOrdinal,
  assignDuplicateFilenameAliases,
  buildActiveImageCatalog,
  getCanonicalImageId,
  parseMetadataBoolean,
  resolveImageReference,
} from '../imageIdentity';

describe('imageIdentity', () => {
  test('uses assignment image_id ahead of a catalog id', () => {
    expect(getCanonicalImageId({ id: 'catalog-id' })).toBe('catalog-id');
    expect(getCanonicalImageId({ image_id: 'assigned-id', id: 'record-id' })).toBe('assigned-id');
    expect(getCanonicalImageId({ image_id: '  assigned-id  ' })).toBe('assigned-id');
    expect(getCanonicalImageId('assigned-id')).toBe('');
  });

  test('adds numeric ordinals without changing the raw filename', () => {
    expect(appendFilenameOrdinal('scan.ext', 1)).toBe('scan (1).ext');
    expect(appendFilenameOrdinal('scan', 2)).toBe('scan (2)');
    expect(appendFilenameOrdinal('.scan', 1)).toBe('.scan (1)');
    expect(appendFilenameOrdinal('folder.name/scan.ext', 1)).toBe('folder.name/scan (1).ext');
  });

  test('assigns aliases by created_at and id while preserving input order', () => {
    const images = [
      { id: 'later', filename: 'scan.ext', created_at: '2026-02-01T00:00:00Z' },
      { id: 'first-b', filename: 'scan.ext', created_at: '2026-01-01T00:00:00Z' },
      { id: 'first-a', filename: 'scan.ext', created_at: '2026-01-01T00:00:00Z' },
    ];

    const decorated = assignDuplicateFilenameAliases(images);

    expect(decorated.map((image) => image.id)).toEqual(['later', 'first-b', 'first-a']);
    expect(decorated.map((image) => image.displayName)).toEqual([
      'scan (2).ext',
      'scan (1).ext',
      'scan.ext',
    ]);
    expect(decorated.map((image) => image.filename)).toEqual([
      'scan.ext',
      'scan.ext',
      'scan.ext',
    ]);

    const reversed = assignDuplicateFilenameAliases([...images].reverse());
    expect(Object.fromEntries(reversed.map((image) => [image.id, image.displayName]))).toEqual({
      later: 'scan (2).ext',
      'first-b': 'scan (1).ext',
      'first-a': 'scan.ext',
    });
  });

  test('does not overwrite a real filename that already contains an ordinal', () => {
    const decorated = assignDuplicateFilenameAliases([
      { id: 'scan-a', filename: 'scan.ext', created_at: '2026-01-01T00:00:00Z' },
      { id: 'scan-b', filename: 'scan.ext', created_at: '2026-01-02T00:00:00Z' },
      { id: 'real-one', filename: 'scan (1).ext', created_at: '2026-01-03T00:00:00Z' },
    ]);

    expect(decorated.map((image) => image.displayName)).toEqual([
      'scan.ext',
      'scan (2).ext',
      'scan (1).ext',
    ]);
  });

  test('builds an active exact-name catalog without metadata normalization', () => {
    const metadata = { side: 'left', modality: 'xray', overlay: 'false' };
    const catalog = buildActiveImageCatalog([
      { id: 'one', filename: 'part_left_xray.png', created_at: '2026-01-01', metadata },
      { id: 'two', filename: 'part_left_xray.png', created_at: '2026-01-02', metadata },
      { id: 'three', filename: 'part_right_xray.png', created_at: '2026-01-03', metadata },
      { id: 'four', filename: 'PART_LEFT_XRAY.png', created_at: '2026-01-04', metadata },
      { id: 'deleted', filename: 'part_left_xray.png', deleted_at: '2026-01-05', metadata },
      { id: 'one', filename: 'unexpected-repeat.png', created_at: '2026-01-06', metadata },
    ]);

    expect(catalog.refs.map((image) => image.id)).toEqual(['one', 'two', 'three', 'four']);
    expect(catalog.refs.map((image) => image.filename)).toEqual([
      'part_left_xray.png',
      'part_left_xray.png',
      'part_right_xray.png',
      'PART_LEFT_XRAY.png',
    ]);
    expect(catalog.byId.get('two').displayName).toBe('part_left_xray (1).png');
    expect(catalog.byFilename.get('part_left_xray.png').map((image) => image.id)).toEqual(['one', 'two']);
    expect(catalog.byFilename.get('part_right_xray.png').map((image) => image.id)).toEqual(['three']);
    expect(catalog.byFilename.get('PART_LEFT_XRAY.png').map((image) => image.id)).toEqual(['four']);
    expect(catalog.byFilename.has('unexpected-repeat.png')).toBe(false);
    expect(catalog.refs[0].metadata).toBe(metadata);
  });

  test('resolves ids authoritatively and reports filename ambiguity', () => {
    const catalog = buildActiveImageCatalog([
      { id: 'one', filename: 'scan.ext', created_at: '2026-01-01' },
      { id: 'two', filename: 'scan.ext', created_at: '2026-01-02' },
      { id: 'three', filename: 'unique.ext', created_at: '2026-01-03' },
    ]);

    expect(resolveImageReference({ image_id: 'two', filename: 'wrong.ext' }, catalog)).toMatchObject({
      status: 'resolved',
      match: 'id',
      ref: { id: 'two' },
    });
    expect(resolveImageReference({ image_id: 'missing', filename: 'unique.ext' }, catalog)).toEqual({
      status: 'missing',
      match: 'id',
      ref: null,
      image: null,
      candidates: [],
    });

    const ambiguous = resolveImageReference({ filename: 'scan.ext' }, catalog);
    expect(ambiguous.status).toBe('ambiguous');
    expect(ambiguous.match).toBe('filename');
    expect(ambiguous.ref).toBeNull();
    expect(ambiguous.candidates.map((image) => image.id)).toEqual(['one', 'two']);

    expect(resolveImageReference('unique.ext', catalog)).toMatchObject({
      status: 'resolved',
      match: 'filename',
      ref: { id: 'three' },
    });
    expect(resolveImageReference('Unique.ext', catalog).status).toBe('missing');
  });

  test('parses regex-derived boolean metadata strictly', () => {
    ['true', ' TRUE ', '1', 'yes', 'Y', 'on'].forEach((value) => {
      expect(parseMetadataBoolean(value)).toBe(true);
    });
    ['false', ' FALSE ', '0', 'no', 'N', 'off', ''].forEach((value) => {
      expect(parseMetadataBoolean(value)).toBe(false);
    });
    expect(parseMetadataBoolean(true)).toBe(true);
    expect(parseMetadataBoolean(false)).toBe(false);
    expect(parseMetadataBoolean(2)).toBe(true);
    expect(parseMetadataBoolean(0)).toBe(false);
    expect(parseMetadataBoolean('overlay')).toBe(false);
    expect(parseMetadataBoolean('unexpected', true)).toBe(true);
    expect(parseMetadataBoolean(null)).toBe(false);
  });
});
