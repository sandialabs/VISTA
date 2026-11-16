import React from 'react';

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

// Allow line breaks after '@' and '.' (zero-width break opportunities).
function breakableEmail(value) {
  return String(value).split(/(?<=[@.])/).flatMap((part, index) => (
    index === 0 ? [part] : [<wbr key={index} />, part]
  ));
}

// User and time on separate lines, so long emails do not break mid-word
// next to the timestamp.
function ActorStamp({ actor, at }) {
  const time = formatTimestamp(at);
  if (!actor && !time) return '-';
  return (
    <span className="ncr-actor-stamp">
      {actor && <span className="ncr-actor">{breakableEmail(actor)}</span>}
      {time && <span className="ncr-actor-time">{time}</span>}
    </span>
  );
}

function codeLabel(code, description) {
  return description ? `${code} - ${description}` : code;
}

// Normalizes the optional `ncrs` list from the v3 report payload. Reports from
// servers that predate NCRs omit it; malformed rows are dropped.
export function getReportNcrs(report) {
  const rows = Array.isArray(report?.ncrs) ? report.ncrs : [];
  return rows.filter((row) => (
    row
    && typeof row === 'object'
    && typeof row.ncr_label === 'string'
    && typeof row.part_identifier === 'string'
  ));
}

/**
 * "Nonconformance Reports" section of the Project Report tab.
 */
export default function ProjectReportNcrTable({ report }) {
  const ncrs = getReportNcrs(report);
  if (!Array.isArray(report?.ncrs)) {
    // Older servers do not report NCRs; say so rather than implying none exist.
    return (
      <section className="inspection-record-ncrs" aria-label="Nonconformance reports">
        <h4>Nonconformance Reports</h4>
        <p className="muted" role="status">This report does not include nonconformance report data.</p>
      </section>
    );
  }
  return (
    <section className="inspection-record-ncrs" aria-label="Nonconformance reports">
      <h4>Nonconformance Reports</h4>
      {ncrs.length === 0 ? (
        <p className="muted" role="status">No nonconformance reports have been raised for this project.</p>
      ) : (
        <div className="inspection-record-table-wrap">
          <table className="inspection-record-table inspection-ncr-table">
            <caption>Nonconformance reports by number</caption>
            <thead>
              <tr>
                <th scope="col">NCR</th>
                <th scope="col">Part</th>
                <th scope="col">Status</th>
                <th scope="col">Failure code</th>
                <th scope="col">Disposition code</th>
                <th scope="col">Comment</th>
                <th scope="col">Disposition instructions</th>
                <th scope="col">Created</th>
                <th scope="col">Approved</th>
              </tr>
            </thead>
            <tbody>
              {ncrs.map((ncr) => (
                <tr key={ncr.ncr_id || ncr.ncr_label}>
                  <th scope="row"><code>{ncr.ncr_label}</code></th>
                  <td><code>{ncr.part_identifier}</code></td>
                  <td>
                    <span className={`ncr-status-badge ${ncr.status === 'approved' ? 'ncr-status-approved' : 'ncr-status-open'}`}>
                      {ncr.status === 'approved' ? 'Approved' : 'Open'}
                    </span>
                  </td>
                  <td>{codeLabel(ncr.failure_code, ncr.failure_code_description)}</td>
                  <td>{codeLabel(ncr.disposition_code, ncr.disposition_code_description)}</td>
                  <td className="ncr-multiline">{ncr.comment}</td>
                  <td className="ncr-multiline">{ncr.disposition_instructions}</td>
                  <td><ActorStamp actor={ncr.created_by} at={ncr.created_at} /></td>
                  <td>
                    {ncr.status === 'approved' ? <ActorStamp actor={ncr.approved_by} at={ncr.approved_at} /> : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
