import React from 'react';
import ReviewStatusBadge from './ReviewStatusBadge';

// Fallback SVG for failed image loads
const FALLBACK_IMAGE_SVG = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgZmlsbD0iI2YzZjRmNiIgc3Ryb2tlPSIjZTVlN2ViIiBzdHJva2Utd2lkdGg9IjIiLz48dGV4dCB4PSI1MCUiIHk9IjQ1JSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE2IiBmb250LXdlaWdodD0iNTAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzlmYTZiMiI+SW1hZ2UgVW5hdmFpbGFibGU8L3RleHQ+PHRleHQgeD0iNTAlIiB5PSI1NSUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZpbGw9IiNkMWQ1ZGIiPvCfk7c8L3RleHQ+PC9zdmc+';

// Deleted image placeholder SVG
const DELETED_IMAGE_SVG = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgZmlsbD0iI2ZiZjVmNSIgc3Ryb2tlPSIjZjU5ZTBiIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1kYXNoYXJyYXk9IjEwLDUiLz48dGV4dCB4PSI1MCUiIHk9IjQwJSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE4IiBmb250LXdlaWdodD0iNjAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iI2M0MzAyYiI+SW1hZ2UgRGVsZXRlZDwvdGV4dD48dGV4dCB4PSI1MCUiIHk9IjU1JSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjMyIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iI2Y1OWUwYiI+8J+XkeKcgO+4jzwvdGV4dD48dGV4dCB4PSI1MCUiIHk9IjY4JSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjEyIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzk3OWNhMSI+Q2xpY2sgdG8gdmlldyBkZXRhaWxzPC90ZXh0Pjwvc3ZnPg==';

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const THUMBNAIL_RESOLUTION = {
  small: 200,
  medium: 400,
  large: 600,
};

function getThumbnailResolution(viewMode) {
  return THUMBNAIL_RESOLUTION[viewMode] || 400;
}

function GalleryGridView({
  images,
  viewMode,
  selectedImages,
  reviewStatuses,
  onImageClick,
  onToggleSelection,
  onRestore,
  onImageLoadStatusChange,
}) {
  const thumbSize = getThumbnailResolution(viewMode);
  return (
    <div className={`gallery-grid view-${viewMode}`}>
      {images.map(image => (
        <div
          key={image.id}
          className={`gallery-item ${selectedImages.has(image.id) ? 'selected' : ''} ${image.deleted_at ? 'deleted' : ''}`}
          onMouseDown={(e) => {
            if (e.shiftKey) e.preventDefault();
          }}
        >
          <div
            className="gallery-item-checkbox"
            role="checkbox"
            aria-checked={selectedImages.has(image.id)}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onToggleSelection(image.id, e);
            }}
          >
            <span className={`custom-check ${selectedImages.has(image.id) ? 'checked' : ''}`} />
          </div>

          <div
            className="gallery-item-image"
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey || e.shiftKey) {
                e.preventDefault();
                onToggleSelection(image.id, e);
              } else {
                onImageClick(image.id);
              }
            }}
          >
            <img
              src={image.deleted_at ? DELETED_IMAGE_SVG : `/api/images/${image.id}/thumbnail?width=${thumbSize}&height=${thumbSize}`}
              alt={image.filename || 'Image'}
              loading="lazy"
              onLoad={() => {
                onImageLoadStatusChange(image.id, { status: 'loaded', timestamp: new Date().toISOString() });
              }}
              onError={(e) => {
                onImageLoadStatusChange(image.id, { status: 'error', timestamp: new Date().toISOString(), error: e.message });
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
                    onImageClick(image.id);
                  }}
                >View</button>
                {image.deleted_at && !image.storage_deleted && (
                  <button
                    className="overlay-btn"
                    onClick={(e) => { e.stopPropagation(); onRestore(image); }}
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
              <ReviewStatusBadge status={reviewStatuses[image.id] || 'unreviewed'} />
              {image.deleted_at && (
                <span className="item-status" style={{ color: '#c0392b', fontWeight: '600', marginLeft: '6px' }}>Deleted</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default GalleryGridView;
