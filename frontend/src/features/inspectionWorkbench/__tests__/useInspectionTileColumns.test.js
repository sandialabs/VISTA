import { act, renderHook } from '@testing-library/react';

import useInspectionTileColumns, { clampTileColumnCount } from '../useInspectionTileColumns';

describe('clampTileColumnCount', () => {
  test('clamps, rounds, and falls back to a safe column count', () => {
    expect(clampTileColumnCount(4.4, 6)).toBe(4);
    expect(clampTileColumnCount(0, 6)).toBe(1);
    expect(clampTileColumnCount(10, 4)).toBe(4);
    expect(clampTileColumnCount('bad', 4, 3)).toBe(3);
  });
});

describe('useInspectionTileColumns', () => {
  test('normalizes tile columns against configured and loaded maximums', () => {
    const { result } = renderHook(() => useInspectionTileColumns({
      configuredMaxColumns: 5,
      imageCount: 2,
      initialColumnCount: 4,
    }));

    expect(result.current.tileColumnMax).toBe(2);
    expect(result.current.normalizedTileColumnCount).toBe(2);
    expect(result.current.tileColumnCount).toBe(2);
  });

  test('does not force stored column count down while no images are loaded', () => {
    const { result, rerender } = renderHook((props) => useInspectionTileColumns(props), {
      initialProps: {
        configuredMaxColumns: 5,
        imageCount: 0,
        initialColumnCount: 4,
      },
    });

    expect(result.current.tileColumnMax).toBe(1);
    expect(result.current.normalizedTileColumnCount).toBe(1);
    expect(result.current.tileColumnCount).toBe(4);

    rerender({ configuredMaxColumns: 5, imageCount: 3, initialColumnCount: 4 });

    expect(result.current.tileColumnMax).toBe(3);
    expect(result.current.tileColumnCount).toBe(3);
  });

  test('allows explicit column updates within the current maximum', () => {
    const { result } = renderHook(() => useInspectionTileColumns({
      configuredMaxColumns: 5,
      imageCount: 5,
      initialColumnCount: 2,
    }));

    act(() => {
      result.current.setTileColumnCount(4);
    });

    expect(result.current.tileColumnCount).toBe(4);
    expect(result.current.normalizedTileColumnCount).toBe(4);
  });
});
