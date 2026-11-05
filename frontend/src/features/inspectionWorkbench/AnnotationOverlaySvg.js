import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getAnnotationOverlayFrame } from './annotationOverlayFrame';

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = (width, height) => {
      setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
    };
    update(element.clientWidth || 0, element.clientHeight || 0);
    if (typeof window === 'undefined' || typeof window.ResizeObserver !== 'function') return undefined;
    const observer = new window.ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) update(rect.width, rect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

// SVG overlay whose viewBox is the image's pixel size. renderContent(frame) draws
// annotations in design units (see annotationOverlayFrame.js) inside a uniformly
// scaled group; children are drawn directly in image-pixel coordinates.
export function AnnotationOverlaySvg({
  imageWidth,
  imageHeight,
  className = 'inspection-fullscreen-measurement-overlay',
  style,
  ariaLabel,
  renderContent,
  children,
}) {
  const svgRef = useRef(null);
  const containerSize = useElementSize(svgRef);
  const frame = useMemo(
    () => getAnnotationOverlayFrame(imageWidth, imageHeight, containerSize.width, containerSize.height),
    [imageWidth, imageHeight, containerSize.width, containerSize.height],
  );
  return (
    <svg
      ref={svgRef}
      className={className}
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="xMidYMid meet"
      style={style}
      aria-label={ariaLabel}
    >
      <g data-testid="annotation-overlay-content" transform={`scale(${frame.scale})`}>
        {renderContent ? renderContent(frame) : null}
      </g>
      {children}
    </svg>
  );
}
