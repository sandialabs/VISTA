import React from 'react';
import { nodeDiagnosticRows } from '../../features/analyzeWorkbench/runDiagnostics';

const CHECK_ICONS = { done: '\u2713', active: '\u25d0', failed: '!' };

// FastAPI progress checklist plus per-node diagnostics for the latest analyze run.
function RunStatusDetails({ checklistItems, detailNodes }) {
  return (
    <>
      {checklistItems.length > 0 && (
        <ol className="analyze-fastapi-checklist" data-testid="analyze-fastapi-checklist">
          {checklistItems.map((item) => (
            <li key={item.label} data-state={item.state}>
              <span className="analyze-fastapi-check-icon" aria-hidden="true">
                {CHECK_ICONS[item.state] || '\u25a1'}
              </span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
            </li>
          ))}
        </ol>
      )}
      {detailNodes.length > 0 && (
        <div className="analyze-status-details" data-testid="analyze-status-details">
          {detailNodes.map((node, index) => {
            const rows = nodeDiagnosticRows(node);
            return (
              <article key={`${node.node_id || 'node'}-${index}`} className="analyze-status-detail-item">
                <strong>{node.node_id || node.method_id || 'Workflow block'}</strong>
                <p>{node.message || node.summary?.runtime_warning || 'No detail message returned.'}</p>
                {node.summary?.runtime_warning && node.summary.runtime_warning !== node.message && (
                  <p>{node.summary.runtime_warning}</p>
                )}
                {rows.length > 0 && (
                  <dl>
                    {rows.map(([label, value]) => (
                      <React.Fragment key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

export default RunStatusDetails;
