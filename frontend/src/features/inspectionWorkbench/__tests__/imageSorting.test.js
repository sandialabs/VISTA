import {
  getInspectionImageSortBaseId,
  getInspectionImageSortLayerLabel,
  isInspectionImageSortDescending,
  normalizeInspectionImageSortLayers,
  setInspectionImageSortDirection,
  sortInspectionImageDisplayEntries,
} from '../imageSorting';

const entry = (filename, metadata = {}) => ({ imageId: filename, filename, imageRef: filename, metadata });
const names = (entries) => entries.map((item) => item.filename);

describe('inspection image sort direction', () => {
  test('reads and writes the descending prefix, including the legacy filename_desc id', () => {
    expect(isInspectionImageSortDescending('filename_asc')).toBe(false);
    expect(isInspectionImageSortDescending('desc:metadata:camera')).toBe(true);
    expect(isInspectionImageSortDescending('filename_desc')).toBe(true);

    expect(getInspectionImageSortBaseId('desc:metadata:camera')).toBe('metadata:camera');
    expect(getInspectionImageSortBaseId('filename_desc')).toBe('filename_asc');

    expect(setInspectionImageSortDirection('type_asc', true)).toBe('desc:type_asc');
    expect(setInspectionImageSortDirection('desc:type_asc', false)).toBe('type_asc');
    expect(setInspectionImageSortDirection('desc:type_asc', true)).toBe('desc:type_asc');
  });

  test('labels a layer with its direction', () => {
    expect(getInspectionImageSortLayerLabel('filename_asc')).toBe('Filename (ascending)');
    expect(getInspectionImageSortLayerLabel('filename_desc')).toBe('Filename (descending)');
    expect(getInspectionImageSortLayerLabel('desc:type_asc')).toBe('Image type (descending)');
  });

  test('normalizes legacy and prefixed ids and drops unknown ones', () => {
    expect(normalizeInspectionImageSortLayers(['filename_desc', 'desc:metadata:side', 'bogus']))
      .toEqual(['desc:filename_asc', 'desc:metadata:side']);
    expect(normalizeInspectionImageSortLayers([])).toEqual(['filename_asc']);
  });
});

describe('sortInspectionImageDisplayEntries', () => {
  const entries = [entry('b.png'), entry('c.png'), entry('a.png')];

  test('sorts filenames ascending and descending', () => {
    expect(names(sortInspectionImageDisplayEntries(entries, 'filename_asc'))).toEqual(['a.png', 'b.png', 'c.png']);
    expect(names(sortInspectionImageDisplayEntries(entries, 'desc:filename_asc'))).toEqual(['c.png', 'b.png', 'a.png']);
    expect(names(sortInspectionImageDisplayEntries(entries, 'filename_desc'))).toEqual(['c.png', 'b.png', 'a.png']);
  });

  test('applies layers hierarchically, each with its own direction', () => {
    const layered = [
      entry('1.png', { side: 'front' }),
      entry('2.png', { side: 'back' }),
      entry('3.png', { side: 'front' }),
      entry('4.png', { side: 'back' }),
    ];
    expect(names(sortInspectionImageDisplayEntries(layered, ['metadata:side', 'desc:filename_asc'])))
      .toEqual(['4.png', '2.png', '3.png', '1.png']);
    expect(names(sortInspectionImageDisplayEntries(layered, ['desc:metadata:side', 'filename_asc'])))
      .toEqual(['1.png', '3.png', '2.png', '4.png']);
  });

  test('keeps missing metadata values last in both directions', () => {
    const sparse = [entry('none.png'), entry('a.png', { camera: 'A' }), entry('b.png', { camera: 'B' })];
    expect(names(sortInspectionImageDisplayEntries(sparse, 'metadata:camera'))).toEqual(['a.png', 'b.png', 'none.png']);
    expect(names(sortInspectionImageDisplayEntries(sparse, 'desc:metadata:camera'))).toEqual(['b.png', 'a.png', 'none.png']);
  });
});
