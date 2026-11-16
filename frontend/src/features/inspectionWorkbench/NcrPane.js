import { formatAnnotationTimestamp } from './annotationListHelpers';
import { NcrEditorModal } from './NcrEditorModal';
import { NcrHistory } from './NcrHistory';
import { isDeletedNcr } from './useInspectionNcrs';

// Display helpers: never render "undefined"/"null" for missing fields.
const text = (value, fallback = '') => (value === null || value === undefined ? fallback : String(value));
const codeText = (code, description) => {
  const base = text(code, '-');
  return description ? `${base} - ${description}` : base;
};
const actorAt = (actor, at) => [text(actor), at ? formatAnnotationTimestamp(at) : ''].filter(Boolean).join(' - ') || '-';

function NcrStatusBadge({ status, deleted = false }) {
  if (deleted) {
    return (
      <span className="ncr-status-badge ncr-status-deleted" data-testid="ncr-status">
        Deleted
      </span>
    );
  }
  const approved = status === 'approved';
  return (
    <span
      className={`ncr-status-badge ${approved ? 'ncr-status-approved' : 'ncr-status-open'}`}
      data-testid="ncr-status"
    >
      {approved ? 'Approved' : 'Open'}
    </span>
  );
}

function NcrDetail({ detail, readOnly, busy, onEdit, onApprove, onDelete, onClose }) {
  const { ncr } = detail;
  const deleted = isDeletedNcr(ncr);
  return (
    <section className={`ncr-detail${deleted ? ' ncr-detail-deleted' : ''}`} aria-label={`${ncr.ncr_label} details`}>
      <div className="ncr-detail-header">
        <h4>{text(ncr.ncr_label, 'NCR')}</h4>
        <NcrStatusBadge status={ncr.status} deleted={deleted} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} aria-label={`Close ${ncr.ncr_label} details`}>
          Close
        </button>
      </div>
      <dl className="ncr-detail-fields">
        <dt>Part</dt>
        <dd>{text(ncr.part_serial_number, '-')}</dd>
        <dt>Failure code</dt>
        <dd>{codeText(ncr.failure_code, ncr.failure_code_description)}</dd>
        <dt>Disposition code</dt>
        <dd>{codeText(ncr.disposition_code, ncr.disposition_code_description)}</dd>
        <dt>Comment</dt>
        <dd className="ncr-multiline">{text(ncr.comment)}</dd>
        <dt>Disposition instructions</dt>
        <dd className="ncr-multiline">{text(ncr.disposition_instructions)}</dd>
        <dt>Created</dt>
        <dd>{actorAt(ncr.created_by, ncr.created_at)}</dd>
        <dt>Last edited</dt>
        <dd>{actorAt(ncr.updated_by, ncr.updated_at)}</dd>
        {ncr.status === 'approved' && (
          <>
            <dt>Approved</dt>
            <dd>{actorAt(ncr.approved_by, ncr.approved_at)}</dd>
          </>
        )}
        {deleted && (
          <>
            <dt>Deleted</dt>
            <dd>{actorAt(ncr.deleted_by, ncr.deleted_at)}</dd>
          </>
        )}
      </dl>
      {deleted && (
        <p className="ncr-deleted-note" role="note">
          This NCR was deleted. It is shown read-only for traceability.
        </p>
      )}
      {!readOnly && !deleted && (
        <div className="ncr-detail-actions">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onEdit(ncr)}>
            Edit
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || ncr.status === 'approved'}
            onClick={() => onApprove(ncr)}
          >
            {ncr.status === 'approved' ? 'Approved' : 'Approve'}
          </button>
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => onDelete(ncr)}>
            Delete
          </button>
        </div>
      )}
      {detail.error && <div className="alert alert-error">{detail.error}</div>}
      <NcrHistory history={detail.history} loading={detail.loading} />
    </section>
  );
}

/**
 * Inspection "NCR" tab: lists the selected part's nonconformance reports and
 * hosts the create/edit form, approval, deletion, and change history.
 */
export function NcrPane({
  selectedPart,
  readOnly,
  failureCodes,
  dispositionCodes,
  ncrState,
  confirmDelete = (message) => window.confirm(message),
}) {
  const {
    ncrs,
    loading,
    loadError,
    editor,
    openCreate,
    openEdit,
    closeEditor,
    setDraft,
    saveEditor,
    detail,
    openDetail,
    closeDetail,
    approve,
    remove,
    busy,
    actionError,
    showDeleted = false,
    setShowDeleted = () => {},
  } = ncrState;
  const deletedCount = ncrs.filter(isDeletedNcr).length;
  const codesConfigured = failureCodes.length > 0 && dispositionCodes.length > 0;

  const handleDelete = async (ncr) => {
    if (!confirmDelete(`Delete ${ncr.ncr_label}? It will be hidden from this part but kept with its history; tick "View deleted" to see it.`)) {
      return;
    }
    await remove(ncr);
  };

  return (
    <section className="workbench-tabbed-panel ncr-pane" data-layout-region="ncrs" aria-label="Nonconformance reports">
      <div className="ncr-controls">
        <p className="muted">For selected part: {selectedPart?.serial_number || 'No part selected'}</p>
        {!readOnly && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={openCreate}
            disabled={!selectedPart || busy}
          >
            Add NCR
          </button>
        )}
        <label className="ncr-view-deleted">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(event) => setShowDeleted(event.target.checked)}
          />
          View deleted
        </label>
        {!readOnly && selectedPart && !codesConfigured && (
          <p className="muted" data-testid="ncr-codes-missing">
            {'Failure and disposition codes are configured under Project Configuration > NCR Configuration.'}
          </p>
        )}
      </div>
      {actionError && !editor && <div className="alert alert-error" role="alert">{actionError}</div>}
      {loadError && <div className="alert alert-error" role="alert">{loadError}</div>}
      <ul className="measurement-list ncr-list" data-testid="ncr-list">
        {!selectedPart ? (
          <li className="muted">Select a part to view its NCRs.</li>
        ) : loading && ncrs.length === 0 ? (
          <li className="muted">Loading NCRs…</li>
        ) : ncrs.length === 0 ? (
          <li className="muted">
            {showDeleted ? 'No NCRs, including deleted ones, for this part.' : 'No NCRs recorded for this part.'}
          </li>
        ) : (
          ncrs.map((ncr) => {
            const selected = detail?.ncr?.id === ncr.id;
            const deleted = isDeletedNcr(ncr);
            return (
              <li
                key={ncr.id}
                className={`annotation-entry ncr-entry ${selected ? 'selected' : ''} ${deleted ? 'ncr-entry-deleted' : ''}`}
                data-deleted={deleted ? 'true' : undefined}
              >
                <button
                  type="button"
                  className="ncr-entry-open"
                  aria-label={`View ${ncr.ncr_label}`}
                  aria-expanded={selected}
                  onClick={() => (selected ? closeDetail() : openDetail(ncr))}
                >
                  <span className="annotation-entry-type">{text(ncr.ncr_label, 'NCR')}</span>
                  <span className="annotation-entry-value">{`${text(ncr.failure_code, '-')} / ${text(ncr.disposition_code, '-')}`}</span>
                  <span className="annotation-entry-meta">{`Created by ${text(ncr.created_by, 'unknown')}`}</span>
                  <span className="annotation-entry-meta">
                    {deleted
                      ? `Deleted by ${actorAt(ncr.deleted_by, ncr.deleted_at)}`
                      : `Last edited by ${actorAt(ncr.updated_by, ncr.updated_at)}`}
                  </span>
                </button>
                <NcrStatusBadge status={ncr.status} deleted={deleted} />
              </li>
            );
          })
        )}
      </ul>
      {showDeleted && selectedPart && !loading && (
        <p className="muted ncr-deleted-count" aria-live="polite">
          {deletedCount === 1 ? '1 deleted NCR shown.' : `${deletedCount} deleted NCRs shown.`}
        </p>
      )}
      {detail && (
        <NcrDetail
          detail={detail}
          readOnly={readOnly}
          busy={busy}
          onEdit={openEdit}
          onApprove={approve}
          onDelete={handleDelete}
          onClose={closeDetail}
        />
      )}
      <NcrEditorModal
        editor={editor}
        readOnly={readOnly}
        busy={busy}
        error={actionError}
        failureCodes={failureCodes}
        dispositionCodes={dispositionCodes}
        selectedPart={selectedPart}
        setDraft={setDraft}
        onSave={saveEditor}
        onClose={closeEditor}
      />
    </section>
  );
}
