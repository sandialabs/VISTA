import { useEffect, useRef } from 'react';
import { formatWindowValue, applyDisplayWindowToCanvasContext } from './displayDomain';

export function MprWindowedImage({
  src,
  alt,
  className,
  draggable = false,
  onDragStart,
  style,
  displayWindow,
  displayDomain,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src) return undefined;
    if (typeof window !== 'undefined' && /jsdom/i.test(window.navigator?.userAgent || '')) {
      return undefined;
    }
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx) return undefined;

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const width = image.naturalWidth || image.width || 1;
      const height = image.naturalHeight || image.height || 1;
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      applyDisplayWindowToCanvasContext(ctx, width, height, displayWindow, displayDomain);
    };
    image.onerror = () => {
      if (cancelled) return;
      canvas.width = 1;
      canvas.height = 1;
      ctx.clearRect(0, 0, 1, 1);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [displayDomain, displayWindow, src]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={alt}
      draggable={draggable}
      onDragStart={onDragStart}
      style={style}
      data-display-window={`${formatWindowValue(displayWindow?.min ?? 0)}-${formatWindowValue(displayWindow?.max ?? 255)}`}
      data-display-domain={`${formatWindowValue(displayDomain?.min ?? 0)}-${formatWindowValue(displayDomain?.max ?? 255)}`}
    />
  );
}
