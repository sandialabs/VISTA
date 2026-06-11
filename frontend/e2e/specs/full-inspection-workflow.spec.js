const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockFullInspectionWorkflowRoutes } = require('../fixtures/fullInspectionWorkflowMocks');

const screenshotPath = path.resolve(__dirname, '../../artifacts/e2e-full-inspection-workflow.png');
const hierarchyScreenshotPath = path.resolve(__dirname, '../../artifacts/e2e-inspection-hierarchy.png');

async function expectRawImageCount(page, expectedCount) {
  const rawImagesCard = page.locator('article.summary-card').filter({ has: page.getByRole('heading', { name: 'Raw Images' }) });
  await expect(rawImagesCard.locator('p')).toHaveText(String(expectedCount));
}

test.describe('Full inspection workflow end-to-end', () => {
  test('creates project, uploads files, inspects parts, and validates report readiness', async ({ page }) => {
    const {
      projectId,
      getUploadedImages,
      getParts,
      getSavedWorkspaceStates,
      getReportRequests,
    } = await mockFullInspectionWorkflowRoutes(page);

    await page.goto('/', { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: 'Create Your First Project' }).click();
    await page.getByLabel('Project Name *').fill('Workflow E2E Project');
    await page.getByLabel('Description').fill('Workflow coverage for upload, inspection, and reporting');
    await page.getByLabel('Access Group *').fill('qa-team');
    await page.getByLabel('Project Type *').selectOption('PT1');
    await page.getByRole('button', { name: 'Create Project' }).click();

    await expect(page.getByRole('heading', { name: 'Your Projects (1)' })).toBeVisible();
    await page.getByRole('link', { name: 'Workflow E2E Project' }).click();

    await expect(page).toHaveURL(new RegExp(`/project/${projectId}$`));

    await page.getByRole('tab', { name: 'Project Data' }).click();
    await expect(page.getByTestId('project-data-summary')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Load Images', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expectRawImageCount(page, 0);

    const uploads = [
      { name: 'part-a-front.png', mimeType: 'image/png', buffer: Buffer.from('fake-image-a') },
      { name: 'part-a-back.png', mimeType: 'image/png', buffer: Buffer.from('fake-image-b') },
      { name: 'part-b-front.png', mimeType: 'image/png', buffer: Buffer.from('fake-image-c') },
    ];

    await page.locator('#file-input').setInputFiles(uploads);
    await expect(page.getByText('3 files selected')).toBeVisible();
    await page.getByRole('button', { name: 'Upload Images' }).click();

    await expect.poll(() => getUploadedImages().length).toBe(3);
    await expectRawImageCount(page, 3);

    await page.getByRole('tab', { name: 'Inspection' }).click();
    const workbench = page.locator('section[aria-label="Inspection Workbench"]');
    await expect(workbench).toBeVisible();

    await expect(workbench.locator('.flexlayout__tab_button', { hasText: 'Part Summary' }).first()).toBeVisible();
    const frontImageButton = workbench.locator('.part-summary-images button', { hasText: 'FRONT' }).first();
    await expect(frontImageButton).toBeVisible();
    await frontImageButton.click();
    await expect(workbench.locator('.part-summary-images button.active', { hasText: 'FRONT' }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Pass' }).click();
    await expect(page.getByText('Passed: 1')).toBeVisible();
    await expect(page.getByText('Rejected: 0')).toBeVisible();

    await page.locator('article.workbench-part-row', { hasText: 'Housing E2E B' }).click();
    await page.getByRole('button', { name: 'Reject' }).click();

    await expect(page.getByText('Passed: 1')).toBeVisible();
    await expect(page.getByText('Rejected: 1')).toBeVisible();

    const reviewBadges = page.getByTestId('part-review-state');
    await expect(reviewBadges).toContainText(['Pass', 'Reject']);

    await expect.poll(() => getParts().map((part) => part.review_state)).toEqual(['pass', 'reject_confirmed']);
    await expect.poll(() => getSavedWorkspaceStates().length).toBeGreaterThan(0);

    await page.getByRole('tab', { name: 'Report' }).click();
    await expect(page.getByRole('heading', { name: 'Report' })).toBeVisible();
    await page.getByLabel('Export/report mode').selectOption('report_json');
    await page.getByRole('button', { name: 'Run Export/Report' }).click();

    await expect(page.getByText('Report generated successfully.')).toBeVisible();
    await expect.poll(() => getReportRequests().length).toBe(1);
    await expect.poll(() => getReportRequests()[0]?.summary).toEqual(expect.objectContaining({
      passed: 1,
      reject_confirmed: 1,
      total_images: 3,
    }));

    await page.screenshot({ path: screenshotPath, fullPage: true });
  });

  test('creates a PT1 project and preserves the original hierarchical inspection panel layout', async ({ page }) => {
    const { projectId } = await mockFullInspectionWorkflowRoutes(page);

    await page.goto('/', { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: 'Create Your First Project' }).click();
    await page.getByLabel('Project Name *').fill('PT1 Hierarchical Layout Regression');
    await page.getByLabel('Description').fill('Verifies PT1 uses the legacy hierarchical inspection panel arrangement');
    await page.getByLabel('Access Group *').fill('qa-team');
    await page.getByLabel('Project Type *').selectOption('PT1');
    await page.getByRole('button', { name: 'Create Project' }).click();

    await page.getByRole('link', { name: 'PT1 Hierarchical Layout Regression' }).click();
    await expect(page).toHaveURL(new RegExp(`/project/${projectId}$`));

    await page.getByRole('tab', { name: 'Inspection' }).click();
    const workbench = page.locator('section[aria-label="Inspection Workbench"]');
    await expect(workbench).toBeVisible();

    await expect(workbench.locator('.flexlayout__layout')).toBeVisible();
    await expect(workbench.locator('.workbench-tabbed-panel')).toHaveCount(3);
    await expect(workbench.locator('.flexlayout__tab_button', { hasText: 'Part Summary' }).first()).toBeVisible();
    await expect(workbench.locator('.flexlayout__tab_button', { hasText: 'Inspection' }).first()).toBeVisible();
    await expect(workbench.locator('.flexlayout__tab_button', { hasText: 'Annotations' }).first()).toBeVisible();
    await page.screenshot({ path: hierarchyScreenshotPath, fullPage: true });
  });
});
