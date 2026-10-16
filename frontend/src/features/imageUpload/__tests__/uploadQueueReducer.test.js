import {
  UPLOAD_QUEUE_STATUS,
  UPLOAD_SOURCES,
  initialUploadQueueState,
  isQueueUploading,
  selectS3GlobalSelectionKeys,
  uploadQueueReducer,
} from '../uploadQueueReducer';

const objects = ['a', 'b', 'c', 'd'].map((name) => ({ key: `in/${name}`, filename: name }));
const reduce = (actions, state = initialUploadQueueState) => actions.reduce(uploadQueueReducer, state);
const listed = () => reduce([{ type: 's3_listing_started' }, { type: 's3_listing_loaded', objects }]);

describe('uploadQueueReducer', () => {
  test('local upload moves idle -> uploading -> partial and keeps only retryable files', () => {
    let state = reduce([{ type: 'local_files_selected', files: ['f1', 'f2', 'f3'] }]);
    expect(state.status).toBe(UPLOAD_QUEUE_STATUS.IDLE);
    state = uploadQueueReducer(state, { type: 'upload_started', source: UPLOAD_SOURCES.LOCAL });
    expect(isQueueUploading(state, UPLOAD_SOURCES.LOCAL)).toBe(true);
    expect(isQueueUploading(state, UPLOAD_SOURCES.S3)).toBe(false);
    state = uploadQueueReducer(state, { type: 'local_upload_settled', retryableFiles: ['f2'], completionUnknownCount: 0 });
    expect(state.status).toBe(UPLOAD_QUEUE_STATUS.PARTIAL);
    expect(state.localFiles).toEqual(['f2']);
    expect(uploadQueueReducer(state, { type: 'upload_finished' }).status).toBe(UPLOAD_QUEUE_STATUS.PARTIAL);
  });

  test('local completion-unknown outranks partial and done', () => {
    const base = reduce([{ type: 'local_files_selected', files: ['f1'] }, { type: 'upload_started', source: UPLOAD_SOURCES.LOCAL }]);
    expect(uploadQueueReducer(base, { type: 'local_upload_settled', retryableFiles: ['f1'], completionUnknownCount: 1 }).status)
      .toBe(UPLOAD_QUEUE_STATUS.COMPLETION_UNKNOWN);
    expect(uploadQueueReducer(base, { type: 'local_upload_settled', retryableFiles: [], completionUnknownCount: 0 }).status)
      .toBe(UPLOAD_QUEUE_STATUS.DONE);
  });

  test('upload_finished without settlement restores the previous status', () => {
    const state = reduce([
      { type: 'local_files_selected', files: ['f1'] },
      { type: 'upload_started', source: UPLOAD_SOURCES.LOCAL },
      { type: 'upload_finished' },
    ]);
    expect(state.status).toBe(UPLOAD_QUEUE_STATUS.IDLE);
    expect(state.localFiles).toEqual(['f1']);
  });

  test('S3 listing selects every object and opens the picker', () => {
    const state = listed();
    expect(state.s3.selectedKeys).toEqual(objects.map((object) => object.key));
    expect(state.s3.pickerOpen).toBe(true);
    expect(selectS3GlobalSelectionKeys(state.s3)).toHaveLength(4);
  });

  test('S3 settlement locks confirmed keys and excludes completion-unknown keys from retry', () => {
    let state = uploadQueueReducer(listed(), { type: 'upload_started', source: UPLOAD_SOURCES.S3 });
    state = uploadQueueReducer(state, {
      type: 's3_import_settled',
      attemptedKeys: ['in/a', 'in/b', 'in/c', 'in/d'],
      importedKeys: ['in/a'],
      retryableKeys: ['in/c'],
      completionUnknownKeys: ['in/b'],
      pageSize: 2,
    });
    expect(state.status).toBe(UPLOAD_QUEUE_STATUS.COMPLETION_UNKNOWN);
    expect(state.s3.confirmedKeys).toEqual(['in/a']);
    expect(state.s3.selectedKeys).toEqual(['in/c']);
    expect(state.s3.pageIndex).toBe(1);
    expect(state.s3.retryMode).toBe(true);
    expect(selectS3GlobalSelectionKeys(state.s3)).toEqual(['in/c']);

    state = uploadQueueReducer(state, { type: 's3_key_toggled', key: 'in/a' });
    expect(state.s3.selectedKeys).toEqual(['in/c']);
    state = uploadQueueReducer(state, { type: 's3_key_toggled', key: 'in/b' });
    expect(state.s3.selectedKeys).toEqual(['in/c', 'in/b']);
    state = uploadQueueReducer(state, { type: 's3_all_toggled' });
    expect(state.s3.selectedKeys).toEqual(['in/b']);
    state = uploadQueueReducer(state, { type: 's3_all_toggled' });
    expect(state.s3.selectedKeys).toEqual(['in/b', 'in/c']);
  });

  test('S3 retry keeps unattempted retry-eligible keys and closes the picker only when done', () => {
    let state = uploadQueueReducer(listed(), {
      type: 's3_import_settled', attemptedKeys: ['in/a', 'in/b', 'in/c', 'in/d'], importedKeys: ['in/a', 'in/d'], retryableKeys: ['in/b', 'in/c'],
    });
    state = uploadQueueReducer(state, { type: 's3_import_reported', reconciliationBlock: null });
    expect(state.status).toBe(UPLOAD_QUEUE_STATUS.PARTIAL);
    expect(state.s3.pickerOpen).toBe(true);
    state = uploadQueueReducer(state, { type: 's3_import_settled', attemptedKeys: ['in/b'], importedKeys: ['in/b'], retryableKeys: [] });
    expect(state.s3.retryEligibleKeys).toEqual(['in/c']);
    expect(state.status).toBe(UPLOAD_QUEUE_STATUS.PARTIAL);
    state = uploadQueueReducer(state, { type: 's3_import_settled', attemptedKeys: ['in/c'], importedKeys: ['in/c'], retryableKeys: [] });
    expect(state.status).toBe(UPLOAD_QUEUE_STATUS.DONE);
    state = uploadQueueReducer(state, { type: 's3_import_reported', reconciliationBlock: null });
    expect(state.s3.pickerOpen).toBe(false);
  });

  test('reconciliation block is stored on report and cleared on resolution or relisting', () => {
    let state = uploadQueueReducer(listed(), {
      type: 's3_import_settled', attemptedKeys: ['in/a'], importedKeys: [], retryableKeys: [], completionUnknownKeys: ['in/a'],
    });
    state = uploadQueueReducer(state, { type: 's3_import_reported', reconciliationBlock: { completion: { total: 1 } } });
    expect(state.s3.reconciliationBlock).toEqual({ completion: { total: 1 } });
    expect(state.s3.pickerOpen).toBe(true);
    expect(uploadQueueReducer(state, { type: 's3_reconciliation_resolved' }).s3.reconciliationBlock).toBeNull();
    expect(uploadQueueReducer(state, { type: 'reset' })).toBe(initialUploadQueueState);
  });
});
