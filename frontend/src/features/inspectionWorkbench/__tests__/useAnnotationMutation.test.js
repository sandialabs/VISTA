import { act, renderHook } from '@testing-library/react';

import { savePartAnnotation } from '../../../api/parts';
import useAnnotationMutation from '../useAnnotationMutation';
import { ALL_PARTS_ID } from '../useInspectionPartSelection';

jest.mock('../../../api/parts', () => ({
  savePartAnnotation: jest.fn(),
}));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderMutationHook(initialProps = {}) {
  const scopeRef = { current: '' };
  const setError = jest.fn();
  const props = {
    projectId: 'proj-1',
    activeSelectionId: 'part-1',
    selectedPart: { id: 'part-1' },
    readOnly: false,
    ...initialProps,
  };
  const hook = renderHook(
    (hookProps) => useAnnotationMutation({ ...hookProps, setError, scopeRef }),
    { initialProps: props },
  );
  return { ...hook, props, scopeRef, setError };
}

describe('useAnnotationMutation', () => {
  beforeEach(() => {
    savePartAnnotation.mockReset();
  });

  test('publishes the active part scope through the shared ref', () => {
    const { scopeRef, rerender, props } = renderMutationHook();
    expect(scopeRef.current).toBe('proj-1:part-1');

    rerender({ ...props, activeSelectionId: 'part-2', selectedPart: { id: 'part-2' } });
    expect(scopeRef.current).toBe('proj-1:part-2');
  });

  test('rejects mutations in read-only mode without calling the API', async () => {
    const { result, setError } = renderMutationHook({ readOnly: true });
    const onSuccess = jest.fn();

    let saved;
    await act(async () => {
      saved = await result.current.mutateAnnotation({ payload: { hidden: true }, errorLabel: 'Failed', onSuccess });
    });

    expect(saved).toBeNull();
    expect(savePartAnnotation).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  test('rejects mutations for the frontend-only All row and when no part is selected', async () => {
    const { result, rerender, props } = renderMutationHook({
      activeSelectionId: ALL_PARTS_ID,
      selectedPart: { id: ALL_PARTS_ID },
    });

    await act(async () => {
      expect(await result.current.mutateAnnotation({ payload: {}, errorLabel: 'Failed' })).toBeNull();
    });

    rerender({ ...props, activeSelectionId: ALL_PARTS_ID, selectedPart: null });
    await act(async () => {
      expect(await result.current.mutateAnnotation({ payload: {}, errorLabel: 'Failed' })).toBeNull();
    });

    expect(savePartAnnotation).not.toHaveBeenCalled();
  });

  test('saves and merges the response for the active part', async () => {
    const created = { id: 'ann-1', defect_class: 'Crack' };
    savePartAnnotation.mockResolvedValue(created);
    const { result, setError } = renderMutationHook();
    const onSuccess = jest.fn();

    let saved;
    await act(async () => {
      saved = await result.current.mutateAnnotation({
        payload: { defect_class: 'Crack' },
        annotationId: '',
        errorLabel: 'Failed to create annotation',
        onSuccess,
      });
    });

    expect(savePartAnnotation).toHaveBeenCalledWith(
      'proj-1',
      'part-1',
      { defect_class: 'Crack' },
      '',
      { readOnly: false, errorLabel: 'Failed to create annotation' },
    );
    expect(saved).toBe(created);
    expect(onSuccess).toHaveBeenCalledWith(created, 'part-1');
    expect(setError).not.toHaveBeenCalled();
  });

  test('passes the annotation id through for updates', async () => {
    savePartAnnotation.mockResolvedValue({ id: 'ann-7' });
    const { result } = renderMutationHook();

    await act(async () => {
      await result.current.mutateAnnotation({ payload: { hidden: true }, annotationId: 'ann-7', errorLabel: 'Failed' });
    });

    expect(savePartAnnotation).toHaveBeenCalledWith('proj-1', 'part-1', { hidden: true }, 'ann-7', {
      readOnly: false,
      errorLabel: 'Failed',
    });
  });

  test('drops a stale success response after the part changes', async () => {
    const pending = deferred();
    savePartAnnotation.mockReturnValue(pending.promise);
    const { result, rerender, props } = renderMutationHook();
    const onSuccess = jest.fn();

    let mutation;
    act(() => {
      mutation = result.current.mutateAnnotation({ payload: {}, errorLabel: 'Failed', onSuccess });
    });
    rerender({ ...props, activeSelectionId: 'part-2', selectedPart: { id: 'part-2' } });

    let saved;
    await act(async () => {
      pending.resolve({ id: 'ann-1' });
      saved = await mutation;
    });

    expect(saved).toEqual({ id: 'ann-1' });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test('drops a stale response after leaving and returning to the same part', async () => {
    const pending = deferred();
    savePartAnnotation.mockReturnValue(pending.promise);
    const { result, rerender, props } = renderMutationHook();
    const onSuccess = jest.fn();

    let mutation;
    act(() => {
      mutation = result.current.mutateAnnotation({ payload: {}, errorLabel: 'Failed', onSuccess });
    });
    rerender({ ...props, activeSelectionId: 'part-2', selectedPart: { id: 'part-2' } });
    rerender(props);

    await act(async () => {
      pending.resolve({ id: 'ann-1' });
      await mutation;
    });

    expect(onSuccess).not.toHaveBeenCalled();
  });

  test('reports errors for the active part and falls back to the error label', async () => {
    savePartAnnotation.mockRejectedValueOnce(new Error('Failed to update box annotation: 500'));
    savePartAnnotation.mockRejectedValueOnce(new Error(''));
    const { result, setError } = renderMutationHook();

    let saved;
    await act(async () => {
      saved = await result.current.mutateAnnotation({ payload: {}, errorLabel: 'Failed to update box annotation' });
    });
    expect(saved).toBeNull();
    expect(setError).toHaveBeenLastCalledWith('Failed to update box annotation: 500');

    await act(async () => {
      await result.current.mutateAnnotation({ payload: {}, errorLabel: 'Failed to update box annotation' });
    });
    expect(setError).toHaveBeenLastCalledWith('Failed to update box annotation');
  });

  test('suppresses errors from a stale part', async () => {
    const pending = deferred();
    savePartAnnotation.mockReturnValue(pending.promise);
    const { result, rerender, props, setError } = renderMutationHook();

    let mutation;
    act(() => {
      mutation = result.current.mutateAnnotation({ payload: {}, errorLabel: 'Failed' });
    });
    rerender({ ...props, activeSelectionId: 'part-2', selectedPart: { id: 'part-2' } });

    let saved;
    await act(async () => {
      pending.reject(new Error('boom'));
      saved = await mutation;
    });

    expect(saved).toBeNull();
    expect(setError).not.toHaveBeenCalled();
  });
});
