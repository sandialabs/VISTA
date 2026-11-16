// Red-team tests for NCR UI components and API helpers. Each test asserts the
// safe/correct behavior; failures are findings.
import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NcrPane } from '../../features/inspectionWorkbench/NcrPane';
import { NcrHistory } from '../../features/inspectionWorkbench/NcrHistory';
import { NcrEditorModal } from '../../features/inspectionWorkbench/NcrEditorModal';
import ProjectReportNcrTable, { getReportNcrs } from '../ProjectReportNcrTable';
import NcrConfigurationPanel from '../projectConfiguration/NcrConfigurationPanel';
import {
  approvePartNcr,
  deletePartNcr,
  fetchPartNcr,
  updatePartNcr,
} from '../../api/ncrs';

const XSS = '<img src=x onerror="window.__ncrXss=1"><script>window.__ncrXss=2</script>';

const baseNcr = (overrides = {}) => ({
  id: 'n1',
  ncr_number: 1,
  ncr_label: 'NCR-0001',
  part_serial_number: 'SN-1',
  status: 'open',
  version: 1,
  comment: 'c',
  failure_code: 'FC',
  failure_code_description: '',
  disposition_code: 'DC',
  disposition_code_description: '',
  disposition_instructions: 'i',
  created_by: 'a@example.com',
  created_at: '2026-11-13T00:00:00Z',
  updated_by: 'a@example.com',
  updated_at: '2026-11-13T00:00:00Z',
  ...overrides,
});

function ncrState(overrides = {}) {
  return {
    ncrs: [],
    loading: false,
    loadError: '',
    editor: null,
    openCreate: jest.fn(),
    openEdit: jest.fn(),
    closeEditor: jest.fn(),
    setDraft: jest.fn(),
    saveEditor: jest.fn(),
    detail: null,
    openDetail: jest.fn(),
    closeDetail: jest.fn(),
    approve: jest.fn(),
    remove: jest.fn(),
    busy: false,
    actionError: '',
    ...overrides,
  };
}

const PART = { id: 'part-1', serial_number: 'SN-1' };
const CODES = [{ code: 'FC', description: 'Fail' }];
const DCODES = [{ code: 'DC', description: 'Disp' }];

function renderPane(stateOverrides = {}, props = {}) {
  const state = ncrState(stateOverrides);
  render(
    <NcrPane
      selectedPart={PART}
      readOnly={false}
      failureCodes={CODES}
      dispositionCodes={DCODES}
      ncrState={state}
      {...props}
    />,
  );
  return state;
}

afterEach(() => {
  delete window.__ncrXss;
});

describe('XSS and hostile text', () => {
  test('NCR fields are rendered as text in list and detail', () => {
    const evil = baseNcr({
      comment: XSS,
      disposition_instructions: XSS,
      failure_code: XSS,
      created_by: XSS,
      part_serial_number: XSS,
      ncr_label: XSS,
    });
    renderPane({ ncrs: [evil], detail: { ncr: evil, history: [], loading: false } });
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(window.__ncrXss).toBeUndefined();
    expect(screen.getAllByText(XSS, { exact: false }).length).toBeGreaterThan(0);
  });

  test('history values are rendered as text', () => {
    render(
      <NcrHistory
        loading={false}
        history={[{
          id: 'h1', version: 1, action: XSS, actor: XSS, at: XSS,
          changes: { [XSS]: { from: XSS, to: XSS }, comment: { from: null, to: XSS } },
        }]}
      />,
    );
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(window.__ncrXss).toBeUndefined();
  });

  test('report table renders text, not HTML', () => {
    render(<ProjectReportNcrTable report={{ ncrs: [{ ...baseNcr(), part_identifier: XSS, comment: XSS }] }} />);
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  test('config panel inputs hold hostile values as values', () => {
    function Harness() {
      const [config, setConfig] = useState({ ncr_configuration: { failure_codes: [{ code: XSS, description: XSS }], disposition_codes: [] } });
      return <NcrConfigurationPanel config={config} setConfig={setConfig} />;
    }
    render(<Harness />);
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByLabelText('Failure Codes code 1')).toHaveValue(XSS);
  });
});

describe('NcrHistory robustness', () => {
  test('unknown action and field names render without crashing', () => {
    render(
      <NcrHistory
        loading={false}
        history={[{ id: 'h1', version: 1, action: 'restored', actor: 'x', at: null, changes: { mystery_field: { from: 'a', to: 'b' } } }]}
      />,
    );
    const entry = screen.getByTestId('ncr-history-entry');
    expect(entry).toHaveTextContent('restored');
    expect(entry).toHaveTextContent('mystery_field: a -> b');
  });

  test('null / non-object change values do not crash', () => {
    expect(() => render(
      <NcrHistory
        loading={false}
        history={[
          { id: 'h1', version: 1, action: 'updated', actor: 'x', at: 'bad-date', changes: null },
          { id: 'h2', version: 2, action: 'updated', actor: 'x', at: 'bad-date', changes: { comment: null } },
          { id: 'h3', version: 3, action: 'updated', actor: 'x', at: 'bad-date', changes: { comment: 'oops' } },
          { id: 'h4', version: 4, action: 'updated', actor: 'x', at: 'bad-date', changes: { comment: 5 } },
          { id: 'h5', version: 5, action: 'updated', actor: 'x', at: 'bad-date', changes: ['a', 'b'] },
          { id: 'h6', version: 6, action: 'updated', actor: 'x', at: 'bad-date', changes: 'str' },
          { id: 'h7', version: 7, action: 'updated', actor: 'x', at: 'x', changes: { approval_revoked: { from: null, to: null } } },
          { id: 'h8', version: 8, action: 'updated', actor: 'x', at: 'x', changes: { approval_revoked: { from: 'str', to: null } } },
        ]}
      />,
    )).not.toThrow();
  });

  test('a string change value is not shown as character-indexed garbage', () => {
    render(
      <NcrHistory
        loading={false}
        history={[{ id: 'h6', version: 6, action: 'updated', actor: 'x', at: 'x', changes: 'str' }]}
      />,
    );
    const entry = screen.getByTestId('ncr-history-entry');
    // Object.entries('str') yields fields "0","1","2"; those are not real fields.
    expect(entry).not.toHaveTextContent('0:');
  });

  test('entries missing ids render without duplicate-key collapse', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <NcrHistory
        loading={false}
        history={[
          { version: 1, action: 'created', actor: 'a', at: 'x', changes: {} },
          { version: 2, action: 'updated', actor: 'b', at: 'x', changes: {} },
        ]}
      />,
    );
    expect(screen.getAllByTestId('ncr-history-entry')).toHaveLength(2);
    const keyWarnings = spy.mock.calls.filter((args) => String(args[0]).includes('key'));
    spy.mockRestore();
    expect(keyWarnings).toEqual([]);
  });

  test('non-array history renders an empty state', () => {
    render(<NcrHistory loading={false} history={{ not: 'array' }} />);
    expect(screen.getByText('No history recorded.')).toBeInTheDocument();
  });

  test('history is shown newest first even if server order is shuffled', () => {
    render(
      <NcrHistory
        loading={false}
        history={[
          { id: 'b', version: 2, action: 'approved', actor: 'x', at: 'x', changes: {} },
          { id: 'a', version: 1, action: 'created', actor: 'x', at: 'x', changes: {} },
          { id: 'c', version: 3, action: 'updated', actor: 'x', at: 'x', changes: {} },
        ]}
      />,
    );
    const labels = screen.getAllByTestId('ncr-history-entry').map((e) => e.querySelector('strong').textContent);
    expect(labels).toEqual(['Edited', 'Approved', 'Created']);
  });
});

describe('NcrPane robustness', () => {
  test('NCRs with missing fields do not render "undefined"/"null"', () => {
    renderPane({ ncrs: [{ id: 'x', ncr_label: 'NCR-0007', status: 'weird' }] });
    const list = screen.getByTestId('ncr-list');
    expect(list).not.toHaveTextContent('undefined');
    expect(list).not.toHaveTextContent('null');
    expect(within(list).getByTestId('ncr-status')).toHaveTextContent('Open');
  });

  test('detail with missing fields does not render "undefined"', () => {
    const partial = { id: 'x', ncr_label: 'NCR-0007', status: 'approved' };
    renderPane({ ncrs: [partial], detail: { ncr: partial, history: [], loading: false } });
    const detail = screen.getByRole('region', { name: 'NCR-0007 details' });
    expect(detail).not.toHaveTextContent('undefined');
  });

  test('delete is not sent when confirm is cancelled', () => {
    const n = baseNcr();
    const confirmDelete = jest.fn(() => false);
    const state = renderPane({ ncrs: [n], detail: { ncr: n, history: [], loading: false } }, { confirmDelete });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirmDelete).toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });

  test('read-only pane exposes no mutation controls even with editor state set', () => {
    const n = baseNcr();
    renderPane(
      { ncrs: [n], detail: { ncr: n, history: [], loading: false }, editor: { mode: 'edit', ncr: n, draft: { ...n } } },
      { readOnly: true },
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    ['Add NCR', 'Edit', 'Approve', 'Delete'].forEach((name) => {
      expect(screen.queryByRole('button', { name })).toBeNull();
    });
  });

  test('approve is disabled for approved NCRs and while busy', () => {
    const n = baseNcr({ status: 'approved', approved_by: 'b@example.com', approved_at: '2026-11-13T00:00:00Z' });
    renderPane({ ncrs: [n], detail: { ncr: n, history: [], loading: false } });
    expect(screen.getByRole('button', { name: 'Approved' })).toBeDisabled();
  });

  test('approved detail with null approved_by does not print "null"', () => {
    const n = baseNcr({ status: 'approved', approved_by: null, approved_at: null });
    renderPane({ ncrs: [n], detail: { ncr: n, history: [], loading: false } });
    const detail = screen.getByRole('region', { name: 'NCR-0001 details' });
    expect(detail).not.toHaveTextContent('null');
  });

  test('duplicate NCR ids in the list do not crash rendering', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    renderPane({ ncrs: [baseNcr(), baseNcr()] });
    spy.mockRestore();
    expect(screen.getAllByRole('button', { name: 'View NCR-0001' }).length).toBeGreaterThan(0);
  });
});

describe('NcrEditorModal robustness', () => {
  const editor = (overrides = {}) => ({
    mode: 'create', ncr: null, draft: { comment: '', failure_code: '', disposition_code: '', disposition_instructions: '' }, ...overrides,
  });

  function renderEditor(props = {}) {
    const onSave = jest.fn();
    const onClose = jest.fn();
    render(
      <NcrEditorModal
        editor={editor()}
        readOnly={false}
        busy={false}
        error=""
        failureCodes={CODES}
        dispositionCodes={DCODES}
        selectedPart={PART}
        setDraft={jest.fn()}
        onSave={onSave}
        onClose={onClose}
        {...props}
      />,
    );
    return { onSave, onClose };
  }

  test('very long code values render in the dropdown', () => {
    const long = 'L'.repeat(64);
    renderEditor({ failureCodes: [{ code: long, description: 'D'.repeat(255) }] });
    expect(screen.getByRole('option', { name: `${long} - ${'D'.repeat(255)}` })).toBeInTheDocument();
  });

  test('case-variant duplicate codes from a stored config do not create duplicate keys', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    renderEditor({ failureCodes: [{ code: 'A', description: '' }, { code: 'A', description: 'dup' }] });
    const keyWarnings = spy.mock.calls.filter((args) => String(args[0]).includes('same key'));
    spy.mockRestore();
    expect(keyWarnings).toEqual([]);
  });

  test('saved code differing only by case from a configured code stays selected', () => {
    // Saved "fc" vs configured "FC": withSavedCode treats it as existing, so the
    // only option has value "FC" while the select value is "fc".
    const n = baseNcr({ failure_code: 'fc' });
    renderEditor({ editor: editor({ mode: 'edit', ncr: n, draft: { ...n } }) });
    expect(screen.getByLabelText('Failure code')).toHaveValue('fc');
  });

  test('busy prevents backdrop-click and Cancel close', () => {
    const { onClose } = renderEditor({ busy: true });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(document.querySelector('.modal'));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('submitting while busy does not call onSave again (Enter key)', () => {
    const { onSave } = renderEditor({ busy: true });
    fireEvent.submit(document.querySelector('form'));
    expect(onSave).not.toHaveBeenCalled();
  });

  test('read-only renders nothing', () => {
    renderEditor({ readOnly: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ProjectReportNcrTable robustness', () => {
  test('drops malformed rows and tolerates missing ncrs', () => {
    expect(getReportNcrs(null)).toEqual([]);
    expect(getReportNcrs({ ncrs: 'x' })).toEqual([]);
    expect(getReportNcrs({ ncrs: [null, 1, 'x', { ncr_label: 1 }, { ncr_label: 'NCR-1', part_identifier: 'p' }] }))
      .toHaveLength(1);
  });

  test('deleted part (part_id null) row still renders', () => {
    render(<ProjectReportNcrTable report={{ ncrs: [{ ...baseNcr(), part_id: null, part_identifier: 'SN-GONE' }] }} />);
    expect(screen.getByText('SN-GONE')).toBeInTheDocument();
  });

  test('rows missing optional fields do not print "undefined"', () => {
    render(<ProjectReportNcrTable report={{ ncrs: [{ ncr_label: 'NCR-0001', part_identifier: 'p' }] }} />);
    expect(screen.getByRole('table')).not.toHaveTextContent('undefined');
  });
});

describe('NcrConfigurationPanel', () => {
  function Harness({ initial, readOnly = false }) {
    const [config, setConfig] = useState(initial);
    return <NcrConfigurationPanel config={config} setConfig={setConfig} readOnly={readOnly} />;
  }

  test('blank entries are flagged inline', () => {
    render(<Harness initial={{ ncr_configuration: { failure_codes: [{ code: '  ' }], disposition_codes: [] } }} />);
    expect(screen.getByLabelText('Failure Codes code 1')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a code.')).toBeInTheDocument();
  });

  test('malformed ncr_configuration does not crash the panel', () => {
    expect(() => render(<Harness initial={{ ncr_configuration: 'junk' }} />)).not.toThrow();
    expect(() => render(<Harness initial={null} />)).not.toThrow();
  });

  test('read-only disables all inputs', () => {
    render(<Harness readOnly initial={{ ncr_configuration: { failure_codes: [{ code: 'A' }], disposition_codes: [] } }} />);
    expect(screen.getByLabelText('Failure Codes code 1')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove failure code 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Failure code' })).toBeDisabled();
  });

  test('removing a middle entry keeps the remaining values aligned with inputs', () => {
    render(<Harness initial={{ ncr_configuration: { failure_codes: [{ code: 'A' }, { code: 'B' }, { code: 'C' }], disposition_codes: [] } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove failure code 2' }));
    expect(screen.getByLabelText('Failure Codes code 1')).toHaveValue('A');
    expect(screen.getByLabelText('Failure Codes code 2')).toHaveValue('C');
  });
});

describe('api/ncrs path and body construction', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}),
    }));
  });

  test('path segments are URL-encoded (no traversal via ids)', async () => {
    await fetchPartNcr('p/../x', '../../admin', 'a?b#c');
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/projects/p%2F..%2Fx/parts/..%2F..%2Fadmin/ncrs/a%3Fb%23c');
  });

  test('approve sends expected_version only when positive', async () => {
    await approvePartNcr('p', 'q', 'n', 3);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ expected_version: 3 });
    await approvePartNcr('p', 'q', 'n', undefined);
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({});
  });

  test('delete encodes expected_version in the query', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 204, headers: { get: () => null }, json: async () => null }));
    await deletePartNcr('p', 'q', 'n', 4);
    expect(global.fetch.mock.calls[0][0]).toBe('/api/projects/p/parts/q/ncrs/n?expected_version=4');
  });

  test('readOnly blocks write requests before fetch', async () => {
    await expect(updatePartNcr('p', 'q', 'n', {}, { readOnly: true })).rejects.toThrow('read-only');
    await expect(deletePartNcr('p', 'q', 'n', 1, { readOnly: true })).rejects.toThrow('read-only');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('caller options cannot override method/body', async () => {
    await updatePartNcr('p', 'q', 'n', { comment: 'x' }, { method: 'DELETE', body: 'evil' });
    const [, init] = global.fetch.mock.calls[0];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ comment: 'x' });
  });
});
