import { act, renderHook } from '@testing-library/react';

import useInspectionSessionState from '../useInspectionSessionState';

describe('useInspectionSessionState', () => {
  test('publishes normalized MPR navigation updates and suppresses no-ops', () => {
    const onMprSessionChange = jest.fn();
    const { result } = renderHook(() => useInspectionSessionState({
      onMprSessionChange,
      projectId: 'project-a',
    }));

    expect(result.current.mprNavigationSession).toEqual({
      slicePosition: { axial: 0, coronal: 0, sagittal: 0 },
      activePane: 'axial',
      lastActiveAxis: 'axial',
      viewportTransform: { zoom: 1, panX: 0, panY: 0 },
      rotation: { x: -22, y: 32 },
    });

    result.current.mprDimensionsRef.current = { axial: 20, coronal: 21, sagittal: 22 };

    act(() => {
      result.current.applyMprNavigationSession({
        slicePosition: { axial: 12, coronal: 13, sagittal: 14 },
        activePane: 'volume',
        viewportTransform: { zoom: 2, panX: 12, panY: -8 },
      });
    });

    expect(result.current.mprNavigationSession).toEqual({
      slicePosition: { axial: 12, coronal: 13, sagittal: 14 },
      activePane: 'volume',
      lastActiveAxis: 'axial',
      viewportTransform: { zoom: 2, panX: 12, panY: -8 },
      rotation: { x: -22, y: 32 },
    });
    expect(onMprSessionChange).toHaveBeenCalledTimes(1);
    expect(onMprSessionChange).toHaveBeenLastCalledWith(result.current.mprNavigationSession);

    const unchangedSession = result.current.mprNavigationSession;
    act(() => {
      const returnedSession = result.current.applyMprNavigationSession({
        viewportTransform: { zoom: 2 },
      });
      expect(returnedSession).toBe(unchangedSession);
    });

    expect(result.current.mprNavigationSession).toBe(unchangedSession);
    expect(onMprSessionChange).toHaveBeenCalledTimes(1);
  });

  test('uses current dimensions when clamping session updates', () => {
    const { result } = renderHook(() => useInspectionSessionState({
      onMprSessionChange: jest.fn(),
      projectId: 'project-a',
    }));

    result.current.mprDimensionsRef.current = { axial: 4, coronal: 5, sagittal: 6 };

    act(() => {
      result.current.applyMprNavigationSession({
        slicePosition: { axial: 40, coronal: 50, sagittal: 60 },
      });
    });

    expect(result.current.mprNavigationSession.slicePosition).toEqual({
      axial: 3,
      coronal: 4,
      sagittal: 5,
    });
  });

  test('resets session refs when the project changes', () => {
    const onMprSessionChange = jest.fn();
    const { result, rerender } = renderHook(
      ({ projectId }) => useInspectionSessionState({
        onMprSessionChange,
        projectId,
      }),
      { initialProps: { projectId: 'project-a' } },
    );

    act(() => {
      result.current.applyMprNavigationSession({
        activePane: 'volume',
        slicePosition: { axial: 8, coronal: 9, sagittal: 10 },
      });
    });
    result.current.mprNavigationHydratedProjectRef.current = 'project-a';
    result.current.lastControlledMprSessionRef.current = { activePane: 'volume' };
    result.current.pendingPublishedMprSessionRef.current = result.current.mprNavigationSession;
    result.current.mprDimensionsRef.current = { axial: 9, coronal: 10, sagittal: 11 };

    rerender({ projectId: 'project-b' });

    expect(result.current.mprSessionProjectKey).toBe('project-b');
    expect(result.current.mprNavigationSession).toEqual({
      slicePosition: { axial: 0, coronal: 0, sagittal: 0 },
      activePane: 'axial',
      lastActiveAxis: 'axial',
      viewportTransform: { zoom: 1, panX: 0, panY: 0 },
      rotation: { x: -22, y: 32 },
    });
    expect(result.current.mprNavigationHydratedProjectRef.current).toBe('');
    expect(result.current.lastControlledMprSessionRef.current).toBeNull();
    expect(result.current.pendingPublishedMprSessionRef.current).toBeNull();
    expect(result.current.mprDimensionsRef.current).toEqual({ axial: 1, coronal: 1, sagittal: 1 });
  });
});
