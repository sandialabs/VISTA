import { useCallback, useMemo, useRef, useState } from 'react';

import {
  createInitialSegmentationHelperState,
  segmentationHelperReducer,
} from './segmentationHelperReducer';

function buildSegmentationHelperActions(dispatch) {
  return {
    open: (axis, initialSegment = null) => dispatch({ type: 'open', axis, initialSegment }),
    close: () => dispatch({ type: 'close' }),
    resetForReadOnly: () => dispatch({ type: 'resetForReadOnly' }),
    selectView: (view) => dispatch({ type: 'selectView', view }),
    focusAxis: (axis) => dispatch({ type: 'focusAxis', axis }),
    syncSegments: (segments) => dispatch({ type: 'syncSegments', segments }),
    removeSegment: (annotationId, localId) => dispatch({ type: 'removeSegment', annotationId, localId }),
    replaceSavedSegment: (localId, resolvedId, segment) => dispatch({
      type: 'replaceSavedSegment',
      localId,
      resolvedId,
      segment,
    }),
    addSegment: (segment) => dispatch({ type: 'addSegment', segment }),
    patchSegment: (segmentId, patch) => dispatch({ type: 'patchSegment', segmentId, patch }),
    setSegmentVisibility: (resourceId, visible) => dispatch({ type: 'setSegmentVisibility', resourceId, visible }),
    selectSegment: (segment, { toggleEditing = false } = {}) => dispatch({ type: 'selectSegment', segment, toggleEditing }),
    selectTool: (toolId) => dispatch({ type: 'selectTool', toolId }),
    setToolMode: (toolId, mode) => dispatch({ type: 'setToolMode', toolId, mode }),
    setOperation: (operation) => dispatch({ type: 'setOperation', operation }),
    setBrushSize: (brushSize) => dispatch({ type: 'setBrushSize', brushSize }),
    setSensitivity: (sensitivity) => dispatch({ type: 'setSensitivity', sensitivity }),
    setPendingSelection: (selection) => dispatch({ type: 'setPendingSelection', selection }),
    setDraftShape: (shape) => dispatch({ type: 'setDraftShape', shape }),
    finishDraft: (selection) => dispatch({ type: 'finishDraft', selection }),
    cancelDraft: (options = {}) => dispatch({ type: 'cancelDraft', ...options }),
    setPointerPreview: (position) => dispatch({ type: 'setPointerPreview', position }),
    setMlParameter: (name, value) => dispatch({ type: 'setMlParameter', name, value }),
    setMlGroup: (groupId) => dispatch({ type: 'setMlGroup', groupId }),
    setMlMethod: (methodId) => dispatch({ type: 'setMlMethod', methodId }),
    setMlStatus: (status) => dispatch({ type: 'setMlStatus', status }),
    setMlSelection: (selection, status) => dispatch({ type: 'setMlSelection', selection, status }),
    setMlLoading: (loading) => dispatch({ type: 'setMlLoading', loading }),
    startVolumePreview: (status) => dispatch({ type: 'startVolumePreview', status }),
    setVolumeStatus: (status) => dispatch({ type: 'setVolumeStatus', status }),
    setVolumeLoading: (loading) => dispatch({ type: 'setVolumeLoading', loading }),
  };
}

/**
 * Segmentation helper modal state: open/view/axis, segments and selection,
 * tool settings, draft and pending selections, ML helper and 3D volume status.
 *
 * Dispatch reduces against a synchronous ref so several actions fired from one
 * pointer or persistence handler compose in order before the next render.
 */
export default function useSegmentationHelper() {
  const [state, setState] = useState(createInitialSegmentationHelperState);
  const stateRef = useRef(state);

  const dispatch = useCallback((action) => {
    const next = segmentationHelperReducer(stateRef.current, action);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const actions = useMemo(() => buildSegmentationHelperActions(dispatch), [dispatch]);

  return { state, actions };
}
