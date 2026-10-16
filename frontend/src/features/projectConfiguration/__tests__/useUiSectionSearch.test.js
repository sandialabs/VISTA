import { act, renderHook } from '@testing-library/react';

import { useUiSectionSearch } from '../useUiSectionSearch';

const NO_HIDDEN_SECTION_KEYS = new Set();

describe('useUiSectionSearch', () => {
  test('defaults to the main group expanded with no search results', () => {
    const { result } = renderHook(() => useUiSectionSearch(NO_HIDDEN_SECTION_KEYS));

    expect(result.current.expandedUiGroups).toEqual(['main']);
    expect(result.current.uiSectionSearchResults).toEqual([]);
    expect(result.current.selectedUiSectionSearchResult).toBeNull();
  });

  test('searching expands the path to the first match and resets the index', () => {
    const { result } = renderHook(() => useUiSectionSearch(NO_HIDDEN_SECTION_KEYS));

    act(() => {
      result.current.setUiSearchIndex(3);
      result.current.setUiSearchQuery('hotkeys');
    });

    expect(result.current.uiSearchQuery).toBe('hotkeys');
    expect(result.current.uiSearchIndex).toBe(0);
    expect(result.current.uiSectionSearchResults.length).toBeGreaterThan(0);
    expect(result.current.selectedUiSectionSearchResult).not.toBeNull();
    expect(result.current.expandedUiGroups).toEqual(result.current.selectedUiSectionSearchResult.path);
  });

  test('hides matches for hidden section keys', () => {
    const hiddenSectionKeys = new Set(['project_configuration.hotkeys']);
    const { result } = renderHook(() => useUiSectionSearch(hiddenSectionKeys));

    act(() => {
      result.current.setUiSearchQuery('hotkeys');
    });

    expect(result.current.uiSectionSearchResults.some(
      (match) => match.key === 'project_configuration.hotkeys',
    )).toBe(false);
  });

  test('toggleUiGroup adds and removes a group id', () => {
    const { result } = renderHook(() => useUiSectionSearch(NO_HIDDEN_SECTION_KEYS));

    act(() => {
      result.current.toggleUiGroup('project_data');
    });
    expect(result.current.expandedUiGroups).toEqual(['main', 'project_data']);

    act(() => {
      result.current.toggleUiGroup('project_data');
    });
    expect(result.current.expandedUiGroups).toEqual(['main']);
  });

  test('clearing the query collapses back to only the main group when nothing was expanded by search', () => {
    const { result } = renderHook(() => useUiSectionSearch(NO_HIDDEN_SECTION_KEYS));

    act(() => {
      result.current.toggleUiGroup('main');
    });
    expect(result.current.expandedUiGroups).toEqual([]);

    act(() => {
      result.current.setUiSearchQuery('nonexistent-query-xyz');
    });
    act(() => {
      result.current.setUiSearchQuery('');
    });
    expect(result.current.expandedUiGroups).toEqual(['main']);
  });
});
