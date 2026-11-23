// Full-stack dashboard organization journey against the real backend.
//
// Seeds data through the public API (as a user would via the UI or scripts),
// then drives the dashboard purely through user actions and records
// screenshots under artifacts/dashboard-*.png for visual review.
const fs = require('fs');
const path = require('path');
const { test, expect, request: pwRequest } = require('@playwright/test');

const BACKEND = process.env.E2E_BACKEND_URL || 'http://127.0.0.1:8000';
const GROUP_A = 'inspection-line-a';
const GROUP_B = 'inspection-line-b';
const EMPTY_GROUP = 'empty-new-group';
const SHOTS = path.resolve(__dirname, '../../artifacts');
const RUN = Date.now().toString(36);

fs.mkdirSync(SHOTS, { recursive: true });

async function shot(page, name) {
  // Let entrance animations (alerts, toasts) finish so the record is faithful.
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, `dashboard-${name}.png`), fullPage: false, animations: 'disabled' });
}

async function api(ctx, method, url, data) {
  const response = await ctx.fetch(`${BACKEND}${url}`, { method, data });
  const body = await response.json().catch(() => null);
  if (!response.ok()) throw new Error(`${method} ${url} -> ${response.status()} ${JSON.stringify(body)}`);
  return body;
}

let ctx;
const ids = {};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ctx = await pwRequest.newContext();
  const folder = (name, parent, group = GROUP_A) => api(ctx, 'POST', '/api/folders', {
    name, meta_group_id: group, parent_id: parent || null,
  });
  const project = (name, folderId, extra = {}) => api(ctx, 'POST', '/api/projects/', {
    name, meta_group_id: GROUP_A, folder_id: folderId || null, ...extra,
  });

  ids.blades = (await folder(`Turbine Blades ${RUN}`)).id;
  ids.batch7 = (await folder('Batch 7', ids.blades)).id;
  ids.batch8 = (await folder('Batch 8', ids.blades)).id;
  ids.housings = (await folder(`Housings ${RUN}`)).id;
  ids.legacy = (await folder(`Legacy 2025 ${RUN}`)).id;
  ids.bFolder = (await folder(`Line B Only ${RUN}`, null, GROUP_B)).id;

  ids.scan1 = (await project(`Blade scan 001 ${RUN}`, ids.batch7, { description: 'CT scan of blade root' })).id;
  ids.scan2 = (await project(`Blade scan 002 ${RUN}`, ids.batch7, { project_type: 'PT2' })).id;
  ids.scan3 = (await project(`Blade scan 003 ${RUN}`, ids.batch8)).id;
  ids.housing = (await project(`Housing weld check ${RUN}`, ids.housings)).id;
  ids.legacyProject = (await project(`Old inspection ${RUN}`, ids.legacy)).id;
  // Plenty of root projects to show density.
  for (let i = 0; i < 45; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await project(`Root project ${String(i).padStart(2, '0')} ${RUN}`, null, { project_type: ['PT1', 'PT2', 'PT3'][i % 3] });
  }
  await api(ctx, 'POST', `/api/folders/${ids.legacy}/archive`);
});

test.afterAll(async () => {
  await ctx?.dispose();
});

test('access group selector lists every member group, including ones with no projects, and is remembered', async ({ page }) => {
  await page.goto('/');
  const selector = page.getByRole('combobox', { name: 'Access group' });
  await expect(selector).toBeVisible();
  const options = await selector.locator('option').allTextContents();
  expect(options).toEqual(expect.arrayContaining([GROUP_A, GROUP_B, EMPTY_GROUP]));

  await selector.selectOption(EMPTY_GROUP);
  await expect(page.getByText('No projects yet')).toBeVisible();
  await shot(page, '01-empty-group');

  await selector.selectOption(GROUP_A);
  await expect(page.getByRole('table', { name: 'Folders and projects' })).toBeVisible();
  await page.reload();
  await expect(selector).toHaveValue(GROUP_A);
});

test('dense listing shows 25+ rows on a 1600x1000 screen with folders first and counts; no sidebar', async ({ page }) => {
  await page.goto(`/?ag=${GROUP_A}`);
  const table = page.getByRole('table', { name: 'Folders and projects' });
  await expect(table.getByText(`Turbine Blades ${RUN}`)).toBeVisible();

  const rows = table.locator('tbody tr');
  const firstTwo = await rows.evaluateAll((els) => els.slice(0, 2).map((el) => el.dataset.testid));
  expect(firstTwo.every((id) => id.startsWith('folder-row-'))).toBe(true);
  // Archived folders are hidden by default.
  await expect(table.getByText(`Legacy 2025 ${RUN}`)).toHaveCount(0);

  const viewportHeight = page.viewportSize().height;
  const visibleRows = await rows.evaluateAll((els, h) => els.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= h;
  }).length, viewportHeight);
  expect(visibleRows).toBeGreaterThanOrEqual(25);
  const rowHeight = await rows.first().evaluate((el) => el.getBoundingClientRect().height);
  expect(rowHeight).toBeLessThanOrEqual(30);

  await expect(page.getByRole('tree')).toHaveCount(0);
  await expect(page.getByText('All projects')).toHaveCount(0);
  await expect(page.getByTestId(`folder-row-${ids.blades}`)).toContainText('2 folders · 3 projects');
  await shot(page, '02-dense-root');
});

test('arrows open folders in place, showing subfolders and their projects; state survives reload', async ({ page }) => {
  await page.goto(`/?ag=${GROUP_A}`);
  const table = page.getByRole('table', { name: 'Folders and projects' });
  await table.getByRole('button', { name: `Expand Turbine Blades ${RUN}`, exact: true }).click();
  await expect(page.getByTestId(`folder-row-${ids.batch7}`)).toBeVisible();
  await expect(page.getByTestId(`folder-row-${ids.batch7}`)).toHaveAttribute('aria-level', '2');
  await table.getByRole('button', { name: 'Expand Batch 7', exact: true }).click();
  await expect(page.getByTestId(`project-row-${ids.scan1}`)).toBeVisible();
  await expect(page.getByTestId(`project-row-${ids.scan1}`)).toHaveAttribute('aria-level', '3');
  // Still at the access-group root: the arrow does not navigate.
  expect(new URL(page.url()).searchParams.get('folder')).toBeNull();
  await shot(page, '02b-expanded-in-place');

  await page.reload();
  await expect(page.getByTestId(`project-row-${ids.scan1}`)).toBeVisible();

  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
  await expect(page.getByTestId(`folder-row-${ids.batch7}`)).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(page.getByTestId(`project-row-${ids.scan3}`)).toBeVisible();
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
});

test('navigates into nested folders via table and breadcrumb; browser Back works', async ({ page }) => {
  await page.goto(`/?ag=${GROUP_A}`);
  const table = page.getByRole('table', { name: 'Folders and projects' });
  await table.getByRole('button', { name: `Turbine Blades ${RUN}`, exact: true }).click();
  await expect(table.getByRole('button', { name: 'Batch 7', exact: true })).toBeVisible();
  await table.getByRole('button', { name: 'Batch 7', exact: true }).click();
  await expect(table.getByText(`Blade scan 001 ${RUN}`)).toBeVisible();
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
  await expect(crumbs.getByRole('combobox', { name: 'Access group' })).toHaveValue(GROUP_A);
  await expect(crumbs).toContainText(`Top/Turbine Blades ${RUN}/Batch 7`);
  await shot(page, '03-nested-folder');

  await page.goBack();
  await expect(table.getByRole('button', { name: 'Batch 8', exact: true })).toBeVisible();
  await crumbs.getByRole('button', { name: 'Top', exact: true }).click();
  await expect(table.getByText(`Root project 00 ${RUN}`)).toBeVisible();
});

test('creates a folder and subfolder; name is required; rename and edit description', async ({ page }) => {
  await page.goto(`/?ag=${GROUP_A}&folder=${ids.housings}`);
  await page.getByRole('button', { name: 'New Folder', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Folder' });
  await dialog.getByRole('button', { name: 'Create Folder', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Folder name is required.');
  await dialog.getByLabel('Folder Name *').fill('Weld lot 12');
  await dialog.getByLabel('Description').fill('Lot from supplier X');
  await shot(page, '04-new-folder-dialog');
  await dialog.getByRole('button', { name: 'Create Folder', exact: true }).click();
  const table = page.getByRole('table', { name: 'Folders and projects' });
  await expect(table.getByRole('button', { name: 'Weld lot 12', exact: true })).toBeVisible();

  await table.getByRole('button', { name: 'Folder options for Weld lot 12', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename / Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Folder' });
  await edit.getByLabel('Folder Name *').fill('Weld lot 12A');
  await edit.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(table.getByRole('button', { name: 'Weld lot 12A', exact: true })).toBeVisible();
});

test('search finds folders and projects anywhere below the current location', async ({ page }) => {
  await page.goto(`/?ag=${GROUP_A}`);
  await page.getByRole('searchbox', { name: `Search in ${GROUP_A}` }).fill('blade');
  const table = page.getByRole('table', { name: 'Folders and projects' });
  await expect(table.getByText(`Blade scan 003 ${RUN}`)).toBeVisible();
  await expect(page.getByTestId(`folder-row-${ids.blades}`)).toBeVisible();
  await expect(page.getByText(/Search results for "blade"/)).toBeVisible();
  await expect(page.getByTestId(`project-row-${ids.scan3}`)).toContainText(`Turbine Blades ${RUN} / Batch 8`);
  await expect(table.getByText(`Root project 00 ${RUN}`)).toHaveCount(0);
  await shot(page, '05-search');

  await page.goto(`/?ag=${GROUP_A}&folder=${ids.batch8}`);
  await page.getByRole('searchbox', { name: 'Search in Batch 8' }).fill('blade');
  await expect(table.getByText(`Blade scan 003 ${RUN}`)).toBeVisible();
  await expect(table.getByText(`Blade scan 001 ${RUN}`)).toHaveCount(0);
});

test('sorts projects by created date ascending and descending', async ({ page }) => {
  await page.goto(`/?ag=${GROUP_A}`);
  const table = page.getByRole('table', { name: 'Folders and projects' });
  await expect(table.getByText(`Root project 00 ${RUN}`)).toBeVisible();
  const names = () => table.locator('tbody tr.dash-row-project .dash-name-text').allTextContents();
  await page.getByRole('button', { name: /Created/ }).click();
  await expect(page.getByRole('columnheader', { name: /Created/ })).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(async () => (await names())[0]).toContain('Root project 44');
  await page.getByRole('button', { name: /Created/ }).click();
  await expect(page.getByRole('columnheader', { name: /Created/ })).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(async () => (await names()).find((n) => n.startsWith('Root project'))).toContain('Root project 00');
});

test('moves a project with the move dialog, then undoes it', async ({ page }) => {
  await page.goto(`/?ag=${GROUP_A}`);
  const table = page.getByRole('table', { name: 'Folders and projects' });
  const name = `Root project 01 ${RUN}`;
  await table.getByRole('button', { name: `Project options for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move to...' }).click();
  const dialog = page.getByRole('dialog', { name: `Move "${name}"` });
  await expect(dialog.getByRole('radio', { name: /Legacy 2025.*\(archived\)/ })).toHaveCount(0);
  await dialog.getByRole('radio', { name: 'Batch 8', exact: true }).check();
  await shot(page, '06-move-dialog');
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(table.getByText(name)).toHaveCount(0);
  const undo = page.locator('.undo-toast');
  await expect(undo).toContainText('Moved 1 item.');
  await shot(page, '07-undo-toast');
  await undo.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(table.getByText(name)).toBeVisible();
});

test('moving a folder moves everything inside; a folder cannot go into its own subfolder', async ({ page }) => {
  await page.goto(`/?ag=${GROUP_A}&folder=${ids.blades}`);
  const table = page.getByRole('table', { name: 'Folders and projects' });
  await table.getByRole('button', { name: 'Folder options for Batch 8', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move to...' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move "Batch 8"' });
  await expect(dialog.getByRole('radio', { name: 'Batch 8 (being moved)', exact: true })).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Batch 7', exact: true }).check();
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(table.getByRole('button', { name: 'Batch 8', exact: true })).toHaveCount(0);

  const scan3 = await api(ctx, 'GET', `/api/projects/${ids.scan3}`);
  expect(scan3.folder_path.map((p) => p.name)).toEqual([`Turbine Blades ${RUN}`, 'Batch 7', 'Batch 8']);
  // Put it back for the following tests.
  await api(ctx, 'POST', `/api/folders/${ids.batch8}/move`, { parent_id: ids.blades });
});

test('multi-select with shift-click and bulk move all-or-nothing', async ({ page }) => {
  await page.goto(`/?ag=${GROUP_A}`);
  const table = page.getByRole('table', { name: 'Folders and projects' });
  await table.getByRole('checkbox', { name: `Select project Root project 10 ${RUN}` }).click();
  await table.getByRole('checkbox', { name: `Select project Root project 12 ${RUN}` }).click({ modifiers: ['Shift'] });
  const bar = page.getByRole('region', { name: 'Selection actions' });
  await expect(bar).toContainText('3 selected');
  await shot(page, '08-multi-select');
  await bar.getByRole('button', { name: 'Move to...', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Move 3 items' });
  await dialog.getByRole('radio', { name: `Housings ${RUN}`, exact: true }).check();
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.locator('.undo-toast')).toContainText('Moved 3 items.');
  await page.goto(`/?ag=${GROUP_A}&folder=${ids.housings}`);
  await expect(table.getByText(`Root project 11 ${RUN}`)).toBeVisible();
});

test('archiving a folder locks everything inside and hides it; Show archived reveals it read-only', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto(`/?ag=${GROUP_A}`);
  const table = page.getByRole('table', { name: 'Folders and projects' });
  await table.getByRole('button', { name: `Folder options for Turbine Blades ${RUN}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(table.getByRole('button', { name: `Turbine Blades ${RUN}`, exact: true })).toHaveCount(0);

  await page.getByText('Show archived').click();
  await table.getByRole('button', { name: `Turbine Blades ${RUN}`, exact: true }).click();
  await expect(page.getByRole('note')).toContainText('This folder is archived');
  await expect(page.getByRole('button', { name: 'New Folder', exact: true })).toBeDisabled();
  await table.getByRole('button', { name: 'Folder options for Batch 7', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Rename / Edit' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Move to...' })).toBeDisabled();
  await shot(page, '09-archived-folder');
  await page.keyboard.press('Escape');

  // The server enforces the lock too.
  const r = await ctx.fetch(`${BACKEND}/api/projects/${ids.scan1}`, { method: 'PUT', data: { name: 'nope' } });
  expect(r.status()).toBe(403);

  // Open a locked project: breadcrumb + read-only banner.
  await page.goto(`/project/${ids.scan1}`);
  await expect(page.getByRole('navigation', { name: 'Project location' })).toContainText(`Turbine Blades ${RUN}`);
  await expect(page.getByRole('note').first()).toContainText('inside an archived folder');
  await shot(page, '10-locked-project');

  await api(ctx, 'POST', `/api/folders/${ids.blades}/unarchive`);
});

test('recently opened and pinned projects appear at the top of the group', async ({ page }) => {
  await page.goto(`/project/${ids.housing}`);
  await expect(page.getByRole('heading', { name: `Housing weld check ${RUN}` })).toBeVisible();
  await page.goto(`/?ag=${GROUP_A}`);
  const recent = page.getByLabel('Recent');
  await expect(recent.getByRole('link', { name: `Housing weld check ${RUN}` })).toBeVisible();

  const table = page.getByRole('table', { name: 'Folders and projects' });
  await table.getByRole('button', { name: `Pin Root project 03 ${RUN}`, exact: true }).click();
  await expect(page.getByLabel('Pinned').getByRole('link', { name: `Root project 03 ${RUN}` })).toBeVisible();
  await shot(page, '11-pinned-recent');

  // Still visible inside a subfolder and during a search.
  await page.goto(`/?ag=${GROUP_A}&folder=${ids.batch7}`);
  await expect(page.getByLabel('Recent').getByRole('link', { name: `Housing weld check ${RUN}` })).toBeVisible();
  await expect(page.getByLabel('Pinned').getByRole('link', { name: `Root project 03 ${RUN}` })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search in Batch 7' }).fill('blade');
  await expect(page.getByTestId(`project-row-${ids.scan1}`)).toBeVisible();
  await expect(page.getByLabel('Recent').getByRole('link', { name: `Housing weld check ${RUN}` })).toBeVisible();
  await shot(page, '11b-recent-in-search');
});

test('the table never moves when checking boxes or searching; header holds only title and account menu', async ({ page }) => {
  await page.goto(`/?ag=${GROUP_A}`);
  const table = page.getByRole('table', { name: 'Folders and projects' });
  await expect(table.getByText(`Root project 05 ${RUN}`)).toBeVisible();
  // Document offset (scroll-independent): any layout shift above the table changes it.
  const top = async () => table.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  const start = await top();

  const bar = page.getByRole('region', { name: 'Selection actions' });
  await expect(bar.getByRole('button', { name: 'Move to...', exact: true })).toBeDisabled();
  await expect(bar.getByRole('button', { name: 'Archive', exact: true })).toBeDisabled();
  await shot(page, '14-nothing-selected');

  await table.getByRole('checkbox', { name: `Select project Root project 05 ${RUN}` }).click();
  await expect(bar).toContainText('1 selected');
  await expect(bar.getByRole('button', { name: 'Move to...', exact: true })).toBeEnabled();
  expect(await top()).toBe(start);
  await table.getByRole('checkbox', { name: `Select project Root project 05 ${RUN}` }).click();

  const search = page.getByRole('searchbox', { name: `Search in ${GROUP_A}` });
  const searchWidth = (await search.boundingBox()).width;
  await search.fill('root project 0');
  await expect(page.getByText(/Search results for/)).toBeVisible();
  expect(await top()).toBe(start);
  // The toolbar does not reflow during search either.
  expect((await search.boundingBox()).width).toBe(searchWidth);
  await expect(page.getByRole('button', { name: 'Expand all', exact: true })).toBeDisabled();

  // Header: title + account menu only.
  const header = page.getByRole('banner');
  await expect(header.getByRole('combobox')).toHaveCount(0);
  await expect(header.getByRole('button', { name: 'New Project', exact: true })).toHaveCount(0);
  expect((await header.boundingBox()).height).toBeLessThanOrEqual(56);
  await header.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'API Keys' })).toBeVisible();
  await shot(page, '15-account-menu');
  await page.getByRole('menuitem', { name: 'Open dashboard settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Dashboard Settings' })).toBeVisible();
});

test('creates a project in the current folder; access group is a dropdown and cannot be retyped', async ({ page }) => {
  await page.goto(`/?ag=${GROUP_A}&folder=${ids.batch8}`);
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New Project' });
  await expect(dialog.getByLabel('Access Group *')).toHaveValue(GROUP_A);
  await expect(dialog.getByTestId('create-project-folder')).toHaveText(`Turbine Blades ${RUN} / Batch 8`);
  await dialog.getByLabel('Project Name *').fill(`Blade scan 004 ${RUN}`);
  await shot(page, '12-create-project');
  await dialog.getByRole('button', { name: 'Create Project', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Folders and projects' }).getByText(`Blade scan 004 ${RUN}`)).toBeVisible();
});

test('deleting a folder requires the typed confirmation and removes everything inside', async ({ page }) => {
  await page.goto(`/?ag=${GROUP_A}`);
  await page.getByText('Show archived').click();
  const table = page.getByRole('table', { name: 'Folders and projects' });
  await table.getByRole('button', { name: `Folder options for Legacy 2025 ${RUN}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete...' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Folder' });
  await expect(dialog.getByRole('list', { name: 'Items that will be deleted' })).toContainText('1 project');
  const confirm = dialog.getByRole('button', { name: 'Delete Folder', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Type .* to confirm/).fill(`DELETE Legacy 2025 ${RUN}`);
  await shot(page, '13-delete-folder');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(table.getByRole('button', { name: `Legacy 2025 ${RUN}`, exact: true })).toHaveCount(0);
  const r = await ctx.fetch(`${BACKEND}/api/projects/${ids.legacyProject}`);
  expect(r.status()).toBe(404);
});

test('projects never move between access groups', async () => {
  const r = await ctx.fetch(`${BACKEND}/api/projects/${ids.housing}/move`, {
    method: 'POST', data: { folder_id: ids.bFolder },
  });
  expect(r.status()).toBe(403);
  const r2 = await ctx.fetch(`${BACKEND}/api/projects/${ids.housing}`, {
    method: 'PUT', data: { meta_group_id: GROUP_B },
  });
  expect(r2.status()).toBe(403);
});

test('clicking anywhere on a project row opens it, like folder rows', async ({ page }) => {
  await page.goto(`/?ag=${GROUP_A}`);
  const row = page.getByTestId(`project-row-${ids.housing}`).or(page.getByTestId(`folder-row-${ids.housings}`)).first();
  await expect(row).toBeVisible();
  // Open the folder by clicking its row, then the project by clicking its row.
  await page.getByTestId(`folder-row-${ids.housings}`).locator('td.dash-col-type').click();
  await expect(page).toHaveURL(new RegExp(`folder=${ids.housings}`));
  await page.getByTestId(`project-row-${ids.housing}`).locator('td.dash-col-type').click();
  await expect(page).toHaveURL(new RegExp(`/project/${ids.housing}$`));
  await expect(page.getByRole('heading', { name: `Housing weld check ${RUN}` })).toBeVisible();
});
