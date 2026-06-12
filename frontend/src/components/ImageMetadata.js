import React, { useState } from 'react';
import MetadataEditDialog from './MetadataEditDialog';

function ImageMetadata({ imageId, image, setImage, loading, setLoading, setError }) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [editingValue, setEditingValue] = useState('');

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

  // Helper to format value for display in dialog
  const formatValueForEdit = (value) => {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return value.toString();
  };

  // Open dialog for adding new metadata
  const handleOpenAddDialog = () => {
    setEditingKey(null);
    setEditingValue('');
    setEditDialogOpen(true);
  };

  // Open dialog for editing existing metadata
  const handleOpenEditDialog = (key, value) => {
    setEditingKey(key);
    setEditingValue(formatValueForEdit(value));
    setEditDialogOpen(true);
  };

  // Handle save from dialog
  const handleSaveMetadata = async (newKey, newValue) => {
    if (newKey.trim() === '') {
      setError('Metadata key cannot be empty');
      return;
    }

    try {
      setLoading(true);
      const keyChanged = editingKey && editingKey !== newKey;

      // If editing and key changed, delete the old key first
      if (keyChanged) {
        const deleteResponse = await fetch(`/api/images/${imageId}/metadata/${editingKey}`, {
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
          key: newKey,
          value: parseMetadataValue(newValue),
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
        if (keyChanged) {
          delete updatedMetadata[editingKey];
        }

        // Add/update new key
        updatedMetadata[newKey] = parseMetadataValue(newValue);

        return {
          ...prev,
          metadata: updatedMetadata,
          metadata_: updatedMetadata
        };
      });

      // Close dialog and reset state
      setEditDialogOpen(false);
      setEditingKey(null);
      setEditingValue('');
      setError(null);

    } catch (error) {
      console.error('Error saving metadata:', error);
      setError('Failed to save metadata. Please try again later.');
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

  const customMetadata = image?.metadata || image?.metadata_ || {};
  const hasCustomMetadata = Object.keys(customMetadata).length > 0;

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

            <div className="custom-metadata-header">
              <h3>Custom Metadata</h3>
              <button
                className="btn btn-small btn-primary"
                onClick={handleOpenAddDialog}
                disabled={loading}
              >
                Add Metadata
              </button>
            </div>

            {hasCustomMetadata ? (
              <div className="custom-metadata-scroll" tabIndex="0" aria-label="Custom metadata fields">
                <table className="metadata-table custom-metadata-table">
                  <tbody>
                    {Object.entries(customMetadata).map(([key, value]) => (
                      <tr key={key}>
                        <td className="metadata-label">{key}</td>
                        <td className="metadata-value">
                          <div className="metadata-value-content">
                            {value === null ? (
                              <span className="metadata-null">null</span>
                            ) : typeof value === 'object' ? (
                              <pre>{JSON.stringify(value, null, 2)}</pre>
                            ) : (
                              value.toString()
                            )}
                          </div>
                          <div className="metadata-actions">
                            <button
                              className="btn btn-small"
                              onClick={() => handleOpenEditDialog(key, value)}
                              disabled={loading}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-small btn-danger"
                              onClick={() => handleDeleteMetadata(key)}
                              disabled={loading}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="no-metadata-message">No custom metadata available</p>
            )}
          </>
        ) : (
          <p>Failed to load metadata</p>
        )}
      </div>

      <MetadataEditDialog
        isOpen={editDialogOpen}
        onClose={() => {
          setEditDialogOpen(false);
          setEditingKey(null);
          setEditingValue('');
        }}
        onSave={handleSaveMetadata}
        initialKey={editingKey}
        initialValue={editingValue}
        isLoading={loading}
      />
    </div>
  );
}

export default ImageMetadata;
