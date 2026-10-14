const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

const screenshotPath = path.resolve(__dirname, '../../artifacts/project-configuration-sides-modalities.png');

test('configures filename side and modality labels together', async ({ page }) => {
  const { projectId, getSavedConfigurations } = await mockInspectionWorkbenchRoutes(page, {
    type: 'PT2',
    scenario: 'basic',
  });

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Project Configuration' }).click();
  await page.getByRole('tab', { name: 'Filename Convention' }).click();

  const sides = page.getByRole('region', { name: 'Sides' });
  const modalities = page.getByRole('region', { name: 'Modalities' });
  await expect(sides).toContainText('potential side labels');
  await expect(modalities).toContainText('potential modality labels');
  await expect(sides).toBeVisible();
  await expect(modalities).toBeVisible();

  await sides.getByRole('button', { name: 'Add Side' }).click();
  await page.getByLabel('Side label 2').fill('Rear side');
  await page.getByLabel('Side filename value 2').fill('rear');
  await modalities.getByRole('button', { name: 'Add Modality' }).click();
  await page.getByLabel('Modality label 2').fill('Ultraviolet');
  await page.getByLabel('Modality filename value 2').fill('uv');

  await page.locator('.project-configuration-panel').screenshot({ path: screenshotPath });
  await page.getByRole('button', { name: 'Save Configuration' }).click();
  await expect(page.getByText('Configuration saved.')).toBeVisible();
  await expect.poll(() => getSavedConfigurations().some(({ payload }) => (
    payload.config.part_views.some(({ id }) => id === 'rear')
      && payload.config.image_modalities.some(({ id }) => id === 'uv')
  ))).toBeTruthy();
});
