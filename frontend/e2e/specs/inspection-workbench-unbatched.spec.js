const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

test('shows selected part images after removing it from a saved batch filter', async ({ page }) => {
  const imageId = 'unbatched-front-id';
  const unbatchedPart = {
    id: 'part-mid-001',
    batch_id: null,
    serial_number: 'UNBATCHED-1',
    display_name: 'Unbatched Part',
    review_state: 'unreviewed',
    metadata: {
      configured_views: ['front'],
      modalities: ['visual'],
      source_images: [
        {
          filename: 'unbatched-front.png',
          image_id: imageId,
          side: 'front',
          modality: 'visual',
          overlay: false,
        },
      ],
      annotations: [],
    },
  };

  const { projectId, getImageAssetRequests } = await mockInspectionWorkbenchRoutes(page, {
    type: 'PT1',
    scenario: 'intermediate',
    images: [{ id: imageId, filename: 'unbatched-front.png', metadata: { modality: 'visual' } }],
    mockParts: [unbatchedPart],
    mockBatches: [{ id: 'batch-mid-a', name: 'Batch Mid A' }],
  });

  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Inspection' }).click();

  await expect(page.getByLabel('Batch', { exact: true })).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Unbatched Part' })).toBeVisible();
  await expect(page.getByText('unbatched-front.png')).toBeVisible();
  await expect(page.getByAltText('front view')).toBeVisible();
  await expect
    .poll(() => getImageAssetRequests().filter((request) => request.imageId === imageId).length)
    .toBeGreaterThan(0);
});
