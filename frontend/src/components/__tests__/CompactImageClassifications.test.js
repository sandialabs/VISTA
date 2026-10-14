import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CompactImageClassifications from '../CompactImageClassifications';

jest.setTimeout(15000);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(data),
    text: jest.fn().mockResolvedValue('')
  };
}

describe('CompactImageClassifications async route ownership', () => {
  const classes = [
    { id: '1', name: 'Alpha' },
    { id: '2', name: 'Beta' }
  ];

  let setLoading;
  let setError;
  let onClassificationsChange;

  beforeEach(() => {
    global.fetch = jest.fn();
    setLoading = jest.fn();
    setError = jest.fn();
    onClassificationsChange = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const propsFor = (imageId) => ({
    imageId,
    classes,
    loading: false,
    setLoading,
    setError,
    onClassificationsChange
  });

  it('aborts image A loading and ignores its response after image B is active', async () => {
    const imageAResponse = deferred();
    const imageBResponse = deferred();
    global.fetch
      .mockReturnValueOnce(imageAResponse.promise)
      .mockReturnValueOnce(imageBResponse.promise);

    const { rerender } = render(
      <CompactImageClassifications {...propsFor('image-a')} />
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const imageASignal = global.fetch.mock.calls[0][1].signal;

    rerender(<CompactImageClassifications {...propsFor('image-b')} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(imageASignal.aborted).toBe(true);

    await act(async () => {
      imageBResponse.resolve(jsonResponse([
        { id: 'classification-b', class_id: '2' }
      ]));
      await imageBResponse.promise;
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Beta/ })).toHaveClass('selected');
    });

    await act(async () => {
      imageAResponse.resolve(jsonResponse([
        { id: 'classification-a', class_id: '1' }
      ]));
      await imageAResponse.promise;
    });

    expect(screen.getByRole('button', { name: /Alpha/ })).not.toHaveClass('selected');
    expect(screen.getByRole('button', { name: /Beta/ })).toHaveClass('selected');
    expect(onClassificationsChange).not.toHaveBeenCalledWith([
      { id: 'classification-a', class_id: '1' }
    ]);
    expect(onClassificationsChange).toHaveBeenLastCalledWith([
      { id: 'classification-b', class_id: '2' }
    ]);
  });

  it('ignores a completed image A mutation after navigating to image B', async () => {
    const imageAMutation = deferred();
    global.fetch.mockImplementation((url, options = {}) => {
      if (url === '/api/images/image-a/classifications' && options.method === 'POST') {
        return imageAMutation.promise;
      }
      if (url === '/api/images/image-b/classifications') {
        return Promise.resolve(jsonResponse([
          { id: 'classification-b', class_id: '2' }
        ]));
      }
      return Promise.resolve(jsonResponse([]));
    });

    const { rerender } = render(
      <CompactImageClassifications {...propsFor('image-a')} />
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/images/image-a/classifications',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/images/image-a/classifications',
        expect.objectContaining({ method: 'POST' })
      );
    });
    const mutationCall = global.fetch.mock.calls.find(
      ([url, options]) => url === '/api/images/image-a/classifications' && options?.method === 'POST'
    );

    rerender(<CompactImageClassifications {...propsFor('image-b')} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Beta/ })).toHaveClass('selected');
    });
    expect(mutationCall[1].signal.aborted).toBe(true);

    await act(async () => {
      imageAMutation.resolve(jsonResponse({
        id: 'classification-a',
        class_id: '1'
      }));
      await imageAMutation.promise;
    });

    expect(screen.getByRole('button', { name: /Alpha/ })).not.toHaveClass('selected');
    expect(screen.getByRole('button', { name: /Beta/ })).toHaveClass('selected');
    expect(onClassificationsChange).toHaveBeenLastCalledWith([
      { id: 'classification-b', class_id: '2' }
    ]);
  });
});
