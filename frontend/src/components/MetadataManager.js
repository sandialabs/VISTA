import React, { useEffect, useState } from 'react';
import {
  deleteProjectMetadata,
  updateProjectMetadata,
  updateProjectMetadataDictionary,
} from '../api/projects';

function getJsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isJsonContainer(value) {
  return value !== null && typeof value === 'object';
}

function getContainerSize(value) {
  if (Array.isArray(value)) return value.length;
  if (isJsonContainer(value)) return Object.keys(value).length;
  return 0;
}

function formatPrimitiveValue(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

function createMetadataPath(parentPath, key, parentIsArray) {
  if (parentIsArray) return `${parentPath}[${key}]`;
  if (parentPath === '$') return `$.${key}`;
  return `${parentPath}.${key}`;
}

function collectContainerPaths(value, path = '$', depth = 0, output = new Set(), maxDepth = 1) {
  if (!isJsonContainer(value)) return output;
  if (depth <= maxDepth) output.add(path);
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  for (const [key, childValue] of entries) {
    if (isJsonContainer(childValue)) {
      collectContainerPaths(childValue, createMetadataPath(path, key, Array.isArray(value)), depth + 1, output, maxDepth);
    }
  }
  return output;
}

function nodeMatchesQuery(label, value, path, query) {
  if (!query) return false;
  const normalizedQuery = query.toLowerCase();
  return String(label).toLowerCase().includes(normalizedQuery)
    || String(path).toLowerCase().includes(normalizedQuery)
    || formatPrimitiveValue(value).toLowerCase().includes(normalizedQuery);
}

function MetadataJsonNode({
  label,
  value,
  path,
  depth,
  expandedPaths,
  onToggle,
  renderTopLevelActions,
  query,
}) {
  const type = getJsonType(value);
  const isContainer = isJsonContainer(value);
  const isExpanded = expandedPaths.has(path);
  const isArray = Array.isArray(value);
  const entries = isContainer ? (isArray ? Array.from(value.entries()) : Object.entries(value)) : [];
  const match = nodeMatchesQuery(label, value, path, query);

  return (
    <li className={`metadata-tree-node metadata-tree-depth-${Math.min(depth, 6)} ${match ? 'metadata-tree-match' : ''}`}>
      <div className="metadata-tree-row">
        {isContainer ? (
          <button
            type="button"
            className="metadata-tree-toggle"
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${path}`}
            onClick={() => onToggle(path)}
          >
            {isExpanded ? '-' : '+'}
          </button>
        ) : (
          <span className="metadata-tree-spacer" aria-hidden="true" />
        )}
        <span className="metadata-tree-key">{label}</span>
        <span className={`metadata-tree-type metadata-tree-type-${type}`}>{type}</span>
        {isContainer ? (
          <span className="metadata-tree-count">
            {getContainerSize(value)} {isArray ? 'items' : 'keys'}
          </span>
        ) : (
          <span className={`metadata-tree-value metadata-tree-value-${type}`}>{formatPrimitiveValue(value)}</span>
        )}
        <code className="metadata-tree-path">{path}</code>
        {depth === 1 && renderTopLevelActions ? renderTopLevelActions(label, value) : null}
      </div>
      {isContainer && isExpanded && (
        entries.length === 0 ? (
          <div className="metadata-tree-empty">{isArray ? 'Empty array' : 'Empty object'}</div>
        ) : (
          <ul className="metadata-tree-list">
            {entries.map(([key, childValue]) => (
              <MetadataJsonNode
                key={createMetadataPath(path, key, isArray)}
                label={String(key)}
                value={childValue}
                path={createMetadataPath(path, key, isArray)}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                renderTopLevelActions={renderTopLevelActions}
                query={query}
              />
            ))}
          </ul>
        )
      )}
    </li>
  );
}

function MetadataTreeViewer({ metadata, renderTopLevelActions }) {
  const [expandedPaths, setExpandedPaths] = useState(() => collectContainerPaths(metadata));
  const [query, setQuery] = useState('');

  useEffect(() => {
    setExpandedPaths(collectContainerPaths(metadata));
  }, [metadata]);

  const togglePath = (path) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const expandAll = () => setExpandedPaths(collectContainerPaths(metadata, '$', 0, new Set(), Number.POSITIVE_INFINITY));
  const collapseAll = () => setExpandedPaths(new Set(['$']));

  return (
    <div className="metadata-tree-viewer" data-testid="project-metadata-tree">
      <div className="metadata-tree-toolbar">
        <label htmlFor="metadata-tree-search" className="form-label">Search metadata</label>
        <input
          id="metadata-tree-search"
          type="search"
          className="form-control metadata-tree-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by key, value, or path"
        />
        <button type="button" className="btn btn-secondary btn-small" onClick={expandAll}>Expand all</button>
        <button type="button" className="btn btn-secondary btn-small" onClick={collapseAll}>Collapse all</button>
      </div>
      <ul className="metadata-tree-list metadata-tree-root">
        <MetadataJsonNode
          label="metadata"
          value={metadata}
          path="$"
          depth={0}
          expandedPaths={expandedPaths}
          onToggle={togglePath}
          renderTopLevelActions={renderTopLevelActions}
          query={query}
        />
      </ul>
    </div>
  );
}

function MetadataManager({ 
  projectId, 
  metadata, 
  setMetadata, 
  loading, 
  setLoading, 
  setError 
}) {
  // Form states
  const [newMetadata, setNewMetadata] = useState({ key: '', value: '' });
  const [bulkMetadata, setBulkMetadata] = useState(JSON.stringify(metadata, null, 2));
  
  // Modal states
  const [showEditMetadataModal, setShowEditMetadataModal] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState({ key: '', value: '' });
  
  // Collapse states - both sections start collapsed
  const [addMetadataCollapsed, setAddMetadataCollapsed] = useState(true);
  const [bulkMetadataCollapsed, setBulkMetadataCollapsed] = useState(true);

  useEffect(() => {
    setBulkMetadata(JSON.stringify(metadata, null, 2));
  }, [metadata]);

  // Helper function to parse metadata value
  const parseMetadataValue = (value) => {
    if (value.trim() === '') {
      return null;
    }
    
    try {
      return JSON.parse(value);
    } catch (e) {
      return value;
    }
  };

  // Handle metadata form submission
  const handleAddMetadata = async (e) => {
    e.preventDefault();
    
    if (newMetadata.key.trim() === '') {
      setError('Metadata key cannot be empty');
      return;
    }
    
    try {
      setLoading(true);
      const parsedValue = parseMetadataValue(newMetadata.value);
      await updateProjectMetadata(projectId, newMetadata.key, parsedValue);

      // Update the metadata state
      setMetadata(prevMetadata => ({
        ...prevMetadata,
        [newMetadata.key]: parsedValue
      }));
      
      // Update bulk metadata
      setBulkMetadata(JSON.stringify({
        ...metadata,
        [newMetadata.key]: parsedValue
      }, null, 2));
      
      // Reset form
      setNewMetadata({ key: '', value: '' });
      setError(null);
    } catch (err) {
      setError(`Failed to add metadata: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle bulk metadata update
  const handleBulkUpdateMetadata = async (e) => {
    e.preventDefault();
    
    try {
      // const metadataObj = JSON.parse(bulkMetadata); // Commented out - not currently used
      
      setLoading(true);
      const updatedMetadata = await updateProjectMetadataDictionary(projectId, bulkMetadata);
      setMetadata(updatedMetadata);
      setError(null);
    } catch (err) {
      setError(`Failed to update metadata: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle edit metadata
  const handleEditMetadata = async () => {
    try {
      setLoading(true);
      const parsedValue = parseMetadataValue(editingMetadata.value);
      await updateProjectMetadata(projectId, editingMetadata.key, parsedValue);

      // Update the metadata state
      setMetadata(prevMetadata => ({
        ...prevMetadata,
        [editingMetadata.key]: parsedValue
      }));
      
      // Update bulk metadata
      setBulkMetadata(JSON.stringify({
        ...metadata,
        [editingMetadata.key]: parsedValue
      }, null, 2));
      
      // Close modal
      setShowEditMetadataModal(false);
      setError(null);
    } catch (err) {
      setError(`Failed to update metadata: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle delete metadata
  const handleDeleteMetadata = async (key) => {
    if (!window.confirm(`Are you sure you want to delete the metadata key "${key}"?`)) {
      return;
    }
    
    try {
      setLoading(true);
      await deleteProjectMetadata(projectId, key);
      
      // Update the metadata state
      const newMetadata = { ...metadata };
      delete newMetadata[key];
      setMetadata(newMetadata);
      
      // Update bulk metadata
      setBulkMetadata(JSON.stringify(newMetadata, null, 2));
      
      setError(null);
    } catch (err) {
      setError(`Failed to delete metadata: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Project Metadata</h2>
      </div>
      <div className="card-content">
        <div id="metadata-container">
          {loading && <p>Loading metadata...</p>}
          
          {!loading && Object.keys(metadata).length === 0 && (
            <p>No metadata defined for this project. Add metadata to get started.</p>
          )}
          
          {!loading && Object.keys(metadata).length > 0 && (
            <MetadataTreeViewer
              metadata={metadata}
              renderTopLevelActions={(key, value) => (
                <span className="metadata-tree-actions">
                      <button 
                        type="button"
                        className="btn btn-small"
                        onClick={() => {
                          setEditingMetadata({
                            key,
                            value: typeof value === 'object' 
                              ? JSON.stringify(value, null, 2) 
                              : (value === null ? '' : value)
                          });
                          setShowEditMetadataModal(true);
                        }}
                      >
                        Edit
                      </button>
                      <button 
                        type="button"
                        className="btn btn-small btn-danger"
                        onClick={() => handleDeleteMetadata(key)}
                      >
                        Delete
                      </button>
                </span>
              )}
            />
          )}
        </div>
        
        <div className="metadata-form-section">
          <div className="section-header">
            <h3>Add Metadata</h3>
            <button 
              className="btn btn-secondary btn-small toggle-btn"
              onClick={() => setAddMetadataCollapsed(!addMetadataCollapsed)}
            >
              {addMetadataCollapsed ? 'Show' : 'Hide'}
            </button>
          </div>
          
          {!addMetadataCollapsed && (
            <form id="add-metadata-form" className="form" onSubmit={handleAddMetadata}>
              <div className="form-group">
                <label htmlFor="metadata-key">Key:</label>
                <input 
                  type="text" 
                  id="metadata-key" 
                  name="metadata-key" 
                  value={newMetadata.key}
                  onChange={(e) => setNewMetadata({...newMetadata, key: e.target.value})}
                  required 
                />
              </div>
              <div className="form-group">
                <label htmlFor="metadata-value">Value:</label>
                <textarea 
                  id="metadata-value" 
                  name="metadata-value" 
                  rows="3"
                  value={newMetadata.value}
                  onChange={(e) => setNewMetadata({...newMetadata, value: e.target.value})}
                ></textarea>
                <small>You can enter a simple value or valid JSON</small>
              </div>
              <button 
                type="submit" 
                className="btn btn-primary"
                disabled={loading}
              >
                Add Metadata
              </button>
            </form>
          )}
        </div>
        
        <div className="metadata-form-section">
          <div className="section-header">
            <h3>JSON Update Metadata</h3>
            <button 
              className="btn btn-secondary btn-small toggle-btn"
              onClick={() => setBulkMetadataCollapsed(!bulkMetadataCollapsed)}
            >
              {bulkMetadataCollapsed ? 'Show' : 'Hide'}
            </button>
          </div>
          
          {!bulkMetadataCollapsed && (
            <form id="bulk-update-metadata-form" className="form" onSubmit={handleBulkUpdateMetadata}>
              <div className="form-group">
                <label htmlFor="metadata-json">Metadata JSON:</label>
                <textarea 
                  id="metadata-json" 
                  name="metadata-json" 
                  rows="5" 
                  value={bulkMetadata}
                  onChange={(e) => setBulkMetadata(e.target.value)}
                  required
                ></textarea>
              </div>
              <button 
                type="submit" 
                className="btn btn-primary"
                disabled={loading}
              >
                Update Metadata
              </button>
            </form>
          )}
        </div>

        {/* Edit metadata modal */}
        {showEditMetadataModal && (
          <div className="modal">
            <div className="modal-content">
              <span 
                className="close-modal" 
                onClick={() => setShowEditMetadataModal(false)}
              >
                &times;
              </span>
              <h2>Edit Metadata</h2>
              <form id="edit-metadata-form" className="form">
                <input type="hidden" value={editingMetadata.key} />
                <div className="form-group">
                  <label htmlFor="edit-metadata-value">Value:</label>
                  <textarea 
                    id="edit-metadata-value" 
                    name="edit-metadata-value" 
                    rows="3"
                    value={editingMetadata.value}
                    onChange={(e) => setEditingMetadata({...editingMetadata, value: e.target.value})}
                  ></textarea>
                  <small>You can enter a simple value or valid JSON</small>
                </div>
                <button 
                  type="button" 
                  className="btn btn-primary"
                  onClick={handleEditMetadata}
                  disabled={loading}
                >
                  Update Metadata
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default MetadataManager;
