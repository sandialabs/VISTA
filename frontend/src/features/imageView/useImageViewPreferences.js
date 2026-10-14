import { useEffect, useState } from 'react';

const DEFAULT_OVERLAY_OPTIONS = Object.freeze({
  showBoxes: true,
  showHeatmap: false,
  opacity: 0.7,
  viewMode: 'overlay',
  bitmapAvailable: false,
});

export default function useImageViewPreferences() {
  const [skipDeletedImages, setSkipDeletedImages] = useState(() => {
    const saved = localStorage.getItem('skipDeletedImages');
    return saved !== null ? JSON.parse(saved) : true;
  });

  const [overlayOptions, setOverlayOptions] = useState(() => {
    const saved = localStorage.getItem('mlOverlayOptions');
    if (saved) {
      try {
        return { ...JSON.parse(saved), bitmapAvailable: false };
      } catch (error) {
        console.error('Failed to parse saved overlay options:', error);
      }
    }
    return DEFAULT_OVERLAY_OPTIONS;
  });

  const [autoSelectLatest, setAutoSelectLatest] = useState(() => {
    const saved = localStorage.getItem('mlAutoSelectLatest');
    return saved === 'true' || saved === null;
  });

  useEffect(() => {
    localStorage.setItem('skipDeletedImages', JSON.stringify(skipDeletedImages));
  }, [skipDeletedImages]);

  useEffect(() => {
    const { bitmapAvailable, ...persistentOptions } = overlayOptions;
    localStorage.setItem('mlOverlayOptions', JSON.stringify(persistentOptions));
  }, [overlayOptions]);

  useEffect(() => {
    localStorage.setItem('mlAutoSelectLatest', autoSelectLatest.toString());
  }, [autoSelectLatest]);

  return {
    autoSelectLatest,
    overlayOptions,
    setAutoSelectLatest,
    setOverlayOptions,
    setSkipDeletedImages,
    skipDeletedImages,
  };
}
