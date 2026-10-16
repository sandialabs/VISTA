import React, { useCallback, useRef, useState } from 'react';
import {
  diagnoseAnalyzeCheckpointResponse,
  fetchAnalyzeCheckpointGraphResponse,
  uploadAnalyzeCheckpointResponse,
} from '../../api/analyses';
import { checkpointStatusText, formatParameterCount } from '../../features/analyzeWorkbench/checkpointDiagnostics';
import { parseWorkflowResponse, workflowRequestError } from '../../features/analyzeWorkbench/workflowResponse';
import { formatFileSizeFixed as formatFileSize } from '../../utils/formatFileSize';
import CheckpointDiagnostics, { CheckpointGraph } from './CheckpointDiagnostics';

function CheckpointsTab({ projectId, checkpointState, checkpointScope, onCheckpointStored, setError }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [graphState, setGraphState] = useState({ checkpoint: null, loading: false, payload: null, error: null });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fileInputRef = useRef(null);

  const openCheckpointGraph = useCallback(async (checkpoint) => {
    if (!checkpoint) return;
    setGraphState({ checkpoint, loading: true, payload: null, error: null });
    try {
      const resp = await fetchAnalyzeCheckpointGraphResponse(projectId, checkpoint.id);
      const { payload, text } = await parseWorkflowResponse(resp);
      if (!resp.ok) throw new Error(workflowRequestError('checkpoint graph', resp, payload, text));
      setGraphState({ checkpoint, loading: false, payload, error: null });
    } catch (err) {
      const errorMessage = err.message || 'Failed to load checkpoint graph';
      setGraphState({ checkpoint, loading: false, payload: null, error: errorMessage });
      if (setError) setError(errorMessage);
    }
  }, [projectId, setError]);

  const loadDiagnostics = useCallback(async (file) => {
    if (!file) return;
    setSelectedFile(file);
    setDiagnostics(null);
    setMessage(`Inspecting checkpoint ${file.name} (${formatFileSize(file.size)})...`);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const resp = await diagnoseAnalyzeCheckpointResponse(projectId, form);
      const { payload, text } = await parseWorkflowResponse(resp);
      if (!resp.ok) throw new Error(workflowRequestError('checkpoint diagnostics', resp, payload, text));
      setDiagnostics(payload);
      setMessage('Review diagnostics, then load the checkpoint if it matches your model.');
    } catch (err) {
      const baseMessage = err.message || 'Failed to inspect checkpoint';
      const errorMessage = `${baseMessage} File: ${file.name} (${formatFileSize(file.size)}).`;
      setMessage(errorMessage);
      setDiagnostics(null);
      if (setError) setError(errorMessage);
    } finally {
      setBusy(false);
    }
  }, [projectId, setError]);

  const storeCheckpoint = useCallback(async () => {
    if (!selectedFile || !diagnostics) return;
    setBusy(true);
    setMessage(`Uploading checkpoint ${selectedFile.name} (${formatFileSize(selectedFile.size)})...`);
    try {
      const form = new FormData();
      form.append('file', selectedFile);
      const resp = await uploadAnalyzeCheckpointResponse(projectId, form);
      const { payload, text } = await parseWorkflowResponse(resp);
      if (!resp.ok) throw new Error(workflowRequestError('checkpoint upload', resp, payload, text));
      setMessage(`Loaded ${payload.filename}.`);
      setSelectedFile(null);
      setDiagnostics(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onCheckpointStored?.();
    } catch (err) {
      const baseMessage = err.message || 'Failed to load checkpoint';
      const errorMessage = `${baseMessage} File: ${selectedFile.name} (${formatFileSize(selectedFile.size)}).`;
      setMessage(errorMessage);
      if (setError) setError(errorMessage);
    } finally {
      setBusy(false);
    }
  }, [diagnostics, onCheckpointStored, projectId, selectedFile, setError]);

  return (
    <section className="analyze-checkpoints-tab workbench-panel" aria-label="Checkpoints">
      <header className="workbench-header">
        <div>
          <p className="analyze-eyebrow">Analyze</p>
          <h2>Checkpoints</h2>
          <p>Upload model checkpoints to project storage. Checkpoints are shared with users who can access the project metagroup.</p>
        </div>
        <div className="workbench-detail-actions">
          <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            Load checkpoint
          </button>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(event) => loadDiagnostics(event.target.files?.[0])}
          />
        </div>
      </header>
      <p className="checkpoint-status-readout" data-testid="checkpoint-status-readout">
        {checkpointStatusText(checkpointState, checkpointScope)}
      </p>
      {message && <p className="muted">{message}</p>}
      <CheckpointDiagnostics diagnostics={diagnostics} />
      {diagnostics && (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={storeCheckpoint}>
          {busy ? 'Loading...' : 'Load this checkpoint'}
        </button>
      )}
      <div className="checkpoint-list">
        <h3>Project Checkpoints</h3>
        {checkpointState.loading ? <p className="muted">Loading checkpoints...</p> : null}
        {!checkpointState.loading && checkpointState.project.length === 0 ? <p className="muted">No project checkpoints loaded.</p> : null}
        {checkpointState.project.map((checkpoint) => (
          <article key={checkpoint.id} className="checkpoint-row">
            <div>
              <button
                type="button"
                className="checkpoint-name-button"
                onClick={() => openCheckpointGraph(checkpoint)}
                aria-label={`View model diagram for ${checkpoint.filename}`}
              >
                {checkpoint.filename}
              </button>
              <span>{checkpoint.model_type || checkpoint.model_family}{checkpoint.model_version ? ` ${checkpoint.model_version}` : ''}</span>
            </div>
            <div>
              <span>{formatParameterCount(checkpoint.parameter_count)} parameters</span>
              <span>{formatFileSize(checkpoint.size_bytes)}</span>
              <span>{checkpoint.meta_group_id}</span>
            </div>
          </article>
        ))}
      </div>
      {graphState.checkpoint ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-content checkpoint-graph-modal" role="dialog" aria-modal="true" aria-labelledby="checkpoint-graph-title">
            <div className="modal-header">
              <div>
                <h3 id="checkpoint-graph-title">{graphState.checkpoint.filename}</h3>
                <p className="muted">Model structure and parameter counts from checkpoint introspection.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setGraphState({ checkpoint: null, loading: false, payload: null, error: null })} aria-label="Close checkpoint diagram">&times;</button>
            </div>
            {graphState.loading ? <p className="muted">Loading model diagram...</p> : null}
            {graphState.error ? <p className="error-message">{graphState.error}</p> : null}
            {graphState.payload ? (
              <>
                <dl className="checkpoint-graph-summary">
                  <div><dt>Total parameters</dt><dd>{formatParameterCount(graphState.payload.parameter_count)}</dd></div>
                  <div><dt>Count source</dt><dd>{graphState.payload.parameter_count_kind || 'Unknown'}</dd></div>
                  <div><dt>Graph source</dt><dd>{graphState.payload.graph?.source || 'Unknown'}</dd></div>
                </dl>
                {Array.isArray(graphState.payload.warnings) && graphState.payload.warnings.length > 0 ? (
                  <p className="muted">Warnings: {graphState.payload.warnings.join('; ')}</p>
                ) : null}
                <CheckpointGraph graph={graphState.payload.graph} />
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default CheckpointsTab;
