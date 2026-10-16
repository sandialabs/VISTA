import React from 'react';
import ReviewStatusBadge from './ReviewStatusBadge';

function GalleryListView({
  images,
  metadataKeys,
  selectedImages,
  reviewStatuses,
  onImageClick,
  onToggleSelection,
}) {
  return (
    <div className="gallery-list">
      <div className="gallery-list-header">
        <div className="gallery-list-cell gallery-list-cell-check"></div>
        <div className="gallery-list-cell gallery-list-cell-filename">Filename</div>
        {metadataKeys.map(key => (
          <div key={key} className="gallery-list-cell gallery-list-cell-meta">{key}</div>
        ))}
        <div className="gallery-list-cell gallery-list-cell-status">Review Status</div>
      </div>
      {images.map(image => {
        const meta = image.metadata || image.metadata_ || {};
        return (
          <div
            key={image.id}
            className={`gallery-list-row ${selectedImages.has(image.id) ? 'selected' : ''} ${image.deleted_at ? 'deleted' : ''}`}
            role="button"
            aria-label={image.displayName || image.filename || 'Unnamed image'}
            tabIndex={0}
            onMouseDown={(e) => {
              if (e.shiftKey) e.preventDefault();
            }}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey || e.shiftKey) {
                e.preventDefault();
                onToggleSelection(image.id, e);
              } else {
                onImageClick(image.id);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onImageClick(image.id);
              }
            }}
          >
            <div
              className="gallery-list-cell gallery-list-cell-check"
              role="checkbox"
              aria-checked={selectedImages.has(image.id)}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelection(image.id, e);
              }}
            >
              <span className={`custom-check ${selectedImages.has(image.id) ? 'checked' : ''}`} />
            </div>
            <div className="gallery-list-cell gallery-list-cell-filename">
              {image.displayName || image.filename || 'Unnamed image'}
              {image.deleted_at && (
                <span className="item-status" style={{ color: '#c0392b', fontWeight: '600', marginLeft: '6px' }}>Deleted</span>
              )}
            </div>
            {metadataKeys.map(key => (
              <div key={key} className="gallery-list-cell gallery-list-cell-meta">
                {meta[key] !== undefined
                  ? (typeof meta[key] === 'object' ? JSON.stringify(meta[key]) : String(meta[key]))
                  : ''}
              </div>
            ))}
            <div className="gallery-list-cell gallery-list-cell-status">
              <ReviewStatusBadge status={reviewStatuses[image.id] || 'unreviewed'} size="small" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default GalleryListView;
