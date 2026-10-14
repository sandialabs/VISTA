import { resolveSavedWorkbenchSelection } from '../useInspectionPartLoading';
import { ALL_PARTS_ID } from '../useInspectionPartSelection';

const BATCHES = [{ id: 1 }, { id: 2 }];
const PARTS = [{ id: 10, batch_id: 1 }, { id: 11, batch_id: 2 }];

describe('resolveSavedWorkbenchSelection', () => {
  test('restores a saved part, batch, filters, and sort mode', () => {
    expect(resolveSavedWorkbenchSelection({
      selected_part_id: '11',
      selected_batch_id: '2',
      review_filter: 'reject_pending',
      part_filter: 'abc',
      sort_mode: 'defect_desc',
    }, BATCHES, PARTS)).toEqual({
      batchId: '2',
      partFilter: 'abc',
      partId: 11,
      reviewFilter: 'reject_pending',
      showAllParts: false,
      sortMode: 'defect_desc',
    });
  });

  test('drops a saved batch that no longer contains the saved part and rejects unknown values', () => {
    expect(resolveSavedWorkbenchSelection({
      selected_part_id: '11',
      selected_batch_id: '1',
      review_filter: 'bogus',
      sort_mode: 'bogus',
    }, BATCHES, PARTS)).toMatchObject({
      batchId: '',
      partId: 11,
      reviewFilter: 'all',
      sortMode: 'part_asc',
    });
  });

  test('falls back to the first part and selects all parts only when parts exist', () => {
    expect(resolveSavedWorkbenchSelection({ selected_part_id: 'missing' }, BATCHES, PARTS).partId).toBe(10);
    expect(resolveSavedWorkbenchSelection({ selected_part_id: ALL_PARTS_ID }, BATCHES, PARTS))
      .toMatchObject({ partId: ALL_PARTS_ID, showAllParts: true });
    expect(resolveSavedWorkbenchSelection({ selected_part_id: ALL_PARTS_ID }, BATCHES, []))
      .toMatchObject({ partId: null, showAllParts: false });
  });
});
