import {
  SEGMENTATION_HELPER_TOOLS,
  SEGMENTATION_VIEW_BY_AXIS,
  DEFAULT_SEGMENTATION_TOOL_MODES,
  getDefaultSegmentationMlMethod,
  getDefaultSegmentationMlParameters,
} from './segmentationConfig';

const DEFAULT_ML_GROUP = 'opencv';
const DEFAULT_ML_METHOD = 'segmentation.opencv.placeholder';

export function createInitialSegmentationHelperState() {
  return {
    open: false,
    axis: 'axial',
    view: 'z',
    segments: [],
    selectedSegmentId: '',
    editingSegmentId: '',
    tool: 'brush',
    toolModes: DEFAULT_SEGMENTATION_TOOL_MODES,
    operation: 'add',
    brushSize: 18,
    sensitivity: 28,
    pendingSelection: null,
    draftShape: null,
    pointerPreview: null,
    mlGroup: DEFAULT_ML_GROUP,
    mlMethod: DEFAULT_ML_METHOD,
    mlParameters: getDefaultSegmentationMlParameters(DEFAULT_ML_METHOD),
    mlStatus: '',
    mlLoading: false,
    volumeStatus: '',
    volumeLoading: false,
  };
}

const sameId = (left, right) => String(left) === String(right);

function patchState(state, patch) {
  const changed = Object.keys(patch).some((key) => !Object.is(state[key], patch[key]));
  return changed ? { ...state, ...patch } : state;
}

function openHelper(state, { axis, initialSegment }) {
  const segmentPatch = initialSegment
    ? { segments: [initialSegment], selectedSegmentId: initialSegment.id, editingSegmentId: '' }
    : {};
  return {
    ...state,
    ...segmentPatch,
    axis,
    view: SEGMENTATION_VIEW_BY_AXIS[axis] || 'z',
    pendingSelection: null,
    draftShape: null,
    volumeStatus: '',
    open: true,
  };
}

function syncSegments(state, { segments }) {
  if (segments.length === 0) {
    return { ...state, segments, selectedSegmentId: '', editingSegmentId: '' };
  }
  const current = state.selectedSegmentId;
  const keepCurrent = current && segments.some((segment) => sameId(segment.id, current));
  return { ...state, segments, selectedSegmentId: keepCurrent ? current : segments[0].id };
}

function removeSegment(state, { annotationId, localId }) {
  const removedIds = [String(annotationId), String(localId)];
  const clearIfRemoved = (current) => (removedIds.includes(String(current)) ? '' : current);
  return {
    ...state,
    segments: state.segments.filter((segment) => (
      !sameId(segment.id, annotationId)
      && !sameId(segment.id, localId)
      && !sameId(segment.annotationId, annotationId)
    )),
    selectedSegmentId: clearIfRemoved(state.selectedSegmentId),
    editingSegmentId: clearIfRemoved(state.editingSegmentId),
  };
}

function replaceSavedSegment(state, { localId, resolvedId, segment: savedSegment }) {
  const resolveId = (current) => (sameId(current, localId) ? resolvedId : current);
  return {
    ...state,
    segments: state.segments.map((segment) => (
      sameId(segment.id, localId) || String(segment.id) === resolvedId ? savedSegment : segment
    )),
    selectedSegmentId: resolveId(state.selectedSegmentId),
    editingSegmentId: resolveId(state.editingSegmentId),
  };
}

function setSegmentVisibility(state, { resourceId, visible }) {
  return {
    ...state,
    segments: state.segments.map((segment) => (
      [segment.id, segment.annotationId].some((candidate) => sameId(candidate, resourceId))
        ? { ...segment, visible }
        : segment
    )),
  };
}

function selectSegment(state, { segment, toggleEditing }) {
  const next = { ...state, selectedSegmentId: segment.id, axis: segment.axis };
  if (!['mpr', '3d'].includes(state.view)) {
    next.view = SEGMENTATION_VIEW_BY_AXIS[segment.axis] || 'z';
  }
  if (toggleEditing) {
    next.editingSegmentId = state.editingSegmentId === segment.id ? '' : segment.id;
  }
  return next;
}

function selectView(state, { view }) {
  if (view.axis) return { ...state, view: view.id, axis: view.axis };
  const activeTool = SEGMENTATION_HELPER_TOOLS.find((tool) => tool.id === state.tool)
    || SEGMENTATION_HELPER_TOOLS[0];
  if (view.id === '3d' && !activeTool.modes?.includes('3d')) {
    return { ...state, view: view.id, tool: 'brush' };
  }
  return { ...state, view: view.id };
}

function cancelDraft(state, { preservePendingSelection = false, stopVolumeLoading = false }) {
  const patch = { draftShape: null };
  if (!preservePendingSelection) patch.pendingSelection = null;
  if (stopVolumeLoading) patch.volumeLoading = false;
  return patchState(state, patch);
}

function selectMlMethod(state, groupPatch, methodId) {
  return {
    ...state,
    ...groupPatch,
    mlMethod: methodId,
    mlParameters: getDefaultSegmentationMlParameters(methodId),
    pendingSelection: null,
    mlStatus: '',
  };
}

const SEGMENT_HANDLERS = {
  syncSegments,
  removeSegment,
  replaceSavedSegment,
  setSegmentVisibility,
  selectSegment,
  addSegment: (state, { segment }) => ({
    ...state,
    segments: [...state.segments, segment],
    selectedSegmentId: segment.id,
    editingSegmentId: segment.id,
  }),
  patchSegment: (state, { segmentId, patch }) => ({
    ...state,
    segments: state.segments.map((segment) => (
      segment.id === segmentId ? { ...segment, ...patch } : segment
    )),
  }),
};

const SESSION_HANDLERS = {
  open: openHelper,
  close: (state) => patchState(state, {
    open: false,
    pendingSelection: null,
    draftShape: null,
    pointerPreview: null,
    volumeLoading: false,
    volumeStatus: '',
  }),
  resetForReadOnly: (state) => patchState(state, {
    open: false,
    editingSegmentId: '',
    pendingSelection: null,
    draftShape: null,
  }),
  selectView,
  focusAxis: (state, { axis }) => patchState(state, {
    axis,
    view: SEGMENTATION_VIEW_BY_AXIS[axis] || 'z',
  }),
};

const TOOL_HANDLERS = {
  selectTool: (state, { toolId }) => patchState(state, { tool: toolId, volumeStatus: '' }),
  setToolMode: (state, { toolId, mode }) => ({
    ...state,
    toolModes: { ...state.toolModes, [toolId]: mode },
    volumeStatus: '',
  }),
  setOperation: (state, { operation }) => patchState(state, { operation }),
  setBrushSize: (state, { brushSize }) => patchState(state, { brushSize }),
  setSensitivity: (state, { sensitivity }) => patchState(state, { sensitivity }),
  setPendingSelection: (state, { selection }) => patchState(state, { pendingSelection: selection }),
  setDraftShape: (state, { shape }) => patchState(state, { draftShape: shape }),
  finishDraft: (state, { selection }) => patchState(state, { pendingSelection: selection, draftShape: null }),
  cancelDraft,
  setPointerPreview: (state, { position }) => patchState(state, { pointerPreview: position }),
};

const ML_HANDLERS = {
  setMlParameter: (state, { name, value }) => ({
    ...state,
    mlParameters: { ...state.mlParameters, [name]: value },
    pendingSelection: null,
    mlStatus: '',
  }),
  setMlGroup: (state, { groupId }) => selectMlMethod(
    state,
    { mlGroup: groupId },
    getDefaultSegmentationMlMethod(groupId),
  ),
  setMlMethod: (state, { methodId }) => selectMlMethod(state, {}, methodId),
  setMlStatus: (state, { status }) => patchState(state, { mlStatus: status }),
  setMlSelection: (state, { selection, status }) => patchState(state, {
    pendingSelection: selection,
    mlStatus: status,
  }),
  setMlLoading: (state, { loading }) => patchState(state, { mlLoading: loading }),
};

const VOLUME_HANDLERS = {
  startVolumePreview: (state, { status }) => patchState(state, {
    pendingSelection: null,
    volumeLoading: true,
    volumeStatus: status,
  }),
  setVolumeStatus: (state, { status }) => patchState(state, { volumeStatus: status }),
  setVolumeLoading: (state, { loading }) => patchState(state, { volumeLoading: loading }),
};

const HANDLERS = {
  ...SEGMENT_HANDLERS,
  ...SESSION_HANDLERS,
  ...TOOL_HANDLERS,
  ...ML_HANDLERS,
  ...VOLUME_HANDLERS,
};

export const SEGMENTATION_HELPER_ACTION_TYPES = Object.freeze(Object.keys(HANDLERS));

export function segmentationHelperReducer(state, action) {
  const handler = HANDLERS[action?.type];
  return handler ? handler(state, action) : state;
}
