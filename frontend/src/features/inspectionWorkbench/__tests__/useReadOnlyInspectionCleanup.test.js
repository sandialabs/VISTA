import { renderHook } from '@testing-library/react';

import useReadOnlyInspectionCleanup from '../useReadOnlyInspectionCleanup';

function buildProps(readOnly = false) {
  return {
    readOnly,
    resetAnnotationDrafts: jest.fn(),
    setAnnotationEditModalVisible: jest.fn(),
    setAnnotationToolMode: jest.fn(),
    setMprGeometryDragPreview: jest.fn(),
    setOtherAnnotationModalVisible: jest.fn(),
    setTileCalibrationPromptImageId: jest.fn(),
    setTileGeometryDragPreview: jest.fn(),
  };
}

describe('useReadOnlyInspectionCleanup', () => {
  test('does not clear editing state when read-only mode is disabled', () => {
    const props = buildProps(false);

    renderHook(() => useReadOnlyInspectionCleanup(props));

    Object.entries(props)
      .filter(([key]) => key.startsWith('set') || key.startsWith('reset'))
      .forEach(([, setter]) => expect(setter).not.toHaveBeenCalled());
  });

  test('clears mutation-only inspection state when read-only mode is enabled', () => {
    const props = buildProps(true);

    renderHook(() => useReadOnlyInspectionCleanup(props));

    expect(props.setAnnotationToolMode).toHaveBeenCalledWith('');
    expect(props.setOtherAnnotationModalVisible).toHaveBeenCalledWith(false);
    expect(props.setAnnotationEditModalVisible).toHaveBeenCalledWith(false);
    expect(props.resetAnnotationDrafts).toHaveBeenCalledTimes(1);
    expect(props.setTileGeometryDragPreview).toHaveBeenCalledWith(null);
    expect(props.setMprGeometryDragPreview).toHaveBeenCalledWith(null);
    expect(props.setTileCalibrationPromptImageId).toHaveBeenCalledWith(null);
  });
});
