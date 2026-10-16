import { act, renderHook } from '@testing-library/react';

import useInspectionImageFilterVisibility, {
  selectOnlyFilterValue,
  setAllFilterValuesVisibility,
} from '../useInspectionImageFilterVisibility';

describe('inspection image filter visibility helpers', () => {
  test('hides and shows normalized filter values', () => {
    expect(setAllFilterValuesVisibility(['front'], ['Back', ''], false)).toEqual(['front', 'back']);
    expect(setAllFilterValuesVisibility(['front', 'back'], ['FRONT'], true)).toEqual(['back']);
  });

  test('selects only one available filter value', () => {
    expect(selectOnlyFilterValue(['front'], ['Front', 'Back', 'Uv'], 'Back')).toEqual(['front', 'uv']);
  });

  test('ignores empty bulk and selected values', () => {
    const previous = ['front'];
    expect(setAllFilterValuesVisibility(previous, [], false)).toBe(previous);
    expect(selectOnlyFilterValue(previous, ['front'], '')).toBe(previous);
  });
});

describe('useInspectionImageFilterVisibility', () => {
  test('tracks view and modality filter visibility state', () => {
    const setAnnotationsVisible = jest.fn();
    const { result } = renderHook(() => useInspectionImageFilterVisibility({
      defaultSecondaryImageFilterKey: 'layer',
      effectiveSecondaryImageFilterKey: 'layer',
      setAnnotationsVisible,
    }));

    act(() => {
      result.current.setAllViewVisibility(['Front', 'Back'], false);
      result.current.selectOnlyModalityFilterVisibility(['Visual', 'IR'], 'IR');
    });

    expect(result.current.hiddenPrimaryImageFilterValues).toEqual(['front', 'back']);
    expect(result.current.hiddenModalityImageFilterValues).toEqual(['visual']);

    act(() => {
      result.current.selectOnlyViewVisibility(['Front', 'Back'], 'Back');
      result.current.setAllModalityFilterVisibility(['Visual'], true);
    });

    expect(result.current.hiddenPrimaryImageFilterValues).toEqual(['front']);
    expect(result.current.hiddenModalityImageFilterValues).toEqual([]);
  });

  test('tracks layer visibility and re-enables annotations when the annotation layer is made visible', () => {
    const setAnnotationsVisible = jest.fn();
    const { result } = renderHook(() => useInspectionImageFilterVisibility({
      defaultSecondaryImageFilterKey: 'layer',
      effectiveSecondaryImageFilterKey: 'layer',
      setAnnotationsVisible,
    }));

    act(() => {
      result.current.setAllLayerVisibility(false, { source: true, overlay: true, annotation: true });
    });
    expect(result.current.hiddenSecondaryImageFilterValues).toEqual(['source', 'overlay', 'annotation']);
    expect(setAnnotationsVisible).not.toHaveBeenCalled();

    act(() => {
      result.current.selectOnlyLayerVisibility('annotation', { source: true, overlay: true, annotation: true });
    });
    expect(result.current.hiddenSecondaryImageFilterValues).toEqual(['source', 'overlay']);
    expect(setAnnotationsVisible).toHaveBeenCalledWith(true);

    act(() => {
      result.current.setAllLayerVisibility(true, { source: true, overlay: true, annotation: true });
    });
    expect(result.current.hiddenSecondaryImageFilterValues).toEqual([]);
    expect(setAnnotationsVisible).toHaveBeenCalledTimes(2);
  });
});
