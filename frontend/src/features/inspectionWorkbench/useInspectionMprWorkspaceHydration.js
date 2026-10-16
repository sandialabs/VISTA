import { useEffect } from 'react';
import {
  inspectionMprSessionsEqual,
  normalizeInspectionMprSession,
} from '../../components/inspectionWorkbenchSession';
import {
  DEFAULT_RAY_MARCH_SETTINGS,
  normalizeRayMarchSettings,
} from '../../components/Pt3GaussianSplatViewer';
import {
  getNormalizedDisplayDomain,
  normalizeDisplayWindow,
  remapDisplayWindow,
} from './displayDomain';
import { clampRange, getLatestRunFromMetadata, getOverlayLayers } from './inspectionUtils';
import { MPR_AXES, normalizeMprReconstructionMode } from './mprConstants';
import { normalizeMprProjectionMirror } from './mprGeometry';

/**
 * Keeps the selected part ID in sync and hydrates PT3 MPR navigation, display window, overlays, and reconstruction settings from the workspace state and the controlled MPR session.
 */
export default function useInspectionMprWorkspaceHydration({
  applyMprNavigationSession,
  displayValueDomain,
  displayWindowContextRef,
  isAllImagesSelection,
  lastControlledMprSessionRef,
  launchFilters,
  mprDimensions,
  mprNavigationHydratedProjectRef,
  mprNavigationSessionRef,
  mprSession,
  mprSessionProjectKey,
  onMprSessionChange,
  pendingPublishedMprSessionRef,
  projectId,
  projectType,
  selectedPart,
  selectedPartId,
  setActiveOverlayIds,
  setCursorProbe,
  setDisplayWindow,
  setMeasurementRun,
  setMprProjectionMirror,
  setMprReconstructionMode,
  setRayMarchSettings,
  setSegmentationRun,
  setSelectedPartId,
  workspaceHydration,
  workspaceStateLoaded,
}) {
  useEffect(() => {
    if (isAllImagesSelection) return;
    if (selectedPart && selectedPart.id !== selectedPartId) {
      setSelectedPartId(selectedPart.id);
    }
  }, [isAllImagesSelection, selectedPart, selectedPartId, setSelectedPartId]);

  useEffect(() => {
    if (!selectedPart || projectType !== 'PT3' || !workspaceStateLoaded) return;
    const savedMpr = workspaceHydration?.mpr || {};
    const centeredSession = normalizeInspectionMprSession({
      slicePosition: {
        axial: Math.floor((mprDimensions.axial - 1) / 2),
        coronal: Math.floor((mprDimensions.coronal - 1) / 2),
        sagittal: Math.floor((mprDimensions.sagittal - 1) / 2),
      },
    }, { dimensions: mprDimensions });
    const workspaceSession = normalizeInspectionMprSession({
      slicePosition: savedMpr.slice_position,
      viewportTransform: savedMpr.viewport_transform,
    }, {
      dimensions: mprDimensions,
      fallback: centeredSession,
    });
    const hasControlledSession = Boolean(mprSession && typeof mprSession === 'object');

    if (mprNavigationHydratedProjectRef.current !== mprSessionProjectKey) {
      const parentPreferredSession = hasControlledSession
        ? normalizeInspectionMprSession(mprSession, {
          dimensions: mprDimensions,
          fallback: workspaceSession,
        })
        : workspaceSession;
      const requestedPane = String(launchFilters?.active_mpr_pane || '').trim();
      const initialSession = normalizeInspectionMprSession(
        ['axial', 'coronal', 'sagittal', 'volume'].includes(requestedPane)
          ? {
            ...parentPreferredSession,
            activePane: requestedPane,
            ...(MPR_AXES.includes(requestedPane)
              ? { lastActiveAxis: requestedPane }
              : {}),
          }
          : parentPreferredSession,
        {
          dimensions: mprDimensions,
          fallback: workspaceSession,
        },
      );
      applyMprNavigationSession(initialSession, { publish: false });
      mprNavigationHydratedProjectRef.current = mprSessionProjectKey;
      lastControlledMprSessionRef.current = mprSession;
      if (
        typeof onMprSessionChange === 'function'
        && (!hasControlledSession || !inspectionMprSessionsEqual(mprSession, initialSession))
      ) {
        pendingPublishedMprSessionRef.current = initialSession;
        onMprSessionChange(initialSession);
      }
      return;
    }

    const controlledSessionChanged = hasControlledSession
      && lastControlledMprSessionRef.current !== mprSession;
    if (controlledSessionChanged) {
      lastControlledMprSessionRef.current = mprSession;
      pendingPublishedMprSessionRef.current = null;
    }
    const sourceSession = controlledSessionChanged
      ? mprSession
      : mprNavigationSessionRef.current.session;
    const normalizedSession = normalizeInspectionMprSession(sourceSession, {
      dimensions: mprDimensions,
      fallback: mprNavigationSessionRef.current.session,
    });
    applyMprNavigationSession(normalizedSession, { publish: false });
    if (
      hasControlledSession
      && typeof onMprSessionChange === 'function'
      && !inspectionMprSessionsEqual(mprSession, normalizedSession)
      && !inspectionMprSessionsEqual(
        pendingPublishedMprSessionRef.current,
        normalizedSession,
      )
    ) {
      pendingPublishedMprSessionRef.current = normalizedSession;
      onMprSessionChange(normalizedSession);
    }
  }, [
    applyMprNavigationSession,
    lastControlledMprSessionRef,
    launchFilters?.active_mpr_pane,
    mprDimensions,
    mprNavigationHydratedProjectRef,
    mprNavigationSessionRef,
    mprSession,
    mprSessionProjectKey,
    onMprSessionChange,
    pendingPublishedMprSessionRef,
    projectType,
    selectedPart,
    workspaceHydration,
    workspaceStateLoaded,
  ]);

  useEffect(() => {
    if (!selectedPart || projectType !== 'PT3') return;
    const savedMpr = workspaceHydration?.mpr || {};
    const savedProbe = savedMpr?.cursor_probe || {};
    setMprProjectionMirror(normalizeMprProjectionMirror(savedMpr.projection_mirror));
    const displayDomain = getNormalizedDisplayDomain(displayValueDomain);
    const displayDomainKey = `${displayDomain.min}:${displayDomain.max}:${displayDomain.step}`;
    const previousDisplayContext = displayWindowContextRef.current;
    const isNewDisplayContext = !previousDisplayContext
      || previousDisplayContext.projectId !== String(projectId);
    const shouldHydrateSavedWindow = workspaceStateLoaded
      && (isNewDisplayContext || previousDisplayContext.workspaceHydrated !== true);
    if (shouldHydrateSavedWindow) {
      const savedDisplayWindow = savedMpr.display_window || {};
      const fallbackContrast = clampRange(savedMpr.contrast_percent, 50, 150, 100);
      const fallbackRange = displayDomain.max - displayDomain.min;
      const legacyFallback = fallbackContrast === 100
        ? { min: displayDomain.min, max: displayDomain.max }
        : {
          min: displayDomain.min + (Math.max(0, 100 - fallbackContrast) / 100) * (fallbackRange / 2),
          max: displayDomain.min + Math.min(1, fallbackContrast / 100) * fallbackRange,
      };
      setDisplayWindow(normalizeDisplayWindow(savedDisplayWindow, displayDomain, legacyFallback));
    } else if (isNewDisplayContext) {
      setDisplayWindow({ min: displayDomain.min, max: displayDomain.max });
    } else if (previousDisplayContext.domainKey !== displayDomainKey) {
      setDisplayWindow((current) => remapDisplayWindow(
        current,
        previousDisplayContext.domain,
        displayDomain,
      ));
    }
    displayWindowContextRef.current = {
      projectId: String(projectId),
      partId: String(selectedPart.id),
      domainKey: displayDomainKey,
      domain: displayDomain,
      workspaceHydrated: workspaceStateLoaded,
    };
    const stableOverlayIds = new Set(getOverlayLayers(selectedPart).map((overlay) => String(overlay.id)));
    const savedOverlayIds = Array.isArray(savedMpr.active_overlay_ids)
      ? savedMpr.active_overlay_ids
        .map((entry) => String(entry))
        .filter((entry) => stableOverlayIds.has(entry))
      : [];
    setActiveOverlayIds(savedOverlayIds);
    setCursorProbe({
      x: clampRange(savedProbe.x, 0, 100, 50),
      y: clampRange(savedProbe.y, 0, 100, 50),
    });
    setSegmentationRun(getLatestRunFromMetadata(selectedPart, 'segmentation_runs'));
    setMeasurementRun(getLatestRunFromMetadata(selectedPart, 'measurement_runs'));
  }, [
    selectedPart,
    projectType,
    projectId,
    mprDimensions,
    workspaceHydration,
    workspaceStateLoaded,
    displayValueDomain,
    displayWindowContextRef,
    setActiveOverlayIds,
    setCursorProbe,
    setDisplayWindow,
    setMeasurementRun,
    setMprProjectionMirror,
    setSegmentationRun,
  ]);

  useEffect(() => {
    if (projectType !== 'PT3' || !workspaceStateLoaded) return;
    const savedMpr = workspaceHydration?.mpr || {};
    // Removed legacy scene modes normalize to a supported view instead of
    // leaving the controlled selector without a matching option.
    setMprReconstructionMode(normalizeMprReconstructionMode(savedMpr.reconstruction_mode));
    setRayMarchSettings(normalizeRayMarchSettings(
      savedMpr.reconstruction_mode === 'hybrid3d'
        ? DEFAULT_RAY_MARCH_SETTINGS
        : savedMpr.ray_march_settings,
    ));
  }, [
    projectId,
    projectType,
    workspaceHydration,
    workspaceStateLoaded,
    setMprReconstructionMode,
    setRayMarchSettings,
  ]);
}
