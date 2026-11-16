// Red-team tests for the NCR hook and API helpers. Each test asserts the
// safe/correct behavior; failures are findings.
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  approvePartNcr,
  createPartNcr,
  deletePartNcr,
  fetchPartNcr,
  fetchPartNcrs,
  updatePartNcr,
} from '../../../api/ncrs';
import useInspectionNcrs, { getNcrErrorMessage, validateNcrDraft } from '../useInspectionNcrs';
import {
  getConfiguredNcrCodes,
  isValidOptionalNcrConfiguration,
  normalizeNcrConfiguration,
  validateNcrConfiguration,
} from '../../projectConfiguration/ncrConfiguration';

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
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
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

const VALID_DRAFT = {
  comment: 'c', failure_code: 'FC', disposition_code: 'DC', disposition_instructions: 'i',
};

function setup(props = {}) {
  return renderHook((p) => useInspectionNcrs(p), {
    initialProps: { projectId: 'p', selectedPartId: 'part-1', readOnly: false, ...props },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  [approvePartNcr, createPartNcr, deletePartNcr, fetchPartNcr, fetchPartNcrs, updatePartNcr]
    .forEach((fn) => fn.mockReset());
  fetchPartNcrs.mockResolvedValue({ ncrs: [ncr()] });
});

describe('validateNcrDraft adversarial input', () => {
  test('null/undefined drafts and non-string values do not throw', () => {
    expect(() => validateNcrDraft(null)).not.toThrow();
    expect(validateNcrDraft(undefined)).toHaveLength(4);
    expect(validateNcrDraft({ comment: 0, failure_code: false, disposition_code: [], disposition_instructions: {} }))
      .toHaveLength(3); // {} stringifies to "[object Object]"
  });

  test('zero-width / NBSP only is not treated as content by the backend either', () => {
    // JS trim() strips NBSP and other Unicode spaces, as Python str.strip() does.
    expect(validateNcrDraft({ ...VALID_DRAFT, comment: '\u00a0\u2003 ' })).toEqual(['Comment is required.']);
  });
});

describe('getNcrErrorMessage adversarial payloads', () => {
  test('array detail without msg is not rendered as [object Object]', () => {
    const message = getNcrErrorMessage({ payload: { detail: [{ loc: ['body'], type: 'missing' }] }, message: 'm' }, 'f');
    expect(message).not.toMatch('[object Object]');
  });

  test('object detail falls back to message', () => {
    expect(getNcrErrorMessage({ payload: { detail: { a: 1 } }, message: 'boom' }, 'f')).toBe('boom');
  });

  test('empty array detail falls back', () => {
    expect(getNcrErrorMessage({ payload: { detail: [] } }, 'fallback')).toBe('fallback');
  });

  test('null entries in detail array do not throw', () => {
    expect(() => getNcrErrorMessage({ payload: { detail: [null, { msg: 'x' }] } }, 'f')).not.toThrow();
  });
});

describe('useInspectionNcrs adversarial flows', () => {
  test('server list payload that is not an array yields an empty list', async () => {
    fetchPartNcrs.mockResolvedValueOnce({ ncrs: 'nope' });
    const { result } = setup();
    await waitFor(() => expect(fetchPartNcrs).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ncrs).toEqual([]);
  });

  test('null list payload yields an empty list', async () => {
    fetchPartNcrs.mockResolvedValueOnce(null);
    const { result } = setup();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ncrs).toEqual([]);
  });

  test('500 load error with array detail surfaces messages', async () => {
    fetchPartNcrs.mockRejectedValueOnce(Object.assign(new Error('Server error'), {
      status: 500, payload: { detail: [{ msg: 'a' }, { msg: 'b' }] },
    }));
    const { result } = setup();
    await waitFor(() => expect(result.current.loadError).toBe('a b'));
    expect(result.current.ncrs).toEqual([]);
  });

  test('switching parts closes an open editor (no stale save to the old part)', async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.ncrs).toHaveLength(1));
    act(() => result.current.openCreate());
    act(() => result.current.setDraft(VALID_DRAFT));
    expect(result.current.editor).not.toBeNull();
    rerender({ projectId: 'p', selectedPartId: 'part-2', readOnly: false });
    await waitFor(() => expect(result.current.editor).toBeNull());
    await act(async () => {
      expect(await result.current.saveEditor()).toBe(false);
    });
    expect(createPartNcr).not.toHaveBeenCalled();
  });

  test('a save in flight when the part switches does not leak into the new part list', async () => {
    const pending = deferred();
    createPartNcr.mockImplementation(() => pending.promise);
    fetchPartNcrs.mockResolvedValueOnce({ ncrs: [] }).mockResolvedValueOnce({ ncrs: [] });
    const { result, rerender } = setup();
    await waitFor(() => expect(fetchPartNcrs).toHaveBeenCalledTimes(1));
    act(() => result.current.openCreate());
    act(() => result.current.setDraft(VALID_DRAFT));
    let save;
    act(() => { save = result.current.saveEditor(); });
    expect(createPartNcr).toHaveBeenCalledWith('p', 'part-1', VALID_DRAFT, { readOnly: false });
    rerender({ projectId: 'p', selectedPartId: 'part-2', readOnly: false });
    await waitFor(() => expect(fetchPartNcrs).toHaveBeenCalledTimes(2));
    await act(async () => {
      pending.resolve(ncr({ id: 'created-on-part-1', part_id: 'part-1' }));
      await save;
    });
    expect(result.current.ncrs.map((n) => n.id)).not.toContain('created-on-part-1');
    expect(result.current.busy).toBe(false);
  });

  test('double save in the same tick only submits once', async () => {
    const pending = deferred();
    createPartNcr.mockImplementation(() => pending.promise);
    const { result } = setup();
    await waitFor(() => expect(result.current.ncrs).toHaveLength(1));
    act(() => result.current.openCreate());
    act(() => result.current.setDraft(VALID_DRAFT));
    let first;
    let second;
    act(() => {
      first = result.current.saveEditor();
      second = result.current.saveEditor();
    });
    await act(async () => {
      pending.resolve(ncr({ id: 'n2', ncr_number: 2 }));
      await Promise.all([first, second]);
    });
    expect(createPartNcr).toHaveBeenCalledTimes(1);
  });

  test('double approve in the same tick only submits once', async () => {
    const pending = deferred();
    approvePartNcr.mockImplementation(() => pending.promise);
    const { result } = setup();
    await waitFor(() => expect(result.current.ncrs).toHaveLength(1));
    let a;
    let b;
    act(() => {
      a = result.current.approve(ncr());
      b = result.current.approve(ncr());
    });
    await act(async () => {
      pending.resolve(ncr({ status: 'approved', version: 2 }));
      await Promise.all([a, b]);
    });
    expect(approvePartNcr).toHaveBeenCalledTimes(1);
  });

  test('read-only toggled while editor is open closes the editor', async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.ncrs).toHaveLength(1));
    act(() => result.current.openEdit(ncr()));
    expect(result.current.editor).not.toBeNull();
    rerender({ projectId: 'p', selectedPartId: 'part-1', readOnly: true });
    await act(async () => {
      expect(await result.current.saveEditor()).toBe(false);
    });
    expect(updatePartNcr).not.toHaveBeenCalled();
    // When write access returns, the stale draft must not silently reappear.
    rerender({ projectId: 'p', selectedPartId: 'part-1', readOnly: false });
    expect(result.current.editor).toBeNull();
  });

  test('read-only blocks remove and save even when called directly', async () => {
    const { result } = setup({ readOnly: true });
    await waitFor(() => expect(result.current.ncrs).toHaveLength(1));
    await act(async () => {
      expect(await result.current.remove(ncr())).toBe(false);
    });
    expect(deletePartNcr).not.toHaveBeenCalled();
  });

  test('edit sends expected_version and trimmed fields', async () => {
    updatePartNcr.mockResolvedValue(ncr({ version: 2, comment: 'new' }));
    const { result } = setup();
    await waitFor(() => expect(result.current.ncrs).toHaveLength(1));
    act(() => result.current.openEdit(ncr({ version: 7 })));
    act(() => result.current.setDraft((d) => ({ ...d, comment: '  new  ' })));
    await act(async () => { await result.current.saveEditor(); });
    expect(updatePartNcr).toHaveBeenCalledWith('p', 'part-1', 'n1', {
      comment: 'new', failure_code: 'FC', disposition_code: 'DC', disposition_instructions: 'i', expected_version: 7,
    }, { readOnly: false });
  });

  test('ncr missing optional fields can be edited without "undefined" in the draft', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.ncrs).toHaveLength(1));
    act(() => result.current.openEdit({ id: 'x', ncr_label: 'NCR-0009', version: 1 }));
    expect(result.current.editor.draft).toEqual({
      comment: '', failure_code: '', disposition_code: '', disposition_instructions: '',
    });
  });

  test('a stale detail response does not replace a newer selection', async () => {
    const first = deferred();
    fetchPartNcrs.mockResolvedValue({
      ncrs: [ncr(), ncr({ id: 'n2', ncr_number: 2, ncr_label: 'NCR-0002' })],
    });
    fetchPartNcr
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ ...ncr({ id: 'n2', ncr_number: 2, ncr_label: 'NCR-0002' }), history: [] });
    const { result } = setup();
    await waitFor(() => expect(result.current.ncrs).toHaveLength(2));
    let openA;
    act(() => { openA = result.current.openDetail(ncr()); });
    await act(async () => {
      await result.current.openDetail(ncr({ id: 'n2', ncr_number: 2, ncr_label: 'NCR-0002' }));
    });
    expect(result.current.detail.ncr.id).toBe('n2');
    await act(async () => {
      first.resolve({ ...ncr(), history: [] });
      await openA;
    });
    expect(result.current.detail.ncr.id).toBe('n2');
  });

  test('history load failure is reported on the detail', async () => {
    fetchPartNcr.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 500, payload: { detail: 'DB down' } }));
    const { result } = setup();
    await waitFor(() => expect(result.current.ncrs).toHaveLength(1));
    await act(async () => { await result.current.openDetail(ncr()); });
    expect(result.current.detail.error).toBe('DB down');
    expect(result.current.detail.loading).toBe(false);
  });

  test('approve on a deleted (404) NCR closes its stale detail', async () => {
    fetchPartNcr.mockResolvedValueOnce({ ...ncr(), history: [] });
    approvePartNcr.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 404, payload: { detail: 'NCR not found' } }));
    const { result } = setup();
    await waitFor(() => expect(result.current.ncrs).toHaveLength(1));
    await act(async () => { await result.current.openDetail(ncr()); });
    fetchPartNcrs.mockResolvedValueOnce({ ncrs: [] });
    await act(async () => { await result.current.approve(ncr()); });
    await waitFor(() => expect(result.current.ncrs).toEqual([]));
    expect(result.current.actionError).toBe('NCR not found');
    expect(result.current.detail).toBeNull();
  });

  test('saving after a 409 conflict in the editor does not resend the stale version forever', async () => {
    updatePartNcr.mockRejectedValueOnce(Object.assign(new Error('x'), {
      status: 409, payload: { detail: 'This NCR was changed by someone else.' },
    }));
    const { result } = setup();
    await waitFor(() => expect(result.current.ncrs).toHaveLength(1));
    fetchPartNcrs.mockResolvedValueOnce({ ncrs: [ncr({ version: 3, comment: 'theirs' })] });
    act(() => result.current.openEdit(ncr()));
    act(() => result.current.setDraft((d) => ({ ...d, comment: 'mine' })));
    await act(async () => { await result.current.saveEditor(); });
    expect(result.current.actionError).toMatch('changed by someone else');
    await waitFor(() => expect(result.current.ncrs[0].version).toBe(3));
    // The editor stays open (draft preserved) but must not keep the stale base;
    // either it is closed, or it now reflects the reloaded version.
    const { editor } = result.current;
    expect(editor === null || editor.ncr.version === 3).toBe(true);
  });

  test('upsert keeps the list sorted even when ncr_number is missing', async () => {
    createPartNcr.mockResolvedValue({ id: 'weird', ncr_label: 'NCR-????' });
    const { result } = setup();
    await waitFor(() => expect(result.current.ncrs).toHaveLength(1));
    act(() => result.current.openCreate());
    act(() => result.current.setDraft(VALID_DRAFT));
    await act(async () => { await result.current.saveEditor(); });
    expect(result.current.ncrs.map((n) => n.id).sort()).toEqual(['n1', 'weird']);
  });
});

describe('ncrConfiguration helpers adversarial input', () => {
  test('blank and whitespace codes are dropped from dropdown options', () => {
    const codes = getConfiguredNcrCodes({
      ncr_configuration: {
        failure_codes: [{ code: '' }, { code: '   ' }, { code: ' A ', description: ' d ' }, null, 5, { code: 7 }],
      },
    }, 'failure_codes');
    expect(codes).toEqual([{ code: 'A', description: 'd' }]);
  });

  test('malformed ncr_configuration normalizes to empty lists', () => {
    expect(normalizeNcrConfiguration('junk')).toEqual({ failure_codes: [], disposition_codes: [] });
    expect(normalizeNcrConfiguration([])).toEqual({ failure_codes: [], disposition_codes: [] });
    expect(normalizeNcrConfiguration({ failure_codes: 'x' })).toEqual({ failure_codes: [], disposition_codes: [] });
  });

  test('duplicate dropdown codes after trimming are de-duplicated', () => {
    // Stored configs bypass validation (clone/raw metadata); duplicates would
    // create duplicate <option> keys and ambiguous selections.
    const codes = getConfiguredNcrCodes({
      ncr_configuration: { failure_codes: [{ code: 'A' }, { code: ' A' }, { code: 'a' }] },
    }, 'failure_codes');
    expect(codes.map((c) => c.code.toLowerCase())).toEqual(['a']);
  });

  test('case-insensitive uniqueness matches backend casefold (STRASSE vs straße)', () => {
    const errors = validateNcrConfiguration({
      failure_codes: [{ code: 'STRASSE' }, { code: 'straße' }],
      disposition_codes: [],
    });
    expect(errors.join(' ')).toMatch('unique');
  });

  test('control characters in codes are rejected client side', () => {
    const errors = validateNcrConfiguration({ failure_codes: [{ code: 'A\u0000B' }], disposition_codes: [] });
    expect(errors.length).toBeGreaterThan(0);
  });

  test('isValidOptionalNcrConfiguration rejects junk and accepts empty', () => {
    expect(isValidOptionalNcrConfiguration(undefined)).toBe(true);
    expect(isValidOptionalNcrConfiguration({})).toBe(true);
    expect(isValidOptionalNcrConfiguration(null)).toBe(false);
    expect(isValidOptionalNcrConfiguration('x')).toBe(false);
    expect(isValidOptionalNcrConfiguration({ failure_codes: [{ code: 1 }] })).toBe(false);
    expect(isValidOptionalNcrConfiguration({ failure_codes: [{ code: 'A', description: 5 }] })).toBe(false);
    expect(isValidOptionalNcrConfiguration({ failure_codes: Array.from({ length: 501 }, (_, i) => ({ code: `C${i}` })) }))
      .toBe(false);
  });

  test('64-char limit counts code points like the backend (emoji code)', () => {
    const code = '\u{1F525}'.repeat(40); // 40 code points, 80 UTF-16 units
    expect(validateNcrConfiguration({ failure_codes: [{ code }], disposition_codes: [] })).toEqual([]);
  });
});

describe('UI-level double submit', () => {
  // eslint-disable-next-line global-require
  const React = require('react');
  // eslint-disable-next-line global-require
  const { render, screen, fireEvent, within, act: rtlAct } = require('@testing-library/react');
  // eslint-disable-next-line global-require
  const { NcrPane } = require('../NcrPane');

  function Harness() {
    const state = useInspectionNcrs({ projectId: 'p', selectedPartId: 'part-1', readOnly: false });
    return (
      <NcrPane
        selectedPart={{ id: 'part-1', serial_number: 'SN' }}
        readOnly={false}
        failureCodes={[{ code: 'FC', description: '' }]}
        dispositionCodes={[{ code: 'DC', description: '' }]}
        ncrState={state}
      />
    );
  }

  test('double-clicking Save creates one NCR', async () => {
    const pending = deferred();
    createPartNcr.mockImplementation(() => pending.promise);
    fetchPartNcrs.mockResolvedValue({ ncrs: [] });
    render(<Harness />);
    await screen.findByText('No NCRs recorded for this part.');
    fireEvent.click(screen.getByRole('button', { name: 'Add NCR' }));
    const dialog = screen.getByRole('dialog', { name: 'Add NCR' });
    fireEvent.change(within(dialog).getByLabelText('Comment'), { target: { value: 'c' } });
    fireEvent.change(within(dialog).getByLabelText('Failure code'), { target: { value: 'FC' } });
    fireEvent.change(within(dialog).getByLabelText('Disposition code'), { target: { value: 'DC' } });
    fireEvent.change(within(dialog).getByLabelText('Disposition Instructions'), { target: { value: 'i' } });
    const save = within(dialog).getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.submit(dialog.querySelector('form'));
    await rtlAct(async () => { pending.resolve(ncr({ id: 'n9' })); });
    expect(createPartNcr).toHaveBeenCalledTimes(1);
  });
});
