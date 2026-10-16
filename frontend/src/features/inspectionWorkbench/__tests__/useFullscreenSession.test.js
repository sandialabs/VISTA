import { act, renderHook } from '@testing-library/react';

import useFullscreenSession from '../useFullscreenSession';

const MPR_MODAL = {
  sourceKind: 'mpr',
  axis: 'axial',
  sliceIndex: 4,
  sliceKey: 'axial:4',
  backingImageId: '17',
  imageId: '17',
  label: 'Axial slice 4',
};

describe('useFullscreenSession', () => {
  test('opens a fullscreen tool and derives the backing image and slice key', () => {
    const { result } = renderHook(() => useFullscreenSession({ readOnly: false }));

    act(() => {
      result.current.setFullscreenCalibrationPromptVisible(true);
      result.current.openFullscreenTool(MPR_MODAL, 'measure');
    });

    expect(result.current.fullscreenImageModal).toEqual(MPR_MODAL);
    expect(result.current.fullscreenMeasureActive).toBe(true);
    expect(result.current.fullscreenBoxActive).toBe(false);
    expect(result.current.fullscreenCalibrationPromptVisible).toBe(false);
    expect(result.current.fullscreenBackingImageId).toBe('17');
    expect(result.current.fullscreenMprSliceKey).toBe('axial:4');
  });

  test('prompts for calibration and resumes measuring after calibration', () => {
    const { result } = renderHook(() => useFullscreenSession({ readOnly: false }));

    act(() => {
      result.current.openFullscreenTool({ sourceKind: 'image', imageId: '5', label: 'Image' }, 'box');
    });
    act(() => {
      result.current.promptFullscreenCalibration();
    });
    expect(result.current.fullscreenCalibrationPromptVisible).toBe(true);
    expect(result.current.fullscreenBoxActive).toBe(false);
    expect(result.current.fullscreenMprSliceKey).toBe('');

    act(() => {
      result.current.resumeFullscreenMeasure();
    });
    expect(result.current.fullscreenCalibrationPromptVisible).toBe(false);
    expect(result.current.fullscreenMeasureActive).toBe(true);
  });

  test('forgets a deleted annotation from session measurements and edits', () => {
    const { result } = renderHook(() => useFullscreenSession({ readOnly: false }));

    act(() => {
      result.current.setFullscreenMeasurements([{ id: 1 }, { id: 2 }]);
      result.current.setFullscreenBoundsEditAnnotationId(1);
      result.current.setFullscreenEditingEndpoint({ lineId: '1', endpoint: 'start' });
      result.current.setFullscreenEditingBoxCorner({ boxId: '2', corner: 'nw' });
    });
    act(() => {
      result.current.forgetFullscreenAnnotation('1');
    });

    expect(result.current.fullscreenMeasurements).toEqual([{ id: 2 }]);
    expect(result.current.fullscreenBoundsEditAnnotationId).toBeNull();
    expect(result.current.fullscreenEditingEndpoint).toBeNull();
    expect(result.current.fullscreenEditingBoxCorner).toEqual({ boxId: '2', corner: 'nw' });
  });

  test('closes the session and clears drag refs and tool state', () => {
    const { result } = renderHook(() => useFullscreenSession({ readOnly: false }));

    act(() => {
      result.current.openFullscreenTool(MPR_MODAL, 'box');
      result.current.setFullscreenCropActive(true);
      result.current.setFullscreenBoundsEditAnnotationId('9');
      result.current.setFullscreenDragPreview({ kind: 'box', geometry: { id: '9' } });
      result.current.fullscreenAnnotationDragRef.current = { pointerId: 1 };
    });
    expect(result.current.fullscreenGeometryDragPreviewRef.current).toEqual({ kind: 'box', geometry: { id: '9' } });

    act(() => {
      result.current.closeFullscreenSession();
    });

    expect(result.current.fullscreenImageModal).toBeNull();
    expect(result.current.fullscreenBoxActive).toBe(false);
    expect(result.current.fullscreenCropActive).toBe(false);
    expect(result.current.fullscreenBoundsEditAnnotationId).toBeNull();
    expect(result.current.fullscreenGeometryDragPreview).toBeNull();
    expect(result.current.fullscreenAnnotationDragRef.current).toBeNull();
    expect(result.current.fullscreenGeometryDragPreviewRef.current).toBeNull();
  });

  test('clears mutation-only tool state but keeps the open image when read-only is enabled', () => {
    const { result, rerender } = renderHook(
      (props) => useFullscreenSession(props),
      { initialProps: { readOnly: false } },
    );

    act(() => {
      result.current.openFullscreenTool(MPR_MODAL, 'measure');
      result.current.setFullscreenEditingEndpoint({ lineId: '3', endpoint: 'end' });
      result.current.setFullscreenDragPreview({ kind: 'line', geometry: { id: '3' } });
    });
    rerender({ readOnly: true });

    expect(result.current.fullscreenImageModal).toEqual(MPR_MODAL);
    expect(result.current.fullscreenMeasureActive).toBe(false);
    expect(result.current.fullscreenEditingEndpoint).toBeNull();
    expect(result.current.fullscreenGeometryDragPreview).toBeNull();
  });
});
