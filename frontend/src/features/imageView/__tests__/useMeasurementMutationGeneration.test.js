import { renderHook, act } from '@testing-library/react';

import useMeasurementMutationGeneration from '../useMeasurementMutationGeneration';

describe('useMeasurementMutationGeneration', () => {
  test('beginGeneration returns the current generation and it stays current until superseded', () => {
    const { result } = renderHook(() => useMeasurementMutationGeneration());

    let generation;
    act(() => {
      generation = result.current.beginGeneration();
    });
    expect(result.current.isCurrentGeneration(generation)).toBe(true);
  });

  test('a later beginGeneration call supersedes an earlier one', () => {
    const { result } = renderHook(() => useMeasurementMutationGeneration());

    let firstGeneration;
    let secondGeneration;
    act(() => {
      firstGeneration = result.current.beginGeneration();
    });
    act(() => {
      secondGeneration = result.current.beginGeneration();
    });

    expect(result.current.isCurrentGeneration(firstGeneration)).toBe(false);
    expect(result.current.isCurrentGeneration(secondGeneration)).toBe(true);
  });

  test('advanceGeneration invalidates a previously begun generation without starting a new tracked mutation', () => {
    const { result } = renderHook(() => useMeasurementMutationGeneration());

    let generation;
    act(() => {
      generation = result.current.beginGeneration();
    });
    act(() => {
      result.current.advanceGeneration();
    });

    expect(result.current.isCurrentGeneration(generation)).toBe(false);
  });
});
