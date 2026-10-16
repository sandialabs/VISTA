const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

const screenshotPath = path.resolve(
  __dirname,
  '../../artifacts/pt3-segmentation-helper-3d.png',
);

test('PT3 segmentation helper links five views and saves a volumetric sphere stroke', async ({ page }) => {
  const { projectId } = await mockInspectionWorkbenchRoutes(page, {
    type: 'PT3',
    scenario: 'advanced',
  });
  const savedSegments = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST'
      && /\/api\/projects\/[^/]+\/parts\/[^/]+\/annotations$/.test(new URL(request.url()).pathname)
    ) {
      savedSegments.push(request.postDataJSON());
    }
  });

  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Inspection' }).click();
  await page.getByRole('button', { name: 'Segmentation Helpers' }).click();

  const dialog = page.getByRole('dialog', { name: 'Segmentation Helpers' });
  const viewTabs = dialog.getByRole('tablist', { name: 'Segmentation workspace views' });
  await expect(viewTabs.getByRole('tab', { name: 'X YZ' })).toBeVisible();
  await expect(viewTabs.getByRole('tab', { name: 'Y XZ' })).toBeVisible();
  await expect(viewTabs.getByRole('tab', { name: 'Z XY' })).toHaveAttribute('aria-selected', 'true');
  await expect(viewTabs.getByRole('tab', { name: 'MPR' })).toBeVisible();
  await expect(viewTabs.getByRole('tab', { name: '3D' })).toBeVisible();

  const brushButton = dialog.getByRole('button', { name: /^Brush:/ });
  const brushTile = brushButton.locator('..');
  const brushButtonBox = await brushButton.boundingBox();
  const modeSwitchBox = await brushTile.locator('.segmentation-tool-mode-switch').boundingBox();
  const sidebarBox = await dialog.locator('.segmentation-helper-sidebar').boundingBox();
  const mainBox = await dialog.locator('.segmentation-helper-main').boundingBox();
  expect(
    brushButtonBox
      && modeSwitchBox
      && modeSwitchBox.y + modeSwitchBox.height >= brushButtonBox.y + brushButtonBox.height,
  ).toBeTruthy();
  expect(
    sidebarBox
      && mainBox
      && sidebarBox.x + sidebarBox.width <= mainBox.x + 1
      && brushButtonBox.x >= mainBox.x
      && modeSwitchBox.x >= mainBox.x,
  ).toBeTruthy();

  await dialog.getByRole('button', { name: 'Brush 3D mode' }).click();
  const stage = dialog.getByTestId('segmentation-helper-stage');
  await expect(stage).toHaveClass(/mode-3d/);
  const stageBox = await stage.boundingBox();
  expect(stageBox).toBeTruthy();
  await page.mouse.move(stageBox.x + (stageBox.width * 0.45), stageBox.y + (stageBox.height * 0.48));
  await page.mouse.down();
  await page.mouse.move(stageBox.x + (stageBox.width * 0.55), stageBox.y + (stageBox.height * 0.52), { steps: 5 });
  await page.mouse.up();

  await expect.poll(() => savedSegments.length).toBe(1);
  const saved = savedSegments[0].geometry.segment;
  expect(saved.version).toBe(2);
  expect(saved.volume_dimensions).toEqual([80, 96, 128]);
  expect(saved.areas).toEqual(expect.arrayContaining([
    expect.objectContaining({
      tool: 'volume-mask',
      mode: '3d',
      operation: 'add',
      volumeRuns: expect.any(Array),
    }),
  ]));
  expect(saved.areas[0].volumeRuns.length).toBeGreaterThan(0);

  await viewTabs.getByRole('tab', { name: 'MPR' }).click();
  await expect(dialog.getByTestId('segmentation-helper-mpr')).toBeVisible();
  await expect(dialog.getByTestId('segmentation-helper-mpr-axial')).toBeVisible();
  await expect(dialog.getByTestId('segmentation-helper-mpr-coronal')).toBeVisible();
  await expect(dialog.getByTestId('segmentation-helper-mpr-sagittal')).toBeVisible();

  await viewTabs.getByRole('tab', { name: '3D' }).click();
  await expect(dialog.getByTestId('segmentation-helper-3d-stage')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Polygon:/ })).toBeDisabled();
  await expect.poll(() => (
    dialog.locator('.segmentation-helper-main').evaluate((node) => node.scrollLeft)
  )).toBe(0);
  await dialog.screenshot({ path: screenshotPath });
});
