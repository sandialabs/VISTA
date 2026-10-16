import { act, renderHook } from '@testing-library/react';
import {
  normalizeInspectionMprSession,
  useInspectionWorkbenchSessionController,
} from '../inspectionWorkbenchSession';

describe('normalizeInspectionMprSession', () => {
  test('completes, normalizes, and clamps the persisted MPR contract', () => {
    const fallback = {
      slicePosition: { axial: 2, coronal: 3, sagittal: 4 },
      activePane: 'volume',
      lastActiveAxis: 'coronal',
      viewportTransform: { zoom: 1.5, panX: 8, panY: 9 },
      rotation: { x: -20, y: 30 },
    };

    expect(normalizeInspectionMprSession({
      slicePosition: { axial: '99.7', coronal: -4, sagittal: 'invalid' },
      activePane: 'invalid-pane',
      lastActiveAxis: 'sagittal',
      viewportTransform: { zoom: 9, panX: -900, panY: 'invalid' },
      rotation: { x: 90, y: 540 },
    }, {
      dimensions: { axial: 20, coronal: 9, sagittal: 5 },
      fallback,
    })).toEqual({
      slicePosition: { axial: 19, coronal: 0, sagittal: 4 },
      activePane: 'volume',
      lastActiveAxis: 'sagittal',
      viewportTransform: { zoom: 4, panX: -200, panY: 9 },
      rotation: { x: 72, y: -180 },
    });
  });

  test('preserves object identity when normalization makes no change', () => {
    const session = {
      slicePosition: { axial: 7, coronal: 8, sagittal: 9 },
      activePane: 'coronal',
      lastActiveAxis: 'coronal',
      viewportTransform: { zoom: 1.25, panX: 12, panY: -18 },
      rotation: { x: -20, y: 30 },
    };

    expect(normalizeInspectionMprSession(session, {
      dimensions: { axial: 20, coronal: 20, sagittal: 20 },
    })).toBe(session);
    expect(normalizeInspectionMprSession({
      viewportTransform: { zoom: 'invalid' },
    }, { fallback: session })).toBe(session);
  });

  test('clamps a retained session when replacement volume dimensions shrink', () => {
    const retained = {
      slicePosition: { axial: 19, coronal: 29, sagittal: 39 },
      activePane: 'volume',
      lastActiveAxis: 'sagittal',
      viewportTransform: { zoom: 2, panX: 12, panY: -18 },
      rotation: { x: -20, y: 30 },
    };

    const normalized = normalizeInspectionMprSession(retained, {
      dimensions: { axial: 4, coronal: 5, sagittal: 6 },
    });

    expect(normalized).toEqual({
      ...retained,
      slicePosition: { axial: 3, coronal: 4, sagittal: 5 },
    });
    expect(normalized).not.toBe(retained);
    expect(retained.slicePosition).toEqual({
      axial: 19,
      coronal: 29,
      sagittal: 39,
    });
  });
});

describe('useInspectionWorkbenchSessionController', () => {
  test('supports patch and updater writes while preserving no-op identity', () => {
    const { result } = renderHook(
      () => useInspectionWorkbenchSessionController('project-a'),
    );

    expect(result.current.session).toBeNull();

    act(() => {
      result.current.updateSession({
        slicePosition: { axial: 11, coronal: 12, sagittal: 13 },
        activePane: 'sagittal',
        lastActiveAxis: 'sagittal',
      });
    });

    expect(result.current.session).toEqual({
      slicePosition: { axial: 11, coronal: 12, sagittal: 13 },
      activePane: 'sagittal',
      lastActiveAxis: 'sagittal',
      viewportTransform: { zoom: 1, panX: 0, panY: 0 },
      rotation: { x: -22, y: 32 },
    });

    act(() => {
      result.current.updateSession((previous) => ({
        viewportTransform: {
          ...previous.viewportTransform,
          zoom: 2,
        },
        rotation: { y: 48 },
      }));
    });

    expect(result.current.session).toEqual(expect.objectContaining({
      slicePosition: { axial: 11, coronal: 12, sagittal: 13 },
      viewportTransform: { zoom: 2, panX: 0, panY: 0 },
      rotation: { x: -22, y: 48 },
    }));

    const unchangedSession = result.current.session;
    act(() => {
      result.current.updateSession({ viewportTransform: { zoom: 2 } });
    });
    expect(result.current.session).toBe(unchangedSession);
  });

  test('isolates sessions by project and resets only the active project', () => {
    const { result, rerender } = renderHook(
      ({ projectId }) => useInspectionWorkbenchSessionController(projectId),
      { initialProps: { projectId: 'project-a' } },
    );

    act(() => {
      result.current.updateSession({
        slicePosition: { axial: 4, coronal: 5, sagittal: 6 },
        activePane: 'axial',
      });
    });
    const projectASession = result.current.session;

    rerender({ projectId: 'project-b' });
    expect(result.current.session).toBeNull();

    act(() => {
      result.current.updateSession({
        slicePosition: { axial: 40, coronal: 50, sagittal: 60 },
        activePane: 'volume',
      });
    });
    expect(result.current.session.slicePosition.axial).toBe(40);

    act(() => {
      result.current.resetSession();
    });
    expect(result.current.session).toBeNull();

    rerender({ projectId: 'project-a' });
    expect(result.current.session).toBe(projectASession);

    act(() => {
      result.current.resetSession();
    });
    expect(result.current.session).toBeNull();
  });

  test('ignores writes without a project key and does not leak them later', () => {
    const updater = jest.fn(() => ({
      slicePosition: { axial: 8, coronal: 9, sagittal: 10 },
    }));
    const { result, rerender } = renderHook(
      ({ projectId }) => useInspectionWorkbenchSessionController(projectId),
      { initialProps: { projectId: '   ' } },
    );

    act(() => {
      result.current.updateSession(updater);
    });
    expect(updater).not.toHaveBeenCalled();
    expect(result.current.session).toBeNull();

    rerender({ projectId: 'project-after-null' });
    expect(result.current.session).toBeNull();
  });
});
