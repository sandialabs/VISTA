import React, { useEffect, useRef, useState } from 'react';
import {
  fetchProjectExportBundleArchiveResponse,
  fetchProjectExportBundleSummary,
  fetchProjectReport,
  fetchProjectReportPdfResponse,
  fetchProjectReportWithImagesPdfResponse,
} from '../api/exports';
import { downloadExcel } from '../utils/downloadExcel';

const EXPORT_ACTIONS = {
  bundle_summary: 'bundle_summary',
  bundle_archive: 'bundle_archive',
  report_json: 'report_json',
  report_pdf: 'report_pdf',
};

const REPORT_RESULTS = new Set(['pass', 'reject', 'unreviewed']);

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateReportPayload(payload) {
  if (
    !payload
    || typeof payload !== 'object'
    || payload.schema_version !== 3
    || !payload.project
    || typeof payload.project !== 'object'
    || typeof payload.project.id !== 'string'
    || typeof payload.project.name !== 'string'
    || typeof payload.project.project_type !== 'string'
    || typeof payload.project.meta_group_id !== 'string'
    || !payload.summary
    || typeof payload.summary !== 'object'
    || !Array.isArray(payload.parts)
  ) {
    throw new Error('Report response did not match the v3 inspection report contract.');
  }

  const summary = payload.summary;
  const counts = summary.part_status_counts;
  if (
    !isNonNegativeInteger(summary.total_parts)
    || !isNonNegativeInteger(summary.reviewed_parts)
    || !isNonNegativeInteger(summary.unreviewed_parts)
    || !counts
    || typeof counts !== 'object'
    || !isNonNegativeInteger(counts.pass)
    || !isNonNegativeInteger(counts.reject)
    || !isNonNegativeInteger(counts.unreviewed)
  ) {
    throw new Error('Report response did not match the v3 inspection report contract.');
  }

  const computedCounts = { pass: 0, reject: 0, unreviewed: 0 };
  const partIds = new Set();
  const partIdentifiers = new Set();
  payload.parts.forEach((part) => {
    if (
      !part
      || typeof part !== 'object'
      || Object.keys(part).length !== 3
      || !['part_id', 'part_identifier', 'inspection_result'].every((key) => Object.hasOwn(part, key))
      || typeof part.part_id !== 'string'
      || typeof part.part_identifier !== 'string'
      || !REPORT_RESULTS.has(part.inspection_result)
    ) {
      throw new Error('Report response did not match the v3 inspection report contract.');
    }
    if (partIds.has(part.part_id) || partIdentifiers.has(part.part_identifier)) {
      throw new Error('Report response did not match the v3 inspection report contract.');
    }
    partIds.add(part.part_id);
    partIdentifiers.add(part.part_identifier);
    computedCounts[part.inspection_result] += 1;
  });

  const computedReviewed = computedCounts.pass + computedCounts.reject;
  if (
    summary.total_parts !== payload.parts.length
    || summary.reviewed_parts !== computedReviewed
    || summary.unreviewed_parts !== computedCounts.unreviewed
    || counts.pass !== computedCounts.pass
    || counts.reject !== computedCounts.reject
    || counts.unreviewed !== computedCounts.unreviewed
  ) {
    throw new Error('Report response did not match the v3 inspection report contract.');
  }

  return payload;
}

function safeReportFilename(projectName, reportStem = 'report') {
  const sanitized = Array.from(String(projectName || 'project')
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_'))
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .replace(/[.\s]+$/g, '')
    .slice(0, 120);
  return `${sanitized || 'project'}-${reportStem}.pdf`;
}

function resultLabel(result) {
  if (result === 'pass') return 'Pass';
  if (result === 'reject') return 'Reject';
  return 'Unreviewed';
}

async function readBlobPrefix(blob, byteCount) {
  const prefix = blob.slice(0, byteCount);
  let buffer;
  if (typeof prefix.arrayBuffer === 'function') {
    buffer = await prefix.arrayBuffer();
  } else {
    buffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Unable to read PDF report.'));
      reader.readAsArrayBuffer(prefix);
    });
  }
  return String.fromCharCode(...new Uint8Array(buffer));
}

async function downloadValidatedPdf({
  requestPdf,
  filename,
  requestErrorLabel,
  invalidResponseMessage,
  isCurrent = () => true,
}) {
  let objectUrl = null;
  let link = null;
  try {
    const resp = await requestPdf();
    if (!isCurrent()) return null;
    if (!resp.ok) throw new Error(`${requestErrorLabel} (${resp.status})`);
    const contentType = resp.headers.get('content-type') || '';
    if (!/^application\/pdf(?:\s*;|$)/i.test(contentType)) {
      throw new Error(invalidResponseMessage);
    }
    const blob = await resp.blob();
    if (!isCurrent()) return null;
    if (blob.size === 0 || await readBlobPrefix(blob, 5) !== '%PDF-') {
      throw new Error(invalidResponseMessage);
    }
    objectUrl = window.URL.createObjectURL(blob);
    if (!isCurrent()) return null;
    link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    return blob.size;
  } finally {
    if (link?.parentNode) link.parentNode.removeChild(link);
    if (objectUrl) window.URL.revokeObjectURL(objectUrl);
  }
}

function ProjectReportTab({ projectId, projectName, setError }) {
  const [bundleExport, setBundleExport] = useState({ loading: false, error: null, payload: null });
  const [bundleArchive, setBundleArchive] = useState({ loading: false, error: null, details: null });
  const [reportExport, setReportExport] = useState({ loading: false, error: null, payload: null });
  const [pdfDownload, setPdfDownload] = useState({ loading: false, error: null, sizeBytes: null });
  const [imageReportDownload, setImageReportDownload] = useState({ loading: false, error: null, sizeBytes: null });
  const [exportAction, setExportAction] = useState(EXPORT_ACTIONS.bundle_summary);
  const [exportingExcel, setExportingExcel] = useState(false);
  const imageReportRequestPending = useRef(false);
  const reportRequestGeneration = useRef(0);
  const reportRequestControllers = useRef(new Set());

  useEffect(() => {
    const controllers = reportRequestControllers.current;
    reportRequestGeneration.current += 1;
    controllers.forEach((controller) => controller.abort());
    controllers.clear();
    imageReportRequestPending.current = false;
    setReportExport({ loading: false, error: null, payload: null });
    setPdfDownload({ loading: false, error: null, sizeBytes: null });
    setImageReportDownload({ loading: false, error: null, sizeBytes: null });
    return () => {
      reportRequestGeneration.current += 1;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, [projectId]);

  const beginReportRequest = () => {
    const generation = reportRequestGeneration.current;
    const controller = new AbortController();
    reportRequestControllers.current.add(controller);
    return {
      controller,
      isCurrent: () => (
        generation === reportRequestGeneration.current && !controller.signal.aborted
      ),
    };
  };

  const requestExportBundleSummary = async () => {
    try {
      setBundleExport({ loading: true, error: null, payload: null });
      const payload = await fetchProjectExportBundleSummary(projectId);
      setBundleExport({ loading: false, error: null, payload });
    } catch (err) {
      setBundleExport({ loading: false, error: err.message || 'Failed to generate export bundle summary', payload: null });
    }
  };

  const requestExportBundleArchive = async () => {
    try {
      setBundleArchive({ loading: true, error: null, details: null });
      const resp = await fetchProjectExportBundleArchiveResponse(projectId);
      if (!resp.ok) throw new Error(`Failed to generate export bundle archive (${resp.status})`);
      const archiveBlob = await resp.blob();
      setBundleArchive({
        loading: false,
        error: null,
        details: { sizeBytes: archiveBlob.size, contentType: resp.headers.get('content-type') || 'application/octet-stream' },
      });
    } catch (err) {
      setBundleArchive({ loading: false, error: err.message || 'Failed to generate export bundle archive', details: null });
    }
  };

  const requestProjectReportJson = async () => {
    const request = beginReportRequest();
    try {
      setReportExport((current) => ({ loading: true, error: null, payload: current.payload }));
      const payload = validateReportPayload(await fetchProjectReport(
        projectId,
        { schemaVersion: 3 },
        { signal: request.controller.signal },
      ));
      if (!request.isCurrent()) return;
      setReportExport({ loading: false, error: null, payload });
    } catch (err) {
      if (!request.isCurrent() || err.name === 'AbortError') return;
      setReportExport((current) => ({
        loading: false,
        error: err.message || 'Failed to generate report',
        payload: current.payload,
      }));
    } finally {
      reportRequestControllers.current.delete(request.controller);
    }
  };

  const requestProjectReportPdf = async () => {
    const request = beginReportRequest();
    try {
      setPdfDownload({ loading: true, error: null, sizeBytes: null });
      const sizeBytes = await downloadValidatedPdf({
        requestPdf: () => fetchProjectReportPdfResponse(
          projectId,
          { schemaVersion: 3 },
          { signal: request.controller.signal },
        ),
        filename: safeReportFilename(projectName),
        requestErrorLabel: 'Failed to generate PDF report',
        invalidResponseMessage: 'The server did not return a valid PDF report.',
        isCurrent: request.isCurrent,
      });
      if (!request.isCurrent() || sizeBytes === null) return;
      setPdfDownload({ loading: false, error: null, sizeBytes });
    } catch (err) {
      if (!request.isCurrent() || err.name === 'AbortError') return;
      setPdfDownload({
        loading: false,
        error: err.message || 'Failed to generate PDF report',
        sizeBytes: null,
      });
    } finally {
      reportRequestControllers.current.delete(request.controller);
    }
  };

  const requestProjectReportWithImagesPdf = async () => {
    if (imageReportRequestPending.current) return;
    imageReportRequestPending.current = true;
    const request = beginReportRequest();
    try {
      setImageReportDownload({ loading: true, error: null, sizeBytes: null });
      const sizeBytes = await downloadValidatedPdf({
        requestPdf: () => fetchProjectReportWithImagesPdfResponse(projectId, {
          signal: request.controller.signal,
        }),
        filename: safeReportFilename(projectName, 'report-with-images'),
        requestErrorLabel: 'Failed to generate report with images',
        invalidResponseMessage: 'The server did not return a valid PDF report with images.',
        isCurrent: request.isCurrent,
      });
      if (!request.isCurrent() || sizeBytes === null) return;
      setImageReportDownload({ loading: false, error: null, sizeBytes });
    } catch (err) {
      if (!request.isCurrent() || err.name === 'AbortError') return;
      setImageReportDownload({
        loading: false,
        error: err.message || 'Failed to generate report with images',
        sizeBytes: null,
      });
    } finally {
      reportRequestControllers.current.delete(request.controller);
      if (request.isCurrent()) imageReportRequestPending.current = false;
    }
  };

  const runProjectExportAction = async () => {
    if (exportAction === EXPORT_ACTIONS.bundle_summary) return requestExportBundleSummary();
    if (exportAction === EXPORT_ACTIONS.bundle_archive) return requestExportBundleArchive();
    if (exportAction === EXPORT_ACTIONS.report_pdf) return requestProjectReportPdf();
    return requestProjectReportJson();
  };

  const handleExportExcel = async () => {
    try {
      setExportingExcel(true);
      await downloadExcel(projectId, projectName);
    } catch (err) {
      setError?.(`Export failed: ${err.message}`);
    } finally {
      setExportingExcel(false);
    }
  };

  const actionLoading = bundleExport.loading || bundleArchive.loading || reportExport.loading || pdfDownload.loading;
  const report = reportExport.payload;
  const statusCounts = report?.summary?.part_status_counts;

  return (
    <section className="workbench-panel project-report-tab" aria-label="Project report and export">
      <header className="workbench-header project-report-heading">
        <div>
          <p className="project-report-kicker">Inspection record / export station</p>
          <h2>Project Report</h2>
          <p>Generate a concise part disposition record or export the underlying project data.</p>
        </div>
        <span className="project-report-schema" aria-label="Report schema version 3">Schema 03</span>
      </header>

      <div className="project-report-command-bar">
        <button type="button" className="btn btn-primary" onClick={handleExportExcel} disabled={exportingExcel}>
          {exportingExcel ? 'Exporting…' : 'Export Data (Excel)'}
        </button>
        <div className="project-report-mode">
          <label htmlFor="project-report-mode" className="form-label">Export/report mode</label>
          <select
            id="project-report-mode"
            className="form-control"
            value={exportAction}
            onChange={(event) => setExportAction(event.target.value)}
          >
            <option value={EXPORT_ACTIONS.bundle_summary}>Export bundle summary</option>
            <option value={EXPORT_ACTIONS.bundle_archive}>Export bundle archive</option>
            <option value={EXPORT_ACTIONS.report_json}>Project report JSON</option>
            <option value={EXPORT_ACTIONS.report_pdf}>Project report PDF</option>
          </select>
        </div>
        <button type="button" className="btn btn-secondary" onClick={runProjectExportAction} disabled={actionLoading}>
          {actionLoading ? 'Running…' : 'Run Export/Report'}
        </button>
        <button
          type="button"
          className="btn project-report-evidence-button"
          onClick={requestProjectReportWithImagesPdf}
          disabled={imageReportDownload.loading}
        >
          <span className="project-report-evidence-mark" aria-hidden="true" />
          {imageReportDownload.loading
            ? 'Preparing report with images…'
            : 'Download report with images (PDF)'}
        </button>
      </div>

      <div className="project-report-feedback" aria-live="polite">
        {actionLoading && <div className="project-report-progress" role="status">Preparing export…</div>}
        {imageReportDownload.loading && (
          <div className="project-report-progress project-report-evidence-progress" role="status">
            Preparing image evidence report…
          </div>
        )}
        {bundleExport.error && <div className="alert alert-error" role="alert">{bundleExport.error}</div>}
        {bundleArchive.error && <div className="alert alert-error" role="alert">{bundleArchive.error}</div>}
        {pdfDownload.error && <div className="alert alert-error" role="alert">{pdfDownload.error}</div>}
        {imageReportDownload.error && <div className="alert alert-error" role="alert">{imageReportDownload.error}</div>}
        {reportExport.error && (
          <div className="alert alert-error project-report-error" role="alert">
            <span>{reportExport.error}</span>
            <button type="button" className="btn btn-small btn-secondary" onClick={requestProjectReportJson}>
              Retry report
            </button>
          </div>
        )}
        {bundleExport.payload && <div className="alert alert-success">Export summary generated.</div>}
        {bundleArchive.details && <div className="alert alert-success">Export archive ready: {bundleArchive.details.sizeBytes} bytes.</div>}
        {pdfDownload.sizeBytes !== null && <div className="alert alert-success">PDF report downloaded: {pdfDownload.sizeBytes} bytes.</div>}
        {imageReportDownload.sizeBytes !== null && (
          <div className="alert alert-success">
            Report with images downloaded: {imageReportDownload.sizeBytes} bytes.
          </div>
        )}
      </div>

      {report && (
        <article className="inspection-record" aria-labelledby="inspection-record-title">
          <header className="inspection-record-header">
            <div>
              <p className="inspection-record-overline">VISTA / final inspection disposition</p>
              <h3 id="inspection-record-title">{report.project.name || projectName || 'Project'}</h3>
              <p className="inspection-record-id">Project ID · {report.project.id || projectId}</p>
            </div>
            <div className="inspection-record-progress" aria-label={`${report.summary.reviewed_parts} of ${report.summary.total_parts} parts reviewed`}>
              <strong>{report.summary.reviewed_parts}</strong>
              <span>/ {report.summary.total_parts} reviewed</span>
            </div>
          </header>

          <dl className="inspection-record-summary" aria-label="Inspection result summary">
            <div>
              <dt>Total parts</dt>
              <dd>{report.summary.total_parts}</dd>
            </div>
            <div className="inspection-summary-pass">
              <dt>Pass</dt>
              <dd>{statusCounts.pass}</dd>
            </div>
            <div className="inspection-summary-reject">
              <dt>Reject</dt>
              <dd>{statusCounts.reject}</dd>
            </div>
            <div className="inspection-summary-unreviewed">
              <dt>Unreviewed</dt>
              <dd>{statusCounts.unreviewed}</dd>
            </div>
          </dl>

          {report.parts.length === 0 ? (
            <div className="inspection-record-empty" role="status">
              <span aria-hidden="true">00</span>
              <div>
                <strong>No parts to report</strong>
                <p>This project has no inspection parts yet.</p>
              </div>
            </div>
          ) : (
            <div className="inspection-record-table-wrap">
              <table className="inspection-record-table">
                <caption>Inspection results by part</caption>
                <thead>
                  <tr>
                    <th scope="col">Part</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {report.parts.map((part, index) => (
                    <tr key={`${part.part_id}-${index}`}>
                      <th scope="row">
                        <span className="inspection-part-cell">
                          <span className="inspection-part-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                          <code>{part.part_identifier}</code>
                        </span>
                      </th>
                      <td>
                        <span className={`inspection-result inspection-result-${part.inspection_result}`}>
                          <span className="inspection-result-mark" aria-hidden="true" />
                          {resultLabel(part.inspection_result)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      )}
    </section>
  );
}

export default ProjectReportTab;
