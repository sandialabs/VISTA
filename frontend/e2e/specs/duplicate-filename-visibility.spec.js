const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

const desktopScreenshotPath = path.resolve(
  __dirname,
  '../../artifacts/duplicate-filename-visibility-desktop.png',
);
const narrowScreenshotPath = path.resolve(
  __dirname,
  '../../artifacts/duplicate-filename-visibility-narrow.png',
);

const imageIds = {
  baseA: '11111111-1111-4111-8111-111111111111',
  baseB: '22222222-2222-4222-8222-222222222222',
  overlay: '33333333-3333-4333-8333-333333333333',
  mask: '44444444-4444-4444-8444-444444444444',
  heatmap: '55555555-5555-4555-8555-555555555555',
};

function expectBoxesNotToOverlap(boxes) {
  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
      const left = boxes[leftIndex];
      const right = boxes[rightIndex];
      const overlapWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left);
      const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
      expect(overlapWidth > 1 && overlapHeight > 1).toBeFalsy();
    }
  }
}

test('keeps exact duplicates and keyword variants visible through assignment and inspection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const images = [
    {
      id: imageIds.baseA,
      filename: 'capture.png',
      created_at: '2026-07-26T10:00:00Z',
      metadata: { modality: 'visual', overlay: false },
    },
    {
      id: imageIds.baseB,
      filename: 'capture.png',
      created_at: '2026-07-26T10:01:00Z',
      metadata: { modality: 'visual', overlay: 'false' },
    },
    {
      id: imageIds.overlay,
      filename: 'capture.png',
      created_at: '2026-07-26T10:02:00Z',
      metadata: { modality: 'visual', overlay: true },
    },
    {
      id: imageIds.mask,
      filename: 'capture_mask.png',
      created_at: '2026-07-26T10:03:00Z',
      metadata: { modality: 'mask', overlay: 'false', filename_label: 'mask' },
    },
    {
      id: imageIds.heatmap,
      filename: 'capture_heatmap.png',
      created_at: '2026-07-26T10:04:00Z',
      metadata: { modality: 'heatmap', overlay: false, filename_label: 'heatmap' },
    },
  ];
  const part = {
    id: 'part-duplicate-visibility',
    batch_id: 'batch-basic',
    serial_number: 'SN-DUPLICATE-001',
    display_name: 'Duplicate Filename Housing',
    review_state: 'unreviewed',
    metadata: {
      configured_views: ['front', 'back', 'mask', 'heatmap'],
      modalities: ['visual'],
      source_images: [
        {
          filename: 'capture.png',
          image_id: imageIds.baseA,
          side: 'front',
          modality: 'visual',
          overlay: false,
        },
        {
          filename: 'capture.png',
          image_id: imageIds.baseB,
          side: 'back',
          modality: 'visual',
          overlay: 'false',
        },
        {
          filename: 'capture_mask.png',
          image_id: imageIds.mask,
          side: 'mask',
          modality: 'mask',
          overlay: 'false',
          filename_label: 'mask',
        },
        {
          filename: 'capture_heatmap.png',
          image_id: imageIds.heatmap,
          side: 'heatmap',
          modality: 'heatmap',
          overlay: false,
          filename_label: 'heatmap',
        },
      ],
    },
  };

  const {
    projectId,
    getImageAssetRequests,
    getOverlayAssignmentRequests,
  } = await mockInspectionWorkbenchRoutes(page, {
    type: 'PT1',
    scenario: 'basic',
    images,
    mockParts: [part],
  });

  await page.goto(`/project/${projectId}?tab=project_data&dataTab=images_to_parts`, {
    waitUntil: 'networkidle',
  });

  const imagesToPartsPanel = page.getByRole('tabpanel', { name: 'Images to Parts' });
  await expect(imagesToPartsPanel).toBeVisible();
  for (const imageId of Object.values(imageIds)) {
    await expect(imagesToPartsPanel.locator(`[data-image-key="${imageId}"]`)).toHaveCount(1);
    await expect(imagesToPartsPanel.locator(`[data-image-key="${imageId}"] img`)).toHaveAttribute(
      'src',
      new RegExp(`/api/images/${imageId}/thumbnail\\?`),
    );
  }
  await expect(imagesToPartsPanel.locator(`[data-image-key="${imageIds.baseA}"]`)).toContainText('capture.png');
  await expect(imagesToPartsPanel.locator(`[data-image-key="${imageIds.baseB}"]`)).toContainText('capture (1).png');
  await expect(imagesToPartsPanel.locator(`[data-image-key="${imageIds.overlay}"]`)).toContainText('capture (2).png');
  await expect(imagesToPartsPanel.locator(`[data-image-key="${imageIds.mask}"]`)).toContainText('capture_mask.png');
  await expect(imagesToPartsPanel.locator(`[data-image-key="${imageIds.heatmap}"]`)).toContainText('capture_heatmap.png');
  await expect(
    imagesToPartsPanel
      .getByTestId('images-to-parts-unassigned-target')
      .locator(`[data-image-key="${imageIds.overlay}"]`),
  ).toHaveCount(1);

  await page.getByRole('tab', { name: 'Overlays' }).click();
  const overlaysPanel = page.getByRole('tabpanel', { name: 'Overlays' });
  const baseATarget = overlaysPanel.getByTestId(`overlay-target-${imageIds.baseA}`);
  const baseBTarget = overlaysPanel.getByTestId(`overlay-target-${imageIds.baseB}`);
  const available = overlaysPanel.getByTestId('overlays-unassigned-target');
  await expect(baseATarget).toBeVisible();
  await expect(baseBTarget).toBeVisible();
  await expect(baseATarget.getByRole('button', { name: 'capture.png', exact: true })).toBeVisible();
  await expect(baseBTarget.getByRole('button', { name: 'capture (1).png', exact: true })).toBeVisible();
  const overlayCandidate = available.getByRole('button', { name: 'capture (2).png', exact: true });
  await expect(overlayCandidate).toBeVisible();

  await overlayCandidate.dragTo(baseATarget);
  await expect.poll(() => getOverlayAssignmentRequests()).toContainEqual(expect.objectContaining({
    overlay_filename: 'capture.png',
    overlay_image_id: imageIds.overlay,
    base_filename: 'capture.png',
    base_image_id: imageIds.baseA,
  }));
  await expect(
    baseATarget.getByRole('button', { name: 'capture (2).png', exact: true }),
  ).toBeVisible();
  await expect(
    baseBTarget.getByRole('button', { name: 'capture (1).png', exact: true }),
  ).toBeVisible();
  await expect(available.getByRole('button', { name: 'capture (2).png', exact: true })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Inspection' }).click();
  const inspectionPanel = page.locator('section[aria-label="Inspection Workbench"]');
  const selectedImagePanel = page.getByTestId('selected-image-panel');
  await expect(inspectionPanel).toBeVisible();
  await expect(selectedImagePanel).toBeVisible();
  await expect(selectedImagePanel.getByTestId('inspection-overlay-composite')).toHaveCount(1);
  await expect(selectedImagePanel.getByLabel('Filename capture (1).png')).toBeVisible();
  await expect(selectedImagePanel.getByLabel('Filename capture (2).png')).toBeVisible();
  await expect(selectedImagePanel.getByLabel('Filename capture_mask.png')).toBeVisible();
  await expect(selectedImagePanel.getByLabel('Filename capture_heatmap.png')).toBeVisible();

  for (const imageId of Object.values(imageIds)) {
    await expect(selectedImagePanel.locator(`img[src="/api/images/${imageId}/content"]`)).toHaveCount(1);
  }
  await expect.poll(() => (
    new Set(getImageAssetRequests().map((request) => request.imageId))
  )).toEqual(new Set(Object.values(imageIds)));
  await selectedImagePanel.getByLabel('Inspection tile columns value').fill('4');
  await expect(selectedImagePanel.getByLabel('Inspection tile columns value')).toHaveValue('4');
  await expect(selectedImagePanel.locator('.view-cell')).toHaveCount(4);

  const desktopCells = await selectedImagePanel.locator('.view-cell').evaluateAll((cells) => (
    cells.map((cell) => {
      const box = cell.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      };
    })
  ));
  expect(desktopCells).toHaveLength(4);
  expectBoxesNotToOverlap(desktopCells);
  await page.screenshot({ path: desktopScreenshotPath, fullPage: true });

  await page.setViewportSize({ width: 820, height: 1100 });
  await expect(selectedImagePanel.getByLabel('Filename capture_heatmap.png')).toBeVisible();
  const narrowLayout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(narrowLayout.scrollWidth).toBeLessThanOrEqual(narrowLayout.clientWidth + 1);
  await expect(selectedImagePanel.locator('.view-cell')).toHaveCount(4);
  const narrowCells = await selectedImagePanel.locator('.view-cell').evaluateAll((cells) => (
    cells.map((cell) => {
      const box = cell.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      };
    })
  ));
  expect(narrowCells).toHaveLength(4);
  expectBoxesNotToOverlap(narrowCells);
  await page.screenshot({ path: narrowScreenshotPath, fullPage: true });

  expect(pageErrors).toEqual([]);
});
