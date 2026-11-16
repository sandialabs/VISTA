import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import InspectionWorkbenchPanel from '../InspectionWorkbenchPanel';

jest.setTimeout(30000);

const NCR_CONFIG = {
  failure_codes: [
    { code: 'FC-01', description: 'Porosity' },
    { code: 'FC-02', description: 'Crack' },
  ],
  disposition_codes: [
    { code: 'RWK', description: 'Rework' },
    { code: 'SCR', description: 'Scrap' },
  ],
};

const PARTS = [
  { id: 'part-1', project_id: 'proj-1', batch_id: null, serial_number: 'SN-001', review_state: 'unreviewed', metadata: {} },
  { id: 'part-2', project_id: 'proj-1', batch_id: null, serial_number: 'SN-002', review_state: 'unreviewed', metadata: {} },
];

function json(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  });
}

// In-memory stand-in for the NCR API that follows the backend contract
// (sequential numbers, history entries, approval revocation on edit, soft delete).
function createNcrBackend({ user = 'inspector@example.com' } = {}) {
  const state = { ncrs: [], seq: 0, user, now: 0, requests: [] };
  const stamp = () => new Date(Date.UTC(2026, 10, 13, 12, 0, state.now++)).toISOString();
  const label = (n) => `NCR-${String(n).padStart(4, '0')}`;
  const describe = (list, code) => NCR_CONFIG[list].find((entry) => entry.code === code)?.description || '';
  const publicNcr = (ncr) => {
    const { history, ...rest } = ncr;
    return rest;
  };
  const withHistory = (ncr) => ({ ...publicNcr(ncr), history: ncr.history });

  function handle(url, options = {}) {
    const method = options.method || 'GET';
    const match = url.match(/\/api\/projects\/([^/]+)\/parts\/([^/]+)\/ncrs(?:\/([^/?]+))?(\/approve)?/);
    if (!match) return null;
    const [, , partId, ncrId, approveSuffix] = match;
    const body = options.body ? JSON.parse(options.body) : {};
    const includeDeleted = /[?&]include_deleted=true\b/.test(url);
    state.requests.push({ method, url });
    if (!ncrId && method === 'GET') {
      return json({
        part_id: partId,
        ncrs: state.ncrs.filter((n) => n.part_id === partId && (includeDeleted || !n.deleted_at)).map(publicNcr),
      });
    }
    if (!ncrId && method === 'POST') {
      const at = stamp();
      state.seq += 1;
      const ncr = {
        id: `ncr-${state.seq}`,
        part_id: partId,
        part_serial_number: PARTS.find((p) => p.id === partId).serial_number,
        ncr_number: state.seq,
        ncr_label: label(state.seq),
        status: 'open',
        ...body,
        failure_code_description: describe('failure_codes', body.failure_code),
        disposition_code_description: describe('disposition_codes', body.disposition_code),
        version: 1,
        created_at: at,
        created_by: state.user,
        updated_at: at,
        updated_by: state.user,
        approved_at: null,
        approved_by: null,
        history: [],
      };
      ncr.history.push({
        id: `${ncr.id}-h1`,
        version: 1,
        action: 'created',
        actor: state.user,
        at,
        changes: Object.fromEntries(['comment', 'failure_code', 'disposition_code', 'disposition_instructions']
          .map((field) => [field, { from: null, to: body[field] }])),
      });
      state.ncrs.push(ncr);
      return json(withHistory(ncr), 201);
    }
    const ncr = state.ncrs.find((n) => n.id === ncrId && n.part_id === partId
      && (!n.deleted_at || (method === 'GET' && includeDeleted)));
    if (!ncr) return json({ detail: 'NCR not found' }, 404);
    if (method === 'GET') return json(withHistory(ncr));
    if (body.expected_version && body.expected_version !== ncr.version) {
      return json({ detail: 'This NCR was changed by someone else. Reload it and try again.' }, 409);
    }
    const at = stamp();
    if (approveSuffix) {
      if (ncr.status === 'approved') return json({ detail: 'NCR is already approved' }, 409);
      ncr.status = 'approved';
      ncr.approved_by = state.user;
      ncr.approved_at = at;
      ncr.version += 1;
      ncr.updated_by = state.user;
      ncr.updated_at = at;
      ncr.history.push({
        id: `${ncr.id}-h${ncr.version}`,
        version: ncr.version,
        action: 'approved',
        actor: state.user,
        at,
        changes: { status: { from: 'open', to: 'approved' }, approved_by: { from: null, to: state.user } },
      });
      return json(withHistory(ncr));
    }
    if (method === 'PATCH') {
      const changes = {};
      ['comment', 'failure_code', 'disposition_code', 'disposition_instructions'].forEach((field) => {
        if (body[field] !== undefined && body[field] !== ncr[field]) {
          changes[field] = { from: ncr[field], to: body[field] };
          ncr[field] = body[field];
        }
      });
      if (Object.keys(changes).length === 0) return json(withHistory(ncr));
      if (ncr.status === 'approved') {
        changes.status = { from: 'approved', to: 'open' };
        changes.approval_revoked = { from: { approved_by: ncr.approved_by, approved_at: ncr.approved_at }, to: null };
        ncr.status = 'open';
        ncr.approved_by = null;
        ncr.approved_at = null;
      }
      ncr.version += 1;
      ncr.updated_by = state.user;
      ncr.updated_at = at;
      ncr.history.push({ id: `${ncr.id}-h${ncr.version}`, version: ncr.version, action: 'updated', actor: state.user, at, changes });
      return json(withHistory(ncr));
    }
    if (method === 'DELETE') {
      ncr.deleted_at = at;
      ncr.deleted_by = state.user;
      ncr.version += 1;
      ncr.history.push({ id: `${ncr.id}-h${ncr.version}`, version: ncr.version, action: 'deleted', actor: state.user, at, changes: { deleted: { from: false, to: true } } });
      ncr.deleted_by = state.user;
      return Promise.resolve({ ok: true, status: 204, headers: { get: () => null }, json: async () => null });
    }
    return json({ detail: 'unsupported' }, 405);
  }
  return { state, handle };
}

function mockFetch({ projectConfiguration = { ncr_configuration: NCR_CONFIG }, ncrBackend = createNcrBackend() } = {}) {
  global.fetch = jest.fn((url, options = {}) => {
    const ncrResponse = ncrBackend.handle(url, options);
    if (ncrResponse) return ncrResponse;
    if (url.includes('/configuration') && options.method === 'PUT') {
      return json({ config: JSON.parse(options.body).config });
    }
    if (url.includes('/configuration')) return json({ config: projectConfiguration, project_type: 'PT2' });
    if (url.includes('/workspace-state')) return json({ state: {} });
    if (url.includes('/metadata-dict')) return json({});
    if (url.endsWith('/batches')) return json([]);
    if (/\/parts(\?|$)/.test(url)) return json(PARTS);
    if (url.includes('/annotations')) return json({ annotations: [] });
    if (url.includes('/images-page?')) return json({ items: [], total: 0, has_more: false });
    if (url.includes('/images')) return json([]);
    return json({});
  });
  return ncrBackend;
}

async function renderWorkbench(props = {}) {
  render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT2" readOnly={false} {...props} />);
  const ncrTab = await screen.findByRole('tab', { name: 'NCR' });
  return ncrTab;
}

async function openNcrTab(props) {
  const ncrTab = await renderWorkbench(props);
  fireEvent.click(ncrTab);
  return screen.findByRole('region', { name: 'Nonconformance reports' });
}

async function createNcrThroughForm({
  comment = 'Porosity cluster on flange',
  failure = 'FC-01',
  disposition = 'RWK',
  instructions = 'Blend and re-inspect',
} = {}) {
  fireEvent.click(screen.getByRole('button', { name: 'Add NCR' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add NCR' });
  fireEvent.change(within(dialog).getByLabelText('Comment'), { target: { value: comment } });
  fireEvent.change(within(dialog).getByLabelText('Failure code'), { target: { value: failure } });
  fireEvent.change(within(dialog).getByLabelText('Disposition code'), { target: { value: disposition } });
  fireEvent.change(within(dialog).getByLabelText('Disposition Instructions'), { target: { value: instructions } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add NCR' })).not.toBeInTheDocument());
}

describe('Inspection NCR tab', () => {
  test('appears next to the Annotations tab in the right column', async () => {
    mockFetch();
    await renderWorkbench();
    const rightTabset = screen.getByTestId('inspection-right-tabset');
    const tabs = within(rightTabset).getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Annotations', 'NCR']);
  });

  test('can be hidden through the inspection.ncrs ui section', async () => {
    mockFetch({ projectConfiguration: { ncr_configuration: NCR_CONFIG, ui_sections: { 'inspection.ncrs': false } } });
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT2" readOnly={false} />);
    const rightTabset = await screen.findByTestId('inspection-right-tabset');
    await waitFor(() => expect(within(rightTabset).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Annotations']));
    expect(global.fetch.mock.calls.some(([url]) => url.includes('/ncrs'))).toBe(false);
  });

  test('form populates dropdowns from the NCR configuration and requires every field', async () => {
    mockFetch();
    const pane = await openNcrTab();
    expect(within(pane).getByText('No NCRs recorded for this part.')).toBeInTheDocument();

    fireEvent.click(within(pane).getByRole('button', { name: 'Add NCR' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add NCR' });
    const failureOptions = within(within(dialog).getByLabelText('Failure code')).getAllByRole('option').map((o) => o.textContent);
    expect(failureOptions).toEqual(['Select failure code', 'FC-01 - Porosity', 'FC-02 - Crack']);
    const dispositionOptions = within(within(dialog).getByLabelText('Disposition code')).getAllByRole('option').map((o) => o.textContent);
    expect(dispositionOptions).toEqual(['Select disposition code', 'RWK - Rework', 'SCR - Scrap']);

    fireEvent.change(within(dialog).getByLabelText('Comment'), { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Comment is required.');
    expect(alert).toHaveTextContent('Failure code is required.');
    expect(alert).toHaveTextContent('Disposition code is required.');
    expect(alert).toHaveTextContent('Disposition instructions is required.');
    expect(global.fetch.mock.calls.some(([url, o = {}]) => url.includes('/ncrs') && o.method === 'POST')).toBe(false);

    fireEvent.change(within(dialog).getByLabelText('Comment'), { target: { value: 'Fixed' } });
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  test('creates an NCR, lists it, and shows creator in history', async () => {
    const backend = mockFetch();
    await openNcrTab();
    await createNcrThroughForm({ comment: '  Porosity cluster on flange  ' });

    const postCall = global.fetch.mock.calls.find(([url, o = {}]) => url.includes('/parts/part-1/ncrs') && o.method === 'POST');
    expect(JSON.parse(postCall[1].body)).toEqual({
      comment: 'Porosity cluster on flange',
      failure_code: 'FC-01',
      disposition_code: 'RWK',
      disposition_instructions: 'Blend and re-inspect',
    });
    const list = screen.getByTestId('ncr-list');
    expect(within(list).getByText('NCR-0001')).toBeInTheDocument();
    expect(within(list).getByText('FC-01 / RWK')).toBeInTheDocument();
    expect(within(list).getByText('Created by inspector@example.com')).toBeInTheDocument();
    expect(within(list).getByTestId('ncr-status')).toHaveTextContent('Open');
    expect(backend.state.ncrs).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'View NCR-0001' }));
    const detail = await screen.findByRole('region', { name: 'NCR-0001 details' });
    const history = await within(detail).findByRole('region', { name: 'Change history' });
    await waitFor(() => expect(within(history).getAllByTestId('ncr-history-entry')).toHaveLength(1));
    expect(within(history).getByText('Created')).toBeInTheDocument();
    expect(history).toHaveTextContent('by inspector@example.com');
    expect(history).toHaveTextContent('Comment: Porosity cluster on flange');
  });

  test('edit, approve, and edit-after-approve flow records history and revokes approval', async () => {
    const backend = mockFetch();
    await openNcrTab();
    await createNcrThroughForm();

    fireEvent.click(screen.getByRole('button', { name: 'View NCR-0001' }));
    let detail = await screen.findByRole('region', { name: 'NCR-0001 details' });

    backend.state.user = 'approver@example.com';
    fireEvent.click(within(detail).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(within(screen.getByTestId('ncr-list')).getByTestId('ncr-status')).toHaveTextContent('Approved'));
    detail = screen.getByRole('region', { name: 'NCR-0001 details' });
    expect(detail).toHaveTextContent('approver@example.com');
    expect(within(detail).getByRole('button', { name: 'Approved' })).toBeDisabled();
    const approveCall = global.fetch.mock.calls.find(([url]) => url.endsWith('/approve'));
    expect(JSON.parse(approveCall[1].body)).toEqual({ expected_version: 1 });

    backend.state.user = 'editor@example.com';
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit NCR-0001' });
    expect(within(dialog).getByRole('note')).toHaveTextContent('Saving changes will revoke the approval');
    expect(within(dialog).getByLabelText('Comment')).toHaveValue('Porosity cluster on flange');
    fireEvent.change(within(dialog).getByLabelText('Disposition code'), { target: { value: 'SCR' } });
    fireEvent.change(within(dialog).getByLabelText('Disposition Instructions'), { target: { value: 'Scrap the part' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit NCR-0001' })).not.toBeInTheDocument());

    const patchCall = global.fetch.mock.calls.find(([, o = {}]) => o.method === 'PATCH');
    expect(JSON.parse(patchCall[1].body)).toEqual(expect.objectContaining({
      disposition_code: 'SCR',
      disposition_instructions: 'Scrap the part',
      expected_version: 2,
    }));
    const list = screen.getByTestId('ncr-list');
    expect(within(list).getByTestId('ncr-status')).toHaveTextContent('Open');
    expect(within(list).getByText('FC-01 / SCR')).toBeInTheDocument();
    expect(list).toHaveTextContent('Last edited by editor@example.com');

    detail = screen.getByRole('region', { name: 'NCR-0001 details' });
    const entries = within(detail).getAllByTestId('ncr-history-entry');
    expect(entries.map((entry) => entry.querySelector('strong').textContent)).toEqual(['Edited', 'Approved', 'Created']);
    expect(entries[0]).toHaveTextContent('by editor@example.com');
    expect(entries[0]).toHaveTextContent('Disposition code: RWK -> SCR');
    expect(entries[0]).toHaveTextContent('Disposition instructions: Blend and re-inspect -> Scrap the part');
    expect(entries[0]).toHaveTextContent('Approval revoked: approved by approver@example.com');
    expect(entries[1]).toHaveTextContent('by approver@example.com');
  });

  test('deletes an NCR after confirmation', async () => {
    const backend = mockFetch();
    await openNcrTab();
    await createNcrThroughForm();
    fireEvent.click(screen.getByRole('button', { name: 'View NCR-0001' }));
    const detail = await screen.findByRole('region', { name: 'NCR-0001 details' });

    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(backend.state.ncrs[0].deleted_at).toBeUndefined();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByText('No NCRs recorded for this part.')).toBeInTheDocument());
    expect(backend.state.ncrs[0].deleted_at).toBeTruthy();
    confirmSpy.mockRestore();
  });

  test('shows a server conflict and reloads the list', async () => {
    const backend = mockFetch();
    await openNcrTab();
    await createNcrThroughForm();
    fireEvent.click(screen.getByRole('button', { name: 'View NCR-0001' }));
    const detail = await screen.findByRole('region', { name: 'NCR-0001 details' });
    await waitFor(() => expect(within(detail).getAllByTestId('ncr-history-entry')).toHaveLength(1));

    // Someone else edits the NCR in the meantime.
    backend.state.ncrs[0].version = 5;
    fireEvent.click(within(detail).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/changed by someone else/)).toBeInTheDocument();
    await waitFor(() => expect(
      global.fetch.mock.calls.filter(([url, o = {}]) => url.endsWith('/parts/part-1/ncrs') && (o.method || 'GET') === 'GET').length,
    ).toBeGreaterThan(1));
  });

  test('explains missing codes when the NCR configuration is empty', async () => {
    mockFetch({ projectConfiguration: {} });
    const pane = await openNcrTab();
    expect(within(pane).getByTestId('ncr-codes-missing')).toHaveTextContent('Project Configuration > NCR Configuration');
  });

  test('keeps a removed code selectable on an existing NCR', async () => {
    const backend = createNcrBackend();
    mockFetch({ ncrBackend: backend });
    await openNcrTab();
    await createNcrThroughForm();
    // Simulate the code being removed from configuration after the NCR was saved.
    backend.state.ncrs[0].failure_code = 'FC-OLD';
    backend.state.ncrs[0].failure_code_description = 'Retired code';
    fireEvent.click(screen.getByRole('button', { name: 'View NCR-0001' }));
    const detail = await screen.findByRole('region', { name: 'NCR-0001 details' });
    await waitFor(() => expect(detail).toHaveTextContent('FC-OLD - Retired code'));
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit NCR-0001' });
    expect(within(dialog).getByLabelText('Failure code')).toHaveValue('FC-OLD');
    expect(within(dialog).getByRole('option', { name: 'FC-OLD - Retired code (no longer configured)' })).toBeInTheDocument();
  });

  test('read-only projects show NCRs without Add, Edit, Approve, or Delete', async () => {
    const backend = createNcrBackend();
    mockFetch({ ncrBackend: backend });
    await act(async () => {
      backend.handle('/api/projects/proj-1/parts/part-1/ncrs', {
        method: 'POST',
        body: JSON.stringify({
          comment: 'c', failure_code: 'FC-01', disposition_code: 'RWK', disposition_instructions: 'i',
        }),
      });
    });
    const pane = await openNcrTab({ readOnly: true });
    await within(pane).findByText('NCR-0001');
    expect(within(pane).queryByRole('button', { name: 'Add NCR' })).not.toBeInTheDocument();
    fireEvent.click(within(pane).getByRole('button', { name: 'View NCR-0001' }));
    const detail = await screen.findByRole('region', { name: 'NCR-0001 details' });
    expect(within(detail).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  test('PT3 workbench offers an NCR side tab beside Annotations', async () => {
    mockFetch();
    render(<InspectionWorkbenchPanel projectId="proj-1" projectType="PT3" readOnly={false} />);
    const aside = await screen.findByRole('complementary', { name: 'PT3 annotations' });
    const sideTabs = within(aside).getByRole('tablist', { name: 'Inspection side panel' });
    expect(within(sideTabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Annotations', 'NCR']);
    expect(within(aside).queryByRole('region', { name: 'Nonconformance reports' })).not.toBeInTheDocument();
    fireEvent.click(within(sideTabs).getByRole('tab', { name: 'NCR' }));
    const pane = await within(aside).findByRole('region', { name: 'Nonconformance reports' });
    expect(within(pane).getByRole('button', { name: 'Add NCR' })).toBeInTheDocument();
  });

  describe('View deleted', () => {
    async function seed(backend, partId, comment) {
      await act(async () => {
        await backend.handle(`/api/projects/proj-1/parts/${partId}/ncrs`, {
          method: 'POST',
          body: JSON.stringify({
            comment, failure_code: 'FC-01', disposition_code: 'RWK', disposition_instructions: 'i',
          }),
        });
      });
    }

    function deleteDirectly(backend, ncrId) {
      const ncr = backend.state.ncrs.find((entry) => entry.id === ncrId);
      return backend.handle(`/api/projects/proj-1/parts/${ncr.part_id}/ncrs/${ncrId}`, { method: 'DELETE' });
    }

    function selectPart(serial) {
      fireEvent.click(screen.getAllByText(serial)[0]);
    }

    test('shows deleted NCRs read-only with who deleted them, and hides them again', async () => {
      const backend = createNcrBackend();
      mockFetch({ ncrBackend: backend });
      await seed(backend, 'part-1', 'kept');
      await seed(backend, 'part-1', 'removed');
      backend.state.user = 'remover@example.com';
      await act(async () => { await deleteDirectly(backend, 'ncr-2'); });

      const pane = await openNcrTab();
      const list = within(pane).getByTestId('ncr-list');
      await within(list).findByText('NCR-0001');
      expect(within(list).queryByText('NCR-0002')).not.toBeInTheDocument();
      const checkbox = within(pane).getByRole('checkbox', { name: 'View deleted' });
      expect(checkbox).not.toBeChecked();

      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
      await within(list).findByText('NCR-0002');
      expect(backend.state.requests.some(({ url }) => url.endsWith('/parts/part-1/ncrs?include_deleted=true'))).toBe(true);
      const deletedRow = within(list).getByText('NCR-0002').closest('li');
      expect(deletedRow).toHaveAttribute('data-deleted', 'true');
      expect(within(deletedRow).getByTestId('ncr-status')).toHaveTextContent('Deleted');
      expect(deletedRow).toHaveTextContent('Deleted by remover@example.com');
      expect(within(pane).getByText('1 deleted NCR shown.')).toBeInTheDocument();

      fireEvent.click(within(pane).getByRole('button', { name: 'View NCR-0002' }));
      const detail = await screen.findByRole('region', { name: 'NCR-0002 details' });
      const history = await within(detail).findByRole('region', { name: 'Change history' });
      await waitFor(() => expect(within(history).getAllByTestId('ncr-history-entry')).toHaveLength(2));
      expect(within(history).getAllByTestId('ncr-history-entry')[0]).toHaveTextContent('Deleted by remover@example.com');
      expect(within(detail).getByRole('note')).toHaveTextContent('shown read-only');
      for (const name of ['Edit', 'Approve', 'Delete']) {
        expect(within(detail).queryByRole('button', { name })).not.toBeInTheDocument();
      }
      expect(backend.state.requests.some(({ url }) => url.endsWith('/ncrs/ncr-2?include_deleted=true'))).toBe(true);

      fireEvent.click(checkbox);
      await waitFor(() => expect(within(list).queryByText('NCR-0002')).not.toBeInTheDocument());
      expect(screen.queryByRole('region', { name: 'NCR-0002 details' })).not.toBeInTheDocument();
      expect(within(list).getByText('NCR-0001')).toBeInTheDocument();
    });

    test('stays checked when the user selects a different part', async () => {
      const backend = createNcrBackend();
      mockFetch({ ncrBackend: backend });
      await seed(backend, 'part-1', 'p1 kept');
      await seed(backend, 'part-2', 'p2 removed');
      await act(async () => { await deleteDirectly(backend, 'ncr-2'); });

      const pane = await openNcrTab();
      fireEvent.click(within(pane).getByRole('checkbox', { name: 'View deleted' }));
      await waitFor(() => expect(
        backend.state.requests.some(({ url }) => url.endsWith('/parts/part-1/ncrs?include_deleted=true')),
      ).toBe(true));

      selectPart('SN-002');
      const paneAfter = await screen.findByRole('region', { name: 'Nonconformance reports' });
      await within(paneAfter).findByText('For selected part: SN-002');
      expect(within(paneAfter).getByRole('checkbox', { name: 'View deleted' })).toBeChecked();
      const list = within(paneAfter).getByTestId('ncr-list');
      await within(list).findByText('NCR-0002');
      expect(within(list).getByText('NCR-0002').closest('li')).toHaveAttribute('data-deleted', 'true');
      expect(backend.state.requests.some(({ url }) => url.endsWith('/parts/part-2/ncrs?include_deleted=true'))).toBe(true);
      // Every list request after the toggle asked for deleted NCRs.
      const togglePoint = backend.state.requests.findIndex(({ url }) => url.includes('include_deleted=true'));
      const laterLists = backend.state.requests.slice(togglePoint)
        .filter(({ method, url }) => method === 'GET' && /\/ncrs(\?|$)/.test(url));
      expect(laterLists.every(({ url }) => url.includes('include_deleted=true'))).toBe(true);

      selectPart('SN-001');
      await within(paneAfter).findByText('For selected part: SN-001');
      expect(within(paneAfter).getByRole('checkbox', { name: 'View deleted' })).toBeChecked();
    });

    test('deleting an NCR while viewing deleted keeps it listed as deleted', async () => {
      const backend = createNcrBackend();
      mockFetch({ ncrBackend: backend });
      await seed(backend, 'part-1', 'to delete');
      const pane = await openNcrTab();
      fireEvent.click(within(pane).getByRole('checkbox', { name: 'View deleted' }));
      fireEvent.click(await within(pane).findByRole('button', { name: 'View NCR-0001' }));
      const detail = await screen.findByRole('region', { name: 'NCR-0001 details' });
      const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
      fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
      const list = within(pane).getByTestId('ncr-list');
      await waitFor(() => expect(within(list).getByText('NCR-0001').closest('li')).toHaveAttribute('data-deleted', 'true'));
      expect(confirmSpy.mock.calls[0][0]).toMatch('View deleted');
      confirmSpy.mockRestore();
    });

    test('read-only projects can still view deleted NCRs', async () => {
      const backend = createNcrBackend();
      mockFetch({ ncrBackend: backend });
      await seed(backend, 'part-1', 'archived');
      await act(async () => { await deleteDirectly(backend, 'ncr-1'); });
      const pane = await openNcrTab({ readOnly: true });
      fireEvent.click(within(pane).getByRole('checkbox', { name: 'View deleted' }));
      await within(pane).findByText('NCR-0001');
    });
  });
});
