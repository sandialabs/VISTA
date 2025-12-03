import React, { useState } from 'react';

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
      
      const response = await fetch(`/api/projects/${projectId}/metadata/${newMetadata.key}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: newMetadata.key,
          value: parseMetadataValue(newMetadata.value),
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // Update the metadata state
      setMetadata(prevMetadata => ({
        ...prevMetadata,
        [newMetadata.key]: parseMetadataValue(newMetadata.value)
      }));
      
      // Update bulk metadata
      setBulkMetadata(JSON.stringify({
        ...metadata,
        [newMetadata.key]: parseMetadataValue(newMetadata.value)
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
      
      const response = await fetch(`/api/projects/${projectId}/metadata-dict`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: bulkMetadata,
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const updatedMetadata = await response.json();
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
      
      const response = await fetch(`/api/projects/${projectId}/metadata/${editingMetadata.key}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: editingMetadata.key,
          value: parseMetadataValue(editingMetadata.value),
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // Update the metadata state
      setMetadata(prevMetadata => ({
        ...prevMetadata,
        [editingMetadata.key]: parseMetadataValue(editingMetadata.value)
      }));
      
      // Update bulk metadata
      setBulkMetadata(JSON.stringify({
        ...metadata,
        [editingMetadata.key]: parseMetadataValue(editingMetadata.value)
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
      
      const response = await fetch(`/api/projects/${projectId}/metadata/${key}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
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
            <table className="metadata-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(metadata).map(([key, value]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td className="metadata-value">
                      {value === null ? (
                        <span className="metadata-null">null</span>
                      ) : typeof value === 'object' ? (
                        <pre>{JSON.stringify(value, null, 2)}</pre>
                      ) : (
                        value.toString()
                      )}
                    </td>
                    <td className="metadata-actions">
                      <button 
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
                        className="btn btn-small btn-danger"
                        onClick={() => handleDeleteMetadata(key)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
