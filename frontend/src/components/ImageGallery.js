import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import GalleryListView from './GalleryListView';
import GalleryGridView from './GalleryGridView';
import BulkDeleteModal from './BulkDeleteModal';
import BulkMetadataModal from './BulkMetadataModal';
import { getGalleryStateFromUrlOrStorage, saveGalleryState, filterBySearch, filterByReviewStatus, sortImages, writeGalleryStateToSearchParams } from '../utils/galleryState';
import { assignDuplicateFilenameAliases } from '../utils/imageIdentity';
import { isUserMetadataKey } from '../utils/metadataKeys';
import { fetchProjectImageReviewStatuses, restoreProjectImage } from '../api/images';

function ImageGallery({ projectId, galleryKey, images, loading, onImageUpdated, refreshProjectImages }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // galleryKey distinguishes between project-level and group-level gallery state
  const stateKey = galleryKey || projectId;

  const [currentPage, setCurrentPage] = useState(1);
  // Filter/sort state is loaded once from localStorage and persisted back on change
  const [savedState] = useState(() => getGalleryStateFromUrlOrStorage(searchParams, stateKey));
  const [viewMode, setViewMode] = useState(savedState.viewMode);
  const [thumbnailSize, setThumbnailSize] = useState(savedState.thumbnailSize);
  const [sortBy, setSortBy] = useState(savedState.sortBy);
  const [sortOrder, setSortOrder] = useState(savedState.sortOrder);
  const [searchField, setSearchField] = useState(savedState.searchField);
  const [searchValue, setSearchValue] = useState(savedState.searchValue);
  const [availableMetadataKeys, setAvailableMetadataKeys] = useState([]);
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [lastSelectedId, setLastSelectedId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [reviewStatuses, setReviewStatuses] = useState({});
  const reviewStatusesRef = useRef(reviewStatuses);
  const [reviewFilter, setReviewFilter] = useState(savedState.reviewFilter);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [showBulkMetaModal, setShowBulkMetaModal] = useState(false);

  // Reset filter/sort state when the gallery key changes (e.g. switching groups)
  const prevKeyRef = useRef(stateKey);
  useEffect(() => {
    if (prevKeyRef.current !== stateKey) {
      prevKeyRef.current = stateKey;
      const saved = getGalleryStateFromUrlOrStorage(searchParams, stateKey);
      setViewMode(saved.viewMode);
      setThumbnailSize(saved.thumbnailSize);
      setSortBy(saved.sortBy);
      setSearchField(saved.searchField);
      setSearchValue(saved.searchValue);
      setSortOrder(saved.sortOrder);
      setReviewFilter(saved.reviewFilter);
      setCurrentPage(1);
    }
  }, [stateKey, searchParams]);

  // Persist filter/sort state to localStorage whenever it changes.
  // Debounce to avoid excessive writes while dragging the thumbnail size slider.
  useEffect(() => {
    const state = { viewMode, thumbnailSize, sortBy, sortOrder, searchField, searchValue, reviewFilter };
    const timer = setTimeout(() => saveGalleryState(stateKey, state), 300);
    return () => clearTimeout(timer);
  }, [stateKey, viewMode, thumbnailSize, sortBy, sortOrder, searchField, searchValue, reviewFilter]);

  const imagesPerPage = viewMode === 'list' ? 200 : 60;
  const displayImages = useMemo(
    () => assignDuplicateFilenameAliases(images),
    [images],
  );

  const filteredImages = sortImages(
    filterByReviewStatus(
      filterBySearch(displayImages, searchField, searchValue),
      reviewFilter,
      reviewStatuses
    ),
    sortBy,
    sortOrder
  );

  const totalPages = Math.ceil(filteredImages.length / imagesPerPage);
  const indexOfLastImage = currentPage * imagesPerPage;
  const indexOfFirstImage = indexOfLastImage - imagesPerPage;
  const currentImages = filteredImages.slice(indexOfFirstImage, indexOfLastImage);

  useEffect(() => {
    setCurrentPage(1);
  }, [images.length, searchValue, searchField, sortBy, sortOrder, reviewFilter, viewMode]);

  useEffect(() => {
    const keys = new Set();
    images.forEach(image => {
      const meta = image.metadata || image.metadata_;
      if (meta) {
        Object.keys(meta).forEach(key => {
          if (isUserMetadataKey(key)) keys.add(key);
        });
      }
    });
    setAvailableMetadataKeys(Array.from(keys).sort());
  }, [images]);

  const loadReviewStatuses = useCallback(async (isCurrent = () => true) => {
    if (!projectId) return;
    try {
      const data = await fetchProjectImageReviewStatuses(projectId);
      if (isCurrent() && JSON.stringify(reviewStatusesRef.current) !== JSON.stringify(data)) {
        reviewStatusesRef.current = data;
        setReviewStatuses(data);
      }
    } catch (err) {
      console.error('Failed to load review statuses:', err);
    }
  }, [projectId]);

  useEffect(() => {
    let isCurrent = true;
    loadReviewStatuses(() => isCurrent);
    return () => {
      isCurrent = false;
    };
  }, [loadReviewStatuses]);

  useEffect(() => {
    if (refreshProjectImages) {
      refreshProjectImages({
        searchField: searchField,
        searchValue: searchValue
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchField, searchValue]);

  useEffect(() => {
    const groupMatch = stateKey && stateKey.match(/_group_(.+)$/);
    const nextParams = writeGalleryStateToSearchParams(searchParams, {
      galleryKey: stateKey,
      groupId: groupMatch ? groupMatch[1] : null,
      ungrouped: stateKey && stateKey.endsWith('_ungrouped'),
      searchField,
      searchValue,
      sortBy,
      sortOrder,
      reviewFilter,
    });
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [stateKey, searchParams, setSearchParams, searchField, searchValue, sortBy, sortOrder, reviewFilter]);

  const buildImageViewUrl = useCallback((imageId) => {
    const groupMatch = stateKey && stateKey.match(/_group_(.+)$/);
    const params = writeGalleryStateToSearchParams(searchParams, {
      galleryKey: stateKey,
      groupId: groupMatch ? groupMatch[1] : null,
      ungrouped: stateKey && stateKey.endsWith('_ungrouped'),
      searchField,
      searchValue,
      sortBy,
      sortOrder,
      reviewFilter,
    });
    const navParams = new URLSearchParams({ project: projectId });
    for (const [key, value] of params.entries()) {
      if (key !== 'project') navParams.set(key, value);
    }
    return `/view/${imageId}?${navParams.toString()}`;
  }, [stateKey, searchParams, projectId, searchField, searchValue, sortBy, sortOrder, reviewFilter]);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
    const selector = viewMode === 'list' ? '.gallery-list' : '.gallery-grid';
    document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleImageSelection = (imageId, event) => {
    if (event && event.shiftKey && lastSelectedId !== null) {
      const lastIndex = currentImages.findIndex(img => img.id === lastSelectedId);
      const currentIndex = currentImages.findIndex(img => img.id === imageId);
      if (lastIndex >= 0 && currentIndex >= 0) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const newSelected = new Set(selectedImages);
        for (let i = start; i <= end; i++) {
          newSelected.add(currentImages[i].id);
        }
        setSelectedImages(newSelected);
        return;
      }
    }
    const newSelected = new Set(selectedImages);
    if (newSelected.has(imageId)) {
      newSelected.delete(imageId);
    } else {
      newSelected.add(imageId);
    }
    setSelectedImages(newSelected);
    setLastSelectedId(imageId);
  };

  const selectAllImages = () => {
    setSelectedImages(new Set(currentImages.map(img => img.id)));
  };

  const clearSelection = () => {
    setSelectedImages(new Set());
    setLastSelectedId(null);
  };

  const handleRestore = async (image) => {
    try {
      const data = await restoreProjectImage(projectId, image.id);
      if (onImageUpdated) onImageUpdated(data);
      if (refreshProjectImages) refreshProjectImages();
    } catch (e) {
      setActionError(e.message);
    }
  };

  return (
    <div className="modern-gallery">
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
              value={reviewFilter}
              onChange={(e) => setReviewFilter(e.target.value)}
              className="sort-select"
              title="Filter by review status"
            >
              <option value="all">All Statuses</option>
              <option value="unreviewed">Unreviewed</option>
              <option value="pass">Pass</option>
              <option value="reject_pending">Reject (Pending)</option>
              <option value="reject_confirmed">Reject (Confirmed)</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="sort-select"
            >
              <option value="date">Sort by Date</option>
              <option value="name">Sort by Name</option>
              <option value="size">Sort by Size</option>
            </select>

            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="sort-select"
              title="Sort order"
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
            
            <div className="view-mode-buttons">
              <div className="thumbnail-size-control">
                <input
                  id="thumbnail-size-slider"
                  type="range"
                  min="100"
                  max="500"
                  step="10"
                  value={thumbnailSize}
                  onChange={(e) => {
                    setThumbnailSize(Number(e.target.value));
                    if (viewMode === 'list') setViewMode('grid');
                  }}
                  className="thumbnail-size-slider"
                  title="Adjust thumbnail size"
                  aria-label="Adjust thumbnail size"
                  aria-valuemin={100}
                  aria-valuemax={500}
                  aria-valuenow={thumbnailSize}
                />
                <span className="thumbnail-size-label">{thumbnailSize}px</span>
              </div>
              <button
                className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
                title="List view"
                aria-label="List view"
                aria-pressed={viewMode === 'list'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                  <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
          
          {selectedImages.size > 0 && (
            <div className="selection-controls">
              <button
                onClick={() => setShowBulkDeleteModal(true)}
                className="btn btn-danger btn-small"
              >
                Delete Selected ({selectedImages.size})
              </button>
              <button
                onClick={() => setShowBulkMetaModal(true)}
                className="btn btn-secondary btn-small"
              >
                Add Metadata to Selected
              </button>
              <button onClick={clearSelection} className="btn btn-secondary btn-small">
                Clear Selection
              </button>
            </div>
          )}
        </div>
      </div>

      {actionError && (
        <div className="error-banner">
          <span className="error-message">{actionError}</span>
          <button onClick={() => setActionError(null)} className="error-close">×</button>
        </div>
      )}

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
            <button onClick={() => { setSearchValue(''); setSearchField('filename'); }} className="btn btn-primary btn-small">
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
            
            {viewMode === 'list' ? (
              <GalleryListView
                images={currentImages}
                metadataKeys={availableMetadataKeys}
                selectedImages={selectedImages}
                reviewStatuses={reviewStatuses}
                onImageClick={(imageId) => navigate(buildImageViewUrl(imageId))}
                onToggleSelection={handleImageSelection}
              />
            ) : (
              <GalleryGridView
                images={currentImages}
                viewMode={viewMode}
                thumbnailSize={thumbnailSize}
                selectedImages={selectedImages}
                reviewStatuses={reviewStatuses}
                onImageClick={(imageId) => navigate(buildImageViewUrl(imageId))}
                onToggleSelection={handleImageSelection}
                onRestore={handleRestore}
              />
            )}
            
            {totalPages > 1 && (
              <div className="gallery-pagination">
                <button onClick={() => handlePageChange(1)} disabled={currentPage === 1} className="pagination-btn">‹‹</button>
                <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className="pagination-btn">‹</button>
                <span className="pagination-info">Page {currentPage} of {totalPages}</span>
                <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className="pagination-btn">›</button>
                <button onClick={() => handlePageChange(totalPages)} disabled={currentPage === totalPages} className="pagination-btn">››</button>
              </div>
            )}
          </>
        )}
      </div>

      {showBulkDeleteModal && (
        <BulkDeleteModal
          projectId={projectId}
          selectedImages={selectedImages}
          onClose={() => setShowBulkDeleteModal(false)}
          onImageUpdated={onImageUpdated}
          refreshProjectImages={refreshProjectImages}
          onClearSelection={clearSelection}
        />
      )}

      {showBulkMetaModal && (
        <BulkMetadataModal
          selectedImages={selectedImages}
          onClose={() => setShowBulkMetaModal(false)}
          onImageUpdated={onImageUpdated}
          refreshProjectImages={refreshProjectImages}
          onClearSelection={clearSelection}
        />
      )}
  </div>
  );
}

export default ImageGallery;
