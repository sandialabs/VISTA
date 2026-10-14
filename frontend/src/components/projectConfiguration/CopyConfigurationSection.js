import React from 'react';

export default function CopyConfigurationSection({
  currentProjectType,
  hasCompatibleCopySources,
  availableProjects,
  copySourceProjectId,
  setCopySourceProjectId,
  setError,
  setStatusMessage,
  readOnly,
  copyingConfiguration,
  copyConfiguration,
}) {
  return (
    <section className="part-detail-panel" aria-label="Copy configuration">
      <h3>Copy Configuration</h3>
      <p>
        Copy settings from another project into this one.
        {currentProjectType
          ? ` Only ${currentProjectType} source projects are listed.`
          : ''}
      </p>
      {!hasCompatibleCopySources && (
        <p className="muted" data-testid="no-compatible-copy-sources">
          No compatible source projects are available yet.
        </p>
      )}
      <div className="workbench-controls-row" aria-busy={copyingConfiguration}>
        <select
          aria-label="Source project"
          value={copySourceProjectId}
          disabled={readOnly || !hasCompatibleCopySources || copyingConfiguration}
          onChange={(event) => {
            setCopySourceProjectId(event.target.value);
            setError(null);
            setStatusMessage('');
          }}
        >
          <option value="">Select project</option>
          {availableProjects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={readOnly || !copySourceProjectId || !hasCompatibleCopySources || copyingConfiguration}
          onClick={copyConfiguration}
        >
          {copyingConfiguration ? 'Copying...' : 'Copy from Project'}
        </button>
      </div>
    </section>
  );
}
