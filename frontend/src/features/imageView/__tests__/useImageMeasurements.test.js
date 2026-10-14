import { act, renderHook } from '@testing-library/react';

import { updateImageMetadataResponse } from '../../../api/images';
import useImageMeasurements from '../useImageMeasurements';

jest.mock('../../../api/images', () => ({
  updateImageMetadataResponse: jest.fn(),
}));

const ROUTE_KEY = 'route-1';

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function imageWith(measurements) {
  return { id: 'image-1', metadata: { measurements } };
}

function setup(initialMeasurements) {
  const activeRouteInstanceKeyRef = { current: ROUTE_KEY };
  const setError = jest.fn();
  const updateCurrentImage = jest.fn();
  const props = {
    activeRouteInstanceKeyRef,
    imageId: 'image-1',
    projectArchived: false,
    projectId: 'project-1',
    routeInstanceKey: ROUTE_KEY,
    setError,
    updateCurrentImage,
  };
  const hook = renderHook(() => useImageMeasurements(props));
  loadImage(hook, initialMeasurements);
  return { ...hook, setError, updateCurrentImage };
}

function loadImage(hook, measurements) {
  act(() => {
    const { glue } = hook.result.current;
    const { imageMutationKey, measurementMutationRevisionAtLoad } = glue.prepareForNewImageLoad(
      'project-1',
      'image-1',
      ROUTE_KEY,
    );
    glue.commitLoadedMeasurements(
      imageWith(measurements),
      ROUTE_KEY,
      imageMutationKey,
      measurementMutationRevisionAtLoad,
    );
  });
}

function lastPersistedValue() {
  const { calls } = updateImageMetadataResponse.mock;
  return calls[calls.length - 1][2];
}

function applyLastImageUpdate(updateCurrentImage, currentImage) {
  const { calls } = updateCurrentImage.mock;
  return calls[calls.length - 1][0](currentImage);
}

describe('useImageMeasurements mutation persistence', () => {
  let consoleError;

  beforeEach(() => {
    updateImageMetadataResponse.mockReset();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test('applies the acknowledged server measurements and merges them into the image', async () => {
    const { result, setError, updateCurrentImage } = setup([{ id: 'a', name: 'A' }]);
    updateImageMetadataResponse.mockResolvedValue(okResponse(imageWith([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'Server B' },
    ])));

    await act(async () => {
      await result.current.handleSaveMeasurement({ id: 'b', name: 'B' });
    });

    expect(updateImageMetadataResponse).toHaveBeenCalledWith('image-1', 'measurements', [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    expect(result.current.measurements).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'Server B' },
    ]);
    expect(result.current.visibleMeasurementIds).toEqual(['a', 'b']);
    expect(applyLastImageUpdate(updateCurrentImage, { id: 'image-1', metadata: {} })).toEqual({
      id: 'image-1',
      metadata: { measurements: [{ id: 'a', name: 'A' }, { id: 'b', name: 'Server B' }] },
    });
    expect(setError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('save failure logs status and detail under its prefix, and rolls back', async () => {
    const { result, setError, updateCurrentImage } = setup([{ id: 'a', name: 'A' }]);
    updateImageMetadataResponse.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'Validation error',
    });

    await act(async () => {
      await result.current.handleSaveMeasurement({ id: 'b', name: 'B' });
    });

    expect(setError).toHaveBeenCalledWith(
      'Failed to save measurement. Please try again.',
    );
    expect(consoleError).toHaveBeenCalledWith(
      'Error saving measurement:',
      expect.objectContaining({ message: 'Failed to save measurement: 422 - Validation error' }),
    );
    expect(result.current.measurements).toEqual([{ id: 'a', name: 'A' }]);
    expect(result.current.visibleMeasurementIds).toEqual(['a']);
    expect(applyLastImageUpdate(updateCurrentImage, { id: 'image-1', metadata: {} })).toEqual({
      id: 'image-1',
      metadata: { measurements: [{ id: 'a', name: 'A' }] },
    });
  });

  test('rename and delete failures use their own prefixes and an unknown status fallback', async () => {
    const { result, setError } = setup([{ id: 'a', name: 'A' }]);
    updateImageMetadataResponse.mockResolvedValue({ ok: false });

    await act(async () => {
      await result.current.handleRenameMeasurement('a', 'Renamed');
    });
    expect(setError).toHaveBeenLastCalledWith('Failed to rename measurement. Please try again.');
    expect(consoleError).toHaveBeenLastCalledWith(
      'Error renaming measurement:',
      expect.objectContaining({ message: 'Failed to rename measurement: unknown' }),
    );
    expect(result.current.measurements).toEqual([{ id: 'a', name: 'A' }]);

    updateImageMetadataResponse.mockResolvedValue({ ok: false, status: 500 });
    await act(async () => {
      await result.current.handleDeleteMeasurement('a');
    });
    expect(setError).toHaveBeenLastCalledWith('Failed to delete measurement. Please try again.');
    expect(consoleError).toHaveBeenLastCalledWith(
      'Error deleting measurement:',
      expect.objectContaining({ message: 'Failed to delete measurement: 500' }),
    );
    expect(result.current.measurements).toEqual([{ id: 'a', name: 'A' }]);
  });

  test('serializes writes for one image and rebases each onto the last acknowledgement', async () => {
    const { result, setError } = setup([{ id: 'a', name: 'A' }]);
    const firstWrite = deferred();
    updateImageMetadataResponse
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementationOnce(async (_imageId, _key, value) => okResponse(imageWith(value)));

    let firstSave;
    let rename;
    act(() => {
      firstSave = result.current.handleSaveMeasurement({ id: 'b', name: 'B' });
    });
    act(() => {
      rename = result.current.handleRenameMeasurement('a', 'Renamed');
    });
    expect(result.current.measurements).toEqual([
      { id: 'a', name: 'Renamed' },
      { id: 'b', name: 'B' },
    ]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(updateImageMetadataResponse).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstWrite.resolve(okResponse(imageWith([
        { id: 'a', name: 'A' },
        { id: 'b', name: 'Server B' },
      ])));
      await firstSave;
      await rename;
    });

    expect(updateImageMetadataResponse).toHaveBeenCalledTimes(2);
    expect(lastPersistedValue()).toEqual([
      { id: 'a', name: 'Renamed' },
      { id: 'b', name: 'Server B' },
    ]);
    expect(result.current.measurements).toEqual([
      { id: 'a', name: 'Renamed' },
      { id: 'b', name: 'Server B' },
    ]);
    expect(setError).not.toHaveBeenCalled();
  });

  test('a failed write leaves the confirmed base for the next queued write', async () => {
    const { result, setError } = setup([{ id: 'a', name: 'A' }]);
    updateImageMetadataResponse
      .mockResolvedValueOnce({ ok: false, status: 409 })
      .mockImplementationOnce(async (_imageId, _key, value) => okResponse(imageWith(value)));

    await act(async () => {
      const failedSave = result.current.handleSaveMeasurement({ id: 'b', name: 'B' });
      const rename = result.current.handleRenameMeasurement('a', 'Renamed');
      await failedSave;
      await rename;
    });

    expect(lastPersistedValue()).toEqual([{ id: 'a', name: 'Renamed' }]);
    expect(result.current.measurements).toEqual([{ id: 'a', name: 'Renamed' }]);
    // The superseded failure is not reported once a later mutation started.
    expect(setError).not.toHaveBeenCalled();
  });

  test('an idle reload replaces the confirmed base used by later writes', async () => {
    const hook = setup([{ id: 'a', name: 'A' }]);
    updateImageMetadataResponse.mockImplementation(
      async (_imageId, _key, value) => okResponse(imageWith(value)),
    );
    await act(async () => {
      await hook.result.current.handleSaveMeasurement({ id: 'b', name: 'B' });
    });

    loadImage(hook, [{ id: 'c', name: 'Server C' }]);
    await act(async () => {
      await hook.result.current.handleSaveMeasurement({ id: 'd', name: 'D' });
    });

    expect(lastPersistedValue()).toEqual([
      { id: 'c', name: 'Server C' },
      { id: 'd', name: 'D' },
    ]);
  });

  test('a reload while a write is pending does not replace the confirmed base', async () => {
    const hook = setup([{ id: 'a', name: 'A' }]);
    const firstWrite = deferred();
    updateImageMetadataResponse
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementation(async (_imageId, _key, value) => okResponse(imageWith(value)));

    let firstSave;
    act(() => {
      firstSave = hook.result.current.handleSaveMeasurement({ id: 'b', name: 'B' });
    });
    loadImage(hook, [{ id: 'stale', name: 'Stale GET' }]);
    expect(hook.result.current.measurements).toEqual([{ id: 'stale', name: 'Stale GET' }]);

    await act(async () => {
      firstWrite.resolve(okResponse(imageWith([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])));
      await firstSave;
    });
    // The settled write belongs to a superseded generation and is not applied.
    expect(hook.result.current.measurements).toEqual([{ id: 'stale', name: 'Stale GET' }]);

    await act(async () => {
      await hook.result.current.handleSaveMeasurement({ id: 'd', name: 'D' });
    });
    expect(lastPersistedValue()).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'd', name: 'D' },
    ]);
  });
});
