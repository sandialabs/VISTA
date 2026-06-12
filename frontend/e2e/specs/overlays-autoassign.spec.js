const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

const screenshotPath = path.resolve(__dirname, '../../artifacts/overlays-autoassign-button.png');

test('shows Autoassign on the Overlays tab and assigns filename matches', async ({ page }) => {
  const { projectId } = await mockInspectionWorkbenchRoutes(page, {
    type: 'PT1',
    scenario: 'basic',
    images: [
      { id: 'scan-base-id', filename: 'scan.npy' },
      { id: 'scan-overlay-id', filename: 'scan.npy' },
      { id: 'camera-base-id', filename: 'camera.png' },
      { id: 'camera-overlay-id', filename: 'camera_overlay.png' },
    ],
    mockParts: [{
      id: 'part-autoassign-001',
      batch_id: 'batch-basic',
      serial_number: 'SN-AUTO-001',
      display_name: 'Autoassign Housing',
      review_state: 'unreviewed',
      metadata: {
        configured_views: ['front'],
        modalities: ['visual'],
        source_images: [
          { filename: 'scan.npy', image_id: 'scan-base-id', side: 'front', overlay: false },
          { filename: 'camera.png', image_id: 'camera-base-id', side: 'front', overlay: false },
        ],
      },
    }],
  });

  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Project Data' }).click();
  await page.getByRole('tab', { name: 'Overlays' }).click();

  const overlaysPanel = page.getByRole('tabpanel', { name: 'Overlays' });
  await expect(overlaysPanel.getByRole('button', { name: 'Autoassign' })).toBeVisible();
  await expect(overlaysPanel).toContainText('scan (duplicate).npy');
  await expect(overlaysPanel).toContainText('camera_overlay.png');

  await overlaysPanel.getByRole('button', { name: 'Autoassign' }).click();
  await expect(overlaysPanel.getByRole('status')).toContainText('Autoassigned 2 overlays.');
  await overlaysPanel.screenshot({ path: screenshotPath });
});
