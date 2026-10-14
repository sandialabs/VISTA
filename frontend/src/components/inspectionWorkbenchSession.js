import { useCallback, useState } from 'react';
import { clamp } from '../utils/numbers';

const MPR_AXES = ['axial', 'coronal', 'sagittal'];
const ACTIVE_MPR_PANES = [...MPR_AXES, 'volume'];

const DEFAULT_SESSION = {
  slicePosition: { axial: 0, coronal: 0, sagittal: 0 },
  activePane: 'axial',
  lastActiveAxis: 'axial',
  viewportTransform: { zoom: 1, panX: 0, panY: 0 },
  rotation: { x: -22, y: 32 },
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === '' || typeof value === 'boolean') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function normalizeSliceIndex(value, fallback, dimension) {
  const numeric = Math.max(0, Math.round(firstFiniteNumber(value, fallback, 0)));
  const numericDimension = firstFiniteNumber(dimension, 0);
  if (numericDimension <= 0) return numeric;
  return Math.min(numeric, Math.max(0, Math.round(numericDimension) - 1));
}

function normalizeEnum(value, fallback, allowedValues, defaultValue) {
  if (allowedValues.includes(value)) return value;
  if (allowedValues.includes(fallback)) return fallback;
  return defaultValue;
}

function normalizeBoundedNumber(value, fallback, defaultValue, min, max) {
  return clamp(firstFiniteNumber(value, fallback, defaultValue), min, max);
}

function normalizeAngle(value, fallback, defaultValue) {
  const angle = firstFiniteNumber(value, fallback, defaultValue);
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}

export function inspectionMprSessionsEqual(left, right) {
  if (!isObject(left) || !isObject(right)) return false;
  return (
    left.activePane === right.activePane
    && left.lastActiveAxis === right.lastActiveAxis
    && MPR_AXES.every((axis) => left.slicePosition?.[axis] === right.slicePosition?.[axis])
    && left.viewportTransform?.zoom === right.viewportTransform?.zoom
    && left.viewportTransform?.panX === right.viewportTransform?.panX
    && left.viewportTransform?.panY === right.viewportTransform?.panY
    && left.rotation?.x === right.rotation?.x
    && left.rotation?.y === right.rotation?.y
  );
}

/**
 * Produces the bounded, complete MPR session contract consumed by the
 * inspection workbench. Candidate values win, then fallback values, then the
 * workbench defaults.
 */
export function normalizeInspectionMprSession(
  candidate,
  { dimensions, fallback } = {},
) {
  const safeCandidate = isObject(candidate) ? candidate : {};
  const safeFallback = isObject(fallback) ? fallback : {};
  const candidateSlice = isObject(safeCandidate.slicePosition) ? safeCandidate.slicePosition : {};
  const fallbackSlice = isObject(safeFallback.slicePosition) ? safeFallback.slicePosition : {};
  const safeDimensions = isObject(dimensions) ? dimensions : {};
  const candidateViewport = isObject(safeCandidate.viewportTransform) ? safeCandidate.viewportTransform : {};
  const fallbackViewport = isObject(safeFallback.viewportTransform) ? safeFallback.viewportTransform : {};
  const candidateRotation = isObject(safeCandidate.rotation) ? safeCandidate.rotation : {};
  const fallbackRotation = isObject(safeFallback.rotation) ? safeFallback.rotation : {};

  const normalized = {
    slicePosition: MPR_AXES.reduce((positions, axis) => {
      positions[axis] = normalizeSliceIndex(
        candidateSlice[axis],
        fallbackSlice[axis],
        safeDimensions[axis],
      );
      return positions;
    }, {}),
    activePane: normalizeEnum(
      safeCandidate.activePane,
      safeFallback.activePane,
      ACTIVE_MPR_PANES,
      DEFAULT_SESSION.activePane,
    ),
    lastActiveAxis: normalizeEnum(
      safeCandidate.lastActiveAxis,
      safeFallback.lastActiveAxis,
      MPR_AXES,
      DEFAULT_SESSION.lastActiveAxis,
    ),
    viewportTransform: {
      zoom: normalizeBoundedNumber(
        candidateViewport.zoom,
        fallbackViewport.zoom,
        DEFAULT_SESSION.viewportTransform.zoom,
        0.5,
        4,
      ),
      panX: normalizeBoundedNumber(
        candidateViewport.panX,
        fallbackViewport.panX,
        DEFAULT_SESSION.viewportTransform.panX,
        -200,
        200,
      ),
      panY: normalizeBoundedNumber(
        candidateViewport.panY,
        fallbackViewport.panY,
        DEFAULT_SESSION.viewportTransform.panY,
        -200,
        200,
      ),
    },
    rotation: {
      x: normalizeBoundedNumber(
        candidateRotation.x,
        fallbackRotation.x,
        DEFAULT_SESSION.rotation.x,
        -72,
        72,
      ),
      y: normalizeAngle(
        candidateRotation.y,
        fallbackRotation.y,
        DEFAULT_SESSION.rotation.y,
      ),
    },
  };

  if (inspectionMprSessionsEqual(normalized, fallback)) return fallback;
  if (inspectionMprSessionsEqual(normalized, candidate)) return candidate;
  return normalized;
}

function mergeSessionPatch(previousSession, patch) {
  const safePrevious = isObject(previousSession) ? previousSession : {};
  const safePatch = isObject(patch) ? patch : {};
  return {
    ...safePrevious,
    ...safePatch,
    slicePosition: {
      ...(isObject(safePrevious.slicePosition) ? safePrevious.slicePosition : {}),
      ...(isObject(safePatch.slicePosition) ? safePatch.slicePosition : {}),
    },
    viewportTransform: {
      ...(isObject(safePrevious.viewportTransform) ? safePrevious.viewportTransform : {}),
      ...(isObject(safePatch.viewportTransform) ? safePatch.viewportTransform : {}),
    },
    rotation: {
      ...(isObject(safePrevious.rotation) ? safePrevious.rotation : {}),
      ...(isObject(safePatch.rotation) ? safePatch.rotation : {}),
    },
  };
}

function getProjectSessionKey(projectId) {
  if (projectId === null || projectId === undefined || String(projectId).trim() === '') return null;
  return String(projectId);
}

export function useInspectionWorkbenchSessionController(projectId) {
  const projectKey = getProjectSessionKey(projectId);
  const [sessionsByProject, setSessionsByProject] = useState(() => new Map());
  const session = projectKey === null ? null : (sessionsByProject.get(projectKey) || null);

  const updateSession = useCallback((patchOrUpdater) => {
    if (projectKey === null) return;
    setSessionsByProject((previousSessions) => {
      const previousSession = previousSessions.get(projectKey) || null;
      const patch = typeof patchOrUpdater === 'function'
        ? patchOrUpdater(previousSession)
        : patchOrUpdater;
      if (!isObject(patch)) return previousSessions;

      const normalized = normalizeInspectionMprSession(
        mergeSessionPatch(previousSession, patch),
        { fallback: previousSession },
      );
      if (
        normalized === previousSession
        || inspectionMprSessionsEqual(normalized, previousSession)
      ) {
        return previousSessions;
      }

      const nextSessions = new Map(previousSessions);
      nextSessions.set(projectKey, normalized);
      return nextSessions;
    });
  }, [projectKey]);

  const resetSession = useCallback(() => {
    if (projectKey === null) return;
    setSessionsByProject((previousSessions) => {
      if (!previousSessions.has(projectKey)) return previousSessions;
      const nextSessions = new Map(previousSessions);
      nextSessions.delete(projectKey);
      return nextSessions;
    });
  }, [projectKey]);

  return {
    session,
    updateSession,
    resetSession,
  };
}
