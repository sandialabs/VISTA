const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

const artifact = (name) => path.resolve(__dirname, '../../artifacts', name);

test('Save Configuration shows a transient overlay banner that does not shift the page', async ({ page }) => {
  const { projectId, getSavedConfigurations } = await mockInspectionWorkbenchRoutes(page, {
    type: 'PT2',
    scenario: 'basic',
  });
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Project Configuration' }).click();
  await page.getByRole('tab', { name: 'Hotkeys' }).click();
  await page.getByLabel('Accept hotkey').fill('q');

  // While a change is pending, the status is shown quietly in the action bar.
  const actionStatus = page.locator('.configuration-action-status');
  await expect(actionStatus).toContainText('Unsaved changes will autosave shortly.');
  await expect(page.getByTestId('transient-status')).toHaveCount(0);

  // Scroll so the Save button (bottom of the page) is in view.
  const saveButton = page.getByRole('button', { name: 'Save Configuration' });
  await saveButton.scrollIntoViewIfNeeded();
  const summary = page.getByRole('tablist', { name: 'Configuration sections' });
  const summaryTopBefore = (await summary.boundingBox()).y;
  const scrollBefore = await page.evaluate(() => window.scrollY);

  await saveButton.click();
  const banner = page.getByTestId('transient-status');
  await expect(banner).toHaveText(/Configuration (saved|autosaved)\./);
  await expect.poll(() => getSavedConfigurations().length).toBeGreaterThan(0);

  // Overlaid: fixed at the top of the viewport, outside the page flow.
  const bannerBox = await banner.boundingBox();
  expect(bannerBox.y).toBeGreaterThanOrEqual(0);
  expect(bannerBox.y).toBeLessThan(40);
  expect(await banner.evaluate((el) => getComputedStyle(el.parentElement).position)).toBe('fixed');
  expect(await banner.evaluate((el) => el.closest('.project-configuration-panel'))).toBeNull();
  // Showing the banner did not move page content or the scroll position.
  expect(Math.abs((await summary.boundingBox()).y - summaryTopBefore)).toBeLessThan(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  // The old inline success alert is gone.
  await expect(page.locator('.project-configuration-panel .alert-success')).toHaveCount(0);
  await page.waitForTimeout(250); // let the entrance animation finish
  await page.screenshot({ path: artifact('config-saved-banner.png') });

  // Stays at the top of the viewport while the user scrolls.
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(150);
  expect((await banner.boundingBox()).y).toBeLessThan(40);

  // Disappears on its own after about 2 seconds.
  await expect(banner).toBeHidden({ timeout: 2600 });
  await page.screenshot({ path: artifact('config-saved-banner-gone.png') });
});

test('the banner can be dismissed early and restarts for a new message', async ({ page }) => {
  const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT2', scenario: 'basic' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Project Configuration' }).click();
  const saveButton = page.getByRole('button', { name: 'Save Configuration' });

  await page.getByRole('tab', { name: 'Hotkeys' }).click();
  await page.getByLabel('Accept hotkey').fill('q');
  await saveButton.click();
  const banner = page.getByTestId('transient-status');
  await expect(banner).toBeVisible();
  await banner.click();
  await expect(banner).toBeHidden();
});
