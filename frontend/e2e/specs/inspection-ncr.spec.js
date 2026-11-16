const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');
const { API_REQUEST } = require('../fixtures/apiRoutes');

const artifactDir = path.resolve(__dirname, '../../artifacts');

const NCR_CONFIGURATION = {
  failure_codes: [
    { code: 'FC-01', description: 'Porosity' },
    { code: 'FC-02', description: 'Crack' },
  ],
  disposition_codes: [
    { code: 'RWK', description: 'Rework' },
    { code: 'SCR', description: 'Scrap' },
  ],
};

// In-memory NCR API following the backend contract. Registered after the shared
// workbench mock so Playwright matches it first; unmatched requests fall back.
async function mockNcrRoutes(page, { users }) {
  const state = { ncrs: [], seq: 0, user: users[0], clock: 0 };
  const stamp = () => new Date(Date.UTC(2026, 10, 13, 14, 0, state.clock++)).toISOString();
  const describe = (list, code) => NCR_CONFIGURATION[list].find((entry) => entry.code === code)?.description || '';
  const strip = ({ history, ...rest }) => rest;
  const withHistory = (ncr) => ({ ...strip(ncr), history: ncr.history });
  const fields = ['comment', 'failure_code', 'disposition_code', 'disposition_instructions'];

  await page.route(API_REQUEST, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const match = url.pathname.match(/^\/api\/projects\/[^/]+\/parts\/([^/]+)\/ncrs(?:\/([^/]+))?(\/approve)?$/);
    if (!match) {
      await route.fallback();
      return;
    }
    const [, partId, ncrId, approve] = match;
    const method = request.method();
    const body = request.postDataJSON() || {};
    const reply = (status, payload) => route.fulfill({
      status,
      contentType: 'application/json',
      body: payload === null ? '' : JSON.stringify(payload),
    });

    if (!ncrId && method === 'GET') {
      await reply(200, { part_id: partId, ncrs: state.ncrs.filter((n) => n.part_id === partId && !n.deleted_at).map(strip) });
      return;
    }
    if (!ncrId && method === 'POST') {
      const at = stamp();
      state.seq += 1;
      const ncr = {
        id: `ncr-${state.seq}`,
        part_id: partId,
        part_serial_number: partId,
        ncr_number: state.seq,
        ncr_label: `NCR-${String(state.seq).padStart(4, '0')}`,
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
        history: [{
          id: `h-${state.seq}-1`,
          version: 1,
          action: 'created',
          actor: state.user,
          at,
          changes: Object.fromEntries(fields.map((field) => [field, { from: null, to: body[field] }])),
        }],
      };
      state.ncrs.push(ncr);
      await reply(201, withHistory(ncr));
      return;
    }
    const ncr = state.ncrs.find((entry) => entry.id === ncrId && !entry.deleted_at);
    if (!ncr) {
      await reply(404, { detail: 'NCR not found' });
      return;
    }
    if (method === 'GET') {
      await reply(200, withHistory(ncr));
      return;
    }
    const at = stamp();
    if (approve) {
      ncr.status = 'approved';
      ncr.approved_by = state.user;
      ncr.approved_at = at;
      ncr.version += 1;
      ncr.updated_by = state.user;
      ncr.updated_at = at;
      ncr.history.push({
        id: `h-${ncr.id}-${ncr.version}`,
        version: ncr.version,
        action: 'approved',
        actor: state.user,
        at,
        changes: { status: { from: 'open', to: 'approved' }, approved_by: { from: null, to: state.user } },
      });
      await reply(200, withHistory(ncr));
      return;
    }
    if (method === 'PATCH') {
      const changes = {};
      fields.forEach((field) => {
        if (body[field] !== undefined && body[field] !== ncr[field]) {
          changes[field] = { from: ncr[field], to: body[field] };
          ncr[field] = body[field];
        }
      });
      if (ncr.status === 'approved' && Object.keys(changes).length > 0) {
        changes.status = { from: 'approved', to: 'open' };
        changes.approval_revoked = { from: { approved_by: ncr.approved_by, approved_at: ncr.approved_at }, to: null };
        ncr.status = 'open';
        ncr.approved_by = null;
        ncr.approved_at = null;
      }
      ncr.disposition_code_description = describe('disposition_codes', ncr.disposition_code);
      ncr.version += 1;
      ncr.updated_by = state.user;
      ncr.updated_at = at;
      ncr.history.push({ id: `h-${ncr.id}-${ncr.version}`, version: ncr.version, action: 'updated', actor: state.user, at, changes });
      await reply(200, withHistory(ncr));
      return;
    }
    if (method === 'DELETE') {
      ncr.deleted_at = at;
      await reply(204, null);
      return;
    }
    await reply(405, { detail: 'unsupported' });
  });
  return state;
}

test('configures NCR codes, then raises, approves, and edits an NCR from Inspection', async ({ page }) => {
  const { projectId, getSavedConfigurations } = await mockInspectionWorkbenchRoutes(page, {
    type: 'PT2',
    scenario: 'basic',
  });
  const ncrState = await mockNcrRoutes(page, { users: ['inspector@example.com'] });

  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });

  // Project Configuration > NCR Configuration
  await page.getByRole('tab', { name: 'Project Configuration' }).click();
  const subtabs = page.getByRole('tablist', { name: 'Configuration sections' });
  await expect(subtabs.getByRole('tab', { name: 'General' })).toBeVisible();
  await expect(subtabs.getByRole('tab', { name: 'Hotkeys' })).toBeVisible();
  await expect(subtabs.getByRole('tab', { name: 'UI Configuration' })).toBeVisible();
  await subtabs.getByRole('tab', { name: 'NCR Configuration' }).click();
  const ncrPanel = page.getByRole('tabpanel', { name: 'NCR configuration' });
  await expect(ncrPanel.getByRole('region', { name: 'Failure Codes' })).toBeVisible();
  await expect(ncrPanel.getByRole('region', { name: 'Disposition Codes' })).toBeVisible();

  for (const [index, entry] of NCR_CONFIGURATION.failure_codes.entries()) {
    await ncrPanel.getByRole('button', { name: 'Add Failure code' }).click();
    await page.getByLabel(`Failure Codes code ${index + 1}`).fill(entry.code);
    await page.getByLabel(`Failure Codes description ${index + 1}`).fill(entry.description);
  }
  for (const [index, entry] of NCR_CONFIGURATION.disposition_codes.entries()) {
    await ncrPanel.getByRole('button', { name: 'Add Disposition code' }).click();
    await page.getByLabel(`Disposition Codes code ${index + 1}`).fill(entry.code);
    await page.getByLabel(`Disposition Codes description ${index + 1}`).fill(entry.description);
  }
  await page.locator('.project-configuration-panel').screenshot({ path: path.join(artifactDir, 'ncr-configuration.png') });
  await page.getByRole('button', { name: 'Save Configuration' }).click();
  await expect(page.getByText('Configuration saved.')).toBeVisible();
  await expect.poll(() => getSavedConfigurations().some(({ payload }) => (
    payload.config.ncr_configuration?.failure_codes?.length === 2
      && payload.config.ncr_configuration?.disposition_codes?.length === 2
  ))).toBeTruthy();

  // Inspection > NCR tab
  await page.getByRole('tab', { name: 'Inspection', exact: true }).click();
  const rightTabset = page.locator('.flexlayout__tabset').filter({ has: page.getByText('Annotations', { exact: true }) }).last();
  await expect(page.getByText('Annotations', { exact: true }).first()).toBeVisible();
  await page.locator('.flexlayout__tab_button').filter({ hasText: /^NCR$/ }).click();
  const pane = page.getByRole('region', { name: 'Nonconformance reports' });
  await expect(pane).toBeVisible();
  await expect(pane.getByText('No NCRs recorded for this part.')).toBeVisible();

  await pane.getByRole('button', { name: 'Add NCR' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add NCR' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Failure code').locator('option')).toHaveText([
    'Select failure code', 'FC-01 - Porosity', 'FC-02 - Crack',
  ]);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Comment is required.');
  await dialog.getByLabel('Comment').fill('Porosity cluster on the flange face, 3 pores over 0.5 mm.');
  await dialog.getByLabel('Failure code').selectOption('FC-01');
  await dialog.getByLabel('Disposition code').selectOption('RWK');
  await dialog.getByLabel('Disposition Instructions').fill('Blend per WI-12 and re-inspect with FPI.');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: path.join(artifactDir, 'ncr-add-form.png') });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const list = pane.getByTestId('ncr-list');
  await expect(list).toContainText('NCR-0001');
  await expect(list).toContainText('FC-01 / RWK');
  await expect(list).toContainText('Created by inspector@example.com');
  await expect(list.getByTestId('ncr-status')).toHaveText('Open');

  await pane.getByRole('button', { name: 'View NCR-0001' }).click();
  const detail = pane.getByRole('region', { name: 'NCR-0001 details' });
  await expect(detail.getByRole('region', { name: 'Change history' })).toContainText('Created');

  ncrState.user = 'approver@example.com';
  await detail.getByRole('button', { name: 'Approve' }).click();
  await expect(list.getByTestId('ncr-status')).toHaveText('Approved');
  await expect(detail).toContainText('approver@example.com');

  ncrState.user = 'editor@example.com';
  await detail.getByRole('button', { name: 'Edit' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit NCR-0001' });
  await expect(editDialog.getByRole('note')).toContainText('revoke the approval');
  await editDialog.getByLabel('Disposition code').selectOption('SCR');
  await editDialog.getByLabel('Disposition Instructions').fill('Scrap; porosity exceeds rework limits.');
  await editDialog.getByRole('button', { name: 'Save' }).click();
  await expect(editDialog).toBeHidden();

  await expect(list.getByTestId('ncr-status')).toHaveText('Open');
  await expect(list).toContainText('Last edited by editor@example.com');
  const history = detail.getByRole('region', { name: 'Change history' });
  await expect(history.getByTestId('ncr-history-entry')).toHaveCount(3);
  await expect(history.getByTestId('ncr-history-entry').first()).toContainText('Disposition code: RWK -> SCR');
  await expect(history.getByTestId('ncr-history-entry').first()).toContainText('Approval revoked: approved by approver@example.com');
  // Revoked approval: the NCR can be approved again.
  await expect(detail.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
  await page.mouse.move(0, 0);
  await rightTabset.screenshot({ path: path.join(artifactDir, 'ncr-inspection-tab.png') });
  await page.screenshot({ path: path.join(artifactDir, 'ncr-inspection-full.png'), fullPage: false });
});
