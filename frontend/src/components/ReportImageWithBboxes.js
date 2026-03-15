import React, { useState, useRef } from 'react';

/**
 * ReportImageWithBboxes
 * Renders a report thumbnail with bounding box annotation overlays.
 * Used in ProjectReport to visualize annotations on exported images.
 */
function ReportImageWithBboxes({ image, fullWidth, annotations, bboxClassMap }) {
  const [imgSize, setImgSize] = useState(null);
  const imgRef = useRef(null);

  const handleLoad = () => {
    if (imgRef.current) {
      setImgSize({
        width: imgRef.current.clientWidth,
        height: imgRef.current.clientHeight,
      });
    }
  };

  const src = fullWidth
    ? (image.content_type === 'image/tiff'
      ? `/api/images/${image.id}/thumbnail?width=800&height=800`
      : `/api/images/${image.id}/content`)
    : `/api/images/${image.id}/thumbnail?width=300&height=300`;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <img
        ref={imgRef}
        src={src}
        alt={image.filename || 'Image'}
        className="report-image"
        onLoad={handleLoad}
        onError={(e) => {
          if (!e.target.src.includes('/content')) {
            e.target.src = `/api/images/${image.id}/content`;
          }
        }}
      />
      {imgSize && annotations.length > 0 && annotations.map((ann, idx) => {
        const iw = ann.image_width || 1;
        const ih = ann.image_height || 1;
        const scaleX = imgSize.width / iw;
        const scaleY = imgSize.height / ih;
        const cls = bboxClassMap[ann.bbox_class_id];
        const color = cls?.color || '#FF9800';
        const name = cls?.name || 'Unknown';
        const left = ann.bbox_x_min * scaleX;
        const top = ann.bbox_y_min * scaleY;
        const width = (ann.bbox_x_max - ann.bbox_x_min) * scaleX;
        const height = (ann.bbox_y_max - ann.bbox_y_min) * scaleY;

        return (
          <div key={ann.id || idx} style={{
            position: 'absolute',
            left, top, width, height,
            border: `2px solid ${color}`,
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}>
            <span style={{
              position: 'absolute',
              left: 0,
              top: -14,
              background: color,
              color: '#fff',
              fontSize: 9,
              padding: '0 3px',
              borderRadius: 2,
              whiteSpace: 'nowrap',
              lineHeight: '14px',
            }}>
              {name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default ReportImageWithBboxes;
