import { formatAnnotationTimestamp } from './annotationListHelpers';

const ACTION_LABELS = {
  created: 'Created',
  updated: 'Edited',
  approved: 'Approved',
  deleted: 'Deleted',
};

const FIELD_LABELS = {
  comment: 'Comment',
  failure_code: 'Failure code',
  failure_code_description: 'Failure code description',
  disposition_code: 'Disposition code',
  disposition_code_description: 'Disposition code description',
  disposition_instructions: 'Disposition instructions',
  status: 'Status',
  approved_by: 'Approved by',
  approval_revoked: 'Approval revoked',
  deleted: 'Deleted',
};

// Description fields are shown alongside their codes; hide them as separate
// rows to keep the history readable.
const HIDDEN_FIELDS = new Set(['failure_code_description', 'disposition_code_description']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatValue(field, value) {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (field === 'approval_revoked' && typeof value === 'object') {
    return `approved by ${value.approved_by || 'unknown'}${value.approved_at ? ` at ${formatAnnotationTimestamp(value.approved_at)}` : ''}`;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function HistoryChange({ entry, field, change }) {
  const label = FIELD_LABELS[field] || field;
  if (entry.action === 'created') {
    return (
      <li>
        <span className="ncr-history-field">{label}:</span> {formatValue(field, change.to)}
      </li>
    );
  }
  if (field === 'approval_revoked') {
    return (
      <li>
        <span className="ncr-history-field">{label}:</span> {formatValue(field, change.from)}
      </li>
    );
  }
  return (
    <li>
      <span className="ncr-history-field">{label}:</span>{' '}
      <span className="ncr-history-from">{formatValue(field, change.from)}</span>
      {' -> '}
      <span className="ncr-history-to">{formatValue(field, change.to)}</span>
    </li>
  );
}

/**
 * Change history for an NCR, newest first: who did what, when, and the
 * before and after value of each changed field.
 */
export function NcrHistory({ history, loading }) {
  if (loading) return <p className="muted">Loading change history…</p>;
  const entries = Array.isArray(history)
    ? history
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry, index) => ({ entry, index }))
      // Newest first by version; fall back to server order when unversioned.
      .sort((left, right) => {
        const lv = Number.isFinite(left.entry.version) ? left.entry.version : left.index;
        const rv = Number.isFinite(right.entry.version) ? right.entry.version : right.index;
        return rv - lv || right.index - left.index;
      })
    : [];
  return (
    <section className="ncr-history" aria-label="Change history">
      <h5>Change history</h5>
      {entries.length === 0 ? (
        <p className="muted">No history recorded.</p>
      ) : (
        <ol className="ncr-history-list">
          {entries.map(({ entry, index }) => (
            <li key={entry.id || `history-${index}`} className="ncr-history-entry" data-testid="ncr-history-entry">
              <div className="ncr-history-summary">
                <strong>{ACTION_LABELS[entry.action] || entry.action}</strong>
                {` by ${entry.actor || 'unknown'} - ${formatAnnotationTimestamp(entry.at)}`}
              </div>
              <ul className="ncr-history-changes">
                {Object.entries(isPlainObject(entry.changes) ? entry.changes : {})
                  .filter(([field]) => !HIDDEN_FIELDS.has(field))
                  .map(([field, change]) => (
                    <HistoryChange key={field} entry={entry} field={field} change={isPlainObject(change) ? change : {}} />
                  ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
