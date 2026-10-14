import React from 'react';

// Associated metadata file picker, parse status, and project-wide load action.
// Parsing/saving state is owned by ImageUploader.
function AssociatedMetadataPanel({
  busy,
  associatedMetadataFile,
  onFileChange,
  onLoadMetadata,
  parsing,
  saving,
  bundle,
  error,
  saved,
}) {
  return (
    <div className="form-group">
      <fieldset className="metadata-association-section" style={{ border: '1px solid #e9ecef', borderRadius: '4px', padding: '12px' }}>
        <legend style={{ fontSize: '1rem', fontWeight: 600, padding: '0 4px' }}>Associate Metadata</legend>
        <label htmlFor="associated-metadata-input">Metadata File (Optional)</label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            id="associated-metadata-input"
            type="file"
            accept=".json,.nsipro,application/json"
            onChange={onFileChange}
            disabled={busy}
          />
          <span className="form-text" aria-live="polite">
            {associatedMetadataFile ? associatedMetadataFile.name : 'No metadata file chosen'}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onLoadMetadata}
            disabled={busy || parsing || !bundle || Boolean(error)}
          >
            {saving ? 'Loading Metadata...' : 'Load Metadata'}
          </button>
        </div>
        <small className="form-text">
          Choose one .json or .nsipro file after selecting images to reference it from uploaded images, or choose a metadata file by itself and click Load Metadata to associate it with the whole project.
        </small>
        {parsing && (
          <div className="form-text" role="status">Parsing associated metadata…</div>
        )}
        {bundle && !error && (
          <div className="form-text" role="status">
            Parsed {bundle.value.filename} as {bundle.key}.
          </div>
        )}
        {saved && (
          <div className="alert alert-success" role="status">
            Loaded {saved.filename} as project metadata. It will display with every image or slice in this project.
          </div>
        )}
        {error && (
          <div className="alert alert-danger" role="alert">{error}</div>
        )}
      </fieldset>
    </div>
  );
}

export default AssociatedMetadataPanel;
