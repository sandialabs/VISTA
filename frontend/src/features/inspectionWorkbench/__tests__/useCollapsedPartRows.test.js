import { act, renderHook } from '@testing-library/react';

import useCollapsedPartRows, { toggleCollapsedPartId } from '../useCollapsedPartRows';

describe('toggleCollapsedPartId', () => {
  test('adds and removes normalized part identifiers', () => {
    expect(toggleCollapsedPartId([], 42)).toEqual(['42']);
    expect(toggleCollapsedPartId(['42', 'part-b'], 42)).toEqual(['part-b']);
  });

  test('ignores blank identifiers', () => {
    const previous = ['part-a'];
    expect(toggleCollapsedPartId(previous, '')).toBe(previous);
    expect(toggleCollapsedPartId(previous, null)).toBe(previous);
  });

  test('treats missing previous identifiers as an empty list', () => {
    expect(toggleCollapsedPartId(undefined, 'part-a')).toEqual(['part-a']);
  });
});

describe('useCollapsedPartRows', () => {
  test('tracks collapsed IDs and exposes them as a set', () => {
    const { result } = renderHook(() => useCollapsedPartRows(['part-a']));

    expect(result.current.collapsedPartIdSet.has('part-a')).toBe(true);
    expect(result.current.collapsedPartIds).toEqual(['part-a']);

    act(() => {
      result.current.togglePartCollapsed('part-b');
    });

    expect(result.current.collapsedPartIds).toEqual(['part-a', 'part-b']);
    expect(result.current.collapsedPartIdSet.has('part-b')).toBe(true);

    act(() => {
      result.current.togglePartCollapsed('part-a');
    });

    expect(result.current.collapsedPartIds).toEqual(['part-b']);
    expect(result.current.collapsedPartIdSet.has('part-a')).toBe(false);
  });
});
