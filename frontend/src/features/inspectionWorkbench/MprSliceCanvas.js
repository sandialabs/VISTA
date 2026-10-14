import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { getScaledIndex } from './mprGeometry';
import { isServerVolumeDescriptor, getMprAxisImageDimensions } from './volumeDescriptors';
import {
  shouldApplyDisplayWindowToVolumeCache,
  drawMprOverlaySlice,
  brightenMprOverlaySlice,
  beginServerMprSlicePrefetch,
  invalidateServerMprSliceGeneration,
  getServerVolumePrefetchSources,
  requestServerMprSliceCanvas,
  getCachedMprSliceCanvas,
} from './mprSliceCache';
import { formatWindowValue, applyDisplayWindowToCanvasContext } from './displayDomain';

export const MprSliceCanvas = React.forwardRef(function MprSliceCanvas({
  axis,
  volumeCache,
  overlayCaches = [],
  volumeCacheStatus,
  slicePosition,
  dimensions,
  displayWindow,
  displayDomain,
  overlayOpacityMultiplier = 1,
  highlightedOverlayResourceId = '',
  className = '',
  ...canvasProps
}, externalRef) {
  const canvasRef = useRef(null);
  const serverSliceRequestVersionRef = useRef(0);
  const [serverSliceRevision, setServerSliceRevision] = useState(0);
  const [serverSliceStatus, setServerSliceStatus] = useState('idle');
  const relevantSlicePosition = slicePosition[axis];
  const relevantAxisLength = Number(dimensions?.[axis]) || 1;
  const fallbackDimensions = getMprAxisImageDimensions(axis, dimensions, volumeCache);
  const serverVolumeCaches = [volumeCache, ...overlayCaches].filter(isServerVolumeDescriptor);
  const serverVolumeCachesRef = useRef(serverVolumeCaches);
  serverVolumeCachesRef.current = serverVolumeCaches;
  const serverVolumeCacheKey = serverVolumeCaches.map((cache) => cache.key).join('|');
  const setCanvasRef = useCallback((node) => {
    canvasRef.current = node;
    if (typeof externalRef === 'function') externalRef(node);
    else if (externalRef) externalRef.current = node;
  }, [externalRef]);

  useEffect(() => {
    const serverCaches = serverVolumeCachesRef.current;
    if (serverCaches.length === 0) {
      setServerSliceStatus('idle');
      return undefined;
    }
    if (typeof window !== 'undefined' && /jsdom/i.test(window.navigator?.userAgent || '')) {
      return undefined;
    }

    const requestVersion = serverSliceRequestVersionRef.current + 1;
    serverSliceRequestVersionRef.current = requestVersion;
    let stale = false;
    const hasServerBase = isServerVolumeDescriptor(volumeCache);
    setServerSliceStatus(hasServerBase ? 'loading' : 'ready');
    const sourceMax = Math.max(0, relevantAxisLength - 1);
    const sourceGroups = serverCaches.map((cache) => {
      const cacheIndex = getScaledIndex(
        relevantSlicePosition,
        sourceMax,
        Number(cache.dimensions?.[axis]) || 1,
      );
      return {
        prefetchGeneration: beginServerMprSlicePrefetch(cache, axis, cacheIndex),
        sources: getServerVolumePrefetchSources(cache, axis, cacheIndex),
      };
    });
    const currentRequests = sourceGroups.map((group, index) => (
      requestServerMprSliceCanvas(serverCaches[index], group.sources[0], {
        priority: true,
        currentGeneration: group.prefetchGeneration,
      })
    ));
    Promise.allSettled(currentRequests).then(() => {
      if (stale || serverSliceRequestVersionRef.current !== requestVersion) return;
      sourceGroups.forEach((group, cacheIndex) => {
        group.sources.slice(1).forEach((source) => {
          requestServerMprSliceCanvas(serverCaches[cacheIndex], source, {
            prefetchGeneration: group.prefetchGeneration,
          }).catch(() => {});
        });
      });
    });

    currentRequests.forEach((request, index) => {
      request.then(() => {
        if (stale || serverSliceRequestVersionRef.current !== requestVersion) return;
        if (hasServerBase && index === 0) setServerSliceStatus('ready');
        setServerSliceRevision((previous) => previous + 1);
      }).catch(() => {
        if (stale || serverSliceRequestVersionRef.current !== requestVersion) return;
        if (hasServerBase && index === 0) setServerSliceStatus('error');
      });
    });

    return () => {
      stale = true;
      serverCaches.forEach((cache) => invalidateServerMprSliceGeneration(cache, axis));
    };
  }, [axis, relevantAxisLength, relevantSlicePosition, serverVolumeCacheKey, volumeCache]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !volumeCache) return undefined;
    if (typeof window !== 'undefined' && /jsdom/i.test(window.navigator?.userAgent || '')) {
      return undefined;
    }
    const safeGetContext = () => {
      try {
        return typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      } catch (_) {
        return null;
      }
    };
    const ctx = safeGetContext();
    if (!ctx) return undefined;

    const sliceCanvas = getCachedMprSliceCanvas(axis, slicePosition, dimensions, volumeCache);
    if (!sliceCanvas) {
      canvas.width = fallbackDimensions.width;
      canvas.height = fallbackDimensions.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return undefined;
    }
    canvas.width = sliceCanvas.width || 1;
    canvas.height = sliceCanvas.height || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sliceCanvas, 0, 0, canvas.width, canvas.height);
    if (shouldApplyDisplayWindowToVolumeCache(volumeCache)) {
      applyDisplayWindowToCanvasContext(ctx, canvas.width, canvas.height, displayWindow, displayDomain);
    }
    overlayCaches.forEach((overlayCache) => {
      const overlaySliceCanvas = getCachedMprSliceCanvas(axis, slicePosition, dimensions, overlayCache);
      if (!overlaySliceCanvas) return;
      const isHighlighted = highlightedOverlayResourceId
        && String(overlayCache?.imageId || overlayCache?.id || '') === String(highlightedOverlayResourceId);
      drawMprOverlaySlice(
        ctx,
        overlaySliceCanvas,
        overlayCache,
        canvas.width,
        canvas.height,
      );
      if (isHighlighted) {
        brightenMprOverlaySlice(
          ctx,
          overlaySliceCanvas,
          overlayCache,
          canvas.width,
          canvas.height,
        );
      }
    });
    return undefined;
  }, [axis, dimensions, displayDomain, displayWindow, fallbackDimensions.height, fallbackDimensions.width, highlightedOverlayResourceId, overlayCaches, relevantSlicePosition, serverSliceRevision, slicePosition, volumeCache]);

  return (
    <canvas
      {...canvasProps}
      ref={setCanvasRef}
      className={`mpr-slice-canvas ${className}`.trim()}
      width={fallbackDimensions.width}
      height={fallbackDimensions.height}
      role={canvasProps.role || (canvasProps['aria-label'] ? 'img' : undefined)}
      aria-hidden={canvasProps['aria-label'] ? undefined : true}
      data-mpr-axis={axis}
      data-mpr-slice-index={relevantSlicePosition}
      data-volume-cache-status={volumeCacheStatus}
      data-slice-load-status={serverSliceStatus}
      data-volume-color-mode={volumeCache?.colorMode || ''}
      data-overlay-color-modes={overlayCaches.map((cache) => cache?.colorMode || '').filter(Boolean).join(',')}
      data-display-window={`${formatWindowValue(displayWindow?.min ?? 0)}-${formatWindowValue(displayWindow?.max ?? 255)}`}
      data-display-domain={`${formatWindowValue(displayDomain?.min ?? 0)}-${formatWindowValue(displayDomain?.max ?? 255)}`}
    />
  );
});
