import React from 'react';
import { formatParameterCount, graphRows } from '../../features/analyzeWorkbench/checkpointDiagnostics';
import { formatFileSizeFixed as formatFileSize } from '../../utils/formatFileSize';

export function CheckpointGraph({ graph }) {
  const rows = graphRows(graph);
  if (rows.length === 0) return <p className="muted">No model graph data is available for this checkpoint.</p>;
  return (
    <div className="checkpoint-graph-canvas" role="img" aria-label="Checkpoint model block diagram">
      {rows.map((node) => {
        const width = Math.max(150, 260 - Math.min(Number(node.depth) || 0, 5) * 18);
        return (
          <div key={node.id} className="checkpoint-graph-row" style={{ marginLeft: `${Math.min(Number(node.depth) || 0, 8) * 26}px` }}>
            <div className={`checkpoint-graph-node checkpoint-graph-node-${String(node.kind || 'module').toLowerCase()}`} style={{ width }}>
              <strong>{node.label}</strong>
              <span>{node.type}</span>
              <small>{formatParameterCount(node.parameter_count)} parameters</small>
            </div>
            <div className="checkpoint-graph-node-detail">
              <code>{node.path}</code>
              {node.summary ? <span>{node.summary}</span> : null}
            </div>
          </div>
        );
      })}
      {graph?.truncated ? <p className="muted">Diagram truncated to the first model blocks for responsiveness.</p> : null}
    </div>
  );
}

function CheckpointDiagnostics({ diagnostics }) {
  if (!diagnostics) return null;
  const rows = [
    ['Model type', diagnostics.model_type],
    ['Model version', diagnostics.model_version],
    ['Parameters', formatParameterCount(diagnostics.parameter_count)],
    ['File size', formatFileSize(diagnostics.filesize_bytes)],
    ['Confidence', diagnostics.confidence],
    ['SHA-256', diagnostics.sha256],
  ];
  return (
    <div className="checkpoint-diagnostics">
      <h3>Checkpoint Diagnostics</h3>
      <dl>
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value || 'Unknown'}</dd>
          </React.Fragment>
        ))}
      </dl>
      {Array.isArray(diagnostics.signals) && diagnostics.signals.length > 0 && (
        <p><strong>Signals:</strong> {diagnostics.signals.join('; ')}</p>
      )}
      {Array.isArray(diagnostics.warnings) && diagnostics.warnings.length > 0 && (
        <p><strong>Warnings:</strong> {diagnostics.warnings.join('; ')}</p>
      )}
    </div>
  );
}

export default CheckpointDiagnostics;
