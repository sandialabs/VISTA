import React, { useState, useEffect } from 'react';

/**
 * HeatmapOverlay
 * Renders heatmap/segmentation mask images from storage_path.
 * Lazy-loads the image using presigned URLs from the backend.
 * Props:
 *  - annotations: array of annotations (filters for heatmap/segmentation/mask types)
 *  - containerSize: { width, height } displayed size
 *  - opacity: overlay opacity
 */
export default function HeatmapOverlay({ annotations, containerSize, opacity }) {
  const [heatmapUrl, setHeatmapUrl] = useState(null);
  const [error, setError] = useState(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    // Reset state when annotations change
    setError(null);
    setImageLoaded(false);

    // Find first heatmap/segmentation/mask annotation with storage_path
    const heatmapAnnotation = (annotations || []).find(a =>
      ['heatmap', 'segmentation', 'mask'].includes(a.annotation_type) && a.storage_path
    );

    if (!heatmapAnnotation) {
      setHeatmapUrl(null);
      return;
    }

    // Load heatmap directly - rely on image onError for handling failures
    const proxyUrl = `/api/ml/artifacts/content?path=${encodeURIComponent(heatmapAnnotation.storage_path)}`;
    console.log('[HeatmapOverlay] Loading heatmap for storage_path:', heatmapAnnotation.storage_path);
    setHeatmapUrl(proxyUrl);
  }, [annotations]);

  if (error) {
    return (
      <div style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: containerSize.width,
        height: containerSize.height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(255,0,0,0.1)',
        pointerEvents: 'none'
      }}>
        <span style={{ color: '#c00', fontSize: 11 }}>Heatmap load failed</span>
      </div>
    );
  }

  if (!heatmapUrl) {
    return null;
  }

  return (
    <div
      className="heatmap-overlay"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: containerSize.width,
        height: containerSize.height,
        pointerEvents: 'none',
        opacity: imageLoaded ? opacity : 0
      }}
    >
      <img
        src={heatmapUrl}
        alt="ML Heatmap"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          mixBlendMode: 'screen',
          display: imageLoaded ? 'block' : 'none'
        }}
        onLoad={() => {
          console.log('[HeatmapOverlay] Heatmap loaded successfully');
          setImageLoaded(true);
        }}
        onError={(e) => {
          console.error('[HeatmapOverlay] Failed to load heatmap image:', e);
          setError('Failed to load heatmap image');
        }}
      />
      {!imageLoaded && !error && (
        <div style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.1)'
        }}>
          <span style={{ color: '#fff', fontSize: 12 }}>Loading heatmap...</span>
        </div>
      )}
    </div>
  );
}
