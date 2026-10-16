import {
  clampFullscreenZoomScale,
  DEFAULT_FULLSCREEN_IMAGE_ZOOM,
  getNextFullscreenPanZoom,
  getNextFullscreenZoom,
} from '../useFullscreenImageViewport';

describe('fullscreen image viewport helpers', () => {
  test('clamps fullscreen zoom scale to the configured range', () => {
    expect(clampFullscreenZoomScale(0.5, 1, 8)).toBe(1);
    expect(clampFullscreenZoomScale(10, 1, 8)).toBe(8);
    expect(clampFullscreenZoomScale(2.5, 1, 8)).toBe(2.5);
    expect(clampFullscreenZoomScale('invalid', 1, 8)).toBe(1);
  });

  test('zooms around the pointer while preserving existing pan offsets', () => {
    const zoom = getNextFullscreenZoom({
      currentZoom: { ...DEFAULT_FULLSCREEN_IMAGE_ZOOM, scale: 2, panX: 12, panY: -8 },
      direction: 1,
      position: {
        displayX: 25,
        displayY: 75,
        rect: { width: 100, height: 150 },
      },
      minScale: 1,
      maxScale: 8,
    });

    expect(zoom).toEqual({
      scale: 2.3,
      originX: 25,
      originY: 50,
      panX: 12,
      panY: -8,
    });
  });

  test('reduces zoom no lower than the minimum scale', () => {
    const zoom = getNextFullscreenZoom({
      currentZoom: { ...DEFAULT_FULLSCREEN_IMAGE_ZOOM, scale: 1 },
      direction: -1,
      position: {
        displayX: 50,
        displayY: 50,
        rect: { width: 100, height: 100 },
      },
      minScale: 1,
      maxScale: 8,
    });

    expect(zoom.scale).toBe(1);
  });

  test('applies pointer movement to fullscreen pan offsets', () => {
    expect(getNextFullscreenPanZoom(
      { ...DEFAULT_FULLSCREEN_IMAGE_ZOOM, panX: 3, panY: 4 },
      { startPanX: 10, startPanY: -5, startClientX: 100, startClientY: 50 },
      { clientX: 125, clientY: 40 },
    )).toEqual({
      ...DEFAULT_FULLSCREEN_IMAGE_ZOOM,
      panX: 35,
      panY: -15,
    });
  });
});
