import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Fallback SVG for failed image loads
const FALLBACK_IMAGE_SVG = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgZmlsbD0iI2YzZjRmNiIgc3Ryb2tlPSIjZTVlN2ViIiBzdHJva2Utd2lkdGg9IjIiLz48dGV4dCB4PSI1MCUiIHk9IjQ1JSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE2IiBmb250LXdlaWdodD0iNTAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzlmYTZiMiI+SW1hZ2UgVW5hdmFpbGFibGU8L3RleHQ+PHRleHQgeD0iNTAlIiB5PSI1NSUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZpbGw9IiNkMWQ1ZGIiPvCfk7c8L3RleHQ+PC9zdmc+';

// Deleted image placeholder SVG
const DELETED_IMAGE_SVG = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgZmlsbD0iI2ZiZjVmNSIgc3Ryb2tlPSIjZjU5ZTBiIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1kYXNoYXJyYXk9IjEwLDUiLz48dGV4dCB4PSI1MCUiIHk9IjQwJSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE4IiBmb250LXdlaWdodD0iNjAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iI2M0MzAyYiI+SW1hZ2UgRGVsZXRlZDwvdGV4dD48dGV4dCB4PSI1MCUiIHk9IjU1JSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjMyIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iI2Y1OWUwYiI+8J+XkeKcgO+4jzwvdGV4dD48dGV4dCB4PSI1MCUiIHk9IjY4JSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjEyIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzk3OWNhMSI+Q2xpY2sgdG8gdmlldyBkZXRhaWxzPC90ZXh0Pjwvc3ZnPg==';

function ImageGallery({ projectId, images, loading, onImageUpdated, refreshProjectImages }) {
  const navigate = useNavigate();
  const [imageLoadStatus, setImageLoadStatus] = useState({});
  const [currentPage, setCurrentPage] = useState(1);
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [viewMode, setViewMode] = useState('medium'); // small, medium, large
  const [sortBy, setSortBy] = useState('date'); // date, name, size
  const [searchField, setSearchField] = useState('filename'); // 'filename', 'content_type', 'uploaded_by', 'metadata', or specific key
  const [searchValue, setSearchValue] = useState('');
  const [availableMetadataKeys, setAvailableMetadataKeys] = useState([]);
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [actionError, setActionError] = useState(null);
  
  const imagesPerPage = viewMode === 'small' ? 100 : viewMode === 'medium' ? 50 : 25;
  
  // Filter and sort images
  const filteredImages = images
    .filter(image => {
      if (!searchValue) return true;
      
      const searchLower = searchValue.toLowerCase();
      
      switch (searchField) {
        case 'filename':
          return (image.filename || '').toLowerCase().includes(searchLower);
        case 'content_type':
          return (image.content_type || '').toLowerCase().includes(searchLower);
        case 'uploaded_by':
          return (image.uploaded_by_user_id || '').toLowerCase().includes(searchLower);
        case 'metadata':
          // Search across all metadata values
          if (!image.metadata_) return false;
          return Object.values(image.metadata_).some(value => 
            String(value).toLowerCase().includes(searchLower)
          );
        default:
          // Search specific metadata key
          if (!image.metadata_ || !image.metadata_[searchField]) return false;
          return String(image.metadata_[searchField]).toLowerCase().includes(searchLower);
      }
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.filename || '').localeCompare(b.filename || '');
        case 'size':
          return (b.size_bytes || 0) - (a.size_bytes || 0);
        case 'date':
        default:
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      }
    });
  
  // Calculate total pages
  const totalPages = Math.ceil(filteredImages.length / imagesPerPage);
  
  // Get current images for the page
  const indexOfLastImage = currentPage * imagesPerPage;
  const indexOfFirstImage = indexOfLastImage - imagesPerPage;
  const currentImages = filteredImages.slice(indexOfFirstImage, indexOfLastImage);
  
  // Reset to first page when images or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [images.length, searchValue, searchField, sortBy]);
  
  // Collect available metadata keys
  useEffect(() => {
    const keys = new Set();
    images.forEach(image => {
      if (image.metadata_) {
        Object.keys(image.metadata_).forEach(key => keys.add(key));
      }
    });
    setAvailableMetadataKeys(Array.from(keys).sort());
  }, [images]);
  
  // Fetch images when search parameters change
  useEffect(() => {
    if (refreshProjectImages) {
      refreshProjectImages({
        searchField: searchField,
        searchValue: searchValue
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchField, searchValue]);
  
  // Page change handler
  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
    document.querySelector('.gallery-grid')?.scrollIntoView({ behavior: 'smooth' });
  };
  
  // Image selection handlers
  const toggleImageSelection = (imageId) => {
    const newSelected = new Set(selectedImages);
    if (newSelected.has(imageId)) {
      newSelected.delete(imageId);
    } else {
      newSelected.add(imageId);
    }
    setSelectedImages(newSelected);
  };
  
  const selectAllImages = () => {
    setSelectedImages(new Set(currentImages.map(img => img.id)));
  };
  
  const clearSelection = () => {
    setSelectedImages(new Set());
  };

  // Helper function to format file size
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };


  const handleRestore = async (image) => {
    try {
      const resp = await fetch(`/api/projects/${projectId}/images/${image.id}/restore`, { method: 'POST' });
      if (!resp.ok) {
        const detail = await resp.text();
        throw new Error(`Restore failed (${resp.status}): ${detail}`);
      }
      const data = await resp.json();
      if (onImageUpdated) onImageUpdated(data);
      if (refreshProjectImages) refreshProjectImages();
    } catch (e) {
      setActionError(e.message);
    }
  };

  return (
    <div className="modern-gallery">
      {/* Gallery Header with Controls */}
      <div className="gallery-header">
        <div className="gallery-title-section">
          <h1 className="gallery-title">Images</h1>
          <div className="gallery-stats">
            <span className="image-count">
              {filteredImages.length} {filteredImages.length === 1 ? 'image' : 'images'}
              {searchValue && ` found for "${searchValue}" in ${searchField}`}
            </span>
            {selectedImages.size > 0 && (
              <span className="selection-count">
                {selectedImages.size} selected
              </span>
            )}
          </div>
        </div>
        
        <div className="gallery-controls">
          <div className="search-control">
            <select 
              value={searchField} 
              onChange={(e) => setSearchField(e.target.value)}
              className="search-field-select"
            >
              <option value="filename">Filename</option>
              <option value="content_type">Content Type</option>
              <option value="uploaded_by">Uploaded By</option>
              <option value="metadata">All Metadata</option>
              {availableMetadataKeys.map(key => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder={`Search by ${searchField}...`}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="search-input"
            />
          </div>
          
          <div className="view-controls">
            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value)}
              className="sort-select"
            >
              <option value="date">Sort by Date</option>
              <option value="name">Sort by Name</option>
              <option value="size">Sort by Size</option>
            </select>
            
            <div className="view-mode-buttons">
              <button 
                className={`view-mode-btn ${viewMode === 'small' ? 'active' : ''}`}
                onClick={() => setViewMode('small')}
                title="Small thumbnails"
              >
                S
              </button>
              <button 
                className={`view-mode-btn ${viewMode === 'medium' ? 'active' : ''}`}
                onClick={() => setViewMode('medium')}
                title="Medium thumbnails"
              >
                M
              </button>
              <button 
                className={`view-mode-btn ${viewMode === 'large' ? 'active' : ''}`}
                onClick={() => setViewMode('large')}
                title="Large thumbnails"
              >
                L
              </button>
            </div>
          </div>
          
          {selectedImages.size > 0 && (
            <div className="selection-controls">
              <button onClick={clearSelection} className="btn btn-secondary btn-small">
                Clear Selection
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error Display */}
      {actionError && (
        <div className="error-banner">
          <span className="error-message">{actionError}</span>
          <button onClick={() => setActionError(null)} className="error-close">×</button>
        </div>
      )}

      {/* Gallery Content */}
      <div className="gallery-content">
        {loading && (
          <div className="gallery-loading">
            <div className="spinner"></div>
            <p>Loading images...</p>
          </div>
        )}
        
        {!loading && images.length === 0 && (
          <div className="gallery-empty">
            <div className="empty-icon">+</div>
            <h3>No images yet</h3>
            <p>Upload your first image to get started</p>
          </div>
        )}
        
        {!loading && filteredImages.length === 0 && images.length > 0 && (
          <div className="gallery-empty">
            <div className="empty-icon">?</div>
            <h3>No images found</h3>
            <p>Try adjusting your search terms</p>
            <button 
              onClick={() => {
                setSearchValue('');
                setSearchField('filename');
              }} 
              className="btn btn-primary btn-small"
            >
              Clear Search
            </button>
          </div>
        )}
        
        {!loading && currentImages.length > 0 && (
          <>
            <div className="gallery-pagination-info">
              <span>
                Showing {indexOfFirstImage + 1}-{Math.min(indexOfLastImage, filteredImages.length)} of {filteredImages.length} images
              </span>
              {selectedImages.size === 0 && (
                <button onClick={selectAllImages} className="btn btn-secondary btn-small">
                  Select All on Page
                </button>
              )}
            </div>
            
            <div className={`gallery-grid view-${viewMode}`}>
        {currentImages.map(image => (
                <div 
                  key={image.id} 
          className={`gallery-item ${selectedImages.has(image.id) ? 'selected' : ''} ${image.deleted_at ? 'deleted' : ''}`}
                >
                  <div className="gallery-item-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedImages.has(image.id)}
                      onChange={() => toggleImageSelection(image.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  
                  <div 
                    className="gallery-item-image"
                    onClick={() => navigate(`/view/${image.id}?project=${projectId}`)}
                  >
                    <img 
                      src={image.deleted_at ? DELETED_IMAGE_SVG : `/api/images/${image.id}/thumbnail?width=400&height=400`} 
                      alt={image.filename || 'Image'} 
                      loading="lazy"
                      onLoad={() => {
                        setImageLoadStatus(prev => ({
                          ...prev,
                          [image.id]: { status: 'loaded', timestamp: new Date().toISOString() }
                        }));
                      }}
                      onError={(e) => {
                        setImageLoadStatus(prev => ({
                          ...prev,
                          [image.id]: { status: 'error', timestamp: new Date().toISOString(), error: e.message }
                        }));
                        e.target.onerror = null;
                        e.target.src = image.deleted_at ? DELETED_IMAGE_SVG : FALLBACK_IMAGE_SVG;
                      }}
                    />
                    <div className="gallery-item-overlay">
                      <div className="overlay-actions">
                        <button 
                          className="overlay-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/view/${image.id}?project=${projectId}`);
                          }}
                        >View</button>
                        {image.deleted_at && !image.storage_deleted && (
                          <button 
                            className="overlay-btn"
                            onClick={(e) => { e.stopPropagation(); handleRestore(image); }}
                          >Restore</button>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="gallery-item-info">
                    <div className="item-filename">
                      {image.filename || 'Unnamed image'}
                    </div>
                    <div className="item-meta">
                      <span className="item-size">{formatFileSize(image.size_bytes)}</span>
                      {image.deleted_at && (
                        <span className="item-status" style={{ color: '#c0392b', fontWeight: '600', marginLeft: '6px' }}>Deleted</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            {totalPages > 1 && (
              <div className="gallery-pagination">
                <button 
                  onClick={() => handlePageChange(1)} 
                  disabled={currentPage === 1}
                  className="pagination-btn"
                >
                  ‹‹
                </button>
                
                <button 
                  onClick={() => handlePageChange(currentPage - 1)} 
                  disabled={currentPage === 1}
                  className="pagination-btn"
                >
                  ‹
                </button>
                
                <span className="pagination-info">
                  Page {currentPage} of {totalPages}
                </span>
                
                <button 
                  onClick={() => handlePageChange(currentPage + 1)} 
                  disabled={currentPage === totalPages}
                  className="pagination-btn"
                >
                  ›
                </button>
                
                <button 
                  onClick={() => handlePageChange(totalPages)} 
                  disabled={currentPage === totalPages}
                  className="pagination-btn"
                >
                  ››
                </button>
              </div>
            )}
          </>
        )}
      </div>

      
      {/* Debug section moved to bottom */}
      <div className="debug-section">
        <div className="debug-header" onClick={() => setDebugExpanded(!debugExpanded)}>
          <h4>Debug Information</h4>
          <span className="debug-toggle">{debugExpanded ? '▲' : '▼'}</span>
        </div>
        
        {debugExpanded && (
          <div className="debug-content">
            <div className="debug-stats">
              <p>Image loading status: {Object.keys(imageLoadStatus).length} / {images.length} images tracked</p>
            </div>
            
            <div className="debug-log">
              <h5>Loading Status Log:</h5>
              <div className="debug-log-list">
                {Object.entries(imageLoadStatus).map(([imageId, status]) => (
                  <div key={imageId} className={`debug-log-item ${status.status}`}>
                    <span className="log-id">{imageId}</span>
                    <span className="log-status">{status.status}</span>
                    <span className="log-time">{new Date(status.timestamp).toLocaleTimeString()}</span>
                    {status.error && <div className="log-error">Error: {status.error}</div>}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="debug-actions">
              <button 
                className="debug-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('Current image load status:', imageLoadStatus);
                  console.log('Images data:', images);
                }}
              >
                Log to Console
              </button>
              
              <button 
                className="debug-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  if (images.length === 0) {
                    console.log('No images to test');
                    return;
                  }
                  const testImage = images[0];
                  console.log(`Testing image loading for ${testImage.id}...`);
                  
                  fetch(`/api/images/${testImage.id}/download`)
                    .then(response => response.json())
                    .then(data => console.log('Download URL data:', data))
                    .catch(err => console.error('Error testing image URLs:', err));
                }}
              >
                Test Image URLs
              </button>
            </div>
          </div>
        )}
      </div>
  </div>
  );
}

export default ImageGallery;
