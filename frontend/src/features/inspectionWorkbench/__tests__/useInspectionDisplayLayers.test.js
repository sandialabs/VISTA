import { act, renderHook } from '@testing-library/react';

import useInspectionDisplayLayers, {
  DEFAULT_INSPECTION_RENDER_CATEGORIES,
  getAnnotationLayerVisible,
  getVolumeOverlayLayersVisible,
} from '../useInspectionDisplayLayers';

describe('inspection display layer helpers', () => {
  test('derives annotation layer visibility from project type and render categories', () => {
    expect(getAnnotationLayerVisible({
      annotationsVisible: true,
      projectType: 'PT1',
      renderCategories: ['source', 'annotation'],
    })).toBe(true);
    expect(getAnnotationLayerVisible({
      annotationsVisible: true,
      projectType: 'PT1',
      renderCategories: ['source'],
    })).toBe(false);
    expect(getAnnotationLayerVisible({
      annotationsVisible: true,
      projectType: 'PT3',
      renderCategories: ['source'],
    })).toBe(true);
    expect(getAnnotationLayerVisible({
      annotationsVisible: false,
      projectType: 'PT3',
      renderCategories: ['annotation'],
    })).toBe(false);
  });

  test('derives volume overlay visibility from annotation visibility and overlay category', () => {
    expect(getVolumeOverlayLayersVisible({
      annotationsVisible: true,
      projectType: 'PT1',
      renderCategories: ['overlay'],
    })).toBe(true);
    expect(getVolumeOverlayLayersVisible({
      annotationsVisible: true,
      projectType: 'PT1',
      renderCategories: ['source'],
    })).toBe(false);
    expect(getVolumeOverlayLayersVisible({
      annotationsVisible: true,
      projectType: 'PT3',
      renderCategories: ['source'],
    })).toBe(true);
  });
});

describe('useInspectionDisplayLayers', () => {
  test('initializes display layer defaults', () => {
    const { result } = renderHook(() => useInspectionDisplayLayers({ projectType: 'PT1' }));

    expect(result.current.renderCategories).toEqual(DEFAULT_INSPECTION_RENDER_CATEGORIES);
    expect(result.current.imageEnabled).toBe(true);
    expect(result.current.annotationsVisible).toBe(true);
    expect(result.current.annotationLayerVisible).toBe(true);
    expect(result.current.volumeOverlayLayersVisible).toBe(true);
  });

  test('updates image and annotation visibility controls', () => {
    const { result } = renderHook(() => useInspectionDisplayLayers({ projectType: 'PT1' }));

    act(() => {
      result.current.setImageEnabled(false);
      result.current.setAnnotationsVisible(false);
    });

    expect(result.current.imageEnabled).toBe(false);
    expect(result.current.annotationsVisible).toBe(false);
    expect(result.current.annotationLayerVisible).toBe(false);
    expect(result.current.volumeOverlayLayersVisible).toBe(false);
  });

  test('ensures a render category is visible without duplicating it', () => {
    const { result } = renderHook(() => useInspectionDisplayLayers({ projectType: 'PT1' }));

    act(() => {
      result.current.setRenderCategories(['source']);
    });
    act(() => {
      result.current.ensureRenderCategoryVisible('overlay');
      result.current.ensureRenderCategoryVisible('overlay');
    });

    expect(result.current.renderCategories).toEqual(['source', 'overlay']);
    expect(result.current.volumeOverlayLayersVisible).toBe(true);
  });
});
