const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

const pickerScreenshotPath = path.resolve(
  __dirname,
  '../../artifacts/s3-picker-large-list.png',
);

function objectOrdinal(key) {
  const match = String(key).match(/_SN(\d+)_/);
  return match ? Number(match[1]) : -1;
}

test.describe('large S3 project import', () => {
  test('imports 2,000 hierarchy objects without mounting or dispatching them all at once', async ({ page }) => {
    test.setTimeout(120_000);

    const objects = Array.from({ length: 2000 }, (_, index) => {
      const filename = `D1001_LOT01_SET01_SN${String(index).padStart(4, '0')}_front_visual_false.jpg`;
      return {
        key: `incoming/${filename}`,
        filename,
        size: 1,
      };
    });
    const expectedKeys = objects.map((object) => object.key);
    const expectedKeySet = new Set(expectedKeys);
    const importBodies = [];
    const importCompletionOrder = [];
    const ingestBodies = [];
    const pageErrors = [];
    let activeImports = 0;
    let maximumActiveImports = 0;
    let summaryRequests = 0;
    let releaseFirstImport;
    const secondImportStarted = new Promise((resolve) => {
      releaseFirstImport = resolve;
    });

    page.on('pageerror', (error) => pageErrors.push(error.message));

    const { projectId } = await mockInspectionWorkbenchRoutes(page, {
      type: 'PT1',
      scenario: 'basic',
    });

    // These handlers are intentionally registered after the common fixture so
    // the fixture keeps serving the rest of the project while this test owns
    // the high-volume S3 and completion-refresh paths.
    await page.route(`**/api/projects/${projectId}/data-summary`, async (route) => {
      summaryRequests += 1;
      const importedCount = importBodies.length === 20 ? 2000 : 0;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project_id: projectId,
          active_image_count: importedCount,
          deleted_image_count: 0,
          total_image_bytes: importedCount,
          part_count: importedCount,
          image_metadata_fields: importedCount * 7,
          annotation_count: 0,
          overlay_layer_count: 0,
        }),
      });
    });

    await page.route(`**/api/projects/${projectId}/s3/list`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ objects, truncated: true }),
      });
    });

    await page.route(`**/api/projects/${projectId}/s3/import`, async (route) => {
      const body = route.request().postDataJSON();
      importBodies.push(body);
      activeImports += 1;
      maximumActiveImports = Math.max(maximumActiveImports, activeImports);

      const firstOrdinal = objectOrdinal(body.keys[0]);
      if (firstOrdinal === 0) {
        await secondImportStarted;
        await new Promise((resolve) => setTimeout(resolve, 40));
      } else if (firstOrdinal === 100) {
        releaseFirstImport();
      } else if ((firstOrdinal / 100) % 2 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const imported = [...body.keys].reverse().map((key) => {
        const ordinal = objectOrdinal(key);
        return {
          id: `image-${ordinal}`,
          filename: objects[ordinal].filename,
          size: objects[ordinal].size,
          metadata: {
            ...(body.per_file_metadata?.[key] || {}),
            source_s3_key: key,
          },
        };
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ imported, failed: [] }),
      });
      importCompletionOrder.push(firstOrdinal);
      activeImports -= 1;
    });

    await page.route(`**/api/projects/${projectId}/ingest`, async (route) => {
      ingestBodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });

    await page.goto(`/project/${projectId}?tab=project_data`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('tab', { name: 'Load Images', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.getByLabel('S3 URL (Optional)').fill('s3://source-bucket/incoming');
    await page.getByRole('button', { name: 'Load Files from S3' }).click();

    const picker = page.getByTestId('s3-file-picker');
    const rows = picker.getByTestId('s3-object-row');
    const pageStatus = picker.getByTestId('s3-pagination-status');
    await expect(picker).toBeVisible();
    await expect(picker.getByText(/2000 \/ 2000 selected/)).toBeVisible();
    await expect(picker.getByText(/listing was truncated by the server/i)).toBeVisible();
    await expect(rows).toHaveCount(100);
    await expect(pageStatus).toHaveText('Page 1 of 20 · Showing 1-100 of 2000 objects');

    await picker.getByRole('button', { name: 'Next' }).click();
    await expect(pageStatus).toHaveText('Page 2 of 20 · Showing 101-200 of 2000 objects');
    await expect(rows).toHaveCount(100);

    const firstPageTwoCheckbox = rows.first().getByRole('checkbox');
    await firstPageTwoCheckbox.uncheck();
    await expect(picker.getByText(/1999 \/ 2000 selected/)).toBeVisible();
    await picker.getByRole('button', { name: 'Previous' }).click();
    await expect(pageStatus).toHaveText('Page 1 of 20 · Showing 1-100 of 2000 objects');
    await expect(rows.first().getByRole('checkbox')).toBeChecked();
    await picker.getByRole('button', { name: 'Next' }).click();
    await expect(pageStatus).toHaveText('Page 2 of 20 · Showing 101-200 of 2000 objects');
    await expect(rows.first().getByRole('checkbox')).not.toBeChecked();
    await rows.first().getByRole('checkbox').check();
    await expect(picker.getByText(/2000 \/ 2000 selected/)).toBeVisible();
    await picker.getByRole('button', { name: 'Previous' }).click();
    await expect(pageStatus).toHaveText('Page 1 of 20 · Showing 1-100 of 2000 objects');
    await expect(rows).toHaveCount(100);

    await picker.screenshot({ path: pickerScreenshotPath });

    const summaryRequestsBeforeImport = summaryRequests;
    await picker.getByRole('button', { name: 'Load Selected S3 Files' }).click();
    await expect(picker).toBeHidden({ timeout: 90_000 });

    expect(importBodies).toHaveLength(20);
    expect(importBodies.every((body) => body.keys.length === 100)).toBe(true);
    expect(new Set(importBodies.map((body) => body.keys.join('\n'))).size).toBe(20);
    const requestedKeys = importBodies.flatMap((body) => body.keys);
    expect(requestedKeys).toHaveLength(2000);
    expect(new Set(requestedKeys)).toEqual(expectedKeySet);
    expect(maximumActiveImports).toBe(2);
    expect(importCompletionOrder.indexOf(100)).toBeLessThan(importCompletionOrder.indexOf(0));

    // PT1 uploads never pre-assign images to parts; users assign them from
    // Project Data, so the import must not post an ingest payload.
    expect(ingestBodies).toHaveLength(0);

    expect(summaryRequests).toBe(summaryRequestsBeforeImport + 1);
    const rawImagesCard = page.locator('article.summary-card').filter({
      has: page.getByRole('heading', { name: 'Raw Images' }),
    });
    await expect(rawImagesCard.locator('p')).toHaveText('2000');
    expect(pageErrors).toEqual([]);
  });
});
