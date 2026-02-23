import React from 'react';

function UserAnnotationOverlay({
  annotations,
  getClassById,
  imageWidth,
  imageHeight,
  displayWidth,
  displayHeight,
  selectedAnnotationId,
  onAnnotationClick,
}) {
  if (!annotations || !annotations.length) return null;
  if (!displayWidth || !displayHeight) return null;

  const scaleX = displayWidth / (imageWidth || 1);
  const scaleY = displayHeight / (imageHeight || 1);

  return (
    <div className="user-annotation-overlay" style={{ width: displayWidth, height: displayHeight }}>
      {annotations.map(ann => {
        const cls = getClassById ? getClassById(ann.bbox_class_id) : null;
        const color = cls ? cls.color : '#FF0000';
        const isSelected = ann.id === selectedAnnotationId;

        const left = ann.x_min * scaleX;
        const top = ann.y_min * scaleY;
        const width = (ann.x_max - ann.x_min) * scaleX;
        const height = (ann.y_max - ann.y_min) * scaleY;

        const statusIndicator = {
          pending: '',
          approved: ' [OK]',
          rejected: ' [X]',
          flagged: ' [!]',
        }[ann.review_status] || '';

        return (
          <div
            key={ann.id}
            className={`user-annotation-box ${isSelected ? 'selected' : ''}`}
            style={{
              left: `${left}px`,
              top: `${top}px`,
              width: `${width}px`,
              height: `${height}px`,
              borderColor: color,
              borderWidth: isSelected ? '3px' : '2px',
            }}
            onClick={() => onAnnotationClick && onAnnotationClick(ann.id)}
            title={`${cls ? cls.name : 'Unknown'}${statusIndicator}`}
          >
            <span
              className="user-annotation-label"
              style={{ backgroundColor: color }}
            >
              {cls ? cls.name : '?'}{statusIndicator}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default UserAnnotationOverlay;
