import React from 'react';

export function IngestValidationPanel({ ingestResult, onRequestIngestValidation }) {
  return (
    <section className="workbench-panel project-data-action-panel" aria-label="Project data validation">
      <header className="workbench-header">
        <div>
          <h2>Data Validation</h2>
          <p>Run a synthetic ingest pass against the current batch and part structure.</p>
        </div>
        <div className="workbench-detail-actions">
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="request-ingest-validation"
            disabled={ingestResult.loading}
            onClick={onRequestIngestValidation}
          >
            {ingestResult.loading ? 'Running Ingest Validation...' : 'Run Ingest Validation'}
          </button>
        </div>
      </header>
      {ingestResult.error && <div className="alert alert-error">{ingestResult.error}</div>}
      {ingestResult.payload && (
        <div className="alert alert-success" data-testid="ingest-validation-result">
          Ingest validation complete: created {ingestResult.payload?.counters?.parts_created || 0} parts, skipped{' '}
          {ingestResult.payload?.counters?.parts_skipped_existing || 0} existing, discrepancies{' '}
          {(ingestResult.payload?.discrepancies || []).length}.
        </div>
      )}
    </section>
  );
}

export function RecentlyDeletedOverlaysPanel({
  onRefresh,
  onRestore,
  recentlyDeletedLoading,
  recentlyDeletedOverlays,
}) {
  return (
    <section className="workbench-panel recently-deleted-overlays-panel" role="tabpanel" aria-label="Recently Deleted">
      <header className="workbench-header">
        <div>
          <h2>Recently Deleted Overlays</h2>
          <p>Analyze overlays remain recoverable for 48 hours before their part metadata is purged.</p>
        </div>
        <div className="workbench-detail-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={recentlyDeletedLoading}
            onClick={onRefresh}
          >
            {recentlyDeletedLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>
      {recentlyDeletedLoading ? (
        <div className="loading-text">Loading recently deleted overlays...</div>
      ) : recentlyDeletedOverlays.length === 0 ? (
        <p className="muted">No Analyze overlays are waiting for deletion.</p>
      ) : (
        <div className="recently-deleted-overlay-list">
          {recentlyDeletedOverlays.map((overlay) => (
            <article key={`${overlay.part_id}-${overlay.image_id}`} className="recently-deleted-overlay-row">
              <div>
                <h3>{overlay.label || 'Analyze Overlay'}</h3>
                <p>
                  {overlay.part_display_name || overlay.part_serial_number}
                  {' '}
                  -
                  {' '}
                  {overlay.filename}
                </p>
                <span>
                  Deleted {overlay.deleted_at ? new Date(overlay.deleted_at).toLocaleString() : 'recently'}
                  {' '}
                  -
                  {' '}
                  purges {overlay.pending_hard_delete_at ? new Date(overlay.pending_hard_delete_at).toLocaleString() : 'after retention'}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onRestore(overlay)}
              >
                Restore
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
