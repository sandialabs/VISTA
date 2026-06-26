import React, { useMemo, useState } from 'react';

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function formatMetadataValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return String(value);
  }
}

function formatMetadataPath(parentPath, key) {
  if (typeof key === 'number') return `${parentPath}[${key}]`;
  return parentPath ? `${parentPath}.${key}` : String(key);
}

export function collectMetadataLeafEntries(value, path = 'metadata') {
  if (Array.isArray(value)) {
    if (!value.length) return [{ path, value }];
    return value.flatMap((entry, index) => collectMetadataLeafEntries(entry, formatMetadataPath(path, index)));
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (!entries.length) return [{ path, value }];
    return entries.flatMap(([key, entryValue]) => collectMetadataLeafEntries(entryValue, formatMetadataPath(path, key)));
  }
  return [{ path, value }];
}

function unwrapMetadataPayload(value) {
  if (!isPlainObject(value)) return value;
  if (isPlainObject(value.metadata)) return value.metadata;
  if (isPlainObject(value.nsipro_metadata)) return value.nsipro_metadata;
  return value;
}

export function buildSelectedSourcePartIds(parts = [], selectedSourceKey = '') {
  if (!selectedSourceKey) return new Set();
  return new Set((Array.isArray(parts) ? parts : [])
    .filter((part) => {
      const metadata = isPlainObject(part?.metadata) ? part.metadata : {};
      const refs = Array.isArray(metadata.associated_metadata_refs)
        ? metadata.associated_metadata_refs.map(String)
        : [];
      if (typeof metadata.associated_metadata_ref === 'string') refs.push(metadata.associated_metadata_ref);
      return refs.includes(selectedSourceKey);
    })
    .map((part) => String(part.id)));
}

function getSourceLabel(key, value) {
  const filename = isPlainObject(value) ? (value.source_filename || value.filename) : '';
  return filename ? `${key} (${filename})` : key;
}

function ProjectDataMetadataTab({ projectId, metadata = {}, parts = [], onAssociationsChanged, setError }) {
  const sources = useMemo(() => Object.entries(isPlainObject(metadata) ? metadata : {})
    .map(([key, value]) => ({ key, value, label: getSourceLabel(key, value) }))
    .sort((left, right) => left.label.localeCompare(right.label)), [metadata]);
  const [selectedSourceKey, setSelectedSourceKey] = useState(sources[0]?.key || '');
  const [savingPartIds, setSavingPartIds] = useState(new Set());
  const [activeViewSourceKey, setActiveViewSourceKey] = useState('');

  React.useEffect(() => {
    if (!selectedSourceKey && sources[0]?.key) setSelectedSourceKey(sources[0].key);
    if (selectedSourceKey && !sources.some((source) => source.key === selectedSourceKey)) {
      setSelectedSourceKey(sources[0]?.key || '');
    }
  }, [selectedSourceKey, sources]);

  const associatedPartIds = useMemo(
    () => buildSelectedSourcePartIds(parts, selectedSourceKey),
    [parts, selectedSourceKey],
  );

  const updatePartAssociation = async (part, checked) => {
    if (!selectedSourceKey || !part?.id) return;
    const metadataObj = isPlainObject(part.metadata) ? part.metadata : {};
    const existingRefs = Array.isArray(metadataObj.associated_metadata_refs)
      ? metadataObj.associated_metadata_refs.map(String)
      : [];
    if (typeof metadataObj.associated_metadata_ref === 'string') existingRefs.push(metadataObj.associated_metadata_ref);
    const nextRefs = Array.from(new Set(
      checked
        ? [...existingRefs, selectedSourceKey]
        : existingRefs.filter((key) => key !== selectedSourceKey),
    ));

    setSavingPartIds((prev) => new Set(prev).add(String(part.id)));
    try {
      const resp = await fetch(`/api/projects/${projectId}/parts/${part.id}/metadata-sources`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metadata_source_keys: nextRefs }),
      });
      if (!resp.ok) throw new Error(`Failed to update metadata association (${resp.status})`);
      if (onAssociationsChanged) await onAssociationsChanged();
    } catch (err) {
      if (setError) setError(err.message || 'Failed to update metadata association');
    } finally {
      setSavingPartIds((prev) => {
        const next = new Set(prev);
        next.delete(String(part.id));
        return next;
      });
    }
  };

  const activeViewSource = sources.find((source) => source.key === activeViewSourceKey);
  const activeRows = activeViewSource ? collectMetadataLeafEntries(unwrapMetadataPayload(activeViewSource.value)) : [];

  return (
    <div className="project-data-tab-panel project-data-metadata-tab" role="tabpanel" aria-label="Metadata">
      <section className="workbench-panel project-data-metadata-panel">
        <header className="workbench-header">
          <div>
            <h2>Metadata</h2>
            <p>Select a project-level metadata source, then choose every part that should display it during inspection.</p>
          </div>
        </header>
        <div className="project-data-metadata-layout">
          <section aria-label="Project level metadata sources" className="project-data-metadata-sources">
            <h3>Project metadata sources</h3>
            {sources.length === 0 ? (
              <p className="muted">No project-level metadata sources are available.</p>
            ) : sources.map((source) => (
              <div key={source.key} className={`metadata-source-row ${selectedSourceKey === source.key ? 'active' : ''}`}>
                <button
                  type="button"
                  className="btn btn-secondary metadata-source-select"
                  aria-pressed={selectedSourceKey === source.key}
                  onClick={() => setSelectedSourceKey(source.key)}
                >
                  {source.label}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setActiveViewSourceKey(source.key)}
                >
                  View
                </button>
              </div>
            ))}
          </section>
          <section aria-label="Available parts" className="project-data-metadata-parts">
            <h3>Available parts</h3>
            {!selectedSourceKey && <p className="muted">Select a metadata source to manage part associations.</p>}
            {selectedSourceKey && parts.length === 0 && <p className="muted">No parts are available in this project.</p>}
            {selectedSourceKey && parts.map((part) => {
              const partId = String(part.id);
              const label = part.display_name || part.serial_number || partId;
              const saving = savingPartIds.has(partId);
              return (
                <label key={partId} className="metadata-part-row">
                  <input
                    type="checkbox"
                    checked={associatedPartIds.has(partId)}
                    disabled={saving}
                    onChange={(event) => updatePartAssociation(part, event.target.checked)}
                  />
                  <span>{label}</span>
                  {saving && <span className="muted">Saving…</span>}
                </label>
              );
            })}
          </section>
        </div>
      </section>

      {activeViewSource && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={`Metadata source ${activeViewSource.key}`}>
          <div className="modal-content metadata-modal-content">
            <header className="modal-header">
              <h2>{activeViewSource.label}</h2>
              <button type="button" className="modal-close" aria-label="Close metadata source" onClick={() => setActiveViewSourceKey('')}>×</button>
            </header>
            <div className="part-metadata-modal-body">
              {activeRows.length === 0 ? (
                <p className="metadata-modal-empty">No fields were extracted from this metadata source.</p>
              ) : (
                <table className="metadata-modal-table">
                  <thead>
                    <tr>
                      <th scope="col">Metadata path</th>
                      <th scope="col">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRows.map((row) => (
                      <tr key={row.path}>
                        <td className="metadata-modal-path"><code>{row.path}</code></td>
                        <td><pre>{formatMetadataValue(row.value)}</pre></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProjectDataMetadataTab;
