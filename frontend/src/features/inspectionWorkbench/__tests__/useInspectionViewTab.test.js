import { act, renderHook } from '@testing-library/react';

import useInspectionViewTab from '../useInspectionViewTab';

describe('useInspectionViewTab', () => {
  test('starts on the configured default tab and exposes a setter', () => {
    const { result } = renderHook(() => useInspectionViewTab({
      allImagesTab: 'view_all_images',
      centerTabs: ['view_parts', 'mpr', 'view_all_images'],
      defaultTab: 'view_parts',
    }));

    expect(result.current.activeInspectionViewTab).toBe('view_parts');

    act(() => {
      result.current.setActiveInspectionViewTab('mpr');
    });

    expect(result.current.activeInspectionViewTab).toBe('mpr');
  });

  test('falls back to the first available center tab when the active tab is removed', () => {
    const { result, rerender } = renderHook(
      (props) => useInspectionViewTab(props),
      {
        initialProps: {
          allImagesTab: 'view_all_images',
          centerTabs: ['view_parts', 'mpr', 'view_all_images'],
          defaultTab: 'view_parts',
        },
      },
    );

    act(() => {
      result.current.setActiveInspectionViewTab('mpr');
    });
    expect(result.current.activeInspectionViewTab).toBe('mpr');

    rerender({
      allImagesTab: 'view_all_images',
      centerTabs: ['view_parts', 'view_all_images'],
      defaultTab: 'view_parts',
    });

    expect(result.current.activeInspectionViewTab).toBe('view_parts');
  });

  test('falls back to the all-images tab when no configured center tabs remain', () => {
    const { result, rerender } = renderHook(
      (props) => useInspectionViewTab(props),
      {
        initialProps: {
          allImagesTab: 'view_all_images',
          centerTabs: ['view_parts'],
          defaultTab: 'view_parts',
        },
      },
    );

    rerender({
      allImagesTab: 'view_all_images',
      centerTabs: [],
      defaultTab: 'view_parts',
    });

    expect(result.current.activeInspectionViewTab).toBe('view_all_images');
  });
});
