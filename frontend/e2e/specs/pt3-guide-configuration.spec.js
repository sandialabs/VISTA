const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

const screenshotPath = path.resolve(
  __dirname,
  '../../artifacts/pt3-3d-guide-configuration.png',
);

const configuredGuides = {
  crosshair_transparency_percent: 75,
  crosshair_line_width_px: 3.5,
  plane_outline_transparency_percent: 40,
  plane_outline_line_width_px: 5,
};

async function openUiConfiguration(page, projectId) {
  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Project Configuration' }).click();
  await expect(page.getByRole('heading', { name: 'Project Configuration' })).toBeVisible();
  await page.getByRole('tab', { name: 'UI Configuration' }).click();
  await expect(page.getByRole('tabpanel', { name: 'UI Configuration' })).toBeVisible();
}

async function setRangeValue(locator, value) {
  await locator.evaluate((input, nextValue) => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    valueSetter.call(input, String(nextValue));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

test('configures and persists PT3 3D guides with a live preview', async ({ page, context }) => {
  const { projectId, getSavedConfigurations } = await mockInspectionWorkbenchRoutes(page, {
    type: 'PT3',
    scenario: 'advanced',
  });

  await openUiConfiguration(page, projectId);

  const guideCard = page.getByTestId('pt3-guide-configuration-card');
  const preview = page.getByTestId('pt3-guide-preview');
  const crosshairTransparency = page.getByLabel('Crosshair transparency');
  const crosshairWidth = page.getByLabel('Crosshair line width');
  const planeTransparency = page.getByLabel('Plane outline transparency');
  const planeWidth = page.getByLabel('Plane outline line width');

  await expect(guideCard).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(crosshairTransparency).toHaveValue('50');
  await expect(crosshairTransparency).toHaveAttribute('min', '0');
  await expect(crosshairTransparency).toHaveAttribute('max', '100');
  await expect(crosshairTransparency).toHaveAttribute('step', '1');
  await expect(crosshairWidth).toHaveValue('1.25');
  await expect(crosshairWidth).toHaveAttribute('min', '0.5');
  await expect(crosshairWidth).toHaveAttribute('max', '6');
  await expect(crosshairWidth).toHaveAttribute('step', '0.25');
  await expect(planeTransparency).toHaveValue('0');
  await expect(planeWidth).toHaveValue('1.25');

  const planePreview = preview.locator('g').nth(0);
  const crosshairPreview = preview.locator('g').nth(1);
  await expect(planePreview).toHaveAttribute('opacity', '1');
  await expect(crosshairPreview).toHaveAttribute('opacity', '0.5');
  await expect(planePreview.locator('path').first()).toHaveAttribute('stroke-width', '1.25');
  await expect(crosshairPreview.locator('path').first()).toHaveAttribute('stroke-width', '1.25');

  await setRangeValue(crosshairTransparency, configuredGuides.crosshair_transparency_percent);
  await setRangeValue(crosshairWidth, configuredGuides.crosshair_line_width_px);
  await setRangeValue(planeTransparency, configuredGuides.plane_outline_transparency_percent);
  await setRangeValue(planeWidth, configuredGuides.plane_outline_line_width_px);
  await page.getByRole('button', { name: 'Save Configuration' }).click();

  await expect(crosshairPreview).toHaveAttribute('opacity', '0.25');
  await expect(planePreview).toHaveAttribute('opacity', '0.6');
  await expect(crosshairPreview.locator('path').first()).toHaveAttribute('stroke-width', '3.5');
  await expect(planePreview.locator('path').first()).toHaveAttribute('stroke-width', '5');
  await expect(guideCard).toContainText('Crosshair 75% transparent');
  await expect(guideCard).toContainText('Plane outlines 40% transparent');

  await expect.poll(() => getSavedConfigurations().some(
    ({ payload }) => JSON.stringify(
      payload?.config?.display_settings?.pt3_3d_guides,
    ) === JSON.stringify(configuredGuides),
  )).toBe(true);

  await page.locator('.configuration-action-bar').evaluate((actionBar) => {
    actionBar.style.visibility = 'hidden';
  });
  await guideCard.screenshot({ path: screenshotPath });

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Project Configuration' }).click();
  await page.getByRole('tab', { name: 'UI Configuration' }).click();
  await expect(page.getByLabel('Crosshair transparency')).toHaveValue('75');
  await expect(page.getByLabel('Crosshair line width')).toHaveValue('3.5');
  await expect(page.getByLabel('Plane outline transparency')).toHaveValue('40');
  await expect(page.getByLabel('Plane outline line width')).toHaveValue('5');

  for (const type of ['PT1', 'PT2']) {
    const nonPt3Page = await context.newPage();
    const { projectId: nonPt3ProjectId } = await mockInspectionWorkbenchRoutes(nonPt3Page, {
      type,
      scenario: 'basic',
    });
    await openUiConfiguration(nonPt3Page, nonPt3ProjectId);
    await expect(nonPt3Page.getByTestId('pt3-guide-configuration-card')).toHaveCount(0);
    await nonPt3Page.close();
  }
});
