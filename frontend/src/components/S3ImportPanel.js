import React from 'react';

// S3 URL entry, uncertain-import reconciliation banner, and paged S3 object picker.
// Selection and retry state is owned by the upload queue reducer in ImageUploader.
function S3ImportPanel({
  s3Url,
  onS3UrlChange,
  onLoadFiles,
  loading,
  reconciliationBlock,
  onRetryReconciliation,
  importing,
  pickerOpen,
  objects,
  visibleObjects,
  selectedKeySet,
  confirmedKeySet,
  selectedCount,
  selectedTotalBytes,
  globalSelectionCount,
  allGlobalSelected,
  retryMode,
  listingTruncated,
  onToggleKey,
  onToggleAll,
  pageIndex,
  pageCount,
  pageStart,
  pageEnd,
  onPageChange,
  onImport,
  extractorValid,
  onClosePicker,
  busy,
  formatSize,
}) {
  return (
    <>
    <div className="form-group" style={{ marginTop: '16px' }}>
      <label htmlFor="s3-url-input">S3 URL (Optional)</label>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          id="s3-url-input"
          type="text"
          className="form-control"
          placeholder="s3://bucket/path/to/files/"
          value={s3Url}
          onChange={(e) => onS3UrlChange(e.target.value)}
          disabled={busy || Boolean(reconciliationBlock)}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onLoadFiles}
          disabled={busy || Boolean(reconciliationBlock)}
        >
          {loading ? 'Loading S3 Files...' : 'Load Files from S3'}
        </button>
      </div>
      <small className="form-text">
        Enter an s3:// bucket or prefix, then choose which files to load into this project.
      </small>
    </div>

    {reconciliationBlock && (
      <div className="alert alert-warning" role="alert">
        An uncertain S3 import has not been reconciled. Loading selected S3 files again is blocked to prevent duplicates.
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginLeft: '8px' }}
          onClick={onRetryReconciliation}
          disabled={busy}
        >
          {importing ? 'Retrying Project Reconciliation...' : 'Retry Project Reconciliation'}
        </button>
      </div>
    )}

    {pickerOpen && (
      <div
        className="card"
        style={{
          margin: '12px 0',
          border: '1px solid #dee2e6',
          boxSizing: 'border-box',
          maxWidth: '100%',
          minWidth: 0,
        }}
        data-testid="s3-file-picker"
      >
        <div className="card-header">
          <h3 style={{ margin: 0 }}>Choose S3 Files</h3>
        </div>
        <div className="card-content">
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '8px',
            minWidth: 0,
          }}>
            <span>{selectedCount} / {objects.length} selected ({formatSize(selectedTotalBytes)})</span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onToggleAll}
              disabled={busy || globalSelectionCount === 0}
            >
              {retryMode
                ? (allGlobalSelected
                  ? 'Clear Retryable Failures'
                  : 'Select Retryable Failures')
                : (allGlobalSelected ? 'Clear Selection' : 'Select All')}
            </button>
          </div>
          {listingTruncated && (
            <div className="alert alert-warning" role="status" style={{ marginBottom: '8px' }}>
              The S3 listing was truncated by the server. All returned files are selectable; narrow the S3 prefix to load additional files.
            </div>
          )}
          <div
            id="s3-object-list"
            style={{
              maxHeight: '240px',
              overflowX: 'hidden',
              overflowY: 'auto',
              border: '1px solid #e9ecef',
              borderRadius: '4px',
              minWidth: 0,
            }}
          >
            {visibleObjects.map((object) => (
              <label
                key={object.key}
                data-testid="s3-object-row"
                style={{
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center',
                  padding: '8px',
                  borderBottom: '1px solid #f1f3f5',
                  minWidth: 0,
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedKeySet.has(object.key)}
                  onChange={() => onToggleKey(object.key)}
                  disabled={busy || confirmedKeySet.has(object.key)}
                />
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                  <strong style={{ overflowWrap: 'anywhere' }}>{object.filename}</strong>
                  <br />
                  <small style={{ overflowWrap: 'anywhere' }}>
                    {object.key} · {formatSize(object.size)}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <nav
            aria-label="S3 object pages"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
              marginTop: '8px',
              minWidth: 0,
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              aria-controls="s3-object-list"
              onClick={() => onPageChange(pageIndex - 1)}
              disabled={busy || pageIndex === 0}
            >
              Previous
            </button>
            <span
              role="status"
              aria-live="polite"
              data-testid="s3-pagination-status"
              style={{ flex: '1 1 180px', minWidth: 0, overflowWrap: 'anywhere', textAlign: 'center' }}
            >
              Page {pageIndex + 1} of {pageCount}
              {' · '}
              Showing {objects.length === 0 ? 0 : pageStart + 1}-{pageEnd} of {objects.length} objects
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              aria-controls="s3-object-list"
              onClick={() => onPageChange(Math.min(pageCount - 1, pageIndex + 1))}
              disabled={busy || pageIndex >= pageCount - 1}
            >
              Next
            </button>
          </nav>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
            <button
              type="button"
              className="btn btn-success"
              onClick={onImport}
              disabled={busy || Boolean(reconciliationBlock) || selectedCount === 0 || !extractorValid}
            >
              {importing ? 'Loading Selected S3 Files...' : 'Load Selected S3 Files'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onClosePicker()}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

export default S3ImportPanel;
