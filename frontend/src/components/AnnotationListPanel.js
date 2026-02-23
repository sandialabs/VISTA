import React from 'react';
import AnnotationReviewControls from './AnnotationReviewControls';

function AnnotationListPanel({
  annotations,
  getClassById,
  selectedAnnotationId,
  onSelectAnnotation,
  onDeleteAnnotation,
  onAnnotationReviewed,
  showReviewControls,
}) {
  if (!annotations || annotations.length === 0) {
    return (
      <div className="annotation-list-panel">
        <h4 className="annotation-list-title">Annotations</h4>
        <p className="annotation-list-empty">No annotations yet.</p>
      </div>
    );
  }

  return (
    <div className="annotation-list-panel">
      <h4 className="annotation-list-title">
        Annotations ({annotations.length})
      </h4>
      <ul className="annotation-list">
        {annotations.map(ann => {
          const cls = getClassById ? getClassById(ann.bbox_class_id) : null;
          const isSelected = ann.id === selectedAnnotationId;

          return (
            <li
              key={ann.id}
              className={`annotation-list-item ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelectAnnotation && onSelectAnnotation(ann.id)}
            >
              <div className="annotation-item-header">
                <span
                  className="annotation-class-dot"
                  style={{ backgroundColor: cls ? cls.color : '#ccc' }}
                />
                <span className="annotation-class-name">
                  {cls ? cls.name : 'Unknown'}
                </span>
                <span className={`review-status-badge status-${ann.review_status}`}>
                  {ann.review_status}
                </span>
              </div>
              <div className="annotation-item-coords">
                ({Math.round(ann.x_min)}, {Math.round(ann.y_min)}) -
                ({Math.round(ann.x_max)}, {Math.round(ann.y_max)})
              </div>
              {ann.notes && (
                <div className="annotation-item-notes">{ann.notes}</div>
              )}
              <div className="annotation-item-actions">
                {onDeleteAnnotation && (
                  <button
                    className="btn btn-small btn-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteAnnotation(ann.id);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
              {showReviewControls && isSelected && (
                <AnnotationReviewControls
                  annotation={ann}
                  onReviewSubmit={onAnnotationReviewed}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default AnnotationListPanel;
