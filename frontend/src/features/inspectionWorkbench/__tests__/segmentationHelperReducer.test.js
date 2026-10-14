import {
  createInitialSegmentationHelperState,
  segmentationHelperReducer,
} from '../segmentationHelperReducer';

const reduce = (state, ...actions) => actions.reduce(segmentationHelperReducer, state);
const segment = (id, extra = {}) => ({ id, axis: 'axial', name: `Segment ${id}`, ...extra });

describe('segmentationHelperReducer', () => {
  test('starts closed with the default tool, ML method and sizes', () => {
    const state = createInitialSegmentationHelperState();
    expect(state).toMatchObject({
      open: false,
      axis: 'axial',
      view: 'z',
      segments: [],
      tool: 'brush',
      operation: 'add',
      brushSize: 18,
      sensitivity: 28,
      mlGroup: 'opencv',
      mlMethod: 'segmentation.opencv.placeholder',
      mlLoading: false,
      volumeLoading: false,
    });
  });

  test('open seeds an initial segment, maps the axis to a view and clears transient selection', () => {
    const base = { ...createInitialSegmentationHelperState(), pendingSelection: { tool: 'circle' }, draftShape: {}, volumeStatus: 'x' };
    const opened = reduce(base, { type: 'open', axis: 'coronal', initialSegment: segment('s1') });
    expect(opened).toMatchObject({
      open: true,
      axis: 'coronal',
      view: 'y',
      segments: [segment('s1')],
      selectedSegmentId: 's1',
      editingSegmentId: '',
      pendingSelection: null,
      draftShape: null,
      volumeStatus: '',
    });
    const reopened = reduce({ ...opened, open: false, editingSegmentId: 's1' }, { type: 'open', axis: 'axial', initialSegment: null });
    expect(reopened.segments).toEqual([segment('s1')]);
    expect(reopened.editingSegmentId).toBe('s1');
  });

  test('close and read-only reset clear only their documented fields', () => {
    const busy = {
      ...createInitialSegmentationHelperState(),
      open: true,
      editingSegmentId: 's1',
      pendingSelection: {},
      draftShape: {},
      pointerPreview: { x: 1 },
      volumeLoading: true,
      volumeStatus: 'busy',
    };
    expect(reduce(busy, { type: 'close' })).toMatchObject({
      open: false, pendingSelection: null, draftShape: null, pointerPreview: null, volumeLoading: false, volumeStatus: '', editingSegmentId: 's1',
    });
    expect(reduce(busy, { type: 'resetForReadOnly' })).toMatchObject({
      open: false, editingSegmentId: '', pendingSelection: null, draftShape: null, pointerPreview: { x: 1 }, volumeStatus: 'busy',
    });
  });

  test('syncSegments keeps a still-present selection, falls back to the first, and clears when empty', () => {
    const state = { ...createInitialSegmentationHelperState(), selectedSegmentId: 's2', editingSegmentId: 's2' };
    expect(reduce(state, { type: 'syncSegments', segments: [segment('s1'), segment('s2')] }).selectedSegmentId).toBe('s2');
    const fallback = reduce(state, { type: 'syncSegments', segments: [segment('s3')] });
    expect(fallback).toMatchObject({ selectedSegmentId: 's3', editingSegmentId: 's2' });
    expect(reduce(state, { type: 'syncSegments', segments: [] })).toMatchObject({ selectedSegmentId: '', editingSegmentId: '' });
  });

  test('persistence replace and remove remap selection ids', () => {
    const state = {
      ...createInitialSegmentationHelperState(),
      segments: [segment('local-1'), segment('s2', { annotationId: 'ann-2' })],
      selectedSegmentId: 'local-1',
      editingSegmentId: 'local-1',
    };
    const saved = reduce(state, { type: 'replaceSavedSegment', localId: 'local-1', resolvedId: 'ann-1', segment: segment('ann-1') });
    expect(saved.segments.map((entry) => entry.id)).toEqual(['ann-1', 's2']);
    expect(saved).toMatchObject({ selectedSegmentId: 'ann-1', editingSegmentId: 'ann-1' });
    const removed = reduce(saved, { type: 'removeSegment', annotationId: 'ann-2', localId: 'missing' });
    expect(removed.segments.map((entry) => entry.id)).toEqual(['ann-1']);
    expect(removed.selectedSegmentId).toBe('ann-1');
    const removedSelected = reduce(saved, { type: 'removeSegment', annotationId: 'ann-1', localId: 'local-1' });
    expect(removedSelected).toMatchObject({ selectedSegmentId: '', editingSegmentId: '' });
  });

  test('add, patch and visibility update segments', () => {
    const added = reduce(createInitialSegmentationHelperState(), { type: 'addSegment', segment: segment('s1', { annotationId: 'ann-1' }) });
    expect(added).toMatchObject({ selectedSegmentId: 's1', editingSegmentId: 's1' });
    const patched = reduce(added, { type: 'patchSegment', segmentId: 's1', patch: { name: 'Renamed' } });
    expect(patched.segments[0].name).toBe('Renamed');
    const hidden = reduce(patched, { type: 'setSegmentVisibility', resourceId: 'ann-1', visible: false });
    expect(hidden.segments[0].visible).toBe(false);
  });

  test('selectSegment follows the axis outside MPR/3D views and toggles editing', () => {
    const state = { ...createInitialSegmentationHelperState(), view: 'z' };
    const selected = reduce(state, { type: 'selectSegment', segment: segment('s1', { axis: 'sagittal' }), toggleEditing: true });
    expect(selected).toMatchObject({ selectedSegmentId: 's1', axis: 'sagittal', view: 'x', editingSegmentId: 's1' });
    const toggled = reduce(selected, { type: 'selectSegment', segment: segment('s1', { axis: 'sagittal' }), toggleEditing: true });
    expect(toggled.editingSegmentId).toBe('');
    const inMpr = reduce({ ...state, view: 'mpr' }, { type: 'selectSegment', segment: segment('s1', { axis: 'coronal' }) });
    expect(inMpr).toMatchObject({ view: 'mpr', axis: 'coronal', editingSegmentId: '' });
  });

  test('selectView sets the axis for slice views and resets non-3D tools in the 3D view', () => {
    const state = { ...createInitialSegmentationHelperState(), tool: 'polygon' };
    expect(reduce(state, { type: 'selectView', view: { id: 'x', axis: 'sagittal' } })).toMatchObject({ view: 'x', axis: 'sagittal', tool: 'polygon' });
    expect(reduce(state, { type: 'selectView', view: { id: 'mpr' } })).toMatchObject({ view: 'mpr', tool: 'polygon' });
    expect(reduce(state, { type: 'selectView', view: { id: '3d' } })).toMatchObject({ view: '3d', tool: 'brush' });
    expect(reduce({ ...state, tool: 'connected' }, { type: 'selectView', view: { id: '3d' } }).tool).toBe('connected');
    expect(reduce(state, { type: 'focusAxis', axis: 'coronal' })).toMatchObject({ axis: 'coronal', view: 'y' });
  });

  test('tool settings, drafts and cancel options', () => {
    const state = { ...createInitialSegmentationHelperState(), volumeStatus: 'old' };
    expect(reduce(state, { type: 'selectTool', toolId: 'polygon' })).toMatchObject({ tool: 'polygon', volumeStatus: '' });
    expect(reduce(state, { type: 'setToolMode', toolId: 'brush', mode: '3d' }).toolModes.brush).toBe('3d');
    expect(reduce(state, { type: 'setOperation', operation: 'subtract' }, { type: 'setBrushSize', brushSize: 40 }, { type: 'setSensitivity', sensitivity: 50 }))
      .toMatchObject({ operation: 'subtract', brushSize: 40, sensitivity: 50 });
    const drafting = reduce(state, { type: 'setDraftShape', shape: { tool: 'polygon' } }, { type: 'setPendingSelection', selection: { tool: 'circle' } });
    expect(reduce(drafting, { type: 'finishDraft', selection: { tool: 'polygon', closed: true } }))
      .toMatchObject({ draftShape: null, pendingSelection: { tool: 'polygon', closed: true } });
    const loading = { ...drafting, volumeLoading: true };
    expect(reduce(loading, { type: 'cancelDraft', preservePendingSelection: true }))
      .toMatchObject({ draftShape: null, pendingSelection: { tool: 'circle' }, volumeLoading: true });
    expect(reduce(loading, { type: 'cancelDraft', stopVolumeLoading: true }))
      .toMatchObject({ draftShape: null, pendingSelection: null, volumeLoading: false });
  });

  test('ML family and method changes reset parameters, selection and status', () => {
    const state = { ...createInitialSegmentationHelperState(), pendingSelection: {}, mlStatus: 'x' };
    const sam = reduce(state, { type: 'setMlGroup', groupId: 'sam' });
    expect(sam).toMatchObject({ mlGroup: 'sam', mlMethod: 'segmentation.sam.placeholder', pendingSelection: null, mlStatus: '' });
    const param = reduce({ ...sam, mlStatus: 'y', pendingSelection: {} }, { type: 'setMlParameter', name: 'mode', value: 'auto' });
    expect(param).toMatchObject({ pendingSelection: null, mlStatus: '' });
    expect(param.mlParameters.mode).toBe('auto');
    expect(reduce(param, { type: 'setMlMethod', methodId: 'segmentation.yolo.placeholder' }).mlParameters.mode).not.toBe('auto');
    expect(reduce(state, { type: 'setMlSelection', selection: { tool: 'ml' }, status: 'picked' }))
      .toMatchObject({ pendingSelection: { tool: 'ml' }, mlStatus: 'picked' });
  });

  test('volume preview lifecycle and no-op identity', () => {
    const state = { ...createInitialSegmentationHelperState(), pendingSelection: {} };
    const started = reduce(state, { type: 'startVolumePreview', status: 'Growing' });
    expect(started).toMatchObject({ pendingSelection: null, volumeLoading: true, volumeStatus: 'Growing' });
    expect(reduce(started, { type: 'setVolumeLoading', loading: false }, { type: 'setVolumeStatus', status: 'done' }))
      .toMatchObject({ volumeLoading: false, volumeStatus: 'done' });
    expect(segmentationHelperReducer(started, { type: 'setVolumeStatus', status: 'Growing' })).toBe(started);
    expect(segmentationHelperReducer(started, { type: 'unknown' })).toBe(started);
  });
});
