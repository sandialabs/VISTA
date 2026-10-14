import { useEffect, useRef } from 'react';
import useSegmentationHelper from './useSegmentationHelper';
import useSegmentationSegmentSync, { useSelectedSegmentationSegment } from './useSegmentationSegmentSync';
import useSegmentationHelper3dDerived from './useSegmentationHelper3dDerived';
import { createSegmentationGeometry } from './segmentationVolumeGeometry';
import { useSegmentationPersistence } from './useSegmentationPersistence';
import { useSegmentationShapeActions } from './useSegmentationShapeActions';
import { useSegmentationHelperActions } from './useSegmentationHelperActions';

function useSegmentationWorkbenchRefs() {
  return {
    segmentationHelperDialogRef: useRef(null),
    segmentationHelperCloseRef: useRef(null),
    segmentationHelperOpenerRef: useRef(null),
    segmentationDraftRef: useRef(null),
    segmentationPointerSessionRef: useRef(null),
    segmentationVolumeRequestRef: useRef({ generation: 0, controller: null }),
    segmentationMutationQueuesRef: useRef(new Map()),
    segmentationServerIdsRef: useRef(new Map()),
    segmentationLocalDraftsRef: useRef(new Map()),
    segmentationMlCacheRef: useRef(new Map()),
  };
}

function useSegmentationWorkbenchState({
  annotations, mprDimensions, projectId, refs, selectedPart, selectedPartId, slicePosition,
  volumeCacheState,
}) {
  const { state, actions } = useSegmentationHelper();
  useSegmentationSegmentSync({
    annotations,
    projectId,
    segmentationHelperActions: actions,
    segmentationLocalDraftsRef: refs.segmentationLocalDraftsRef,
    selectedPartId,
  });
  const selectedSegment = useSelectedSegmentationSegment({
    segmentationSegments: state.segments,
    selectedSegmentationSegmentId: state.selectedSegmentId,
  });
  const derived3d = useSegmentationHelper3dDerived({
    mprDimensions,
    segmentationHelperAxis: state.axis,
    segmentationHelperOpen: state.open,
    segmentationHelperView: state.view,
    segmentationPendingSelection: state.pendingSelection,
    segmentationSegments: state.segments,
    selectedPart,
    selectedSegmentationSegment: selectedSegment,
    slicePosition,
    volumeCacheState,
  });
  return { state, actions, selectedSegment, derived3d };
}

function buildSegmentationGeometry({ state, derived3d, inputs }) {
  return createSegmentationGeometry({
    segmentationHelperVolumeDimensions: derived3d.segmentationHelperVolumeDimensions,
    segmentationHelperAxis: state.axis,
    segmentationHelperView: state.view,
    segmentationTool: state.tool,
    segmentationToolModes: state.toolModes,
    segmentationOperation: state.operation,
    segmentationBrushSize: state.brushSize,
    segmentationSensitivity: state.sensitivity,
    segmentationMlMethod: state.mlMethod,
    segmentationMlParameters: state.mlParameters,
    slicePosition: inputs.slicePosition,
    mprDimensions: inputs.mprDimensions,
    volumeCacheState: inputs.volumeCacheState,
    selectedPart: inputs.selectedPart,
    displayWindow: inputs.displayWindow,
  });
}

function useWorkbenchPersistence({ workbench, refs, geometry, inputs }) {
  return useSegmentationPersistence({
    readOnly: inputs.readOnly,
    projectId: inputs.projectId,
    selectedPart: inputs.selectedPart,
    annotations: inputs.annotations,
    setAnnotations: inputs.setAnnotations,
    setSelectedAnnotationId: inputs.setSelectedAnnotationId,
    setError: inputs.setError,
    segmentationSegments: workbench.state.segments,
    segmentationHelperActions: workbench.actions,
    segmentationMutationQueuesRef: refs.segmentationMutationQueuesRef,
    segmentationServerIdsRef: refs.segmentationServerIdsRef,
    segmentationLocalDraftsRef: refs.segmentationLocalDraftsRef,
    activeSegmentationPersistenceScopeRef: inputs.persistenceScopeRef,
    getSegmentationVolumeDimensions: geometry.getSegmentationVolumeDimensions,
  });
}

function useWorkbenchShapeActions({ workbench, refs, geometry, persistence, inputs }) {
  const { state } = workbench;
  return useSegmentationShapeActions({
    readOnly: inputs.readOnly,
    projectId: inputs.projectId,
    selectedPart: inputs.selectedPart,
    slicePosition: inputs.slicePosition,
    displayWindow: inputs.displayWindow,
    mprDimensions: inputs.mprDimensions,
    volumeCacheState: inputs.volumeCacheState,
    segmentationHelperAxis: state.axis,
    segmentationTool: state.tool,
    segmentationOperation: state.operation,
    segmentationSensitivity: state.sensitivity,
    segmentationMlMethod: state.mlMethod,
    segmentationMlParameters: state.mlParameters,
    segmentationPendingSelection: state.pendingSelection,
    selectedSegmentationSegment: workbench.selectedSegment,
    segmentationHelperActions: workbench.actions,
    segmentationDraftRef: refs.segmentationDraftRef,
    segmentationPointerSessionRef: refs.segmentationPointerSessionRef,
    segmentationVolumeRequestRef: refs.segmentationVolumeRequestRef,
    segmentationMlCacheRef: refs.segmentationMlCacheRef,
    segmentationGeometry: geometry,
    persistSegmentationSegment: persistence.persistSegmentationSegment,
    updateSegmentationSegment: persistence.updateSegmentationSegment,
  });
}

function useWorkbenchHelperActions({ workbench, refs, geometry, persistence, shapeActions, inputs }) {
  const { state } = workbench;
  return useSegmentationHelperActions({
    readOnly: inputs.readOnly,
    projectId: inputs.projectId,
    selectedPart: inputs.selectedPart,
    activeMprPane: inputs.activeMprPane,
    mprDimensions: inputs.mprDimensions,
    volumeCacheState: inputs.volumeCacheState,
    mprProjectionMirror: inputs.mprProjectionMirror,
    stepSlicePosition: inputs.stepSlicePosition,
    updateSlicePosition: inputs.updateSlicePosition,
    applyMprNavigationSession: inputs.applyMprNavigationSession,
    segmentationHelperState: {
      segmentationHelperOpen: state.open,
      segmentationHelperAxis: state.axis,
      segmentationSegments: state.segments,
      selectedSegmentationSegment: workbench.selectedSegment,
      segmentationTool: state.tool,
      segmentationOperation: state.operation,
      segmentationSensitivity: state.sensitivity,
    },
    segmentationHelperActions: workbench.actions,
    segmentationRefs: {
      segmentationHelperDialogRef: refs.segmentationHelperDialogRef,
      segmentationHelperCloseRef: refs.segmentationHelperCloseRef,
      segmentationHelperOpenerRef: refs.segmentationHelperOpenerRef,
      segmentationDraftRef: refs.segmentationDraftRef,
      segmentationPointerSessionRef: refs.segmentationPointerSessionRef,
      segmentationVolumeRequestRef: refs.segmentationVolumeRequestRef,
      segmentationLocalDraftsRef: refs.segmentationLocalDraftsRef,
    },
    segmentationGeometry: geometry,
    segmentationPersistence: persistence,
    segmentationShapeActions: shapeActions,
  });
}

function buildDialogProps({ workbench, refs, geometry, helperActions }) {
  const { derived3d } = workbench;
  return {
    state: workbench.state,
    actions: workbench.actions,
    dialogRef: refs.segmentationHelperDialogRef,
    closeButtonRef: refs.segmentationHelperCloseRef,
    onClose: helperActions.closeSegmentationHelper,
    handlers: helperActions.segmentationHelperModalHandlers,
    stageHandlers: helperActions.segmentationHelperStageHandlers,
    selectedSegment: workbench.selectedSegment,
    volumeDimensions: geometry.getSegmentationVolumeDimensions(),
    pendingVolumePreviewSegment: derived3d.segmentationHelperPending3dPreviewSegment,
    getCanonicalSliceIndex: geometry.getSegmentationCanonicalSliceIndex,
    getActiveToolMode: geometry.getActiveSegmentationToolMode,
    volumeMetadata: derived3d.segmentationHelper3dVolumeMetadata,
    canonicalSlicePosition: derived3d.segmentationHelperCanonicalSlicePosition,
    vectorAnnotations: derived3d.segmentationHelper3dAnnotations,
    surfacePreviewTruncated: derived3d.segmentation3dSurfacePreviewTruncated,
  };
}

/**
 * Segmentation helper workbench: reducer state, segment sync with persisted
 * annotations and local drafts, persistence queues, shape and ML actions, the
 * dialog lifecycle (Escape and Tab trap), and read-only reset. The dialog
 * keydown listener is registered by useSegmentationHelperActions, so callers
 * must invoke this hook after hooks whose document listeners must run first.
 */
export default function useInspectionSegmentationWorkbench(inputs) {
  const refs = useSegmentationWorkbenchRefs();
  const workbench = useSegmentationWorkbenchState({ ...inputs, refs });
  const geometry = buildSegmentationGeometry({ state: workbench.state, derived3d: workbench.derived3d, inputs });
  const persistence = useWorkbenchPersistence({ workbench, refs, geometry, inputs });
  const shapeActions = useWorkbenchShapeActions({ workbench, refs, geometry, persistence, inputs });
  const helperActions = useWorkbenchHelperActions({
    workbench, refs, geometry, persistence, shapeActions, inputs,
  });
  const { readOnly } = inputs;
  const { actions } = workbench;
  useEffect(() => {
    if (readOnly) actions.resetForReadOnly();
  }, [readOnly, actions]);

  return {
    helperOpen: workbench.state.open,
    helperView: workbench.state.view,
    openSegmentationHelper: helperActions.openSegmentationHelper,
    getCanonicalSliceIndex: geometry.getSegmentationCanonicalSliceIndex,
    deleteSegment: persistence.deleteSegmentationSegment,
    segmentVisibility: {
      segments: workbench.state.segments,
      setSegmentVisibility: actions.setSegmentVisibility,
      updateSegment: persistence.updateSegmentationSegment,
      persistSegment: persistence.persistSegmentationSegment,
    },
    dialog: buildDialogProps({ workbench, refs, geometry, helperActions }),
  };
}
