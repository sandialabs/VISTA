import React, { useMemo } from 'react';

/**
 * UserAnnotationOverlay
 * Renders user-drawn bounding box annotations over the image.
 * Color-coded by bbox class color, with interactive selection.
 * Props:
 *  - annotations: array of {id, bbox_x_min, bbox_y_min, bbox_x_max, bbox_y_max, image_width, image_height, class_name, class_color, ...}
 *  - naturalSize: {width, height}
 *  - containerSize: {width, height}
 *  - opacity: number
 *  - selectedAnnotationId: string|null
 *  - onSelectAnnotation: function(annotationId)
 *  - visible: boolean
 */
export default function UserAnnotationOverlay({
  annotations,
  naturalSize,
  containerSize,
  opacity,
  selectedAnnotationId,
  onSelectAnnotation,
  visible
}) {
  const boxes = useMemo(() => {
    return (annotations || []).map((a) => {
      const iw = a.image_width || naturalSize.width || containerSize.width;
      const ih = a.image_height || naturalSize.height || containerSize.height;
      if (!iw || !ih) return null;

      const xMin = a.bbox_x_min ?? 0;
      const yMin = a.bbox_y_min ?? 0;
      const xMax = a.bbox_x_max ?? xMin;
      const yMax = a.bbox_y_max ?? yMin;
      const w = Math.max(0, xMax - xMin);
      const h = Math.max(0, yMax - yMin);
      const scaleX = containerSize.width / iw;
      const scaleY = containerSize.height / ih;

      return {
        id: a.id,
        class_name: a.class_name || 'Annotation',
        class_color: a.class_color || '#4CAF50',
        left: xMin * scaleX,
        top: yMin * scaleY,
        width: w * scaleX,
        height: h * scaleY
      };
    }).filter(Boolean);
  }, [annotations, naturalSize, containerSize]);

  if (!visible || !boxes.length) return null;

  const handleBoxClick = (e, boxId) => {
    e.stopPropagation();
    if (onSelectAnnotation) {
      onSelectAnnotation(boxId);
    }
  };

  return (
    <div
      className="user-annotation-overlay"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: containerSize.width,
        height: containerSize.height,
        pointerEvents: 'none',
        opacity
      }}
    >
      {boxes.map(b => {
        const isSelected = selectedAnnotationId === b.id;
        const color = b.class_color;

        return (
          <div
            key={b.id}
            onClick={(e) => handleBoxClick(e, b.id)}
            style={{
              position: 'absolute',
              left: b.left,
              top: b.top,
              width: b.width,
              height: b.height,
              border: isSelected
                ? `3px dashed ${color}`
                : `2px solid ${color}`,
              boxSizing: 'border-box',
              background: `${color}10`,
              cursor: 'pointer',
              pointerEvents: 'auto'
            }}
          >
            {/* Label */}
            <div style={{
              position: 'absolute',
              left: 0,
              top: -18,
              background: color,
              color: '#fff',
              fontSize: 11,
              padding: '1px 4px',
              borderRadius: 3,
              maxWidth: 160,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {b.class_name}
            </div>
            {/* Resize handles when selected */}
            {isSelected && (
              <>
                <div style={handleStyle(color, 'top', 'left')} />
                <div style={handleStyle(color, 'top', 'right')} />
                <div style={handleStyle(color, 'bottom', 'left')} />
                <div style={handleStyle(color, 'bottom', 'right')} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function handleStyle(color, vertical, horizontal) {
  return {
    position: 'absolute',
    width: 8,
    height: 8,
    background: '#fff',
    border: `2px solid ${color}`,
    borderRadius: 2,
    [vertical]: -4,
    [horizontal]: -4,
    pointerEvents: 'none'
  };
}
