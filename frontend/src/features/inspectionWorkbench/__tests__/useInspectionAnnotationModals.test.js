import { act, renderHook } from '@testing-library/react';

import useInspectionAnnotationModals, {
  getAnnotationEditDraft,
  getDefaultAnnotationDraft,
} from '../useInspectionAnnotationModals';

function createHookProps(overrides = {}) {
  return {
    enabledModalities: ['infrared'],
    inspectionAnnotationItems: [],
    modalityOptions: ['visual'],
    setSelectedAnnotationId: jest.fn(),
    setSelectedImageRef: jest.fn(),
    setSelectedInspectionItemKey: jest.fn(),
    ...overrides,
  };
}

describe('inspection annotation modal helpers', () => {
  test('builds a default annotation draft with modality fallback', () => {
    expect(getDefaultAnnotationDraft({ enabledModalities: ['uv'], modalityOptions: ['visual'] })).toMatchObject({
      defect_class: '',
      modality: 'uv',
      disposition: 'open',
      bbox: { x: '', y: '', width: '', height: '' },
    });
    expect(getDefaultAnnotationDraft({ enabledModalities: [], modalityOptions: ['visual'] }).modality).toBe('visual');
    expect(getDefaultAnnotationDraft({ enabledModalities: [], modalityOptions: [] }).modality).toBe('visual');
  });

  test('builds annotation edit drafts with normalized display fields', () => {
    expect(getAnnotationEditDraft({
      id: 'annotation-1',
      defect_class: ' Crack ',
      comment: 'Needs review',
      disposition: '',
      metadata: { annotation_color: '#123456', annotation_fill_opacity: 0.25 },
    })).toEqual({
      id: 'annotation-1',
      defect_class: 'Crack',
      comment: 'Needs review',
      disposition: 'open',
      color: '#123456',
      fill_opacity: 0.25,
      transparency_percent: 75,
    });
    expect(getAnnotationEditDraft({})).toBeNull();
  });
});

describe('useInspectionAnnotationModals', () => {
  test('opens and closes the create annotation modal with a reset draft', () => {
    const props = createHookProps();
    const { result } = renderHook(() => useInspectionAnnotationModals(props));

    act(() => {
      result.current.setAnnotationDraft((prev) => ({ ...prev, defect_class: 'Old' }));
    });
    expect(result.current.annotationDraft.defect_class).toBe('Old');

    act(() => {
      result.current.openOtherAnnotationModal();
    });
    expect(result.current.otherAnnotationModalVisible).toBe(true);
    expect(result.current.annotationDraft).toMatchObject({ defect_class: '', modality: 'infrared' });

    act(() => {
      result.current.closeOtherAnnotationModal();
    });
    expect(result.current.otherAnnotationModalVisible).toBe(false);
  });

  test('opens annotation edit modal and selects the matching annotation item', () => {
    const props = createHookProps({
      inspectionAnnotationItems: [
        { key: 'annotation:item-1', source: { resource: 'annotation', resourceId: 'annotation-1' } },
      ],
    });
    const { result } = renderHook(() => useInspectionAnnotationModals(props));

    act(() => {
      result.current.openAnnotationEditModal({
        id: 'annotation-1',
        defect_class: 'Void',
        metadata: { annotation_color: '#abcdef' },
      });
    });

    expect(props.setSelectedAnnotationId).toHaveBeenCalledWith('annotation-1');
    expect(props.setSelectedInspectionItemKey).toHaveBeenCalledWith('annotation:item-1');
    expect(result.current.annotationEditModalVisible).toBe(true);
    expect(result.current.annotationEditDraft).toMatchObject({ id: 'annotation-1', color: '#abcdef' });

    act(() => {
      result.current.closeAnnotationEditModal();
    });
    expect(result.current.annotationEditModalVisible).toBe(false);
    expect(result.current.annotationEditDraft).toBeNull();
  });

  test('opens external overlay config modal and selects overlay image refs', () => {
    const props = createHookProps();
    const item = {
      id: 'overlay-item',
      key: 'overlay:key',
      kind: 'external_overlay',
      color: '#a78bfa',
      overlay: { imageRef: 'image-ref', overlay_opacity: 0.5 },
      source: { resource: 'source_image', resourceId: 'overlay-1' },
    };
    const { result } = renderHook(() => useInspectionAnnotationModals(props));

    act(() => {
      result.current.openInspectionItemConfigModal(item);
    });
    expect(props.setSelectedInspectionItemKey).toHaveBeenCalledWith('overlay:key');
    expect(props.setSelectedAnnotationId).toHaveBeenCalledWith(null);
    expect(result.current.annotationEditDraft).toMatchObject({ resource: 'source_image', resourceId: 'overlay-1' });

    act(() => {
      result.current.selectInspectionAnnotationItem(item);
    });
    expect(props.setSelectedImageRef).toHaveBeenCalledWith('image-ref');
  });
});
