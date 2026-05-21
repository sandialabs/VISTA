import React, { useMemo, useState } from 'react';

const EXPORT_OPTIONS = [
  {
    key: 'include_images',
    label: 'Loaded images',
    detail: 'Original image and voxel artifacts',
  },
  {
    key: 'include_overlays',
    label: 'Loaded overlays',
    detail: 'Overlay files and overlay image artifacts',
  },
  {
    key: 'include_metadata',
    label: 'Metadata',
    detail: 'Project, image, batch, part, and import mapping TOML',
  },
  {
    key: 'include_created_overlays',
    label: 'Created overlays',
    detail: 'Annotations, overlay layers, segmentation, and measurement runs',
  },
  {
    key: 'include_project_configuration',
    label: 'Project configuration',
    detail: 'Inspection configuration and interface defaults',
  },
];

function filenameFromDisposition(disposition, fallback) {
  if (!disposition) return fallback;
  const match = disposition.match(/filename="?([^"]+)"?/);
  return match ? match[1] : fallback;
}

function ProjectDataExportPanel({ projectId, projectName, counts = {}, setError }) {
  const [options, setOptions] = useState(() => (
    EXPORT_OPTIONS.reduce((acc, option) => ({ ...acc, [option.key]: true }), {})
  ));
  const [exportState, setExportState] = useState({ loading: false, detail: null });

  const selectedCount = useMemo(
    () => Object.values(options).filter(Boolean).length,
    [options]
  );

  const updateOption = (key, checked) => {
    setOptions((prev) => ({ ...prev, [key]: checked }));
  };

  const exportProjectData = async () => {
    const params = new URLSearchParams();
    EXPORT_OPTIONS.forEach((option) => {
      params.set(option.key, options[option.key] ? 'true' : 'false');
    });

    try {
      setExportState({ loading: true, detail: null });
      const response = await fetch(`/api/projects/${projectId}/export-bundle?${params.toString()}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || `Export failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameFromDisposition(
        response.headers.get('Content-Disposition'),
        `${projectName || 'project'}_export_bundle.zip`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setExportState({
        loading: false,
        detail: `${selectedCount} export sections packaged as TOML manifests and project artifacts.`,
      });
      if (setError) setError(null);
    } catch (err) {
      setExportState({ loading: false, detail: null });
      if (setError) setError(err.message || 'Failed to export project data');
    }
  };

  return (
    <div className="card project-data-export-card">
      <div className="card-header">
        <h2>Export Data</h2>
      </div>
      <div className="card-content">
        <div className="export-data-summary" aria-label="Export data summary">
          <div>
            <strong>{counts.rawImages || 0}</strong>
            <span>Images</span>
          </div>
          <div>
            <strong>{counts.overlayImages || 0}</strong>
            <span>Overlays</span>
          </div>
          <div>
            <strong>{counts.annotations || 0}</strong>
            <span>Annotations</span>
          </div>
        </div>

        <div className="export-option-list" role="group" aria-label="Project export options">
          {EXPORT_OPTIONS.map((option) => (
            <label key={option.key} className="export-option-row">
              <input
                type="checkbox"
                checked={Boolean(options[option.key])}
                onChange={(event) => updateOption(option.key, event.target.checked)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </span>
            </label>
          ))}
        </div>

        <button
          type="button"
          className="btn btn-primary export-data-button"
          disabled={exportState.loading}
          onClick={exportProjectData}
        >
          {exportState.loading ? 'Exporting Project...' : 'Export Project Bundle'}
        </button>

        {exportState.detail && (
          <div className="alert alert-success export-data-status" data-testid="project-data-export-result">
            {exportState.detail}
          </div>
        )}
      </div>
    </div>
  );
}

export default ProjectDataExportPanel;
