const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockFullInspectionWorkflowRoutes } = require('../fixtures/fullInspectionWorkflowMocks');

const reportDesktopScreenshotPath = path.resolve(__dirname, '../../artifacts/e2e-inspection-report-desktop.png');
const reportNarrowScreenshotPath = path.resolve(__dirname, '../../artifacts/e2e-inspection-report-narrow.png');

async function expectRawImageCount(page, expectedCount) {
  const rawImagesCard = page.locator('article.summary-card').filter({ has: page.getByRole('heading', { name: 'Raw Images' }) });
  await expect(rawImagesCard.locator('p')).toHaveText(String(expectedCount));
}

test.describe('Full inspection workflow end-to-end', () => {
  test('creates project, uploads files, inspects parts, and validates report readiness', async ({ page }, testInfo) => {
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
    const frontImageButton = workbench.getByRole('button', { name: /^FRONT\b/ }).first();
    await expect(frontImageButton).toBeVisible();
    await frontImageButton.click();
    await expect(frontImageButton).toHaveClass(/\bactive\b/);
    await expect(frontImageButton).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Pass' }).click();
    await expect(page.getByText('Passed: 1')).toBeVisible();
    await expect(page.getByText('Rejected: 0')).toBeVisible();

    await page.locator('article.workbench-part-row', { hasText: 'Housing E2E B' }).click();
    await page.getByRole('button', { name: 'Reject' }).click();

    await expect(page.getByText('Passed: 1')).toBeVisible();
    await expect(page.getByText('Rejected: 1')).toBeVisible();

    const reviewBadges = page.getByTestId('part-review-state');
    await expect(reviewBadges).toContainText(['Pass', 'Reject', 'Unreviewed']);

    await expect.poll(() => getParts().map((part) => part.review_state)).toEqual(['pass', 'reject_confirmed', 'unreviewed']);
    await expect.poll(() => getSavedWorkspaceStates().length).toBeGreaterThan(0);

    await page.goto(`/project/${projectId}/report`, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(new RegExp(`/project/${projectId}\\?tab=report$`));
    await expect(page.getByRole('heading', { name: 'Project Report' })).toBeVisible();
    await page.getByLabel('Export/report mode').selectOption('report_json');
    await page.getByRole('button', { name: 'Run Export/Report' }).click();

    await expect.poll(() => getReportRequests().length).toBe(1);
    await expect.poll(() => getReportRequests()[0]?.payload).toEqual(expect.objectContaining({
      schema_version: 3,
      summary: {
        total_parts: 3,
        reviewed_parts: 2,
        unreviewed_parts: 1,
        part_status_counts: { pass: 1, reject: 1, unreviewed: 1 },
      },
    }));

    const reportTable = page.getByRole('table', { name: 'Inspection results by part' });
    const reportRows = reportTable.locator('tbody tr');
    await expect(reportRows).toHaveCount(3);
    const expectedRows = [
      ['SN-E2E-001', 'Pass'],
      ['SN-E2E-002', 'Reject'],
      ['SN-E2E-003', 'Unreviewed'],
    ];
    await expect(reportTable.getByRole('columnheader')).toHaveCount(2);
    for (const [partIdentifier, result] of expectedRows) {
      const row = reportRows.filter({ has: page.getByRole('rowheader', { name: new RegExp(partIdentifier) }) });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole('cell').nth(0)).toHaveText(result);
    }

    await page.addStyleTag({
      content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }',
    });
    await page.screenshot({ path: reportDesktopScreenshotPath, fullPage: true });

    await page.getByLabel('Export/report mode').selectOption('report_pdf');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Run Export/Report' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Workflow E2E Project-report.pdf');
    const reportPdfPath = testInfo.outputPath('inspection-report.pdf');
    await download.saveAs(reportPdfPath);
    expect(fs.readFileSync(reportPdfPath).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    await expect(page.getByText(/PDF report downloaded: \d+ bytes\./)).toBeVisible();
    await expect.poll(() => getReportRequests().map((request) => request.method)).toEqual(['json', 'pdf']);

    const imageReportDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download report with images (PDF)' }).click();
    const imageReportDownload = await imageReportDownloadPromise;
    expect(imageReportDownload.suggestedFilename()).toBe('Workflow E2E Project-report-with-images.pdf');
    const imageReportPdfPath = testInfo.outputPath('inspection-report-with-images.pdf');
    await imageReportDownload.saveAs(imageReportPdfPath);
    expect(fs.readFileSync(imageReportPdfPath).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    await expect(page.getByText(/Report with images downloaded: \d+ bytes\./)).toBeVisible();
    await expect.poll(() => getReportRequests().map((request) => request.method)).toEqual(['json', 'pdf', 'pdf-images']);

    await page.setViewportSize({ width: 375, height: 900 });
    await expect(reportTable).toBeVisible();
    await expect.poll(() => reportTable.evaluate((table) => ({
      clientWidth: table.clientWidth,
      scrollWidth: table.scrollWidth,
    }))).toEqual(expect.objectContaining({
      clientWidth: expect.any(Number),
      scrollWidth: expect.any(Number),
    }));
    const tableDimensions = await reportTable.evaluate((table) => ({
      clientWidth: table.clientWidth,
      scrollWidth: table.scrollWidth,
    }));
    expect(tableDimensions.scrollWidth).toBeLessThanOrEqual(tableDimensions.clientWidth);
    const imageReportButton = page.getByRole('button', { name: 'Download report with images (PDF)' });
    await expect(imageReportButton).toBeVisible();
    const buttonBounds = await imageReportButton.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        viewportWidth: window.innerWidth,
      };
    });
    expect(buttonBounds.left).toBeGreaterThanOrEqual(0);
    expect(buttonBounds.right).toBeLessThanOrEqual(buttonBounds.viewportWidth);
    await page.screenshot({ path: reportNarrowScreenshotPath, fullPage: true });
  });
});
