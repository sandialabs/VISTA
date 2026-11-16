import { act, renderHook, waitFor } from '@testing-library/react';
import {
  approvePartNcr,
  createPartNcr,
  fetchPartNcrs,
} from '../../../api/ncrs';
import useInspectionNcrs, { getNcrErrorMessage, validateNcrDraft } from '../useInspectionNcrs';

jest.mock('../../../api/ncrs', () => ({
  approvePartNcr: jest.fn(),
  createPartNcr: jest.fn(),
  deletePartNcr: jest.fn(),
  fetchPartNcr: jest.fn(),
  fetchPartNcrs: jest.fn(),
  updatePartNcr: jest.fn(),
}));

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

const ncr = (overrides = {}) => ({
  id: 'n1',
  ncr_number: 1,
  ncr_label: 'NCR-0001',
  status: 'open',
  version: 1,
  comment: 'c',
  failure_code: 'FC',
  disposition_code: 'DC',
  disposition_instructions: 'i',
  ...overrides,
});

describe('validateNcrDraft', () => {
  test('requires every field and treats whitespace as empty', () => {
    expect(validateNcrDraft({ comment: ' ', failure_code: 'A', disposition_code: '', disposition_instructions: 'x' }))
      .toEqual(['Comment is required.', 'Disposition code is required.']);
    expect(validateNcrDraft({ comment: 'a', failure_code: 'b', disposition_code: 'c', disposition_instructions: 'd' }))
      .toEqual([]);
  });
});

describe('getNcrErrorMessage', () => {
  test('prefers string detail, then validation messages, then message', () => {
    expect(getNcrErrorMessage({ payload: { detail: 'nope' } }, 'f')).toBe('nope');
    expect(getNcrErrorMessage({ payload: { detail: [{ msg: 'a' }, { msg: 'b' }] } }, 'f')).toBe('a b');
    expect(getNcrErrorMessage({ message: 'm' }, 'f')).toBe('m');
    expect(getNcrErrorMessage(null, 'f')).toBe('f');
  });
});

describe('useInspectionNcrs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loads NCRs for the selected part and clears without a part', async () => {
    fetchPartNcrs.mockResolvedValue({ ncrs: [ncr()] });
    const { result, rerender } = renderHook((props) => useInspectionNcrs(props), {
      initialProps: { projectId: 'p', selectedPartId: 'part-1', readOnly: false },
    });
    await waitFor(() => expect(result.current.ncrs).toHaveLength(1));
    rerender({ projectId: 'p', selectedPartId: '', readOnly: false });
    await waitFor(() => expect(result.current.ncrs).toEqual([]));
  });

  test('ignores a stale response after switching parts', async () => {
    const first = deferred();
    fetchPartNcrs.mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ ncrs: [ncr({ id: 'n2', ncr_label: 'NCR-0002', ncr_number: 2 })] });
    const { result, rerender } = renderHook((props) => useInspectionNcrs(props), {
      initialProps: { projectId: 'p', selectedPartId: 'part-1', readOnly: false },
    });
    rerender({ projectId: 'p', selectedPartId: 'part-2', readOnly: false });
    await waitFor(() => expect(result.current.ncrs.map((n) => n.id)).toEqual(['n2']));
    await act(async () => {
      first.resolve({ ncrs: [ncr()] });
    });
    expect(result.current.ncrs.map((n) => n.id)).toEqual(['n2']);
  });

  test('blocks invalid drafts and trims values on create', async () => {
    fetchPartNcrs.mockResolvedValue({ ncrs: [] });
    createPartNcr.mockResolvedValue(ncr());
    const { result } = renderHook(() => useInspectionNcrs({ projectId: 'p', selectedPartId: 'part-1', readOnly: false }));
    await waitFor(() => expect(fetchPartNcrs).toHaveBeenCalled());

    act(() => result.current.openCreate());
    await act(async () => {
      expect(await result.current.saveEditor()).toBe(false);
    });
    expect(result.current.actionError).toMatch('Comment is required.');
    expect(createPartNcr).not.toHaveBeenCalled();

    act(() => result.current.setDraft({
      comment: ' c ', failure_code: 'FC', disposition_code: 'DC', disposition_instructions: ' i ',
    }));
    await act(async () => {
      expect(await result.current.saveEditor()).toBe(true);
    });
    expect(createPartNcr).toHaveBeenCalledWith('p', 'part-1', {
      comment: 'c', failure_code: 'FC', disposition_code: 'DC', disposition_instructions: 'i',
    }, { readOnly: false });
    expect(result.current.editor).toBeNull();
    expect(result.current.ncrs).toHaveLength(1);
  });

  test('read-only mode never opens the editor or calls write APIs', async () => {
    fetchPartNcrs.mockResolvedValue({ ncrs: [ncr()] });
    const { result } = renderHook(() => useInspectionNcrs({ projectId: 'p', selectedPartId: 'part-1', readOnly: true }));
    await waitFor(() => expect(result.current.ncrs).toHaveLength(1));
    act(() => result.current.openCreate());
    act(() => result.current.openEdit(ncr()));
    expect(result.current.editor).toBeNull();
    await act(async () => {
      expect(await result.current.approve(ncr())).toBe(false);
    });
    expect(approvePartNcr).not.toHaveBeenCalled();
  });

  test('a conflict shows the server message and reloads', async () => {
    fetchPartNcrs.mockResolvedValue({ ncrs: [ncr()] });
    approvePartNcr.mockRejectedValue(Object.assign(new Error('x'), {
      status: 409,
      payload: { detail: 'This NCR was changed by someone else.' },
    }));
    const { result } = renderHook(() => useInspectionNcrs({ projectId: 'p', selectedPartId: 'part-1', readOnly: false }));
    await waitFor(() => expect(result.current.ncrs).toHaveLength(1));
    await act(async () => {
      await result.current.approve(ncr());
    });
    expect(result.current.actionError).toBe('This NCR was changed by someone else.');
    await waitFor(() => expect(fetchPartNcrs).toHaveBeenCalledTimes(2));
  });

  test('prevents double submission while a request is in flight', async () => {
    fetchPartNcrs.mockResolvedValue({ ncrs: [ncr()] });
    const pending = deferred();
    approvePartNcr.mockImplementation(() => pending.promise);
    const { result } = renderHook(() => useInspectionNcrs({ projectId: 'p', selectedPartId: 'part-1', readOnly: false }));
    await waitFor(() => expect(result.current.ncrs).toHaveLength(1));
    let firstCall;
    act(() => {
      firstCall = result.current.approve(ncr());
    });
    await waitFor(() => expect(result.current.busy).toBe(true));
    await act(async () => {
      await result.current.approve(ncr());
    });
    expect(approvePartNcr).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(ncr({ status: 'approved', version: 2 }));
      await firstCall;
    });
    expect(result.current.ncrs[0].status).toBe('approved');
  });
});
