const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockFullInspectionWorkflowRoutes } = require('../fixtures/fullInspectionWorkflowMocks');

const beforeScreenshotPath = path.resolve(
  __dirname,
  '../../artifacts/unload-parts-before.png',
);
const afterScreenshotPath = path.resolve(
  __dirname,
  '../../artifacts/unload-parts-after.png',
);

test.describe('Unload Parts end-to-end', () => {
  test('cancels safely and unloads every part with one confirmed request', async ({ page }) => {
    const { projectId, getParts } = await mockFullInspectionWorkflowRoutes(page);
    let visibleParts = [...getParts()];
    let bulkDeleteCount = 0;
    let partsGetCount = 0;
    let summaryGetCount = 0;
    const imageRequests = [];

    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (
        pathname === `/api/projects/${projectId}/images`
        || pathname === `/api/projects/${projectId}/images-page`
      ) {
        imageRequests.push(`${request.method()} ${pathname}`);
      }
    });

    await page.route(`**/api/projects/${projectId}/parts`, async (route) => {
      const method = route.request().method();
      if (method === 'DELETE') {
        bulkDeleteCount += 1;
        visibleParts = [];
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      if (method === 'GET') {
        partsGetCount += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(visibleParts),
        });
        return;
      }
      await route.fallback();
    });
    await page.route(`**/api/projects/${projectId}/data-summary`, async (route) => {
      summaryGetCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          part_count: visibleParts.length,
          active_image_count: 0,
          image_metadata_fields: 0,
          overlay_layer_count: 3,
          annotation_count: 1,
        }),
      });
    });

    await page.goto(
      `/project/${projectId}?tab=project_data&dataTab=unload_parts`,
      { waitUntil: 'networkidle' },
    );

    await expect(page.getByRole('tab', { name: 'Unload Parts' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Unload Parts' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText('3 parts are currently loaded.')).toBeVisible();
    await expect(
      page.locator('article.summary-card').filter({
        has: page.getByRole('heading', { name: 'Parts Loaded' }),
      }).locator('p'),
    ).toHaveText('3');
    await expect(page.getByRole('button', { name: 'Unload All Parts' })).toBeEnabled();
    expect(partsGetCount).toBe(1);
    expect(summaryGetCount).toBe(1);
    expect(imageRequests).toEqual([]);

    await page.addStyleTag({
      content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
    });
    await page.screenshot({ path: beforeScreenshotPath, fullPage: true });

    let cancelMessage = '';
    page.once('dialog', async (dialog) => {
      cancelMessage = dialog.message();
      await dialog.dismiss();
    });
    await page.getByRole('button', { name: 'Unload All Parts' }).click();

    expect(cancelMessage).toContain('Unload all 3 parts from this project?');
    expect(cancelMessage).toContain('Images and batches will be preserved.');
    expect(bulkDeleteCount).toBe(0);
    expect(partsGetCount).toBe(1);
    await expect(page.getByText('3 parts are currently loaded.')).toBeVisible();

    let confirmMessage = '';
    page.once('dialog', async (dialog) => {
      confirmMessage = dialog.message();
      await dialog.accept();
    });
    await page.getByRole('button', { name: 'Unload All Parts' }).click();

    expect(confirmMessage).toContain('This cannot be undone.');
    await expect.poll(() => bulkDeleteCount).toBe(1);
    await expect.poll(() => partsGetCount).toBe(2);
    await expect.poll(() => summaryGetCount).toBe(2);
    await expect(page.getByText('There are no parts to unload.')).toBeVisible();
    await expect(
      page.locator('article.summary-card').filter({
        has: page.getByRole('heading', { name: 'Parts Loaded' }),
      }).locator('p'),
    ).toHaveText('0');
    await expect(page.getByRole('button', { name: 'Unload All Parts' })).toBeDisabled();
    await expect(page.getByRole('status')).toContainText('Unloaded 3 parts.');
    expect(imageRequests).toEqual([]);

    await page.screenshot({ path: afterScreenshotPath, fullPage: true });
  });
});
