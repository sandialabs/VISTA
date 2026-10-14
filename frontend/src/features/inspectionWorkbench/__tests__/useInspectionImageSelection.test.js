import { act, renderHook } from '@testing-library/react';

import useInspectionImageSelection, {
  findFallbackInspectionImageRef,
} from '../useInspectionImageSelection';

describe('inspection image selection helpers', () => {
  test('finds the first available image ref as the fallback selection', () => {
    expect(findFallbackInspectionImageRef([{ imageRef: 'image-a' }, { imageRef: 'image-b' }])).toBe('image-a');
    expect(findFallbackInspectionImageRef([])).toBe('');
  });
});

describe('useInspectionImageSelection', () => {
  test('selects the first image when the current selected image is absent', () => {
    const { result, rerender } = renderHook((props) => useInspectionImageSelection(props), {
      initialProps: {
        selectedPartImageRefs: [{ imageRef: 'image-a', viewName: 'front' }],
      },
    });

    expect(result.current.selectedImageRef).toBe('image-a');

    act(() => {
      result.current.setSelectedImageRef('image-b');
    });
    rerender({
      selectedPartImageRefs: [{ imageRef: 'image-c', viewName: 'front' }],
    });

    expect(result.current.selectedImageRef).toBe('image-c');
  });

  test('clears selected image when no image refs are available', () => {
    const { result, rerender } = renderHook((props) => useInspectionImageSelection(props), {
      initialProps: {
        selectedPartImageRefs: [{ imageRef: 'image-a', viewName: 'front' }],
      },
    });

    expect(result.current.selectedImageRef).toBe('image-a');

    rerender({
      selectedPartImageRefs: [],
    });

    expect(result.current.selectedImageRef).toBe('');
  });
});
