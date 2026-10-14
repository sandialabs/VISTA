import { act, renderHook } from '@testing-library/react';

import useInspectionEnabledModalities, {
  ensureModalityEnabled,
  selectOnlyModality,
  setAllModalitiesVisibility,
} from '../useInspectionEnabledModalities';

describe('inspection enabled modality helpers', () => {
  test('shows and hides normalized modalities', () => {
    expect(setAllModalitiesVisibility(['visual'], ['IR', ''], true)).toEqual(['visual', 'ir']);
    expect(setAllModalitiesVisibility(['visual', 'ir'], ['VISUAL'], false)).toEqual(['ir']);
  });

  test('selects only a known modality', () => {
    expect(selectOnlyModality(['Visual', 'IR'], 'IR')).toEqual(['ir']);
    expect(selectOnlyModality(['Visual'], 'UV')).toBeNull();
  });

  test('ensures a crop modality is enabled without duplicating existing entries', () => {
    const previous = ['Visual'];
    expect(ensureModalityEnabled(previous, 'visual')).toBe(previous);
    expect(ensureModalityEnabled(previous, 'IR')).toEqual(['Visual', 'ir']);
  });
});

describe('useInspectionEnabledModalities', () => {
  test('tracks enabled modalities and exposes visibility helpers', () => {
    const { result } = renderHook(() => useInspectionEnabledModalities(['visual']));

    act(() => {
      result.current.setAllModalityVisibility(['IR'], true);
    });
    expect(result.current.enabledModalities).toEqual(['visual', 'ir']);

    act(() => {
      result.current.selectOnlyModalityVisibility(['Visual', 'IR'], 'Visual');
    });
    expect(result.current.enabledModalities).toEqual(['visual']);

    act(() => {
      result.current.ensureEnabledModality('uv');
    });
    expect(result.current.enabledModalities).toEqual(['visual', 'uv']);
  });
});
