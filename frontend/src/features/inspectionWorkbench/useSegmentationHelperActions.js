import { useCallback, useEffect } from 'react';
import { safeReleasePointerCapture } from '../../utils/annotationGeometry';
import { MPR_AXES } from './mprConstants';
import { getMprAxisImageDimensions } from './volumeDescriptors';
import { createDefaultSegment } from './segmentationGeometry';
import { useSegmentationStagePointer } from './useSegmentationStagePointer';

const HELPER_FOCUSABLE_SELECTOR = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const makeHelperSegment = (index, axis, sliceIndex, mprDimensions, volumeCache) => {
  const dimensions = getMprAxisImageDimensions(axis, mprDimensions, volumeCache);
  return createDefaultSegment(index, {
    axis,
    sliceIndex,
    imageWidth: dimensions.width,
    imageHeight: dimensions.height,
    volumeDimensions: [
      mprDimensions.sagittal,
      mprDimensions.coronal,
      mprDimensions.axial,
    ],
  });
};

const trapHelperDialogTab = (event, dialogElement) => {
  const focusable = Array.from(
    dialogElement?.querySelectorAll(HELPER_FOCUSABLE_SELECTOR) || [],
  ).filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.tabIndex >= 0);
  if (focusable.length === 0) return;
  const activeIndex = focusable.indexOf(document.activeElement);
  const nextIndex = event.shiftKey
    ? (activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1)
    : (activeIndex < 0 || activeIndex === focusable.length - 1 ? 0 : activeIndex + 1);
  event.preventDefault();
  focusable[nextIndex].focus();
};

/**
 * Segmentation helper dialog lifecycle (open, close, Escape and Tab trap),
 * stage pointer wiring, segment creation, view/axis/segment selection, and the
 * handler objects passed to the helper modal. The hooks it calls run in the
 * order the panel previously called them: useCallback, useEffect, then
 * useSegmentationStagePointer.
 */
export function useSegmentationHelperActions({
  readOnly,
  projectId,
  selectedPart,
  activeMprPane,
  mprDimensions,
  volumeCacheState,
  mprProjectionMirror,
  stepSlicePosition,
  updateSlicePosition,
  applyMprNavigationSession,
  segmentationHelperState,
  segmentationHelperActions,
  segmentationRefs,
  segmentationGeometry,
  segmentationPersistence,
  segmentationShapeActions,
}) {
  const {
    segmentationHelperOpen,
    segmentationHelperAxis,
    segmentationSegments,
    selectedSegmentationSegment,
    segmentationTool,
    segmentationOperation,
    segmentationSensitivity,
  } = segmentationHelperState;
  const {
    segmentationHelperDialogRef,
    segmentationHelperCloseRef,
    segmentationHelperOpenerRef,
    segmentationDraftRef,
    segmentationPointerSessionRef,
    segmentationVolumeRequestRef,
    segmentationLocalDraftsRef,
  } = segmentationRefs;
  const {
    getSegmentationVolumeDimensions,
    getSegmentationCanonicalSliceIndex,
    getSegmentationVolumeSpacing,
    getActiveSegmentationToolMode,
    getSegmentationVoxelPosition,
    makeSegmentationShapeBase,
  } = segmentationGeometry;
  const {
    persistSegmentationSegment,
    updateSegmentationSegment,
    saveSegmentationSegmentPatch,
  } = segmentationPersistence;
  const {
    buildConnectedSegmentationSelection,
    buildConnectedVolumeSegmentationSelection,
    runSegmentationMlHelper,
    commitSegmentationShape,
    commitPendingSegmentationSelection,
    completeSegmentationPolygon,
    cancelSegmentationDraft,
  } = segmentationShapeActions;

  const openSegmentationHelper = (event) => {
    if (readOnly) return;
    segmentationHelperOpenerRef.current = event?.currentTarget || document.activeElement;
    const fallbackAxis = activeMprPane === 'volume' ? 'axial' : activeMprPane;
    const axis = MPR_AXES.includes(fallbackAxis) ? fallbackAxis : 'axial';
    let initialSegment = null;
    if (segmentationSegments.length === 0) {
      const firstSegment = makeHelperSegment(
        0,
        axis,
        getSegmentationCanonicalSliceIndex(axis),
        mprDimensions,
        volumeCacheState.cache,
      );
      if (selectedPart?.id) {
        segmentationLocalDraftsRef.current.set(
          `${projectId}:${selectedPart.id}:${firstSegment.id}`,
          {
            localId: String(firstSegment.id),
            serverId: '',
            version: 0,
            segment: firstSegment,
          },
        );
      }
      initialSegment = firstSegment;
    }
    segmentationDraftRef.current = null;
    segmentationHelperActions.open(axis, initialSegment);
  };

  const closeSegmentationHelper = useCallback(() => {
    const pointerSession = segmentationPointerSessionRef.current;
    if (pointerSession) {
      safeReleasePointerCapture(pointerSession.captureTarget, pointerSession.pointerId);
      segmentationPointerSessionRef.current = null;
    }
    segmentationVolumeRequestRef.current.controller?.abort();
    segmentationVolumeRequestRef.current = {
      generation: segmentationVolumeRequestRef.current.generation + 1,
      controller: null,
    };
    segmentationHelperActions.close();
    segmentationDraftRef.current = null;
    window.requestAnimationFrame(() => segmentationHelperOpenerRef.current?.focus());
  }, [
    segmentationDraftRef,
    segmentationHelperActions,
    segmentationHelperOpenerRef,
    segmentationPointerSessionRef,
    segmentationVolumeRequestRef,
  ]);

  useEffect(() => {
    if (!segmentationHelperOpen) return undefined;
    segmentationHelperCloseRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSegmentationHelper();
        return;
      }
      if (event.key !== 'Tab') return;
      trapHelperDialogTab(event, segmentationHelperDialogRef.current);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeSegmentationHelper, segmentationHelperCloseRef, segmentationHelperDialogRef, segmentationHelperOpen]);

  const stagePointer = useSegmentationStagePointer({
    segmentationHelperAxis,
    mprDimensions,
    volumeCacheState,
    mprProjectionMirror,
    stepSlicePosition,
    readOnly,
    selectedSegmentationSegment,
    segmentationPointerSessionRef,
    segmentationHelperActions,
    segmentationTool,
    segmentationOperation,
    getActiveSegmentationToolMode,
    runSegmentationMlHelper,
    getSegmentationVoxelPosition,
    makeSegmentationShapeBase,
    segmentationDraftRef,
    buildConnectedVolumeSegmentationSelection,
    buildConnectedSegmentationSelection,
    segmentationSensitivity,
    getSegmentationVolumeSpacing,
    getSegmentationVolumeDimensions,
    commitSegmentationShape,
  });

  const addSegmentationSegment = () => {
    if (readOnly) return;
    cancelSegmentationDraft();
    const nextSegment = makeHelperSegment(
      segmentationSegments.length,
      segmentationHelperAxis,
      getSegmentationCanonicalSliceIndex(segmentationHelperAxis),
      mprDimensions,
      volumeCacheState.cache,
    );
    segmentationHelperActions.addSegment(nextSegment);
    persistSegmentationSegment(nextSegment);
  };

  const focusNavigationAxis = (axis) => {
    applyMprNavigationSession({
      activePane: axis,
      lastActiveAxis: axis,
    });
  };

  const segmentationHelperModalHandlers = {
    onSelectView: (view) => {
      cancelSegmentationDraft({
        preservePendingSelection: true,
        preserveVolumeRequest: true,
      });
      segmentationHelperActions.selectView(view);
      if (view.axis) focusNavigationAxis(view.axis);
    },
    onFocusAxis: (axis) => {
      segmentationHelperActions.focusAxis(axis);
      focusNavigationAxis(axis);
    },
    onSelectSegment: (segment, toggleEditing) => {
      cancelSegmentationDraft();
      segmentationHelperActions.selectSegment(segment, { toggleEditing });
      focusNavigationAxis(segment.axis);
    },
    onSliceChange: updateSlicePosition,
    onAddSegment: addSegmentationSegment,
    onUpdateSegment: updateSegmentationSegment,
    onSaveSegmentPatch: saveSegmentationSegmentPatch,
    onCommitPendingSelection: commitPendingSegmentationSelection,
    onSelectTool: (toolId) => {
      cancelSegmentationDraft();
      segmentationHelperActions.selectTool(toolId);
    },
    onSelectToolMode: (toolId, mode) => {
      cancelSegmentationDraft();
      segmentationHelperActions.setToolMode(toolId, mode);
    },
  };

  const segmentationHelperStageHandlers = {
    onWheel: stagePointer.handleSegmentationHelperWheel,
    onPointerDown: stagePointer.handleSegmentationStagePointerDown,
    onPointerMove: stagePointer.handleSegmentationStagePointerMove,
    onPointerUp: stagePointer.handleSegmentationStagePointerUp,
    onPointerLeave: stagePointer.handleSegmentationStagePointerLeave,
    onPointerCancel: stagePointer.handleSegmentationStagePointerCancel,
    onDoubleClick: completeSegmentationPolygon,
  };

  return {
    openSegmentationHelper,
    closeSegmentationHelper,
    segmentationHelperModalHandlers,
    segmentationHelperStageHandlers,
  };
}
