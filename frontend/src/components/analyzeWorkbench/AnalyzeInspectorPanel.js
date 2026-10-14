import React from 'react';
import { OUTPUT_METHOD_ID, SOURCE_METHOD_ID } from '../../features/analyzeWorkbench/workflowGraph';
import { visibleMethodParameters } from '../../features/analyzeWorkbench/workflowParameters';
import ExampleImageParameter from './ExampleImageParameter';
import ParameterInput from './ParameterInput';
import RunStatusDetails from './RunStatusDetails';

function availableCheckpointLabels(method) {
  const checkpoints = Array.isArray(method?.available_checkpoints) ? method.available_checkpoints : [];
  return checkpoints
    .filter((checkpoint) => checkpoint?.available)
    .map((checkpoint) => checkpoint.label || checkpoint.filename || checkpoint.id)
    .filter(Boolean);
}

function methodAcademicDescription(method) {
  if (!method) return '';
  const base = method.description || method.name || 'This method';
  return `${base}. In the workflow graph, this operator transforms typed image artifacts according to its parameterized contract, enabling reproducible and composable analysis pipelines. Its outputs are explicitly structured for downstream stages, supporting auditability, provenance tracking, and cross-method interoperability.`;
}

function AnalyzeInspectorPanel({
  selectedNode,
  selectedToolboxMethod,
  selectedMethod,
  selectedParameterValues,
  selectedMethodCheckpoints,
  checkpointScope,
  setActiveCheckpointScope,
  stagedImages,
  loadedImages,
  exampleImageId,
  updateSelectedParameter,
  onSelectImages,
  outputConfig,
  status,
  clearStatus,
  checklistItems,
  statusDetailItems,
  selectedNodeIds,
  removeSelectedNode,
}) {
  return (
    <aside className="analyze-inspector" aria-label="Workflow block settings">
      <div className="analyze-inspector-header">
        <h3>{selectedNode?.label || selectedToolboxMethod?.name || 'No block selected'}</h3>
        <p>{selectedMethod?.id || 'Select a workflow block'}</p>
        {selectedMethod && <p className="muted">{methodAcademicDescription(selectedMethod)}</p>}
        {availableCheckpointLabels(selectedMethod).length > 0 && (
          <p className="muted">Off-the-shelf checkpoint available: {availableCheckpointLabels(selectedMethod).join(', ')}</p>
        )}
      </div>
      {selectedMethod && (
        <div className="analyze-parameters">
          {selectedNode && selectedMethod.id === SOURCE_METHOD_ID && (
            <div className="analyze-input-actions">
              <button type="button" className="btn btn-secondary" onClick={onSelectImages}>
                Select Images
              </button>
              <span>{stagedImages.length} images in Process</span>
            </div>
          )}
          {visibleMethodParameters(selectedMethod, selectedParameterValues).length === 0 && <p className="muted">No parameters</p>}
          {visibleMethodParameters(selectedMethod, selectedParameterValues).map((parameter) => {
            if (selectedNode && selectedMethod.id === SOURCE_METHOD_ID && parameter.name === 'example_image_id') {
              return (
                <ExampleImageParameter
                  key={parameter.name}
                  images={stagedImages.length > 0 ? stagedImages : loadedImages}
                  value={exampleImageId}
                  onChange={(value) => updateSelectedParameter(parameter.name, value)}
                  inputId="analyze-param-example-image-inspector"
                />
              );
            }
            return (
              <ParameterInput
                key={parameter.name}
                parameter={parameter}
                value={selectedParameterValues?.[parameter.name]}
                onChange={(value) => updateSelectedParameter(parameter.name, value)}
                checkpoints={selectedMethodCheckpoints}
                checkpointScope={checkpointScope}
                onCheckpointScopeChange={setActiveCheckpointScope}
              />
            );
          })}
        </div>
      )}
      {selectedMethod?.id === OUTPUT_METHOD_ID && (
        <div className="analyze-output-note">
          <strong>Recipe-first output</strong>
          <p>
            Originals are preserved. Detection boxes are stored as metadata, segmentation outputs as overlay artifacts,
            and processed image versions as reproducible sequences with an on-demand cache.
            {' '}
            <code>{outputConfig.version_strategy}</code>
          </p>
          <span>{outputConfig.mode}</span>
        </div>
      )}
      <div className="analyze-status-panel">
        <div className="analyze-status-header">
          <strong>{status.loading ? 'Working' : 'Status'}</strong>
          {(status.message || status.result) && (
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={clearStatus}
              disabled={status.loading}
            >
              Clear status
            </button>
          )}
        </div>
        {status.message ? <p>{status.message}</p> : <p className="muted">No status message.</p>}
        {status.result && (
          <div className="analyze-run-summary" data-testid="analyze-run-summary">
            <span>{status.result.status}</span>
            <span>{status.result.node_results?.length || 0} blocks</span>
            <span>{status.result.image_count || 0} images</span>
          </div>
        )}
        <RunStatusDetails checklistItems={checklistItems} detailNodes={statusDetailItems} />
      </div>
      {selectedNode && (
        <div className="analyze-block-actions">
          <button type="button" className="btn btn-danger" onClick={removeSelectedNode}>
            Remove {selectedNodeIds.length > 1 ? `(${selectedNodeIds.length})` : ''}
          </button>
        </div>
      )}
    </aside>
  );
}

export default AnalyzeInspectorPanel;
