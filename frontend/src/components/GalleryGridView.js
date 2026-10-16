import React from 'react';
import ReviewStatusBadge from './ReviewStatusBadge';
import { formatFileSize } from '../utils/formatFileSize';

// Fallback SVG for failed image loads
const FALLBACK_IMAGE_SVG = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgZmlsbD0iI2YzZjRmNiIgc3Ryb2tlPSIjZTVlN2ViIiBzdHJva2Utd2lkdGg9IjIiLz48dGV4dCB4PSI1MCUiIHk9IjQ1JSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE2IiBmb250LXdlaWdodD0iNTAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzlmYTZiMiI+SW1hZ2UgVW5hdmFpbGFibGU8L3RleHQ+PHRleHQgeD0iNTAlIiB5PSI1NSUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyNCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZpbGw9IiNkMWQ1ZGIiPvCfk7c8L3RleHQ+PC9zdmc+';

// Deleted image placeholder SVG
const DELETED_IMAGE_SVG = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgZmlsbD0iI2ZiZjVmNSIgc3Ryb2tlPSIjZjU5ZTBiIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1kYXNoYXJyYXk9IjEwLDUiLz48dGV4dCB4PSI1MCUiIHk9IjQwJSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE4IiBmb250LXdlaWdodD0iNjAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iI2M0MzAyYiI+SW1hZ2UgRGVsZXRlZDwvdGV4dD48dGV4dCB4PSI1MCUiIHk9IjU1JSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjMyIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iI2Y1OWUwYiI+8J+XkeKcgO+4jzwvdGV4dD48dGV4dCB4PSI1MCUiIHk9IjY4JSIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjEyIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSIgZmlsbD0iIzk3OWNhMSI+Q2xpY2sgdG8gdmlldyBkZXRhaWxzPC90ZXh0Pjwvc3ZnPg==';

// Snap to the nearest fixed tier to keep backend thumbnail cache bounded.
// At most 5 distinct cache entries per image instead of one per slider step.
const THUMBNAIL_TIERS = [200, 400, 600, 800, 1000];
function snapToTier(size) {
  const target = size * 2; // 2x for retina
  let best = THUMBNAIL_TIERS[0];
  for (const tier of THUMBNAIL_TIERS) {
    if (Math.abs(tier - target) < Math.abs(best - target)) best = tier;
  }
  return best;
}

function GalleryGridView({
  images,
  viewMode,
  thumbnailSize,
  selectedImages,
  reviewStatuses,
  onImageClick,
  onToggleSelection,
  onRestore,
}) {
  const thumbFetchSize = snapToTier(thumbnailSize);
  const gridStyle = viewMode !== 'list'
    ? { gridTemplateColumns: `repeat(auto-fill, minmax(${thumbnailSize}px, 1fr))` }
    : undefined;
  return (
    <div className="gallery-grid" style={gridStyle}>
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
              src={image.deleted_at ? DELETED_IMAGE_SVG : `/api/images/${image.id}/thumbnail?width=${thumbFetchSize}&height=${thumbFetchSize}`}
              alt={image.displayName || image.filename || 'Image'}
              loading="lazy"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = image.deleted_at ? DELETED_IMAGE_SVG : FALLBACK_IMAGE_SVG;
              }}
            />
            <div className="gallery-item-overlay">
              <div className="overlay-actions">
                <button
                  className="overlay-btn"
                  aria-label={`View ${image.displayName || image.filename || 'image'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onImageClick(image.id);
                  }}
                >View</button>
                {image.deleted_at && !image.storage_deleted && (
                  <button
                    className="overlay-btn"
                    aria-label={`Restore ${image.displayName || image.filename || 'image'}`}
                    onClick={(e) => { e.stopPropagation(); onRestore(image); }}
                  >Restore</button>
                )}
              </div>
            </div>
          </div>

          <div className="gallery-item-info">
            <div className="item-filename">
              {image.displayName || image.filename || 'Unnamed image'}
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
