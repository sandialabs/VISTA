import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ImageComments from '../ImageComments';

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

describe('ImageComments async route ownership', () => {
  jest.setTimeout(15000);
  let setLoading;
  let setError;

  beforeEach(() => {
    global.fetch = jest.fn();
    setLoading = jest.fn();
    setError = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const propsFor = (imageId) => ({
    imageId,
    loading: false,
    setLoading,
    setError
  });

  it('aborts image A loading and ignores its response after image B is active', async () => {
    const imageAResponse = deferred();
    const imageBResponse = deferred();
    global.fetch
      .mockReturnValueOnce(imageAResponse.promise)
      .mockReturnValueOnce(imageBResponse.promise);

    const { rerender } = render(<ImageComments {...propsFor('image-a')} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const imageASignal = global.fetch.mock.calls[0][1].signal;

    rerender(<ImageComments {...propsFor('image-b')} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(imageASignal.aborted).toBe(true);

    await act(async () => {
      imageBResponse.resolve(jsonResponse([
        { id: 'comment-b', text: 'Comment for image B' }
      ]));
      await imageBResponse.promise;
    });

    expect(await screen.findByText('Comment for image B')).toBeInTheDocument();

    await act(async () => {
      imageAResponse.resolve(jsonResponse([
        { id: 'comment-a', text: 'Stale comment for image A' }
      ]));
      await imageAResponse.promise;
    });

    expect(screen.queryByText('Stale comment for image A')).not.toBeInTheDocument();
    expect(screen.getByText('Comment for image B')).toBeInTheDocument();
    expect(setError).not.toHaveBeenCalledWith(
      'Failed to load comments. Please try again later.'
    );
  });

  it('ignores a completed image A comment creation after navigating to image B', async () => {
    const imageAMutation = deferred();
    global.fetch.mockImplementation((url, options = {}) => {
      if (url === '/api/images/image-a/comments' && options.method === 'POST') {
        return imageAMutation.promise;
      }
      if (url === '/api/images/image-b/comments') {
        return Promise.resolve(jsonResponse([
          { id: 'comment-b', text: 'Comment for image B' }
        ]));
      }
      return Promise.resolve(jsonResponse([]));
    });

    const { rerender } = render(<ImageComments {...propsFor('image-a')} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/images/image-a/comments',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    fireEvent.change(screen.getByLabelText('Comment:'), {
      target: { value: 'New comment for image A' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Comment' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/images/image-a/comments',
        expect.objectContaining({ method: 'POST' })
      );
    });
    const mutationCall = global.fetch.mock.calls.find(
      ([url, options]) => url === '/api/images/image-a/comments' && options?.method === 'POST'
    );

    rerender(<ImageComments {...propsFor('image-b')} />);

    expect(await screen.findByText('Comment for image B')).toBeInTheDocument();
    expect(mutationCall[1].signal.aborted).toBe(true);

    await act(async () => {
      imageAMutation.resolve(jsonResponse({
        id: 'comment-a-created',
        text: 'New comment for image A'
      }));
      await imageAMutation.promise;
    });

    expect(screen.queryByText('New comment for image A')).not.toBeInTheDocument();
    expect(screen.getByText('Comment for image B')).toBeInTheDocument();
  });
});
