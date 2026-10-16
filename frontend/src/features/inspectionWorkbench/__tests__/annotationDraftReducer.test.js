import {
  ANNOTATION_DRAFT_SURFACES,
  FULLSCREEN_MIN_MEASURE_LENGTH_PX,
  annotationDraftReducer,
  createInitialAnnotationDraftState,
  getDraftBox,
  getDraftLine,
  isCommittableDraftBox,
  isCommittableDraftLine,
} from '../annotationDraftReducer';

const point = (x, y, extra = {}) => ({ x, y, imageWidth: 100, imageHeight: 80, ...extra });
const reduce = (actions, state = createInitialAnnotationDraftState()) => actions.reduce(annotationDraftReducer, state);

describe('annotationDraftReducer', () => {
  test('starts with empty slots for every surface', () => {
    const state = createInitialAnnotationDraftState();
    expect(Object.keys(state)).toEqual(ANNOTATION_DRAFT_SURFACES);
    ANNOTATION_DRAFT_SURFACES.forEach((surface) => {
      expect(state[surface]).toEqual({ measure: null, drag: null, pending: null, preview: null });
    });
  });

  test('ignores unknown surfaces and actions without changing identity', () => {
    const state = createInitialAnnotationDraftState();
    expect(annotationDraftReducer(state, { type: 'start', surface: 'gallery', slot: 'measure', point: point(1, 1) })).toBe(state);
    expect(annotationDraftReducer(state, { type: 'unknown', surface: 'tile' })).toBe(state);
    expect(annotationDraftReducer(state, { type: 'cancel', surface: 'tile' })).toBe(state);
  });

  test('keeps surfaces independent', () => {
    const state = reduce([
      { type: 'start', surface: 'tile', slot: 'measure', point: point(1, 2, { imageId: 'a' }) },
      { type: 'start', surface: 'fullscreen', slot: 'drag', point: point(3, 4) },
    ]);
    expect(state.tile.measure).toEqual(point(1, 2, { imageId: 'a' }));
    expect(state.fullscreen.drag).toEqual(point(3, 4));
    expect(state.mpr.measure).toBeNull();
    expect(state.tile.drag).toBeNull();
  });

  describe('tile surface', () => {
    test('measure: start, move, finish clears anchor and preview', () => {
      const anchor = point(10, 10, { mode: 'measure', imageId: 'img-1' });
      let state = reduce([{ type: 'start', surface: 'tile', slot: 'measure', point: anchor }]);
      expect(state.tile.measure).toBe(anchor);
      const preview = { mode: 'measure', imageId: 'img-1', line: getDraftLine(anchor, point(20, 10)) };
      state = annotationDraftReducer(state, { type: 'move', surface: 'tile', preview });
      expect(state.tile.preview).toBe(preview);
      expect(state.tile.measure).toBe(anchor);
      state = annotationDraftReducer(state, { type: 'finish', surface: 'tile' });
      expect(state.tile).toEqual({ measure: null, drag: null, pending: null, preview: null });
    });

    test('box: drag start replaces a measure anchor and cancel clears everything', () => {
      let state = reduce([
        { type: 'start', surface: 'tile', slot: 'measure', point: point(1, 1) },
        { type: 'start', surface: 'tile', slot: 'drag', point: point(5, 5, { mode: 'box' }) },
      ]);
      expect(state.tile.measure).toBeNull();
      expect(state.tile.drag).toEqual(point(5, 5, { mode: 'box' }));
      state = annotationDraftReducer(state, { type: 'move', surface: 'tile', preview: { mode: 'crop', box: {} } });
      state = annotationDraftReducer(state, { type: 'cancel', surface: 'tile' });
      expect(state.tile).toEqual({ measure: null, drag: null, pending: null, preview: null });
    });

    test('box drag committing requires a positive finite box', () => {
      const anchor = point(10, 10);
      expect(isCommittableDraftBox(getDraftBox(anchor, point(10, 30)))).toBe(false);
      expect(isCommittableDraftBox(getDraftBox(anchor, point(30, 10)))).toBe(false);
      const box = getDraftBox(anchor, point(4, 30));
      expect(box).toEqual({ x: 4, y: 10, width: 6, height: 20, imageWidth: 100, imageHeight: 80 });
      expect(isCommittableDraftBox(box)).toBe(true);
    });
  });

  describe('mpr surface', () => {
    test('measure keeps the first slice index in the committed line', () => {
      const anchor = point(2, 3, { mode: 'measure', axis: 'axial', sliceIndex: 7 });
      const state = reduce([{ type: 'start', surface: 'mpr', slot: 'measure', point: anchor }]);
      const line = getDraftLine(state.mpr.measure, point(8, 3, { sliceIndex: 9 }), { axis: 'axial', slice_index: anchor.sliceIndex });
      expect(line).toEqual({ x1: 2, y1: 3, x2: 8, y2: 3, imageWidth: 100, imageHeight: 80, axis: 'axial', slice_index: 7 });
      expect(isCommittableDraftLine(line)).toBe(true);
    });

    test('cube: first finish stores a pending face, second drag keeps it, completion clears it', () => {
      const pending = { mode: 'cube-pending', axis: 'axial', sliceIndex: 3, box: { x: 1 } };
      let state = reduce([
        { type: 'start', surface: 'mpr', slot: 'drag', point: point(1, 1, { mode: 'cube', axis: 'axial' }) },
        { type: 'move', surface: 'mpr', preview: { mode: 'cube' } },
        { type: 'finish', surface: 'mpr', pending },
      ]);
      expect(state.mpr).toEqual({ measure: null, drag: null, pending, preview: null });
      state = annotationDraftReducer(state, {
        type: 'start', surface: 'mpr', slot: 'drag', point: point(2, 2), keepPending: true,
      });
      expect(state.mpr.pending).toBe(pending);
      expect(state.mpr.drag).toEqual(point(2, 2));
      state = annotationDraftReducer(state, { type: 'finish', surface: 'mpr' });
      expect(state.mpr.pending).toBe(pending);
      state = annotationDraftReducer(state, { type: 'finish', surface: 'mpr', pending: null });
      expect(state.mpr.pending).toBeNull();
    });

    test('a non-cube start drops the pending cube face', () => {
      const pending = { mode: 'cube-pending', axis: 'axial', sliceIndex: 3, box: {} };
      const state = reduce([
        { type: 'setPending', surface: 'mpr', pending },
        { type: 'start', surface: 'mpr', slot: 'drag', point: point(1, 1, { mode: 'box' }) },
      ]);
      expect(state.mpr.pending).toBeNull();
    });

    test('pointer cancel clears only the drag and preview slots', () => {
      const pending = { mode: 'cube-pending', axis: 'axial', sliceIndex: 3, box: {} };
      const state = reduce([
        { type: 'setPending', surface: 'mpr', pending },
        { type: 'start', surface: 'mpr', slot: 'drag', point: point(1, 1), keepPending: true },
        { type: 'move', surface: 'mpr', preview: { mode: 'cube' } },
        { type: 'cancel', surface: 'mpr', slots: ['drag', 'preview'] },
      ]);
      expect(state.mpr).toEqual({ measure: null, drag: null, pending, preview: null });
    });
  });

  describe('fullscreen surface', () => {
    test('measure: start, move, finish', () => {
      let state = reduce([
        { type: 'start', surface: 'fullscreen', slot: 'measure', point: point(0, 0) },
        { type: 'move', surface: 'fullscreen', preview: { mode: 'measure', line: {} } },
      ]);
      expect(state.fullscreen.preview).toEqual({ mode: 'measure', line: {} });
      state = annotationDraftReducer(state, { type: 'finish', surface: 'fullscreen' });
      expect(state.fullscreen.measure).toBeNull();
      expect(state.fullscreen.preview).toBeNull();
    });

    test('measure lines shorter than the minimum drag length are not committable', () => {
      const anchor = point(10, 10);
      expect(FULLSCREEN_MIN_MEASURE_LENGTH_PX).toBe(2);
      const shortLine = getDraftLine(anchor, point(11, 11));
      expect(Math.hypot(1, 1)).toBeLessThan(2);
      expect(isCommittableDraftLine(shortLine, { minLength: FULLSCREEN_MIN_MEASURE_LENGTH_PX })).toBe(false);
      expect(isCommittableDraftLine(getDraftLine(anchor, point(12, 10)), { minLength: FULLSCREEN_MIN_MEASURE_LENGTH_PX })).toBe(true);
      expect(isCommittableDraftLine(getDraftLine(anchor, point(Number.NaN, 10)), { minLength: FULLSCREEN_MIN_MEASURE_LENGTH_PX })).toBe(false);
      expect(isCommittableDraftLine(null)).toBe(false);
    });

    test('selective cancel keeps unrelated slots', () => {
      const state = reduce([
        { type: 'start', surface: 'fullscreen', slot: 'drag', point: point(4, 4) },
        { type: 'move', surface: 'fullscreen', preview: { mode: 'box', box: {} } },
        { type: 'cancel', surface: 'fullscreen', slots: ['preview'] },
      ]);
      expect(state.fullscreen.drag).toEqual(point(4, 4));
      expect(state.fullscreen.preview).toBeNull();
    });
  });

  test('resetAll clears every surface', () => {
    const state = reduce([
      { type: 'start', surface: 'tile', slot: 'measure', point: point(1, 1) },
      { type: 'setPending', surface: 'mpr', pending: { box: {} } },
      { type: 'start', surface: 'fullscreen', slot: 'drag', point: point(1, 1) },
      { type: 'resetAll' },
    ]);
    expect(state).toEqual(createInitialAnnotationDraftState());
  });
});
