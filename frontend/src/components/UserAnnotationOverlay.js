import React, { useMemo, useState, useRef, useCallback } from 'react';

/**
 * UserAnnotationOverlay
 * Renders user-drawn bounding box annotations over the image.
 * Color-coded by bbox class color, with interactive selection and resize.
 */
export default function UserAnnotationOverlay({
  annotations,
  naturalSize,
  containerSize,
  opacity,
  selectedAnnotationId,
  onSelectAnnotation,
  onAnnotationUpdate,
  visible
}) {
  const [resizing, setResizing] = useState(null);
  const overlayRef = useRef(null);
  const resizeStartRef = useRef(null);

  const boxes = useMemo(() => {
    return (annotations || []).map((a) => {
      const iw = a.image_width || naturalSize.width || containerSize.width;
      const ih = a.image_height || naturalSize.height || containerSize.height;
      if (!iw || !ih) return null;

      const xMin = a.bbox_x_min ?? 0;
      const yMin = a.bbox_y_min ?? 0;
      const xMax = a.bbox_x_max ?? xMin;
      const yMax = a.bbox_y_max ?? yMin;
      const scaleX = containerSize.width / iw;
      const scaleY = containerSize.height / ih;

      return {
        id: a.id,
        class_name: a.class_name || 'Annotation',
        class_color: a.class_color || '#4CAF50',
        left: xMin * scaleX,
        top: yMin * scaleY,
        right: xMax * scaleX,
        bottom: yMax * scaleY,
        width: (xMax - xMin) * scaleX,
        height: (yMax - yMin) * scaleY,
        // Keep image-space coords for update
        img_xMin: xMin, img_yMin: yMin, img_xMax: xMax, img_yMax: yMax,
        img_w: iw, img_h: ih,
      };
    }).filter(Boolean);
  }, [annotations, naturalSize, containerSize]);

  const handleResizeStart = useCallback((e, boxId, handle) => {
    e.stopPropagation();
    e.preventDefault();
    const box = boxes.find(b => b.id === boxId);
    if (!box) return;
    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      handle,
      origLeft: box.left,
      origTop: box.top,
      origRight: box.right,
      origBottom: box.bottom,
      boxId,
      imgW: box.img_w,
      imgH: box.img_h,
    };
    setResizing(boxId);
  }, [boxes]);

  const handleResizeMove = useCallback((e) => {
    if (!resizing || !resizeStartRef.current) return;
    const ref = resizeStartRef.current;
    const dx = e.clientX - ref.mouseX;
    const dy = e.clientY - ref.mouseY;
    const h = ref.handle;

    let newLeft = ref.origLeft;
    let newTop = ref.origTop;
    let newRight = ref.origRight;
    let newBottom = ref.origBottom;

    if (h.includes('left')) newLeft = Math.min(ref.origRight - 8, ref.origLeft + dx);
    if (h.includes('right')) newRight = Math.max(ref.origLeft + 8, ref.origRight + dx);
    if (h.includes('top')) newTop = Math.min(ref.origBottom - 8, ref.origTop + dy);
    if (h.includes('bottom')) newBottom = Math.max(ref.origTop + 8, ref.origBottom + dy);

    // Clamp to container
    newLeft = Math.max(0, newLeft);
    newTop = Math.max(0, newTop);
    newRight = Math.min(containerSize.width, newRight);
    newBottom = Math.min(containerSize.height, newBottom);

    resizeStartRef.current.currentLeft = newLeft;
    resizeStartRef.current.currentTop = newTop;
    resizeStartRef.current.currentRight = newRight;
    resizeStartRef.current.currentBottom = newBottom;

    // Update visual position via DOM for smooth feedback
    const el = overlayRef.current?.querySelector(`[data-box-id="${ref.boxId}"]`);
    if (el) {
      el.style.left = `${newLeft}px`;
      el.style.top = `${newTop}px`;
      el.style.width = `${newRight - newLeft}px`;
      el.style.height = `${newBottom - newTop}px`;
    }
  }, [resizing, containerSize]);

  const handleResizeEnd = useCallback(() => {
    if (!resizing || !resizeStartRef.current) {
      setResizing(null);
      return;
    }
    const ref = resizeStartRef.current;
    const left = ref.currentLeft ?? ref.origLeft;
    const top = ref.currentTop ?? ref.origTop;
    const right = ref.currentRight ?? ref.origRight;
    const bottom = ref.currentBottom ?? ref.origBottom;

    // Convert display coords back to image coords
    const scaleX = ref.imgW / containerSize.width;
    const scaleY = ref.imgH / containerSize.height;

    if (onAnnotationUpdate) {
      onAnnotationUpdate(ref.boxId, {
        bbox_x_min: left * scaleX,
        bbox_y_min: top * scaleY,
        bbox_x_max: right * scaleX,
        bbox_y_max: bottom * scaleY,
        image_width: ref.imgW,
        image_height: ref.imgH,
      });
    }
    setResizing(null);
    resizeStartRef.current = null;
  }, [resizing, containerSize, onAnnotationUpdate]);

  // Attach document-level listeners during resize
  React.useEffect(() => {
    if (!resizing) return;
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [resizing, handleResizeMove, handleResizeEnd]);

  if (!visible || !boxes.length) return null;

  const handleBoxClick = (e, boxId) => {
    e.stopPropagation();
    if (onSelectAnnotation) {
      onSelectAnnotation(boxId);
    }
  };

  const HANDLE_SIZE = 10;

  const handles = [
    { name: 'top-left', cursor: 'nwse-resize', x: 0, y: 0 },
    { name: 'top-right', cursor: 'nesw-resize', x: 1, y: 0 },
    { name: 'bottom-left', cursor: 'nesw-resize', x: 0, y: 1 },
    { name: 'bottom-right', cursor: 'nwse-resize', x: 1, y: 1 },
    { name: 'top', cursor: 'ns-resize', x: 0.5, y: 0 },
    { name: 'bottom', cursor: 'ns-resize', x: 0.5, y: 1 },
    { name: 'left', cursor: 'ew-resize', x: 0, y: 0.5 },
    { name: 'right', cursor: 'ew-resize', x: 1, y: 0.5 },
  ];

  return (
    <div
      ref={overlayRef}
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
            data-box-id={b.id}
            onClick={(e) => handleBoxClick(e, b.id)}
            style={{
              position: 'absolute',
              left: b.left,
              top: b.top,
              width: b.width,
              height: b.height,
              border: isSelected
                ? `3px solid ${color}`
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
            {isSelected && handles.map(h => (
              <div
                key={h.name}
                onMouseDown={(e) => handleResizeStart(e, b.id, h.name)}
                style={{
                  position: 'absolute',
                  width: HANDLE_SIZE,
                  height: HANDLE_SIZE,
                  background: '#fff',
                  border: `2px solid ${color}`,
                  borderRadius: 2,
                  left: `calc(${h.x * 100}% - ${HANDLE_SIZE / 2}px)`,
                  top: `calc(${h.y * 100}% - ${HANDLE_SIZE / 2}px)`,
                  cursor: h.cursor,
                  pointerEvents: 'auto',
                  zIndex: 10,
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
