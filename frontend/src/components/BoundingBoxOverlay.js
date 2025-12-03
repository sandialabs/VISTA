import React, { useMemo } from 'react';

/**
 * BoundingBoxOverlay
 * Renders bounding box annotations over the image using absolutely positioned divs.
 * Expects annotations with annotation_type === 'bounding_box' and data containing:
 *   { x_min, y_min, x_max, y_max, image_width, image_height }
 * Props:
 *  - annotations: array
 *  - naturalSize: { width, height } original image dims (fallback to data fields)
 *  - containerSize: { width, height } displayed size (after scaling)
 *  - opacity: overlay opacity
 */
export default function BoundingBoxOverlay({ annotations, naturalSize, containerSize, opacity }) {
  const boxes = useMemo(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[BoundingBoxOverlay] Rendering with:', {
        naturalSize,
        containerSize,
        annotationCount: annotations?.length || 0
      });
    }

    return (annotations || [])
      .filter(a => a.annotation_type === 'bounding_box' && a.data)
      .map((a, idx) => {
        const d = a.data || {}; // Defensive
        const iw = d.image_width || naturalSize.width || containerSize.width;
        const ih = d.image_height || naturalSize.height || containerSize.height;

        if (process.env.NODE_ENV === 'development') {
          console.log(`[BoundingBoxOverlay] Box ${idx}:`, {
            bbox_data: d,
            resolved_image_dims: { width: iw, height: ih },
            naturalSize,
            containerSize
          });
        }

        if (!iw || !ih) return null;
        const xMin = d.x_min ?? d.left ?? 0;
        const yMin = d.y_min ?? d.top ?? 0;
        const xMax = d.x_max ?? (d.right != null ? d.right : xMin);
        const yMax = d.y_max ?? (d.bottom != null ? d.bottom : yMin);
        const w = Math.max(0, xMax - xMin);
        const h = Math.max(0, yMax - yMin);
        const scaleX = containerSize.width / iw;
        const scaleY = containerSize.height / ih;

        if (process.env.NODE_ENV === 'development') {
          console.log(`[BoundingBoxOverlay] Box ${idx} scaling:`, {
            original_coords: { xMin, yMin, xMax, yMax, w, h },
            scales: { scaleX, scaleY },
            scaled_coords: {
              left: xMin * scaleX,
              top: yMin * scaleY,
              width: w * scaleX,
              height: h * scaleY
            }
          });
        }

        return {
          id: a.id,
            class_name: a.class_name,
            confidence: a.confidence,
            left: xMin * scaleX,
            top: yMin * scaleY,
            width: w * scaleX,
            height: h * scaleY
        };
      })
      .filter(Boolean);
  }, [annotations, naturalSize, containerSize]);

  if (!boxes.length) return null;

  return (
    <div className="bbox-overlay" style={{ position: 'absolute', left: 0, top: 0, width: containerSize.width, height: containerSize.height, pointerEvents: 'none', opacity }}>
      {boxes.map(b => (
        <div key={b.id} style={{
          position: 'absolute',
          left: b.left,
          top: b.top,
          width: b.width,
          height: b.height,
          border: '2px solid #ff9800',
          boxSizing: 'border-box',
          background: 'rgba(255,152,0,0.10)'
        }}>
          {(b.class_name || b.confidence != null) && (
            <div style={{
              position: 'absolute',
              left: 0,
              top: -18,
              background: '#ff9800',
              color: '#fff',
              fontSize: 11,
              padding: '1px 4px',
              borderRadius: 3,
              maxWidth: 160,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {b.class_name || 'object'}{b.confidence != null && ` ${(b.confidence*100).toFixed(1)}%`}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
