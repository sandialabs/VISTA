import React, { useState } from 'react';

function ImageUploader({ projectId, onUploadComplete, loading, setLoading, setError }) {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadMetadata, setUploadMetadata] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  // Handle file input change
  const handleFileChange = (e) => {
    if (e.target.files) {
      setSelectedFiles(Array.from(e.target.files));
    }
  };

  // Handle drag and drop events
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) {
      setSelectedFiles(Array.from(e.dataTransfer.files));
    }
  };

  // Handle file upload
  const handleUpload = async (e) => {
    e.preventDefault();
    
    if (selectedFiles.length === 0) {
      setError('Please select at least one file to upload.');
      return;
    }
    
    // Validate metadata if provided
    if (uploadMetadata.trim()) {
      try {
        JSON.parse(uploadMetadata);
      } catch (err) {
        setError('Invalid JSON format for metadata.');
        return;
      }
    }
    
    setLoading(true);
    
    const uploadPromises = selectedFiles.map(async (file) => {
      const formData = new FormData();
      formData.append('file', file);
      
      if (uploadMetadata.trim()) {
        formData.append('metadata', uploadMetadata);
      }
      
      try {
        // log the url being called for upload. 
        console.log(`Uploading ${file.name} to /api/projects/${projectId}/images`);
        const response = await fetch(`/api/projects/${projectId}/images`, {
          method: 'POST',
          body: formData
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return await response.json();
      } catch (err) {
        console.error(`Error uploading ${file.name}:`, err);
        throw err;
      }
    });
    
    try {
      const results = await Promise.all(uploadPromises);
      onUploadComplete(results);
      setSelectedFiles([]);
      setUploadMetadata('');
      setError(null);
    } catch (err) {
      setError(`Upload failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Upload Images</h2>
      </div>
      <div className="card-content">
        <form onSubmit={handleUpload}>
          <div 
            className={`upload-area ${isDragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-input').click()}
          >
            <div className="upload-area-content">
              <div className="upload-area-icon">
                +
              </div>
              <div className="upload-area-text">
                Drag and drop images here, or click to select files
              </div>
              <div className="upload-area-subtext">
                Supports multiple image files (JPG, PNG, GIF, etc.)
              </div>
              <div className={`upload-area-status ${selectedFiles.length > 0 ? 'has-files' : 'no-files'}`}>
                {selectedFiles.length > 0 
                  ? `${selectedFiles.length} ${selectedFiles.length === 1 ? 'file' : 'files'} selected` 
                  : 'No files selected'}
              </div>
            </div>
            <input 
              type="file" 
              id="file-input" 
              accept="image/*,image/tiff,.tiff,.tif" 
              multiple 
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="metadata-input">Metadata (Optional JSON)</label>
            <textarea 
              id="metadata-input" 
              rows="3" 
              placeholder='{"key": "value"}'
              value={uploadMetadata}
              onChange={(e) => setUploadMetadata(e.target.value)}
            ></textarea>
          </div>
          
          <div className="form-group">
            <button 
              type="submit" 
              className="btn btn-success"
              disabled={loading}
            >
              {loading ? 'Uploading...' : 'Upload Images'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ImageUploader;
