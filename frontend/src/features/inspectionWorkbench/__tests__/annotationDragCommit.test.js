import { commitDraggedGeometry } from '../annotationDragCommit';

const source = { id: 'a1', x1: 0, y1: 0, x2: 10, y2: 0 };
const movedLine = { kind: 'line', geometry: { ...source, x1: 5, x2: 15 } };

// Mirrors the hooks' set-preview helpers: the ref and the rendered state move together.
function makePreviewStore(initial) {
  const previewRef = { current: initial };
  const setPreview = jest.fn((value) => { previewRef.current = value; });
  return { previewRef, setPreview };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('commitDraggedGeometry', () => {
  test('keeps the preview at the drop position until the save resolves', async () => {
    const store = makePreviewStore(movedLine);
    const save = deferred();
    const updateMeasurementAnnotationLine = jest.fn(() => save.promise);
    const commit = commitDraggedGeometry({
      preview: movedLine, source, ...store, updateMeasurementAnnotationLine, updateBoxAnnotationGeometry: jest.fn(),
    });
    await Promise.resolve();
    expect(updateMeasurementAnnotationLine).toHaveBeenCalledWith('a1', movedLine.geometry);
    expect(store.setPreview).not.toHaveBeenCalled();
    expect(store.previewRef.current).toBe(movedLine);
    save.resolve({ id: 'a1' });
    await commit;
    expect(store.setPreview).toHaveBeenCalledWith(null);
  });

  test('clears the preview after a failed save so the shape returns to its saved position', async () => {
    const store = makePreviewStore(movedLine);
    const updateMeasurementAnnotationLine = jest.fn(() => Promise.reject(new Error('boom')));
    await expect(commitDraggedGeometry({
      preview: movedLine, source, ...store, updateMeasurementAnnotationLine, updateBoxAnnotationGeometry: jest.fn(),
    })).rejects.toThrow('boom');
    expect(store.previewRef.current).toBeNull();
  });

  test('does not clear a newer drag preview that replaced this one during the save', async () => {
    const store = makePreviewStore(movedLine);
    const save = deferred();
    const commit = commitDraggedGeometry({
      preview: movedLine, source, ...store, updateMeasurementAnnotationLine: () => save.promise, updateBoxAnnotationGeometry: jest.fn(),
    });
    const newerPreview = { kind: 'box', geometry: { id: 'b1', x: 1, y: 1, width: 2, height: 2 } };
    store.previewRef.current = newerPreview;
    save.resolve({ id: 'a1' });
    await commit;
    expect(store.previewRef.current).toBe(newerPreview);
    expect(store.setPreview).not.toHaveBeenCalled();
  });

  test('routes box drags to the box update', async () => {
    const box = { kind: 'box', geometry: { id: 'b1', x: 3, y: 3, width: 4, height: 4 } };
    const store = makePreviewStore(box);
    const updateBoxAnnotationGeometry = jest.fn(() => Promise.resolve({ id: 'b1' }));
    await commitDraggedGeometry({
      preview: box, source: { id: 'b1', x: 0, y: 0, width: 4, height: 4 }, ...store,
      updateMeasurementAnnotationLine: jest.fn(), updateBoxAnnotationGeometry,
    });
    expect(updateBoxAnnotationGeometry).toHaveBeenCalledWith('b1', box.geometry);
    expect(store.previewRef.current).toBeNull();
  });

  test.each([
    ['cancelled', { preview: movedLine, source, cancel: true }],
    ['unmoved', { preview: { kind: 'line', geometry: { ...source } }, source }],
    ['missing geometry', { preview: null, source }],
  ])('clears immediately without saving when %s', async (_label, input) => {
    const store = makePreviewStore(input.preview);
    const updateMeasurementAnnotationLine = jest.fn();
    await commitDraggedGeometry({ ...input, ...store, updateMeasurementAnnotationLine, updateBoxAnnotationGeometry: jest.fn() });
    expect(updateMeasurementAnnotationLine).not.toHaveBeenCalled();
    expect(store.setPreview).toHaveBeenCalledWith(null);
  });
});
