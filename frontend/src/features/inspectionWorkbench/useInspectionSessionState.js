import { useCallback, useRef, useState } from 'react';

import {
  inspectionMprSessionsEqual,
  normalizeInspectionMprSession,
} from '../../components/inspectionWorkbenchSession';

const DEFAULT_MPR_DIMENSIONS = { axial: 1, coronal: 1, sagittal: 1 };

export default function useInspectionSessionState({
  onMprSessionChange,
  projectId,
}) {
  const mprSessionProjectKey = String(projectId ?? '');
  const [localMprNavigationState, setLocalMprNavigationState] = useState(() => ({
    projectKey: mprSessionProjectKey,
    session: normalizeInspectionMprSession({}),
  }));
  const mprNavigationSessionRef = useRef({
    projectKey: mprSessionProjectKey,
    session: localMprNavigationState.session,
  });
  const mprNavigationHydratedProjectRef = useRef('');
  const lastControlledMprSessionRef = useRef(null);
  const pendingPublishedMprSessionRef = useRef(null);
  const mprDimensionsRef = useRef(DEFAULT_MPR_DIMENSIONS);

  if (mprNavigationSessionRef.current.projectKey !== mprSessionProjectKey) {
    mprNavigationSessionRef.current = {
      projectKey: mprSessionProjectKey,
      session: normalizeInspectionMprSession({}),
    };
    mprNavigationHydratedProjectRef.current = '';
    lastControlledMprSessionRef.current = null;
    pendingPublishedMprSessionRef.current = null;
    mprDimensionsRef.current = DEFAULT_MPR_DIMENSIONS;
  }

  const mprNavigationSession = (
    localMprNavigationState.projectKey === mprSessionProjectKey
      ? localMprNavigationState.session
      : mprNavigationSessionRef.current.session
  );

  const applyMprNavigationSession = useCallback((patchOrUpdater, { publish = true } = {}) => {
    const previousSession = mprNavigationSessionRef.current.projectKey === mprSessionProjectKey
      ? mprNavigationSessionRef.current.session
      : normalizeInspectionMprSession({});
    const candidate = typeof patchOrUpdater === 'function'
      ? patchOrUpdater(previousSession)
      : patchOrUpdater;
    const nextSession = normalizeInspectionMprSession(candidate, {
      dimensions: mprDimensionsRef.current,
      fallback: previousSession,
    });
    if (
      nextSession === previousSession
      || inspectionMprSessionsEqual(nextSession, previousSession)
    ) {
      return previousSession;
    }
    mprNavigationSessionRef.current = {
      projectKey: mprSessionProjectKey,
      session: nextSession,
    };
    setLocalMprNavigationState({
      projectKey: mprSessionProjectKey,
      session: nextSession,
    });
    if (publish && typeof onMprSessionChange === 'function') {
      pendingPublishedMprSessionRef.current = nextSession;
      onMprSessionChange(nextSession);
    }
    return nextSession;
  }, [mprSessionProjectKey, onMprSessionChange]);

  return {
    applyMprNavigationSession,
    lastControlledMprSessionRef,
    mprDimensionsRef,
    mprNavigationHydratedProjectRef,
    mprNavigationSession,
    mprNavigationSessionRef,
    mprSessionProjectKey,
    pendingPublishedMprSessionRef,
  };
}
