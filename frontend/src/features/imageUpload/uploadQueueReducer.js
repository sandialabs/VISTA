// Upload queue state machine shared by local file uploads and S3 imports.
//
// Status lifecycle:
//   idle -> uploading -> done | partial | completion-unknown
// `partial` means some files definitely failed and may be retried.
// `completion-unknown` means at least one request may have committed on the
// server without a readable response. Those files are never re-added to the
// retry selection; the user must audit project data and reselect explicitly.

export const UPLOAD_QUEUE_STATUS = Object.freeze({
  IDLE: 'idle',
  UPLOADING: 'uploading',
  PARTIAL: 'partial',
  COMPLETION_UNKNOWN: 'completion-unknown',
  DONE: 'done',
});

export const UPLOAD_SOURCES = Object.freeze({
  LOCAL: 'local_upload',
  S3: 's3_import',
  S3_RECONCILE: 's3_reconcile',
});

const EMPTY_S3_STATE = Object.freeze({
  objects: [],
  selectedKeys: [],
  confirmedKeys: [],
  retryEligibleKeys: [],
  retryMode: false,
  pickerOpen: false,
  pageIndex: 0,
  reconciliationBlock: null,
});

export const initialUploadQueueState = Object.freeze({
  status: UPLOAD_QUEUE_STATUS.IDLE,
  source: null,
  statusBeforeUpload: UPLOAD_QUEUE_STATUS.IDLE,
  localFiles: [],
  s3: EMPTY_S3_STATE,
});

function orderKeysByObjects(objects, keySet) {
  return objects.filter((object) => keySet.has(object.key)).map((object) => object.key);
}

function settledStatus({ completionUnknownCount, retryableCount }) {
  if (completionUnknownCount > 0) return UPLOAD_QUEUE_STATUS.COMPLETION_UNKNOWN;
  if (retryableCount > 0) return UPLOAD_QUEUE_STATUS.PARTIAL;
  return UPLOAD_QUEUE_STATUS.DONE;
}

// Keys offered by the global select/clear toggle: never confirmed keys, and
// only retry-eligible keys once an import has settled.
export function selectS3GlobalSelectionKeys(s3) {
  const confirmed = new Set(s3.confirmedKeys);
  const eligible = new Set(s3.retryEligibleKeys);
  return s3.objects
    .filter((object) => !confirmed.has(object.key) && (!s3.retryMode || eligible.has(object.key)))
    .map((object) => object.key);
}

function toggleS3Key(s3, key) {
  if (s3.confirmedKeys.includes(key)) return s3;
  const selected = new Set(s3.selectedKeys);
  if (selected.has(key)) selected.delete(key);
  else selected.add(key);
  return { ...s3, selectedKeys: Array.from(selected) };
}

function toggleAllS3Keys(s3) {
  const globalKeys = selectS3GlobalSelectionKeys(s3);
  if (globalKeys.length === 0) return s3;
  const selected = new Set(s3.selectedKeys);
  const clearGlobalSelection = globalKeys.every((key) => selected.has(key));
  globalKeys.forEach((key) => {
    if (clearGlobalSelection) selected.delete(key);
    else selected.add(key);
  });
  s3.confirmedKeys.forEach((key) => selected.delete(key));
  return { ...s3, selectedKeys: orderKeysByObjects(s3.objects, selected) };
}

function settleS3Import(s3, { attemptedKeys = [], importedKeys = [], retryableKeys = [], pageSize = 0 }) {
  const confirmed = new Set([...s3.confirmedKeys, ...importedKeys]);
  const confirmedKeys = orderKeysByObjects(s3.objects, confirmed);
  const eligible = new Set(s3.retryEligibleKeys);
  attemptedKeys.forEach((key) => eligible.delete(key));
  retryableKeys.forEach((key) => eligible.add(key));
  confirmedKeys.forEach((key) => eligible.delete(key));
  let { pageIndex } = s3;
  if (retryableKeys.length > 0 && pageSize > 0) {
    const firstFailureIndex = s3.objects.findIndex((object) => object.key === retryableKeys[0]);
    if (firstFailureIndex >= 0) pageIndex = Math.floor(firstFailureIndex / pageSize);
  }
  return {
    ...s3,
    confirmedKeys,
    retryEligibleKeys: orderKeysByObjects(s3.objects, eligible),
    retryMode: true,
    selectedKeys: retryableKeys,
    pageIndex,
  };
}

export function uploadQueueReducer(state, action) {
  switch (action.type) {
    case 'reset':
      return initialUploadQueueState;
    case 'local_files_selected':
      return { ...state, status: UPLOAD_QUEUE_STATUS.IDLE, source: UPLOAD_SOURCES.LOCAL, localFiles: action.files };
    case 'upload_started':
      return {
        ...state,
        status: UPLOAD_QUEUE_STATUS.UPLOADING,
        source: action.source,
        statusBeforeUpload: state.status === UPLOAD_QUEUE_STATUS.UPLOADING ? state.statusBeforeUpload : state.status,
      };
    case 'upload_finished':
      // Requests that stop before settling (validation or metadata errors)
      // return the queue to its previous status.
      return state.status === UPLOAD_QUEUE_STATUS.UPLOADING
        ? { ...state, status: state.statusBeforeUpload }
        : state;
    case 'local_upload_settled':
      return {
        ...state,
        status: settledStatus({
          completionUnknownCount: action.completionUnknownCount,
          retryableCount: action.retryableFiles.length,
        }),
        source: UPLOAD_SOURCES.LOCAL,
        localFiles: action.retryableFiles,
      };
    case 's3_listing_started':
      return { ...state, status: UPLOAD_QUEUE_STATUS.IDLE, source: UPLOAD_SOURCES.S3, s3: EMPTY_S3_STATE };
    case 's3_listing_loaded':
      return {
        ...state,
        s3: {
          ...state.s3,
          objects: action.objects,
          selectedKeys: action.objects.map((object) => object.key),
          pickerOpen: true,
        },
      };
    case 's3_key_toggled':
      return { ...state, s3: toggleS3Key(state.s3, action.key) };
    case 's3_all_toggled':
      return { ...state, s3: toggleAllS3Keys(state.s3) };
    case 's3_page_changed':
      return { ...state, s3: { ...state.s3, pageIndex: Math.max(0, action.pageIndex) } };
    case 's3_picker_closed':
      return { ...state, s3: { ...state.s3, pickerOpen: false } };
    case 's3_import_settled': {
      const s3 = settleS3Import(state.s3, action);
      return {
        ...state,
        status: settledStatus({
          completionUnknownCount: action.completionUnknownKeys?.length || 0,
          retryableCount: s3.retryEligibleKeys.length,
        }),
        source: UPLOAD_SOURCES.S3,
        s3,
      };
    }
    case 's3_import_reported':
      // Close the picker only when nothing is retryable and nothing is uncertain.
      return {
        ...state,
        s3: {
          ...state.s3,
          reconciliationBlock: action.reconciliationBlock || null,
          pickerOpen: state.status === UPLOAD_QUEUE_STATUS.DONE ? false : state.s3.pickerOpen,
        },
      };
    case 's3_reconciliation_resolved':
      return { ...state, s3: { ...state.s3, reconciliationBlock: null } };
    default:
      return state;
  }
}

export function isQueueUploading(state, source) {
  return state.status === UPLOAD_QUEUE_STATUS.UPLOADING
    && (Array.isArray(source) ? source.includes(state.source) : state.source === source);
}
