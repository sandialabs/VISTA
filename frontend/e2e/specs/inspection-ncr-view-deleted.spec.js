const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

const artifact = (name) => path.resolve(__dirname, '../../artifacts', name);

const PARTS = [
  { id: 'part-a', project_id: 'proj', batch_id: null, serial_number: 'SN-A-001', display_name: 'Housing A', review_state: 'unreviewed', metadata: {} },
  { id: 'part-b', project_id: 'proj', batch_id: null, serial_number: 'SN-B-002', display_name: 'Housing B', review_state: 'unreviewed', metadata: {} },
];

function ncr(id, number, partId, overrides = {}) {
  return {
    id,
    ncr_number: number,
    ncr_label: `NCR-${String(number).padStart(4, '0')}`,
    part_id: partId,
    part_serial_number: PARTS.find((p) => p.id === partId).serial_number,
    status: 'open',
    comment: `Comment for ${id}`,
    failure_code: 'FC-01',
    failure_code_description: 'Porosity',
    disposition_code: 'RWK',
    disposition_code_description: 'Rework',
    disposition_instructions: 'Rework per WI-12',
    version: 1,
    created_by: 'inspector@example.com',
    created_at: '2026-11-13T14:00:00Z',
    updated_by: 'inspector@example.com',
    updated_at: '2026-11-13T14:00:00Z',
    approved_by: null,
    approved_at: null,
    deleted_by: null,
    deleted_at: null,
    ...overrides,
  };
}

const deletedBy = { deleted_by: 'qa-lead@example.com', deleted_at: '2026-11-13T16:30:00Z', version: 2 };
const NCRS = [
  ncr('a1', 1, 'part-a'),
  ncr('a2', 2, 'part-a', deletedBy),
  ncr('b1', 3, 'part-b', deletedBy),
];

test('View deleted shows deleted NCRs and stays checked across parts', async ({ page }) => {
  const { projectId } = await mockInspectionWorkbenchRoutes(page, {
    type: 'PT2',
    scenario: 'basic',
    mockParts: PARTS,
    mockBatches: [],
  });
  const listRequests = [];
  await page.route(/\/api\/projects\/[^/]+\/parts\/[^/]+\/ncrs(\/[^/?]+)?(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const includeDeleted = url.searchParams.get('include_deleted') === 'true';
    const [, partId, ncrId] = url.pathname.match(/\/parts\/([^/]+)\/ncrs(?:\/([^/]+))?$/);
    if (!ncrId) {
      listRequests.push({ partId, includeDeleted });
      const ncrs = NCRS.filter((n) => n.part_id === partId && (includeDeleted || !n.deleted_at));
      await route.fulfill({ json: { part_id: partId, ncrs } });
      return;
    }
    const found = NCRS.find((n) => n.id === ncrId && (includeDeleted || !n.deleted_at));
    if (!found) {
      await route.fulfill({ status: 404, json: { detail: 'NCR not found' } });
      return;
    }
    const history = [
      { id: `${ncrId}-1`, version: 1, action: 'created', actor: 'inspector@example.com', at: found.created_at, changes: { comment: { from: null, to: found.comment } } },
      ...(found.deleted_at ? [{ id: `${ncrId}-2`, version: 2, action: 'deleted', actor: found.deleted_by, at: found.deleted_at, changes: { deleted: { from: false, to: true } } }] : []),
    ];
    await route.fulfill({ json: { ...found, history } });
  });

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Inspection', exact: true }).click();
  await page.locator('.flexlayout__tab_button').filter({ hasText: /^NCR$/ }).click();
  const pane = page.getByRole('region', { name: 'Nonconformance reports' });
  const list = pane.getByTestId('ncr-list');
  const checkbox = pane.getByRole('checkbox', { name: 'View deleted' });

  await expect(pane).toContainText('For selected part: SN-A-001');
  await expect(list.getByText('NCR-0001')).toBeVisible();
  await expect(list.getByText('NCR-0002')).toHaveCount(0);
  await expect(checkbox).not.toBeChecked();

  await checkbox.check();
  await expect(list.getByText('NCR-0002')).toBeVisible();
  const deletedRow = list.locator('li[data-deleted="true"]');
  await expect(deletedRow).toHaveCount(1);
  await expect(deletedRow).toContainText('Deleted by qa-lead@example.com');
  await expect(deletedRow.getByTestId('ncr-status')).toHaveText('Deleted');
  await pane.getByRole('button', { name: 'View NCR-0002' }).click();
  const detail = pane.getByRole('region', { name: 'NCR-0002 details' });
  await expect(detail.getByRole('region', { name: 'Change history' })).toContainText('Deleted');
  for (const name of ['Edit', 'Approve', 'Delete']) {
    await expect(detail.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await page.mouse.move(0, 0);
  await pane.screenshot({ path: artifact('ncr-view-deleted.png') });

  // Select the other part: the checkbox stays checked and its deleted NCR shows.
  await page.getByText('Housing B').first().click();
  await expect(pane).toContainText('For selected part: SN-B-002');
  await expect(checkbox).toBeChecked();
  await expect(list.getByText('NCR-0003')).toBeVisible();
  await expect(list.locator('li[data-deleted="true"]')).toHaveCount(1);
  expect(listRequests.filter((r) => r.partId === 'part-b').every((r) => r.includeDeleted)).toBe(true);

  // Switch tabs and back: still checked.
  await page.locator('.flexlayout__tab_button').filter({ hasText: /^Annotations$/ }).click();
  await page.locator('.flexlayout__tab_button').filter({ hasText: /^NCR$/ }).click();
  await expect(pane.getByRole('checkbox', { name: 'View deleted' })).toBeChecked();

  // And back to the first part.
  await page.getByText('Housing A').first().click();
  await expect(pane).toContainText('For selected part: SN-A-001');
  await expect(checkbox).toBeChecked();
  await expect(list.getByText('NCR-0002')).toBeVisible();

  // Unchecking hides deleted NCRs again.
  await checkbox.uncheck();
  await expect(list.getByText('NCR-0002')).toHaveCount(0);
  await expect(list.getByText('NCR-0001')).toBeVisible();
});
