import {
  buildFilteredVisibleMeasurementIds,
  buildUpsertedVisibleMeasurementIds,
  getMeasurementMutationKey,
} from '../measurementMutationPayloads';

describe('getMeasurementMutationKey', () => {
  test('builds a stable key from project and image id', () => {
    expect(getMeasurementMutationKey('p1', 'i1')).toBe(getMeasurementMutationKey('p1', 'i1'));
    expect(getMeasurementMutationKey('p1', 'i1')).not.toBe(getMeasurementMutationKey('p1', 'i2'));
  });

  test('coerces missing project or image id to an empty string', () => {
    expect(getMeasurementMutationKey(undefined, undefined)).toBe(JSON.stringify(['', '']));
  });
});

describe('buildUpsertedVisibleMeasurementIds', () => {
  test('returns all updated ids when nothing was previously hidden', () => {
    const result = buildUpsertedVisibleMeasurementIds({
      originalVisibleIds: null,
      updatedMeasurements: [{ id: 'a' }, { id: 'b' }],
      measurementId: 'b',
    });
    expect(result).toEqual(['a', 'b']);
  });

  test('keeps existing visible ids that still exist and adds the saved id', () => {
    const result = buildUpsertedVisibleMeasurementIds({
      originalVisibleIds: ['a'],
      updatedMeasurements: [{ id: 'a' }, { id: 'b' }],
      measurementId: 'b',
    });
    expect(result).toEqual(['a', 'b']);
  });

  test('does not duplicate the saved id when already visible', () => {
    const result = buildUpsertedVisibleMeasurementIds({
      originalVisibleIds: ['a', 'b'],
      updatedMeasurements: [{ id: 'a' }, { id: 'b' }],
      measurementId: 'b',
    });
    expect(result).toEqual(['a', 'b']);
  });

  test('drops previously visible ids that no longer exist', () => {
    const result = buildUpsertedVisibleMeasurementIds({
      originalVisibleIds: ['a', 'stale'],
      updatedMeasurements: [{ id: 'a' }, { id: 'b' }],
      measurementId: 'b',
    });
    expect(result).toEqual(['a', 'b']);
  });

  test('returns null when the resulting visible list is empty', () => {
    const result = buildUpsertedVisibleMeasurementIds({
      originalVisibleIds: ['stale'],
      updatedMeasurements: [],
      measurementId: null,
    });
    expect(result).toBeNull();
  });
});

describe('buildFilteredVisibleMeasurementIds', () => {
  test('returns all remaining ids when nothing was previously hidden', () => {
    const result = buildFilteredVisibleMeasurementIds({
      originalVisibleIds: null,
      updatedMeasurements: [{ id: 'a' }],
    });
    expect(result).toEqual(['a']);
  });

  test('filters out the deleted id from the previously visible set', () => {
    const result = buildFilteredVisibleMeasurementIds({
      originalVisibleIds: ['a', 'b'],
      updatedMeasurements: [{ id: 'a' }],
    });
    expect(result).toEqual(['a']);
  });

  test('returns null when no measurements remain', () => {
    const result = buildFilteredVisibleMeasurementIds({
      originalVisibleIds: ['a'],
      updatedMeasurements: [],
    });
    expect(result).toBeNull();
  });
});
