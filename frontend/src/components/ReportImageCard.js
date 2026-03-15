import React from 'react';
import ReportImageWithBboxes from './ReportImageWithBboxes';

/**
 * ReportImageCard
 * Renders a single image entry in the project report,
 * including thumbnail with bbox overlays, metadata, comments, and annotations.
 */
function ReportImageCard({
  image, fullWidthImages, annotations, bboxClassMap,
  classes, formatFileSize, getClassLabels
}) {
  return (
    <div className="image-item">
      <div className={`image-display-section ${fullWidthImages ? 'full-width' : ''}`}>
        <div className={`image-thumbnail ${fullWidthImages ? 'full-width-thumbnail' : ''}`}>
          {image.deleted_at ? (
            <div className="deleted-image-placeholder">
              <div className="deleted-image-text">
                <div>IMAGE DELETED</div>
                <div className="deleted-date">
                  {new Date(image.deleted_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          ) : (
            <ReportImageWithBboxes
              image={image}
              fullWidth={fullWidthImages}
              annotations={annotations}
              bboxClassMap={bboxClassMap}
            />
          )}
        </div>
        <div className="image-details">
          <div className="image-title">{image.filename || 'Untitled'}</div>
          <div className="image-meta">
            <span><strong>ID:</strong> {image.id}</span>
            <span><strong>Size:</strong> {formatFileSize(image.size_bytes)}</span>
            <span><strong>Type:</strong> {image.content_type || 'Unknown'}</span>
            <span><strong>Uploaded:</strong> {new Date(image.created_at).toLocaleString()}</span>
            <span><strong>Class Labels:</strong> {getClassLabels(image.classifications, classes)}</span>
            {image.deleted_at && (
              <span className="deleted-indicator">
                <strong>DELETED:</strong> {new Date(image.deleted_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </div>

      {image.comments && image.comments.length > 0 && (
        <div className="image-comments">
          <strong>Comments ({image.comments.length}):</strong>
          {image.comments.map((comment, idx) => (
            <div key={idx} className="comment">
              <strong>{comment.author?.email || 'Unknown'}:</strong> {comment.text}
              <small className="comment-date"> - {new Date(comment.created_at).toLocaleString()}</small>
            </div>
          ))}
        </div>
      )}

      {image.metadata && Object.keys(image.metadata).length > 0 && (
        <div className="image-metadata">
          <strong>Custom Metadata:</strong>
          <pre className="metadata-json">{JSON.stringify(image.metadata, null, 2)}</pre>
        </div>
      )}

      {annotations.length > 0 && (
        <div className="image-annotations" style={{ marginTop: '0.3rem', fontSize: '0.85rem' }}>
          <strong>Annotations ({annotations.length}):</strong>
          <div style={{ marginTop: '0.2rem' }}>
            {annotations.map((ann, idx) => {
              const cls = bboxClassMap[ann.bbox_class_id];
              return (
                <span key={ann.id || idx} style={{
                  display: 'inline-block',
                  marginRight: '0.5rem',
                  marginBottom: '0.2rem',
                  padding: '1px 6px',
                  borderRadius: 3,
                  border: `1px solid ${cls?.color || '#FF9800'}`,
                  fontSize: '0.78rem',
                }}>
                  {cls?.name || 'Unknown'}
                  {ann.notes ? ` -- ${ann.notes}` : ''}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default ReportImageCard;
