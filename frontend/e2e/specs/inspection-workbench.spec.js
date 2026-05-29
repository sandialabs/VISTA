const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

const screenshotPath = path.resolve(__dirname, '../../artifacts/pr04-mpr-workbench.png');
const pr08ScreenshotPath = path.resolve(__dirname, '../../artifacts/pr08-project-type-visibility.png');
const pr09ScreenshotPath = path.resolve(__dirname, '../../artifacts/pr09-inspector-modalities-measurements.png');
const pr11ScreenshotPath = path.resolve(__dirname, '../../artifacts/pr11-project-configuration.png');
const pr14ScreenshotPath = path.resolve(__dirname, '../../artifacts/pr14-report-normalization-advanced.png');
const projectDataLayoutScreenshotPath = path.resolve(__dirname, '../../artifacts/project-data-load-images-layout.png');
const simulatedUsers = ['basic', 'intermediate', 'advanced'];

test.describe('Project Data load images layout', () => {
  test('places Images to Parts before Batches and keeps upload left of compact export', async ({ page }) => {
    const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT1', scenario: 'basic' });

    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Project Data' }).click();

    await expect(page.getByRole('tab', { name: 'Load Images' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Images to Parts' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Batches' })).toBeVisible();

    const loadImagesTabBox = await page.getByRole('tab', { name: 'Load Images' }).boundingBox();
    const imagesToPartsTabBox = await page.getByRole('tab', { name: 'Images to Parts' }).boundingBox();
    const batchesTabBox = await page.getByRole('tab', { name: 'Batches' }).boundingBox();
    expect(
      loadImagesTabBox
        && imagesToPartsTabBox
        && batchesTabBox
        && loadImagesTabBox.x < imagesToPartsTabBox.x
        && imagesToPartsTabBox.x < batchesTabBox.x
    ).toBeTruthy();

    await expect(page.getByRole('heading', { name: 'Upload Images' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Export Data' })).toBeVisible();
    const uploadCardBox = await page.locator('.project-data-upload-first .upload-section').boundingBox();
    const exportCardBox = await page.locator('.project-data-upload-first .export-section').boundingBox();
    expect(
      uploadCardBox
        && exportCardBox
        && uploadCardBox.x < exportCardBox.x
        && uploadCardBox.width > exportCardBox.width
    ).toBeTruthy();

    await page.locator('.project-data-tab-panel[aria-label="Load Images"]').screenshot({
      path: projectDataLayoutScreenshotPath,
    });
  });
});

for (const projectType of ['PT1', 'PT2', 'PT3']) {
  for (const simulatedUser of simulatedUsers) {
    test.describe(`Inspection Workbench E2E (${projectType}) ${simulatedUser}`, () => {
      test(`renders project data workflow for ${projectType} ${simulatedUser}`, async ({ page }) => {
        const { projectId, getWorkspaceStates, getIngestValidationRequests } = await mockInspectionWorkbenchRoutes(page, { type: projectType, scenario: simulatedUser });

        await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
        await page.getByRole('tab', { name: 'Project Data' }).click();

        await expect(page.getByTestId('project-data-summary')).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Load Images' })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('tab', { name: 'Batches' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Upload Images' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Data Validation' })).toBeVisible();
        await page.getByRole('tab', { name: 'Project Configuration' }).click();
        await expect(page.getByRole('heading', { name: 'Project Metadata' })).toBeVisible();
        await expect(page.getByTestId('project-metadata-tree')).toContainText('inspection_profile');
        await page.getByRole('tab', { name: 'Project Data' }).click();
        const summaryBox = await page.getByTestId('project-data-summary').boundingBox();
        const tabsBox = await page.getByRole('tab', { name: 'Load Images' }).boundingBox();
        expect(summaryBox && tabsBox && summaryBox.y < tabsBox.y).toBeTruthy();
        await page.getByTestId('request-ingest-validation').click();
        await expect(page.getByTestId('ingest-validation-result')).toContainText('Ingest validation complete');

        await page.getByRole('tab', { name: 'Inspection' }).click();
        const inspectionPanel = page.locator('section[aria-label="Inspection Workbench"]');
        await expect(inspectionPanel).toBeVisible();
        if (projectType === 'PT3') {
          await expect(page.getByTestId('inspection-layout-grid')).toHaveCount(0);
          await expect(page.getByTestId('mpr-panel')).toBeVisible();
          await expect(page.getByLabel('3D view')).toHaveValue('orientation');
          await expect(page.getByTestId('mpr-pane-3d')).toContainText('3D');
          await expect(page.locator('.mpr-mirror-toggle').first()).toBeVisible();
          await expect.poll(() => getWorkspaceStates().length).toBeGreaterThan(0);
          return;
        }
        await expect(page.getByTestId('inspection-layout-grid')).toBeVisible();
        await expect(inspectionPanel.locator('.flexlayout__tab_button', { hasText: 'Part Summary' }).first()).toBeVisible();
        await expect(inspectionPanel.locator('.flexlayout__tab_button', { hasText: 'Inspection' }).first()).toBeVisible();
        await expect(inspectionPanel.locator('.flexlayout__tab_button', { hasText: 'Image Metadata' }).first()).toBeVisible();
        await expect(inspectionPanel.locator('.flexlayout__tab_button', { hasText: 'Annotations' }).first()).toBeVisible();
        await expect(page.getByLabel('Batch', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Status')).toBeVisible();
        await expect(page.getByLabel('Filter')).toBeVisible();
        await expect(page.getByLabel('Sort')).toBeVisible();

        if (simulatedUser === 'basic') {
          await expect(page.getByText('Batches: 1')).toBeVisible();
          await expect(page.getByText('Parts: 1')).toBeVisible();
        } else if (simulatedUser === 'intermediate') {
          await expect(page.getByText('Batches: 2')).toBeVisible();
          await expect(page.getByText('Parts: 2')).toBeVisible();
        } else {
          await expect(page.getByText('Batches: 2')).toBeVisible();
          await expect(page.getByText('Parts: 3')).toBeVisible();
        }

        if (simulatedUser !== 'basic') {
          const primaryBatch = simulatedUser === 'intermediate' ? 'batch-mid-a' : 'batch-adv-a';
          const primaryPart = simulatedUser === 'intermediate' ? 'Housing Mid 1' : 'Housing Adv 1';
          await page.getByLabel('Batch', { exact: true }).selectOption(primaryBatch);
          await expect(page.getByRole('heading', { name: primaryPart })).toBeVisible();
        }

        await page.getByRole('button', { name: /mark pass/i }).click();
        const expectedPassedCount = simulatedUser === 'advanced' ? 'Passed: 2' : 'Passed: 1';
        await expect(page.getByText(expectedPassedCount)).toBeVisible();

        await expect(page.getByTestId('selected-image-panel')).toBeVisible();
        if (simulatedUser === 'advanced') {
          const topViewButton = inspectionPanel.locator('.part-summary-images button', { hasText: 'TOP' }).first();
          await topViewButton.click();
          await expect(inspectionPanel.locator('.view-cell.selected .view-cell-title')).toHaveText('TOP');
          await inspectionPanel.locator('.view-cell', { hasText: 'FRONT' }).first().click();
          await expect(inspectionPanel.locator('.part-summary-images button.active', { hasText: 'FRONT' }).first()).toBeVisible();
        }
        await expect(page.getByTestId('annotation-controls')).toBeVisible();
        await page.getByLabel('Annotation defect type').selectOption('Other');
        await page.getByPlaceholder('annotation modality').fill('visual');
        await page.getByPlaceholder('annotation comment').fill(`${simulatedUser}-surface-note`);
        await page.getByRole('button', { name: 'Add annotation' }).click();
        await expect(page.getByTestId('annotation-list')).toContainText('Other • visual • open');

        await expect.poll(() => getWorkspaceStates().length).toBeGreaterThan(0);
        await expect.poll(() => {
          const states = getWorkspaceStates();
          return states[states.length - 1]?.state?.inspector?.viewport_transform || null;
        }).toEqual(expect.objectContaining({
          zoom: expect.any(Number),
          panX: expect.any(Number),
          panY: expect.any(Number),
        }));
        await expect.poll(() => getIngestValidationRequests().length).toBeGreaterThan(0);
      });
    });
  }
}

test.describe('Inspection Workbench screenshot artifact', () => {
  test('captures PT2 inspection workbench screenshot', async ({ page }) => {
    const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT2' });

    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Inspection' }).click();
    await expect(page.getByTestId('inspection-layout-grid')).toBeVisible();

    const panel = page.locator('section[aria-label="Inspection Workbench"]');
    await expect(panel).toBeVisible();
    await panel.screenshot({ path: screenshotPath });
  });
});

test.describe('PR-09 annotation controls screenshot artifact', () => {
  test('captures PT1 annotation controls screenshot', async ({ page }) => {
    const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT1', scenario: 'advanced' });
    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Inspection' }).click();
    await expect(page.getByTestId('annotation-controls')).toBeVisible();
    await page.getByLabel('Annotation defect type').selectOption('Other');
    await page.getByPlaceholder('annotation comment').fill('qa-length review note');
    const panel = page.locator('section[aria-label="Inspection Workbench"]');
    await expect(panel).toBeVisible();
    await panel.screenshot({ path: pr09ScreenshotPath });
  });
});

test.describe('PR-08 project type UI exposure smoke', () => {
  for (const projectType of ['PT1', 'PT2', 'PT3']) {
    test(`dashboard and project detail surfaces show ${projectType}`, async ({ page }) => {
      const projectId = `proj-${projectType.toLowerCase()}-smoke`;

      await page.route('**/api/**', async (route) => {
        const url = route.request().url();
        const method = route.request().method();

        if (url.endsWith('/api/users/me')) {
          await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Unauthorized' }) });
          return;
        }
        if (url.endsWith('/api/projects/') && method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([{
              id: projectId,
              name: `${projectType} smoke`,
              description: 'Synthetic smoke project',
              meta_group_id: 'qa-team',
              project_type: projectType,
            }]),
          });
          return;
        }
        if (url.endsWith(`/api/projects/${projectId}`)) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: projectId,
              name: `${projectType} smoke`,
              description: 'Synthetic smoke project',
              meta_group_id: 'qa-team',
              project_type: projectType,
            }),
          });
          return;
        }
        if (url.endsWith(`/api/projects/${projectId}/metadata-dict`)) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
          return;
        }
        if (url.endsWith(`/api/projects/${projectId}/classes`)) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
          return;
        }
        if (url.endsWith(`/api/projects/${projectId}/has-groups`)) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ has_groups: false }) });
          return;
        }
        if (url.includes(`/api/projects/${projectId}/images`)) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });

      await page.goto('/', { waitUntil: 'networkidle' });
      await expect(page.getByText(`Type: ${projectType}`)).toBeVisible();
      if (projectType === 'PT2') {
        await page.screenshot({ path: pr08ScreenshotPath, fullPage: true });
      }

      await page.getByRole('link', { name: `${projectType} smoke` }).click();
      await expect(page.getByText(`Type: ${projectType}`)).toBeVisible();
    });
  }
});

for (const projectType of ['PT1', 'PT2', 'PT3']) {
  for (const simulatedUser of simulatedUsers) {
    test.describe(`PR-11 project configuration E2E (${projectType}) ${simulatedUser}`, () => {
      test(`saves, edits, and copies configuration for ${projectType} ${simulatedUser}`, async ({ page }) => {
        const { projectId, getSavedConfigurations } = await mockInspectionWorkbenchRoutes(page, {
          type: projectType,
          scenario: simulatedUser,
        });
        const defectLabel = `Escalated ${projectType} ${simulatedUser}`;

        await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
        await page.getByRole('tab', { name: 'Project Configuration' }).click();

        await expect(page.getByRole('heading', { name: 'Project Configuration' })).toBeVisible();
        await expect(page.getByTestId('project-configuration-summary')).toBeVisible();

        await page.getByRole('button', { name: 'Add Defect Type' }).click();
        const newDefectIndex = 2;
        await page.getByLabel(`Defect type name ${newDefectIndex}`).fill(defectLabel);
        await page.getByLabel(`Defect type color ${newDefectIndex}`).fill('#0ea5e9');
        await page.getByLabel(`Defect type definition ${newDefectIndex}`).fill('Synthetic E2E defect type update');

        await page.getByLabel('Default colormap').selectOption(simulatedUser === 'basic' ? 'magma' : 'viridis');
        await page.getByRole('button', { name: 'Save Configuration' }).click();
        await expect(page.getByText('Configuration saved.')).toBeVisible();

        await page.getByLabel('Source project').selectOption('proj-copy');
        await page.getByRole('button', { name: 'Copy from Project' }).click();
        await expect(page.getByText(/Configuration copied from/)).toBeVisible();
        await expect(page.getByLabel('Defect type name 1')).toHaveValue(`${simulatedUser}-copied-defect`);

        await expect.poll(() => getSavedConfigurations().length).toBeGreaterThanOrEqual(2);
        await expect.poll(() => getSavedConfigurations().some(
          ({ payload }) => JSON.stringify(payload).includes(defectLabel),
        )).toBeTruthy();
      });
    });
  }
}

test.describe('PR-11 project configuration screenshot artifact', () => {
  test('captures PT3 advanced project configuration screenshot', async ({ page }) => {
    const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT3', scenario: 'advanced' });
    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Project Configuration' }).click();
    await expect(page.getByRole('heading', { name: 'Project Configuration' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Defect Type' }).click();
    await page.getByLabel('Defect type name 2').fill('Screenshot Defect');
    const panel = page.locator('section[aria-label="Project Configuration"]');
    await expect(panel).toBeVisible();
    await panel.screenshot({ path: pr11ScreenshotPath });
  });
});

test.describe('Project Data metadata hierarchy screenshot artifact', () => {
  test('captures PT3 advanced project metadata hierarchy screenshot', async ({ page }) => {
    const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT3', scenario: 'advanced' });
    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Project Configuration' }).click();
    await expect(page.getByTestId('project-metadata-tree')).toContainText('inspection_profile');
    const panel = page.locator('.metadata-section');
    await expect(panel).toBeVisible();
    await panel.screenshot({ path: pr14ScreenshotPath });
  });
});
