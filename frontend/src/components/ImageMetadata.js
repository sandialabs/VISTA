import React, { useState } from 'react';

function ImageMetadata({ imageId, image, setImage, loading, setLoading, setError }) {
  const [newMetadata, setNewMetadata] = useState({ key: '', value: '' });
  const [editingMetadata, setEditingMetadata] = useState(null);

  // Helper function to format file size
  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown size';
    
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  // Helper function to format date
  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown date';
    
    const date = new Date(dateString);
    return date.toLocaleString();
  };

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

  // Handle adding metadata
  const handleAddMetadata = async (e) => {
    e.preventDefault();
    
    if (newMetadata.key.trim() === '') {
      setError('Metadata key cannot be empty');
      return;
    }
    
    try {
      setLoading(true);
      
      const response = await fetch(`/api/images/${imageId}/metadata`, {
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
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      // Update the image metadata
      setImage(prev => {
        const currentMetadata = prev.metadata || prev.metadata_ || {};
        const updatedMetadata = {
          ...currentMetadata,
          [newMetadata.key]: parseMetadataValue(newMetadata.value)
        };

        return {
          ...prev,
          metadata: updatedMetadata,
          metadata_: updatedMetadata
        };
      });
      
      // Reset form
      setNewMetadata({ key: '', value: '' });
      setError(null);
      
    } catch (error) {
      console.error('Error adding metadata:', error);
      setError('Failed to add metadata. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  // Handle updating metadata
  const handleUpdateMetadata = async () => {
    if (!editingMetadata) return;

    if (editingMetadata.key.trim() === '') {
      setError('Metadata key cannot be empty');
      return;
    }

    try {
      setLoading(true);

      const keyChanged = editingMetadata.originalKey !== editingMetadata.key;

      // If key changed, delete the old key first
      if (keyChanged && editingMetadata.originalKey) {
        const deleteResponse = await fetch(`/api/images/${imageId}/metadata/${editingMetadata.originalKey}`, {
          method: 'DELETE',
        });

        if (!deleteResponse.ok) {
          throw new Error(`Failed to delete old key: ${deleteResponse.status}`);
        }
      }

      // Add/update with new key and value
      const response = await fetch(`/api/images/${imageId}/metadata`, {
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
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      // Update the image metadata
      setImage(prev => {
        const currentMetadata = prev.metadata || prev.metadata_ || {};
        const updatedMetadata = { ...currentMetadata };

        // Remove old key if it changed
        if (keyChanged && editingMetadata.originalKey) {
          delete updatedMetadata[editingMetadata.originalKey];
        }

        // Add/update new key
        updatedMetadata[editingMetadata.key] = parseMetadataValue(editingMetadata.value);

        return {
          ...prev,
          metadata: updatedMetadata,
          metadata_: updatedMetadata
        };
      });

      // Exit inline editing
      setEditingMetadata(null);
      setError(null);

    } catch (error) {
      console.error('Error updating metadata:', error);
      setError('Failed to update metadata. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  // Handle deleting metadata
  const handleDeleteMetadata = async (key) => {
    if (!window.confirm(`Are you sure you want to delete the metadata key "${key}"?`)) {
      return;
    }
    
    try {
      setLoading(true);
      
      const response = await fetch(`/api/images/${imageId}/metadata/${key}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      // Update the image metadata
      setImage(prev => {
        const currentMetadata = prev.metadata || prev.metadata_ || {};
        const updatedMetadata = { ...currentMetadata };
        delete updatedMetadata[key];

        return {
          ...prev,
          metadata: updatedMetadata,
          metadata_: updatedMetadata
        };
      });
      
      setError(null);
      
    } catch (error) {
      console.error('Error deleting metadata:', error);
      setError('Failed to delete metadata. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" id="metadata-container">
      <div className="card-header">
        <h2>Image Metadata</h2>
      </div>
      <div className="card-content" id="metadata-content">
        {loading && !image ? (
          <p>Loading metadata...</p>
        ) : image ? (
          <>
            <table className="metadata-table">
              <tbody>
                <tr>
                  <td className="metadata-label">Filename</td>
                  <td className="metadata-value">{image.filename || 'Unknown'}</td>
                </tr>
                <tr>
                  <td className="metadata-label">Size</td>
                  <td className="metadata-value">{formatFileSize(image.size_bytes)}</td>
                </tr>
                <tr>
                  <td className="metadata-label">Content Type</td>
                  <td className="metadata-value">{image.content_type || 'Unknown'}</td>
                </tr>
                <tr>
                  <td className="metadata-label">Uploaded By</td>
                  <td className="metadata-value">{image.uploaded_by_user_id || 'Unknown'}</td>
                </tr>
                <tr>
                  <td className="metadata-label">Upload Date</td>
                  <td className="metadata-value">{formatDate(image.created_at)}</td>
                </tr>
              </tbody>
            </table>
            
            <h3>Custom Metadata</h3>
            {((image.metadata || image.metadata_) && Object.keys(image.metadata || image.metadata_).length > 0) ? (
              <>
                <table className="metadata-table custom-metadata-table">
                  <tbody>
                    {Object.entries(image.metadata || image.metadata_).map(([key, value]) => (
                      <tr key={key}>
                        <td className="metadata-label">
                          {editingMetadata && editingMetadata.originalKey === key ? (
                            <input
                              type="text"
                              className="metadata-key-input-inline"
                              value={editingMetadata.key}
                              onChange={(e) => setEditingMetadata({...editingMetadata, key: e.target.value})}
                              placeholder="Metadata key"
                            />
                          ) : (
                            <span onClick={() => setEditingMetadata({
                              originalKey: key,
                              key,
                              value: typeof value === 'object'
                                ? JSON.stringify(value, null, 2)
                                : value.toString()
                            })} style={{ cursor: 'pointer' }}>
                              {key}
                            </span>
                          )}
                        </td>
                        <td className="metadata-value">
                          {editingMetadata && editingMetadata.originalKey === key ? (
                            <textarea
                              className="metadata-value-textarea-inline"
                              value={editingMetadata.value}
                              onChange={(e) => setEditingMetadata({...editingMetadata, value: e.target.value})}
                              placeholder="Enter a simple value or valid JSON"
                            ></textarea>
                          ) : (
                            <div onClick={() => setEditingMetadata({
                              originalKey: key,
                              key,
                              value: typeof value === 'object'
                                ? JSON.stringify(value, null, 2)
                                : value.toString()
                            })} style={{ cursor: 'pointer' }}>
                              {value === null ? (
                                <span className="metadata-null">null</span>
                              ) : typeof value === 'object' ? (
                                <pre>{JSON.stringify(value, null, 2)}</pre>
                              ) : (
                                value.toString()
                              )}
                            </div>
                          )}
                        </td>
                        <td className="metadata-actions">
                          {(!editingMetadata || editingMetadata.originalKey !== key) && (
                            <>
                              <button
                                className="btn btn-small"
                                onClick={() => setEditingMetadata({
                                  originalKey: key,
                                  key,
                                  value: typeof value === 'object'
                                    ? JSON.stringify(value, null, 2)
                                    : value.toString()
                                })}
                              >
                                Edit
                              </button>
                              <button
                                className="btn btn-small btn-danger"
                                onClick={() => handleDeleteMetadata(key)}
                              >
                                Delete
                              </button>
                            </>
                          )}
                          {editingMetadata && editingMetadata.originalKey === key && (
                            <span className="editing-indicator">Editing...</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Edit actions below table */}
                {editingMetadata && (
                  <div className="metadata-edit-actions-below">
                    <button
                      className="btn btn-small btn-primary"
                      onClick={handleUpdateMetadata}
                      disabled={loading}
                    >
                      {loading ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      className="btn btn-small btn-secondary"
                      onClick={() => setEditingMetadata(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p>No custom metadata available</p>
            )}
            
            <form id="add-metadata-form" className="form" onSubmit={handleAddMetadata}>
              <h3>Add Metadata</h3>
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
          </>
        ) : (
          <p>Failed to load metadata</p>
        )}
      </div>

    </div>
  );
}

export default ImageMetadata;
