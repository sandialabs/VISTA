import { act, renderHook } from '@testing-library/react';

import useInspectionWorkbenchLayoutMetrics, {
  getInitialViewportWidth,
  measureElementWidth,
} from '../useInspectionWorkbenchLayoutMetrics';

describe('useInspectionWorkbenchLayoutMetrics', () => {
  test('measures element widths using clientWidth before bounding rect fallback', () => {
    expect(measureElementWidth(null)).toBe(0);
    expect(measureElementWidth({
      clientWidth: 320,
      getBoundingClientRect: () => ({ width: 240 }),
    })).toBe(320);
    expect(measureElementWidth({
      clientWidth: 0,
      getBoundingClientRect: () => ({ width: 240.8 }),
    })).toBe(241);
    expect(measureElementWidth({
      clientWidth: 0,
      getBoundingClientRect: () => ({ width: -4 }),
    })).toBe(0);
  });

  test('initial viewport width follows window availability', () => {
    expect(getInitialViewportWidth()).toBe(window.innerWidth);
  });

  test('tracks viewport resize and observed workbench width', () => {
    const listeners = new Map();
    const originalResizeObserver = window.ResizeObserver;
    const disconnect = jest.fn();
    const observe = jest.fn();
    window.ResizeObserver = jest.fn((callback) => {
      listeners.set('resizeObserver', callback);
      return { disconnect, observe };
    });

    const { result, unmount } = renderHook(() => useInspectionWorkbenchLayoutMetrics());
    const element = {
      clientWidth: 640,
      getBoundingClientRect: () => ({ width: 640 }),
    };

    act(() => {
      result.current.workbenchDetailsRef(element);
    });

    expect(result.current.workbenchWidth).toBe(640);
    expect(observe).toHaveBeenCalledWith(element);

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1234,
    });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.viewportWidth).toBe(1234);

    element.clientWidth = 700;
    act(() => {
      listeners.get('resizeObserver')();
    });
    expect(result.current.workbenchWidth).toBe(700);

    unmount();
    expect(disconnect).toHaveBeenCalled();
    window.ResizeObserver = originalResizeObserver;
  });

  test('clears pending inspection resize persistence timer on unmount', () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(window, 'clearTimeout');
    const { result, unmount } = renderHook(() => useInspectionWorkbenchLayoutMetrics());
    const timeoutId = window.setTimeout(() => {}, 1000);
    result.current.inspectionResizeSaveTimerRef.current = timeoutId;

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutId);
    clearTimeoutSpy.mockRestore();
    jest.useRealTimers();
  });
});
