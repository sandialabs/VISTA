const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

const screenshotPath = path.resolve(__dirname, '../../artifacts/pr04-mpr-workbench.png');
const pr09ScreenshotPath = path.resolve(__dirname, '../../artifacts/pr09-inspector-modalities-measurements.png');
const pr11ScreenshotPath = path.resolve(__dirname, '../../artifacts/pr11-project-configuration.png');
const pr14ScreenshotPath = path.resolve(__dirname, '../../artifacts/pr14-report-normalization-advanced.png');
const projectDataLayoutScreenshotPath = path.resolve(__dirname, '../../artifacts/project-data-load-images-layout.png');
const highVolumeUploadScreenshotPath = path.resolve(__dirname, '../../artifacts/high-volume-image-upload-progress.png');
const pt3RealSplatScreenshotPath = path.resolve(__dirname, '../../artifacts/pt3-real-vs-simplified-3dgs.png');
const largeNpyLazyMprScreenshotPath = path.resolve(__dirname, '../../artifacts/large-npy-lazy-mpr.png');
const rgbaVolumePreviewScreenshotPath = path.resolve(__dirname, '../../artifacts/rgba-segment-volume-preview.png');
const rgbaFullscreen2dScreenshotPath = path.resolve(__dirname, '../../artifacts/rgba-segment-fullscreen-2d.png');
const rgbaFullscreen3dScreenshotPath = path.resolve(__dirname, '../../artifacts/rgba-segment-fullscreen-3d.png');
const rgbaFullscreen3dNarrowScreenshotPath = path.resolve(__dirname, '../../artifacts/rgba-segment-fullscreen-3d-narrow.png');
const rgbaFullscreen3dCompactScreenshotPath = path.resolve(__dirname, '../../artifacts/rgba-segment-fullscreen-3d-compact.png');
const annotationTransparencyScreenshotPath = path.resolve(__dirname, '../../artifacts/annotation-transparency-50.png');
const annotationDefectTypeScreenshotPath = path.resolve(__dirname, '../../artifacts/annotation-edit-defect-type.png');
const nsiproMetadataScreenshotPath = path.resolve(__dirname, '../../artifacts/nsipro-part-metadata.png');
const imageSortMenuScreenshotPath = path.resolve(__dirname, '../../artifacts/image-sort-menu.png');
const imageSortMenuNarrowScreenshotPath = path.resolve(__dirname, '../../artifacts/image-sort-menu-narrow.png');
const accessGroupDesktopScreenshotPath = path.resolve(__dirname, '../../artifacts/access-group-project-configuration-desktop.png');
const accessGroupNarrowScreenshotPath = path.resolve(__dirname, '../../artifacts/access-group-project-configuration-narrow.png');
const simulatedUsers = ['basic', 'intermediate', 'advanced'];

function readMultipartJsonFilePart(bodyBuffer, fieldName) {
  const multipartBody = bodyBuffer.toString('utf8');
  const fieldMarker = `name="${fieldName}"`;
  const fieldIndex = multipartBody.indexOf(fieldMarker);
  if (fieldIndex < 0) throw new Error(`Multipart field ${fieldName} was not found`);
  const headerStart = multipartBody.lastIndexOf('\r\n', fieldIndex) + 2;
  const headerEnd = multipartBody.indexOf('\r\n\r\n', fieldIndex);
  const headers = multipartBody.slice(headerStart, headerEnd);
  const valueStart = headerEnd + 4;
  const valueEnd = multipartBody.indexOf('\r\n--', valueStart);
  return {
    headers,
    value: JSON.parse(multipartBody.slice(valueStart, valueEnd)),
  };
}

test.describe('Project Data load images layout', () => {
  test('places Images to Parts before Batches and keeps upload left of compact export', async ({ page }) => {
    const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT1', scenario: 'basic' });

    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Project Data' }).click();

    await expect(page.getByRole('tab', { name: 'Load Images', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Images to Parts' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Batches' })).toBeVisible();

    const loadImagesTabBox = await page.getByRole('tab', { name: 'Load Images', exact: true }).boundingBox();
    const imagesToPartsTabBox = await page.getByRole('tab', { name: 'Images to Parts' }).boundingBox();
    const batchesTabBox = await page.getByRole('tab', { name: 'Batches' }).boundingBox();
    expect(
      loadImagesTabBox
        && imagesToPartsTabBox
        && batchesTabBox
        && loadImagesTabBox.x < imagesToPartsTabBox.x
        && imagesToPartsTabBox.x < batchesTabBox.x
    ).toBeTruthy();

    await expect(page.getByRole('heading', { name: 'Upload Images' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Filename Regex & Delimiter Decoder' })).toBeVisible();
    await expect(page.getByLabel('Advanced (Regex)')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Export Data' })).toBeVisible();
    const uploadCardBox = await page.locator('.project-data-upload-first .upload-section').boundingBox();
    const exportCardBox = await page.locator('.project-data-upload-first .export-section').boundingBox();
    expect(
      uploadCardBox
        && exportCardBox
        && uploadCardBox.x < exportCardBox.x
        && uploadCardBox.width > exportCardBox.width
    ).toBeTruthy();

    await page.locator('.project-data-tab-panel[aria-label="Load Images"]').screenshot({
      path: projectDataLayoutScreenshotPath,
    });
  });

  test('batches a large local selection with bounded concurrency and refreshes from successes once', async ({ page }) => {
    const { projectId, getIngestValidationRequests } = await mockInspectionWorkbenchRoutes(page, { type: 'PT1', scenario: 'basic' });
    const batchRequests = [];
    const imageListUrls = [];
    const summaryUrls = [];
    const legacyUploadRequests = [];
    const pageErrors = [];
    let activeBatchRequests = 0;
    let maximumActiveBatchRequests = 0;
    let releaseDelayedBatches;
    const delayedBatches = new Promise((resolve) => {
      releaseDelayedBatches = resolve;
    });

    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.route(`**/api/projects/${projectId}/data-summary`, async (route) => {
      summaryUrls.push(new URL(route.request().url()).pathname);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          project_id: projectId,
          active_image_count: 2,
          deleted_image_count: 0,
          total_image_bytes: 2,
          part_count: 1,
          image_metadata_fields: 0,
          annotation_count: 0,
          overlay_layer_count: 0,
        }),
      });
    });

    // Registered after the common fixture so this handler can measure the
    // high-volume path while the fixture continues to serve all other APIs.
    await page.route(`**/api/projects/${projectId}/images**`, async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      if (request.method() === 'GET') {
        imageListUrls.push(`${requestUrl.pathname}${requestUrl.search}`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], total: 0, next_cursor: null, has_more: false }),
        });
        return;
      }
      if (!requestUrl.pathname.endsWith('/images/batch')) {
        legacyUploadRequests.push(requestUrl.pathname);
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'unexpected legacy upload' }) });
        return;
      }

      const manifestPart = readMultipartJsonFilePart(request.postDataBuffer(), 'manifest');
      expect(manifestPart.headers).toContain('filename="manifest.json"');
      expect(manifestPart.headers.toLowerCase()).toContain('content-type: application/json');
      const manifest = manifestPart.value;
      const requestNumber = batchRequests.length;
      batchRequests.push(manifest);
      activeBatchRequests += 1;
      maximumActiveBatchRequests = Math.max(maximumActiveBatchRequests, activeBatchRequests);

      if (requestNumber === 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      } else {
        await delayedBatches;
      }

      const failedClientIndex = 204;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          uploaded: manifest
            .filter((entry) => entry.client_index !== failedClientIndex)
            .map((entry) => ({
              client_index: entry.client_index,
              image: { id: `image-${entry.client_index}`, filename: entry.filename },
            })),
          failed: manifest
            .filter((entry) => entry.client_index === failedClientIndex)
            .map((entry) => ({
              client_index: entry.client_index,
              filename: entry.filename,
              code: 'validation_failed',
              detail: 'synthetic corrupt image',
            })),
        }),
      });
      activeBatchRequests -= 1;
    });
    await page.goto(`/project/${projectId}?tab=project_data`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('tab', { name: 'Load Images', exact: true })).toHaveAttribute('aria-selected', 'true');
    const initialSummaryRequestCount = summaryUrls.length;
    expect(initialSummaryRequestCount).toBeGreaterThanOrEqual(1);
    expect(imageListUrls).toEqual([]);

    const files = Array.from({ length: 205 }, (_, index) => ({
      name: `D1001_LOT01_SET01_SN${String(index).padStart(4, '0')}_front_visual_false.jpg`,
      mimeType: 'image/jpeg',
      buffer: Buffer.from([index % 251]),
    }));
    await page.locator('#file-input').setInputFiles(files);
    await expect(page.getByText('205 files selected (205 B)')).toBeVisible();
    await expect(page.getByLabel('Delimiter')).toHaveValue('_');
    await expect(page.getByLabel('Keys (comma-separated)')).toHaveValue(
      'design_number, lot_number, set_number, serial_number, side, modality, overlay',
    );

    await page.getByRole('button', { name: 'Upload Images' }).click();
    await expect.poll(() => batchRequests.length).toBe(3);
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Image upload data progress' })).toHaveAttribute('aria-valuenow', '49', { timeout: 8_000 });
    await expect(page.getByText('100 B / 205 B uploaded')).toBeVisible();
    await page.locator('.project-data-upload-first .upload-section').screenshot({
      path: highVolumeUploadScreenshotPath,
    });

    releaseDelayedBatches();
    await expect(page.getByText('Upload complete: 204 succeeded, 1 failed out of 205.')).toBeVisible();
    await expect(page.getByText('1 file selected (1 B)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload Images' })).toBeEnabled();
    await expect(page.getByRole('progressbar', { name: 'Image upload data progress' })).toHaveCount(0);

    expect(batchRequests.map((manifest) => manifest.length).sort((left, right) => right - left)).toEqual([100, 100, 5]);
    expect(maximumActiveBatchRequests).toBeLessThanOrEqual(2);
    expect(legacyUploadRequests).toEqual([]);
    expect(getIngestValidationRequests()).toEqual([]);

    await expect.poll(() => summaryUrls.length).toBe(initialSummaryRequestCount + 1);
    expect(imageListUrls).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

for (const projectType of ['PT1', 'PT2', 'PT3']) {
  for (const simulatedUser of simulatedUsers) {
    test.describe(`Inspection Workbench E2E (${projectType}) ${simulatedUser}`, () => {
      test(`renders project data workflow for ${projectType} ${simulatedUser}`, async ({ page }) => {
        const { projectId, getWorkspaceStates, getIngestValidationRequests } = await mockInspectionWorkbenchRoutes(page, { type: projectType, scenario: simulatedUser });

        await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
        await page.getByRole('tab', { name: 'Project Data' }).click();

        await expect(page.getByTestId('project-data-summary')).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Load Images', exact: true })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('tab', { name: 'Batches' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Upload Images' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Data Validation' })).toBeVisible();
        await page.getByRole('tab', { name: 'Project Data' }).click();
        await page.getByRole('tab', { name: 'Metadata' }).click();
        await expect(page.getByRole('heading', { name: 'Project metadata sources' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'inspection_profile' })).toBeVisible();
        await page.getByRole('tab', { name: 'Load Images', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Data Validation' })).toBeVisible();
        const summaryBox = await page.getByTestId('project-data-summary').boundingBox();
        const tabsBox = await page.getByRole('tab', { name: 'Load Images', exact: true }).boundingBox();
        expect(summaryBox && tabsBox && summaryBox.y < tabsBox.y).toBeTruthy();
        await page.getByTestId('request-ingest-validation').click();
        await expect(page.getByTestId('ingest-validation-result')).toContainText('Ingest validation complete');

        await page.getByRole('tab', { name: 'Inspection' }).click();
        const inspectionPanel = page.locator('section[aria-label="Inspection Workbench"]');
        await expect(inspectionPanel).toBeVisible();
        if (projectType === 'PT3') {
          await expect(page.getByTestId('inspection-layout-grid')).toHaveCount(0);
          await expect(page.getByTestId('mpr-panel')).toBeVisible();
          await expect(page.getByLabel('3D view')).toHaveValue('orientation');
          await expect(page.getByTestId('mpr-pane-3d')).toContainText('3D');
          await expect(page.locator('.mpr-mirror-toggle').first()).toBeVisible();
          await expect.poll(() => getWorkspaceStates().length).toBeGreaterThan(0);
          return;
        }
        await expect(page.getByTestId('inspection-layout-grid')).toBeVisible();
        await expect(inspectionPanel.locator('.flexlayout__tab_button', { hasText: 'Part Summary' }).first()).toBeVisible();
        await expect(inspectionPanel.locator('.flexlayout__tab_button', { hasText: 'View Parts' }).first()).toBeVisible();
        await expect(inspectionPanel.locator('.flexlayout__tab_button', { hasText: 'Image Metadata' }).first()).toBeVisible();
        await expect(inspectionPanel.locator('.flexlayout__tab_button', { hasText: 'Annotations' }).first()).toBeVisible();
        await expect(page.getByLabel('Batch', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Status')).toBeVisible();
        await expect(page.getByLabel('Filter', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Sort')).toBeVisible();

        if (simulatedUser === 'basic') {
          await expect(page.getByText('Batches: 1')).toBeVisible();
          await expect(page.getByText('Parts: 1')).toBeVisible();
        } else if (simulatedUser === 'intermediate') {
          await expect(page.getByText('Batches: 2')).toBeVisible();
          await expect(page.getByText('Parts: 2')).toBeVisible();
        } else {
          await expect(page.getByText('Batches: 2')).toBeVisible();
          await expect(page.getByText('Parts: 3')).toBeVisible();
        }

        if (simulatedUser !== 'basic') {
          const primaryBatch = simulatedUser === 'intermediate' ? 'batch-mid-a' : 'batch-adv-a';
          const primaryPart = simulatedUser === 'intermediate' ? 'Housing Mid 1' : 'Housing Adv 1';
          await page.getByLabel('Batch', { exact: true }).selectOption(primaryBatch);
          await expect(page.getByRole('heading', { name: primaryPart })).toBeVisible();
        }

        await page.getByRole('button', { name: 'Pass', exact: true }).click();
        const expectedPassedCount = simulatedUser === 'advanced' ? 'Passed: 2' : 'Passed: 1';
        await expect(page.getByText(expectedPassedCount)).toBeVisible();

        await expect(page.getByTestId('selected-image-panel')).toBeVisible();
        if (simulatedUser === 'advanced') {
          const closeFullscreenIfOpen = async () => {
            const closeButton = page.getByRole('button', { name: 'Close fullscreen image' });
            if (await closeButton.isVisible().catch(() => false)) {
              await closeButton.click();
              await expect(page.locator('.inspection-fullscreen-modal')).toHaveCount(0);
            }
          };
          const topViewButton = inspectionPanel.getByRole('button', { name: /^TOP\b/ }).first();
          await topViewButton.click();
          // View toggles mark selection with the Bootstrap 'active' class; 'selected' is the
          // part-row convention and never appears on these buttons.
          await expect(topViewButton).toHaveClass(/\bactive\b/);
          await closeFullscreenIfOpen();
          const frontViewButton = inspectionPanel.getByRole('button', { name: /^FRONT\b/ }).first();
          await frontViewButton.click();
          await expect(frontViewButton).toHaveClass(/\bactive\b/);
          await closeFullscreenIfOpen();
        }
        await expect(page.getByTestId('annotation-controls')).toBeVisible();
        await page.getByRole('button', { name: 'Other', exact: true }).click();
        await page.getByLabel('Annotation defect type').selectOption('Other');
        await page.getByPlaceholder('annotation modality').fill('visual');
        await page.getByPlaceholder('annotation comment').fill(`${simulatedUser}-surface-note`);
        await page.getByRole('button', { name: 'Save annotation' }).click();
        await expect(page.getByTestId('annotation-list')).toContainText(`${simulatedUser}-surface-note`);

        await expect.poll(() => getWorkspaceStates().length).toBeGreaterThan(0);
        await expect.poll(() => {
          const states = getWorkspaceStates();
          return states[states.length - 1]?.state?.inspector?.viewport_transform || null;
        }).toEqual(expect.objectContaining({
          zoom: expect.any(Number),
          panX: expect.any(Number),
          panY: expect.any(Number),
        }));
        await expect.poll(() => getIngestValidationRequests().length).toBeGreaterThan(0);
      });
    });
  }
}

test('image sort dropdown persists a full ordered sequence across an inspection rerender', async ({ page }) => {
  const orderedPart = {
    id: 'part-image-order',
    batch_id: 'batch-basic',
    serial_number: 'SN-IMAGE-ORDER',
    display_name: 'Image Order Housing',
    review_state: 'in_review',
    metadata: {
      configured_views: ['front', 'back'],
      modalities: ['visual'],
      view_images: {
        front: 'order-front.png',
        back: 'order-back.png',
      },
      source_images: [
        {
          filename: 'order-front.png',
          image_id: 'order-front-id',
          side: 'front',
          modality: 'visual',
        },
        {
          filename: 'order-back.png',
          image_id: 'order-back-id',
          side: 'back',
          modality: 'visual',
        },
      ],
      analysis_outputs: [
        {
          filename: 'order-overlay.png',
          image_id: 'order-overlay-id',
          label: 'Porosity overlay',
          analysis_output: true,
          overlay: true,
        },
      ],
    },
  };
  const images = [
    { id: 'order-front-id', filename: 'order-front.png', metadata: {} },
    { id: 'order-back-id', filename: 'order-back.png', metadata: {} },
    { id: 'order-overlay-id', filename: 'order-overlay.png', metadata: {} },
  ];
  const {
    projectId: mockedProjectId,
    getImageDisplayOrderRequests,
  } = await mockInspectionWorkbenchRoutes(page, {
    type: 'PT1',
    scenario: 'basic',
    mockParts: [orderedPart],
    mockBatches: [{ id: 'batch-basic', name: 'Batch Basic' }],
    images,
  });

  await page.goto(`/project/${mockedProjectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Inspection' }).click();
  const viewBoard = page.locator('.view-board');
  await expect(viewBoard.locator('.view-cell-title span')).toHaveText([
    'order-front.png',
    'order-back.png',
    'order-overlay.png',
  ]);
  await expect(viewBoard.locator('.view-cell')).toHaveCount(3);

  const sortButton = page.getByRole('button', { name: 'Sort images' });
  await sortButton.click();
  const sortMenu = page.getByRole('dialog', { name: 'Image sorting options' });
  await expect(sortMenu).toBeVisible();
  await expect(sortButton).toHaveAttribute('aria-expanded', 'true');
  const primarySort = sortMenu.getByRole('combobox', { name: 'Primary image sort' });
  // The four static sorts always lead the list; metadata-derived sorts are appended
  // from whatever keys the loaded images expose, so only the static prefix is fixed.
  const staticSortLabels = ['Filename A-Z', 'Filename Z-A', 'View A-Z', 'Image type'];
  await expect.poll(async () => (await primarySort.locator('option').allTextContents()).slice(0, 4))
    .toEqual(staticSortLabels);
  await sortMenu.screenshot({ path: imageSortMenuScreenshotPath });

  await page.setViewportSize({ width: 430, height: 900 });
  await expect(primarySort).toBeVisible();
  await expect(sortMenu.getByRole('button', { name: 'Apply sort' })).toBeVisible();
  const narrowMenuBox = await sortMenu.boundingBox();
  expect(narrowMenuBox).not.toBeNull();
  expect(narrowMenuBox.x).toBeGreaterThanOrEqual(0);
  expect(narrowMenuBox.x + narrowMenuBox.width).toBeLessThanOrEqual(430);
  await sortMenu.screenshot({ path: imageSortMenuNarrowScreenshotPath });

  await primarySort.selectOption({ label: 'Filename Z-A' });
  await sortMenu.getByRole('button', { name: 'Apply sort' }).click();
  await expect(sortMenu).toHaveCount(0);
  await expect.poll(() => sortButton.evaluate((element) => element === document.activeElement)).toBe(true);
  await expect.poll(() => getImageDisplayOrderRequests().length).toBe(1);
  expect(getImageDisplayOrderRequests()[0]).toEqual({
    partId: 'part-image-order',
    payload: {
      image_refs: ['order-overlay-id', 'order-front-id', 'order-back-id'],
    },
  });

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Inspection' }).click();
  const persistedViewBoard = page.locator('.view-board');
  await expect(persistedViewBoard.locator('.view-cell-title span')).toHaveText([
    'order-overlay.png',
    'order-front.png',
    'order-back.png',
  ]);
  await page.getByRole('button', { name: 'Sort images' }).click();
  const persistedMenu = page.getByRole('dialog', { name: 'Image sorting options' });
  const persistedSort = persistedMenu.getByRole('combobox', { name: 'Primary image sort' });
  await expect.poll(async () => (await persistedSort.locator('option').allTextContents()).slice(0, 4))
    .toEqual(staticSortLabels);
});


test('All inspection row aggregates views and modalities across visible parts', async ({ page }) => {
  const allParts = [
    {
      id: 'part-all-e2e-a',
      batch_id: 'batch-all-e2e',
      serial_number: 'SN-ALL-E2E-A',
      display_name: 'All E2E Part A',
      review_state: 'unreviewed',
      metadata: {
        configured_views: ['top', 'side'],
        modalities: ['optical', 'thermal'],
        view_images: { top: 'all-e2e-a-top-optical.png' },
        source_images: [
          { filename: 'all-e2e-a-top-optical.png', image_id: 'all-e2e-a-top-optical', side: 'top', modality: 'optical', overlay: false },
          { filename: 'all-e2e-a-side-thermal.png', image_id: 'all-e2e-a-side-thermal', side: 'side', modality: 'thermal', overlay: false },
        ],
        annotations: [],
      },
    },
    {
      id: 'part-all-e2e-b',
      batch_id: 'batch-all-e2e',
      serial_number: 'SN-ALL-E2E-B',
      display_name: 'All E2E Part B',
      review_state: 'pass',
      metadata: {
        configured_views: ['top', 'side'],
        modalities: ['optical', 'thermal'],
        view_images: { top: 'all-e2e-b-top-optical.png' },
        source_images: [
          { filename: 'all-e2e-b-top-optical.png', image_id: 'all-e2e-b-top-optical', side: 'top', modality: 'optical', overlay: false },
          { filename: 'all-e2e-b-side-thermal.png', image_id: 'all-e2e-b-side-thermal', side: 'side', modality: 'thermal', overlay: false },
        ],
        annotations: [],
      },
    },
  ];
  const images = allParts.flatMap((part) => part.metadata.source_images.map((image) => ({
    id: image.image_id,
    filename: image.filename,
    metadata: {},
  })));
  const { projectId, getWorkspaceStates, getImageDisplayOrderRequests } = await mockInspectionWorkbenchRoutes(page, {
    type: 'PT1',
    scenario: 'basic',
    mockParts: allParts,
    mockBatches: [{ id: 'batch-all-e2e', name: 'Batch All E2E' }],
    images,
    mockWorkspaceState: {
      selected_batch_id: 'batch-all-e2e',
      selected_part_id: '__all_parts__',
      inspector: { image_enabled: true, modalities: ['optical'], view_name: 'top' },
    },
    mockConfiguration: {
      image_modalities: [
        { id: 'optical', label: 'Optical', calibration_required: false },
        { id: 'thermal', label: 'Thermal', calibration_required: false },
      ],
      part_views: [
        { id: 'top', label: 'Top', required_modalities: ['optical'], source: 'manual' },
        { id: 'side', label: 'Side', required_modalities: ['thermal'], source: 'manual' },
      ],
      defect_types: [{ name: 'Surface', color: '#ef4444', definition: 'Synthetic defect' }],
      process_settings: {
        configurable_hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
      },
      ui_sections: {
        'inspection.part_summary.views_row': true,
      },
    },
  });

  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Inspection' }).click();

  const inspectionPanel = page.locator('section[aria-label="Inspection Workbench"]');
  await expect(inspectionPanel).toBeVisible();
  // The aggregate row lives in its own View All Images subtab, which replaces the
  // per-part summary list rather than adding an extra row to it.
  const viewAllImagesTab = inspectionPanel
    .locator('.flexlayout__tab_button', { hasText: 'View All Images' })
    .first();
  await viewAllImagesTab.click();
  await expect(viewAllImagesTab).toHaveClass(/flexlayout__tab_button--selected/);
  const allRow = inspectionPanel.locator('article.workbench-part-row-all');
  await expect(allRow).toContainText('All Images');
  await expect(allRow).toContainText('2 parts');
  await expect(allRow).toHaveClass(/selected/);
  await expect(inspectionPanel.getByAltText('top view')).toHaveCount(2);
  await expect(inspectionPanel.getByText('All E2E Part A').first()).toBeVisible();
  await expect(inspectionPanel.getByText('All E2E Part B').first()).toBeVisible();

  // View and modality toggles are "show only this value" filters that intersect, and
  // each part maps top to optical and side to thermal.
  const viewToggles = allRow.locator('[aria-label="All Images view toggles"]');
  const modalityToggles = allRow.locator('[aria-label="All Images modality toggles"]');

  await modalityToggles.getByRole('button', { name: 'THERMAL' }).click();
  await expect(inspectionPanel.getByAltText('side view')).toHaveCount(2);
  await expect(inspectionPanel.getByAltText('top view')).toHaveCount(0);

  await viewToggles.getByRole('button', { name: 'TOP' }).click();
  await modalityToggles.getByRole('button', { name: 'OPTICAL' }).click();
  await expect(inspectionPanel.getByAltText('top view')).toHaveCount(2);
  await expect(inspectionPanel.getByAltText('side view')).toHaveCount(0);

  await viewToggles.getByRole('button', { name: 'ALL' }).click();
  await modalityToggles.getByRole('button', { name: 'ALL' }).click();
  await expect(inspectionPanel.getByAltText('top view')).toHaveCount(2);
  await expect(inspectionPanel.getByAltText('side view')).toHaveCount(2);

  await allRow.getByRole('button', { name: 'Collapse row' }).click();
  await expect(allRow).toHaveClass(/collapsed/);
  await expect(allRow.locator('[aria-label="All Images view toggles"]')).toHaveCount(0);
  await expect(allRow.getByRole('button', { name: 'Expand row' })).toBeVisible();

  await expect.poll(() => getWorkspaceStates().some((payload) => (
    payload.state?.selected_part_id === '__all_parts__'
  ))).toBeTruthy();
  expect(getImageDisplayOrderRequests()).toEqual([]);
});

test.describe('Inspection Workbench screenshot artifact', () => {
  test('captures PT2 inspection workbench screenshot', async ({ page }) => {
    const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT2' });

    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Inspection' }).click();
    await expect(page.getByTestId('inspection-layout-grid')).toBeVisible();

    const panel = page.locator('section[aria-label="Inspection Workbench"]');
    await expect(panel).toBeVisible();
    await panel.screenshot({ path: screenshotPath });
  });
});

test.describe('PT3 Real 3DGS mode', () => {
  test('completes a voxel-native canonical Real 3DGS fit', async ({ page }) => {
    const segmentedPart = {
      id: 'part-adv-001',
      batch_id: 'batch-adv-a',
      serial_number: 'SN-ADV-001',
      display_name: 'Segmented housing',
      review_state: 'in_review',
      metadata: {
        defects: [],
        volume_shape: { axial: 128, coronal: 96, sagittal: 80 },
        spacing: [0.08, 0.08, 0.08],
        pt3_segmentation: {
          segments: [
            { id: 1, label: 'Shell', color: '#f97316' },
            { id: 2, label: 'Core', color: '#38bdf8' },
          ],
        },
      },
    };
    const { projectId, getRealSplatRequests } = await mockInspectionWorkbenchRoutes(page, {
      type: 'PT3',
      scenario: 'advanced',
      mockParts: [segmentedPart],
      realSplatSegmentIds: [1, 1, 2, 2],
    });

    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Inspection' }).click();
    const viewSelector = page.getByLabel('3D view');
    await expect(viewSelector).toBeVisible();
    await expect(viewSelector.locator('optgroup[label="Ray marching"] option')).toHaveText([
      'Composite',
      'MIP',
      'X-ray',
      'Iso',
      'Window',
    ]);
    await expect(viewSelector.locator('option[value="real_splat"]')).toHaveText('Real 3DGS');

    await viewSelector.selectOption('real_splat');
    const viewer = page.getByTestId('pt3-gaussian-splat-viewer');
    await expect(viewer).toContainText('Real 3DGS missing');
    await expect(page.getByRole('group', { name: 'Real 3DGS fitting' })).toBeVisible();
    await expect(page.getByLabel('Real 3DGS fitting strategy')).toHaveValue('voxel_direct');
    await expect(page.getByLabel('Real 3DGS splat budget')).toHaveValue('50000');
    await expect(page.getByLabel('Real 3DGS splat budget')).toHaveAttribute('max', '100000');
    const computeButton = page.getByRole('button', { name: 'Fit voxel splats' });
    await expect(computeButton).toBeEnabled();

    await computeButton.click();
    await expect(viewer).toContainText('37% complete');
    await expect.poll(() => getRealSplatRequests().length).toBe(1);
    expect(getRealSplatRequests()[0]).toEqual(expect.objectContaining({
      fit_mode: 'voxel_direct',
      cameras: [],
      parameters: expect.objectContaining({ max_splats: 50000, sh_degree: 0, optimize_camera_poses: false }),
    }));
    await expect(viewer).toContainText('Voxel splats ready • analytic fit • canonical v1');
    await expect(viewer).toContainText('splats 4');
    await expect(page.getByRole('button', { name: 'Recompute voxel splats' })).toBeEnabled();
    const segmentationControls = page.getByRole('group', { name: 'Segmentation display' });
    await expect(segmentationControls).toContainText('Shell');
    await expect(segmentationControls).toContainText('Core');

    const sceneBox = await page.getByTestId('mpr-pane-3d').locator('.mpr-volume-scene').boundingBox();
    const controlsBox = await page.getByRole('group', { name: 'Real 3DGS fitting' }).boundingBox();
    const segmentationBox = await segmentationControls.boundingBox();
    expect(sceneBox?.width).toBeGreaterThanOrEqual(380);
    expect(sceneBox?.width).toBeLessThanOrEqual(420);
    expect(sceneBox && controlsBox
      && controlsBox.x >= sceneBox.x
      && controlsBox.y >= sceneBox.y
      && controlsBox.x + controlsBox.width <= sceneBox.x + sceneBox.width
      && controlsBox.y + controlsBox.height <= sceneBox.y + sceneBox.height).toBeTruthy();
    expect(sceneBox && segmentationBox
      && segmentationBox.x >= sceneBox.x
      && segmentationBox.y >= sceneBox.y
      && segmentationBox.x + segmentationBox.width <= sceneBox.x + sceneBox.width
      && segmentationBox.y + segmentationBox.height <= sceneBox.y + sceneBox.height).toBeTruthy();
    expect(controlsBox && segmentationBox && (
      controlsBox.x < segmentationBox.x + segmentationBox.width
      && controlsBox.x + controlsBox.width > segmentationBox.x
      && controlsBox.y < segmentationBox.y + segmentationBox.height
      && controlsBox.y + controlsBox.height > segmentationBox.y
    )).toBeFalsy();
    await page.getByTestId('mpr-pane-3d').screenshot({ path: pt3RealSplatScreenshotPath });
  });
});

test.describe('PT3 large NPY lazy MPR loading', () => {
  test('bounds slice requests and keeps a segmented overlay aligned with the base volume', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 860 });
    const dimensions = { axial: 749, coronal: 1010, sagittal: 984 };
    const baseImageId = 'large-npy-base';
    const overlayImageId = 'large-npy-segments';
    const largeVolumePart = {
      id: 'part-adv-001',
      batch_id: 'batch-adv-a',
      serial_number: 'NIST-749',
      display_name: 'Large NPY segmented part',
      review_state: 'in_review',
      metadata: {
        volume_shape: dimensions,
        overlay_layers: [{ id: 'segments', label: 'Segments', color: '#fb315b' }],
        source_images: [
          {
            filename: 'nist_part.npy',
            image_id: baseImageId,
            overlay: false,
            metadata: { load_mode: 'volume', volume_shape: dimensions, voxel_dtype: 'uint16' },
          },
          {
            filename: 'nist_part_segments.npy',
            image_id: overlayImageId,
            overlay: true,
            overlay_base_image_id: baseImageId,
            overlay_base_filename: 'nist_part.npy',
            metadata: { load_mode: 'volume', volume_shape: dimensions, voxel_dtype: 'uint8' },
          },
        ],
      },
    };
    const images = [
      { id: baseImageId, filename: 'nist_part.npy', metadata: { load_mode: 'volume', volume_shape: dimensions, voxel_dtype: 'uint16' } },
      { id: overlayImageId, filename: 'nist_part_segments.npy', metadata: { load_mode: 'volume', volume_shape: dimensions, voxel_dtype: 'uint8' } },
    ];
    const metadataRequests = [];
    const sliceRequests = [];
    const volumeContentRequests = [];
    const pageErrors = [];
    const failedRequests = [];
    let inFlightSliceRequests = 0;
    let maxInFlightSliceRequests = 0;
    let sliceRequestDelayMs = 25;

    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (
        [baseImageId, overlayImageId].some((imageId) => (
          requestUrl.pathname === `/api/images/${imageId}/content`
        ))
      ) {
        volumeContentRequests.push(requestUrl.pathname);
      }
    });
    page.on('requestfailed', (request) => {
      // React may cancel superseded project-data reads while the inspection tab
      // initializes; those browser aborts are not failed slice loads.
      if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
      failedRequests.push(`${request.method()} ${request.url()}`);
    });

    const { projectId } = await mockInspectionWorkbenchRoutes(page, {
      type: 'PT3',
      scenario: 'advanced',
      mockParts: [largeVolumePart],
      mockBatches: [{ id: 'batch-adv-a', name: 'Batch Adv A' }],
      images,
    });

    await page.route(/\/api\/images\/(large-npy-base|large-npy-segments)\/volume-metadata(?:\?.*)?$/, async (route) => {
      const requestUrl = new URL(route.request().url());
      const imageId = requestUrl.pathname.split('/').at(-2);
      const isOverlay = imageId === overlayImageId;
      metadataRequests.push(imageId);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          dimensions,
          channel_count: isOverlay ? 4 : 1,
          color_mode: isOverlay ? 'rgba' : 'scalar',
          pixel_dtype: isOverlay ? 'uint8' : 'uint16',
          voxel_dtype: isOverlay ? 'uint8' : 'uint16',
          bit_depth: isOverlay ? 8 : 16,
          source_kind: 'npy',
          interpretation: 'voxel_array',
        }),
      });
    });

    await page.route(/\/api\/images\/large-npy-segments\/volume-render-summary(?:\?.*)?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary_version: 1,
          kind: 'rgba-channel-presence',
          active_channels: [0, 1, 2, 3],
          channel_representatives: [0, 1, 2, 3].map((channel) => ({
            channel,
            axial_index: 700,
          })),
          representative_axial_indices: [700],
          source_kind: 'npy',
          dimensions,
        }),
      });
    });

    await page.route(/\/api\/images\/(large-npy-base|large-npy-segments)\/volume-slice\?/, async (route) => {
      const requestUrl = new URL(route.request().url());
      const imageId = requestUrl.pathname.split('/').at(-2);
      const axis = requestUrl.searchParams.get('axis');
      const index = Number(requestUrl.searchParams.get('index'));
      const imageDimensions = {
        axial: { width: dimensions.sagittal, height: dimensions.coronal },
        coronal: { width: dimensions.sagittal, height: dimensions.axial },
        sagittal: { width: dimensions.coronal, height: dimensions.axial },
      }[axis];
      sliceRequests.push({ imageId, axis, index });
      inFlightSliceRequests += 1;
      maxInFlightSliceRequests = Math.max(maxInFlightSliceRequests, inFlightSliceRequests);
      await new Promise((resolve) => setTimeout(resolve, sliceRequestDelayMs));
      const isOverlay = imageId === overlayImageId;
      const body = isOverlay
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="${imageDimensions.width}" height="${imageDimensions.height}" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="38" y="38" width="24" height="24" rx="5" fill="#ff1744" fill-opacity="0.82"/><circle cx="50" cy="50" r="31" fill="none" stroke="#ff4f72" stroke-opacity="0.88" stroke-width="4"/><rect x="14" y="9" width="10" height="8" fill="#ff002f"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="${imageDimensions.width}" height="${imageDimensions.height}" viewBox="0 0 100 100" preserveAspectRatio="none"><rect width="100" height="100" fill="#182332"/><circle cx="50" cy="50" r="31" fill="#aeb8c6"/><path d="M19 50h62M50 19v62" stroke="#566579" stroke-width="2"/><rect x="8" y="5" width="28" height="16" fill="#eef2f7"/><text x="4" y="96" fill="#d9e2ec" font-size="6">${axis} ${index}</text></svg>`;
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body });
      inFlightSliceRequests -= 1;
    });

    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Project Data' }).click();
    await page.getByRole('tab', { name: 'Images to Parts' }).click();
    await page.getByRole('button', { name: 'nist_part_segments.npy', exact: true }).click();

    const volumePreviewDialog = page.getByRole('dialog', { name: 'nist_part_segments.npy' });
    const volumePreviewCanvas = volumePreviewDialog.locator('.mpr-slice-canvas');
    await expect(volumePreviewDialog).toBeVisible();
    await expect(volumePreviewCanvas).toHaveAttribute('data-volume-color-mode', 'rgba');
    for (const axis of ['axial', 'coronal', 'sagittal']) {
      await volumePreviewDialog.getByLabel('Slice axis').selectOption(axis);
      await expect(volumePreviewCanvas).toHaveAttribute('data-mpr-axis', axis);
      await expect(volumePreviewCanvas).toHaveAttribute('data-slice-load-status', 'ready');
      await expect.poll(async () => volumePreviewCanvas.evaluate((canvas) => {
        const context = canvas.getContext('2d');
        if (!context || canvas.width < 1 || canvas.height < 1) return false;
        const center = context.getImageData(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1,
        ).data;
        return center[0] > center[1] + 35 && center[0] > center[2] + 35 && center[3] > 0;
      })).toBe(true);
    }
    await volumePreviewDialog.screenshot({ path: rgbaVolumePreviewScreenshotPath });
    await volumePreviewDialog.getByRole('button', { name: 'Close volume viewer' }).click();
    await expect.poll(() => inFlightSliceRequests).toBe(0);

    metadataRequests.length = 0;
    sliceRequests.length = 0;
    volumeContentRequests.length = 0;
    maxInFlightSliceRequests = 0;
    await page.getByRole('tab', { name: 'Inspection' }).click();

    const mprPanel = page.getByTestId('mpr-panel');
    await expect(mprPanel).toBeVisible();
    await expect(page.getByTestId('mpr-pane-axial')).toBeVisible();
    await expect(page.getByTestId('mpr-pane-coronal')).toBeVisible();
    await expect(page.getByTestId('mpr-pane-sagittal')).toBeVisible();
    await expect(page.getByTestId('mpr-pane-3d')).toContainText('3D');
    await expect(page.locator('#mpr-slice-axial')).toHaveAttribute('max', '748');
    await expect(page.locator('#mpr-slice-coronal')).toHaveAttribute('max', '1009');
    await expect(page.locator('#mpr-slice-sagittal')).toHaveAttribute('max', '983');
    await expect(page.locator('.mpr-slice-canvas[data-slice-load-status="ready"]')).toHaveCount(3);
    await expect.poll(() => inFlightSliceRequests).toBe(0);
    expect(metadataRequests.filter((imageId) => imageId === baseImageId)).toHaveLength(1);
    expect(metadataRequests.filter((imageId) => imageId === overlayImageId)).toHaveLength(1);
    expect(metadataRequests).toHaveLength(2);
    expect(volumeContentRequests).toEqual([]);

    const baseRequestsAfterLoad = sliceRequests.filter((request) => request.imageId === baseImageId);
    const overlayRequests = sliceRequests.filter((request) => request.imageId === overlayImageId);
    expect(baseRequestsAfterLoad.length).toBeGreaterThanOrEqual(3);
    expect(baseRequestsAfterLoad.length).toBeLessThanOrEqual(24);
    expect(baseRequestsAfterLoad.length).toBeLessThan(dimensions.axial / 20);
    expect(overlayRequests.length).toBeGreaterThanOrEqual(3);
    expect(overlayRequests.length).toBeLessThanOrEqual(15);
    expect(maxInFlightSliceRequests).toBeLessThanOrEqual(4);
    for (const axis of ['axial', 'coronal', 'sagittal']) {
      const selectedIndex = Number(await page.locator(`#mpr-slice-${axis}`).inputValue());
      expect(baseRequestsAfterLoad.find((request) => request.axis === axis)?.index).toBe(selectedIndex);
    }

    const annotationList = page.getByTestId('annotation-list');
    await expect(annotationList).toContainText('External: overlay for nist_part.npy');
    await expect(annotationList.getByRole('button', {
      name: 'Hide external overlay overlay for nist_part.npy',
      exact: true,
    })).toBeVisible();
    for (const overlayRequest of overlayRequests) {
      expect(baseRequestsAfterLoad).toContainEqual(expect.objectContaining({
        axis: overlayRequest.axis,
        index: overlayRequest.index,
      }));
    }
    expect(maxInFlightSliceRequests).toBeLessThanOrEqual(4);

    await expect.poll(async () => page.evaluate(() => ['axial', 'coronal', 'sagittal'].every((axis) => {
      const canvas = document.querySelector(`[data-testid="mpr-preview-${axis}"] canvas`);
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return false;
      const center = context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      return center[0] > center[1] + 35 && center[0] > center[2] + 35;
    }))).toBe(true);

    const canvasEvidence = await page.evaluate(() => {
      const expectedDimensions = {
        axial: { width: 984, height: 1010 },
        coronal: { width: 984, height: 749 },
        sagittal: { width: 1010, height: 749 },
      };
      return Object.entries(expectedDimensions).map(([axis, expected]) => {
        const canvas = document.querySelector(`[data-testid="mpr-preview-${axis}"] canvas`);
        const context = canvas.getContext('2d');
        const center = Array.from(context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data);
        const background = Array.from(context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 10), 1, 1).data);
        return { axis, width: canvas.width, height: canvas.height, expected, center, background };
      });
    });
    for (const evidence of canvasEvidence) {
      expect({ width: evidence.width, height: evidence.height }).toEqual(evidence.expected);
      expect(evidence.center[0]).toBeGreaterThan(evidence.center[1] + 35);
      expect(evidence.center[0]).toBeGreaterThan(evidence.center[2] + 35);
      expect(evidence.background[3]).toBe(255);
      expect(Math.abs(evidence.background[0] - evidence.background[1])).toBeLessThan(20);
    }

    const orientationEvidence = await page.evaluate(() => (
      ['axial', 'coronal', 'sagittal'].map((axis) => {
        const canvas = document.querySelector(`[data-testid="mpr-preview-${axis}"] canvas`);
        const context = canvas.getContext('2d');
        const pixel = (xFraction, yFraction) => Array.from(context.getImageData(
          Math.floor(canvas.width * xFraction),
          Math.floor(canvas.height * yFraction),
          1,
          1,
        ).data);
        return {
          axis,
          sourceTopMarker: pixel(0.19, 0.13),
          legacyBottomMarker: pixel(0.19, 0.87),
          sourceTopBaseEdge: pixel(0.10, 0.10),
          legacyBottomBaseEdge: pixel(0.10, 0.90),
        };
      })
    ));
    const isRed = (pixel) => pixel[0] > pixel[1] + 55 && pixel[0] > pixel[2] + 55;
    const isBrightNeutral = (pixel) => (
      pixel[0] > 180
      && Math.abs(pixel[0] - pixel[1]) < 35
      && Math.abs(pixel[0] - pixel[2]) < 35
    );
    for (const evidence of orientationEvidence) {
      if (evidence.axis === 'axial') {
        expect(isRed(evidence.sourceTopMarker)).toBe(true);
        expect(isRed(evidence.legacyBottomMarker)).toBe(false);
        expect(isBrightNeutral(evidence.sourceTopBaseEdge)).toBe(true);
      } else {
        expect(isRed(evidence.sourceTopMarker)).toBe(false);
        expect(isRed(evidence.legacyBottomMarker)).toBe(true);
        expect(isBrightNeutral(evidence.legacyBottomBaseEdge)).toBe(true);
      }
    }

    const persistedSlicePositions = {
      axial: '321',
      coronal: '654',
      sagittal: '777',
    };
    for (const [axis, index] of Object.entries(persistedSlicePositions)) {
      const slider = page.locator(`#mpr-slice-${axis}`);
      await slider.fill(index);
      await expect(slider).toHaveValue(index);
    }
    await page.getByTestId('mpr-pane-sagittal').dispatchEvent('wheel', { deltaY: 80 });
    persistedSlicePositions.sagittal = '778';
    await expect(page.locator('#mpr-slice-sagittal')).toHaveValue('778');

    await page.getByTestId('mpr-pane-3d').dispatchEvent('wheel', { deltaY: -80 });
    await expect(mprPanel).toHaveAttribute('data-active-pane', 'volume');
    await expect(mprPanel).toHaveAttribute('data-last-active-axis', 'sagittal');
    const compact3dScene = page.getByRole('button', { name: 'Open 3D part view fullscreen' });
    await compact3dScene.press('Enter');
    const fullscreen3dScene = page.getByRole('application', {
      name: 'Fullscreen 3D part view. Use arrow keys to orbit, plus and minus to zoom, and zero to reset.',
    });
    await fullscreen3dScene.press('ArrowRight');
    await page.getByRole('button', { name: 'Close fullscreen 3D view' }).click();
    const persistedNavigation = await mprPanel.evaluate((panel) => ({
      activePane: panel.dataset.activePane,
      lastActiveAxis: panel.dataset.lastActiveAxis,
      zoom: panel.dataset.zoom,
      panX: panel.dataset.panX,
      panY: panel.dataset.panY,
      rotationX: panel.dataset.rotationX,
      rotationY: panel.dataset.rotationY,
    }));
    expect(persistedNavigation).toEqual({
      activePane: 'volume',
      lastActiveAxis: 'sagittal',
      zoom: '1.42',
      panX: '20',
      panY: '-14',
      rotationX: '-22',
      rotationY: '37',
    });
    await expect.poll(() => inFlightSliceRequests).toBe(0);

    await page.getByRole('tab', { name: 'Project Data' }).click();
    await expect(page.getByTestId('project-data-summary')).toBeVisible();
    await page.getByRole('tab', { name: 'Inspection' }).click();
    await expect(mprPanel).toBeVisible();
    await expect(page.locator('.mpr-slice-canvas[data-slice-load-status="ready"]')).toHaveCount(3);
    for (const [axis, index] of Object.entries(persistedSlicePositions)) {
      await expect(page.locator(`#mpr-slice-${axis}`)).toHaveValue(index);
    }
    await expect(mprPanel).toHaveAttribute('data-active-pane', persistedNavigation.activePane);
    await expect(mprPanel).toHaveAttribute('data-last-active-axis', persistedNavigation.lastActiveAxis);
    await expect(mprPanel).toHaveAttribute('data-zoom', persistedNavigation.zoom);
    await expect(mprPanel).toHaveAttribute('data-pan-x', persistedNavigation.panX);
    await expect(mprPanel).toHaveAttribute('data-pan-y', persistedNavigation.panY);
    await expect(mprPanel).toHaveAttribute('data-rotation-x', persistedNavigation.rotationX);
    await expect(mprPanel).toHaveAttribute('data-rotation-y', persistedNavigation.rotationY);
    await expect(annotationList).toContainText('External: overlay for nist_part.npy');
    await expect.poll(async () => page.evaluate(() => ['axial', 'coronal', 'sagittal'].every((axis) => {
      const canvas = document.querySelector(`[data-testid="mpr-preview-${axis}"] canvas`);
      return canvas?.getAttribute('data-overlay-color-modes') === 'rgba';
    }))).toBe(true);

    for (const axis of ['axial', 'coronal', 'sagittal']) {
      await page.getByTestId(`mpr-pane-${axis}`).locator('.mpr-pane-header').click();
      const fullscreenSlice = page.getByTestId('fullscreen-mpr-slice');
      await expect(fullscreenSlice).toBeVisible();
      await expect(fullscreenSlice).toHaveAttribute('data-mpr-axis', axis);
      await expect(fullscreenSlice).toHaveAttribute('data-overlay-color-modes', 'rgba');
      await expect.poll(async () => fullscreenSlice.evaluate((canvas) => {
        const context = canvas.getContext('2d');
        if (!context || canvas.width < 1 || canvas.height < 1) return false;
        const center = context.getImageData(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1,
        ).data;
        return center[0] > center[1] + 35 && center[0] > center[2] + 35 && center[3] > 0;
      })).toBe(true);
      if (axis === 'axial') {
        await page.locator('.inspection-fullscreen-modal-content').screenshot({ path: rgbaFullscreen2dScreenshotPath });
      }
      await page.getByRole('button', { name: 'Close fullscreen image' }).click();
      await expect(fullscreenSlice).not.toBeVisible();
    }

    const reconstructionSelector = page.getByLabel('3D view');
    await reconstructionSelector.selectOption('stack');
    await expect.poll(() => page.locator('.volume-slice-segment-overlay').count()).toBeGreaterThan(0);
    await expect.poll(() => sliceRequests.some((request) => (
      request.imageId === overlayImageId
      && request.axis === 'axial'
      && request.index === 700
    ))).toBe(true);
    expect(sliceRequests).not.toContainEqual({ imageId: baseImageId, axis: 'axial', index: 700 });

    await reconstructionSelector.selectOption('ray-march:composite');
    const volumeViewer = page.getByTestId('pt3-gaussian-splat-viewer');
    await expect(volumeViewer).toBeVisible();
    await expect(volumeViewer).toHaveAttribute('data-external-overlay-rendered', 'true');
    const activeVolumeRenderer = await volumeViewer.getAttribute('data-renderer-type');
    expect(activeVolumeRenderer).toMatch(/^(three-|canvas2d-fallback$)/);
    if (activeVolumeRenderer.startsWith('three-')) {
      await expect(volumeViewer).toHaveAttribute('data-external-overlay-points', '0');
    } else {
      await expect.poll(async () => Number(await volumeViewer.getAttribute('data-external-overlay-points')))
        .toBeGreaterThan(0);
    }

    await page.getByRole('button', { name: 'Open 3D part view fullscreen' }).click();
    const fullscreen3d = page.getByRole('dialog', { name: '3D reconstruction' });
    const displayOptions = fullscreen3d.getByRole('group', { name: 'Fullscreen 3D display options' });
    const renderAnnotationsToggle = displayOptions.getByLabel('Render annotations');
    const annotationListToggle = displayOptions.getByLabel('Show annotations list');
    const reconstructionSettingsToggle = displayOptions.getByLabel('Show reconstruction settings');
    const annotationList3d = fullscreen3d.getByRole('complementary', { name: '3D annotations' });
    const rayMarchControls = fullscreen3d.getByRole('group', { name: 'Ray-march controls' });
    const closeFullscreen3d = fullscreen3d.getByRole('button', { name: 'Close fullscreen 3D view' });

    await expect(fullscreen3d).toBeVisible();
    await expect(renderAnnotationsToggle).toBeChecked();
    await expect(annotationListToggle).toBeChecked();
    await expect(reconstructionSettingsToggle).toBeChecked();
    await expect(annotationList3d).toBeVisible();
    await expect(rayMarchControls).toBeVisible();

    const assertFullscreenRailsDoNotOverlap = async () => {
      const dialogBox = await fullscreen3d.boundingBox();
      const closeBox = await closeFullscreen3d.boundingBox();
      const displayOptionsBox = await displayOptions.boundingBox();
      const titleBox = await fullscreen3d.locator('#mpr-3d-fullscreen-title').boundingBox();
      const modeBox = await fullscreen3d.locator('#mpr-3d-fullscreen-mode').boundingBox();
      const settingsBox = await rayMarchControls.boundingBox();
      const annotationsBox = await annotationList3d.boundingBox();
      const boxesOverlap = (left, right) => (
        left.x < right.x + right.width
        && left.x + left.width > right.x
        && left.y < right.y + right.height
        && left.y + left.height > right.y
      );
      expect(
        dialogBox
        && closeBox
        && displayOptionsBox
        && titleBox
        && modeBox
        && settingsBox
        && annotationsBox
      ).toBeTruthy();
      const closeRightInset = (dialogBox.x + dialogBox.width) - (closeBox.x + closeBox.width);
      const closeTopInset = closeBox.y - dialogBox.y;
      expect(closeRightInset).toBeGreaterThanOrEqual(0);
      expect(closeRightInset).toBeLessThanOrEqual(12);
      expect(closeTopInset).toBeGreaterThanOrEqual(0);
      expect(closeTopInset).toBeLessThanOrEqual(12);
      [
        displayOptionsBox,
        titleBox,
        modeBox,
        settingsBox,
        annotationsBox,
      ].forEach((box) => expect(boxesOverlap(closeBox, box)).toBe(false));
      expect(boxesOverlap(displayOptionsBox, settingsBox)).toBe(false);
      expect(boxesOverlap(displayOptionsBox, annotationsBox)).toBe(false);
      expect(boxesOverlap(settingsBox, annotationsBox)).toBe(false);
      const sceneBox = await fullscreen3d.locator('.mpr-volume-scene').boundingBox();
      expect(sceneBox && settingsBox && settingsBox.x < sceneBox.x + (sceneBox.width / 2)).toBeTruthy();
      expect(sceneBox && annotationsBox && annotationsBox.x > sceneBox.x + (sceneBox.width / 2)).toBeTruthy();
    };
    await assertFullscreenRailsDoNotOverlap();
    await fullscreen3d.screenshot({ path: rgbaFullscreen3dScreenshotPath });

    await renderAnnotationsToggle.uncheck();
    await expect(volumeViewer).toHaveAttribute('data-external-overlay-rendered', 'false');
    await expect(volumeViewer).toHaveAttribute('data-external-overlay-points', '0');
    await expect(annotationList3d).toBeVisible();
    await expect(rayMarchControls).toBeVisible();
    await renderAnnotationsToggle.check();
    await expect(volumeViewer).toHaveAttribute('data-external-overlay-rendered', 'true');

    await annotationListToggle.uncheck();
    await expect(annotationList3d).not.toBeVisible();
    await expect(rayMarchControls).toBeVisible();
    await expect(volumeViewer).toHaveAttribute('data-external-overlay-rendered', 'true');
    await annotationListToggle.check();
    await expect(annotationList3d).toBeVisible();

    await reconstructionSettingsToggle.uncheck();
    await expect(rayMarchControls).not.toBeVisible();
    await expect(annotationList3d).toBeVisible();
    await expect(volumeViewer).toHaveAttribute('data-external-overlay-rendered', 'true');
    await reconstructionSettingsToggle.check();
    await expect(rayMarchControls).toBeVisible();

    await page.setViewportSize({ width: 800, height: 720 });
    await assertFullscreenRailsDoNotOverlap();
    await page.setViewportSize({ width: 600, height: 720 });
    await assertFullscreenRailsDoNotOverlap();
    await fullscreen3d.screenshot({ path: rgbaFullscreen3dNarrowScreenshotPath });
    await page.setViewportSize({ width: 375, height: 720 });
    await assertFullscreenRailsDoNotOverlap();
    await fullscreen3d.screenshot({ path: rgbaFullscreen3dCompactScreenshotPath });
    await page.setViewportSize({ width: 1280, height: 860 });
    await closeFullscreen3d.click();
    await expect(fullscreen3d).not.toBeVisible();
    // A zero in-flight count can occur briefly between the fullscreen renderer's
    // current-slice and prefetch generations. Require a quiet window so those
    // background requests are not attributed to the scrub measured below.
    let previousSliceRequestCount = -1;
    let quietSliceRequestPolls = 0;
    await expect.poll(() => {
      const currentCount = sliceRequests.length;
      quietSliceRequestPolls = inFlightSliceRequests === 0
        && currentCount === previousSliceRequestCount
        ? quietSliceRequestPolls + 1
        : 0;
      previousSliceRequestCount = currentCount;
      return quietSliceRequestPolls;
    }, { timeout: 10_000, intervals: [100, 100, 100, 200] }).toBeGreaterThanOrEqual(3);
    maxInFlightSliceRequests = 0;

    const requestsBeforeRapidScrub = sliceRequests.length;
    // Model the slow cold-slice path that originally exposed the backlog:
    // only the latest queued generation should survive while four requests run.
    sliceRequestDelayMs = 1000;
    const axialSlider = page.locator('#mpr-slice-axial');
    await axialSlider.evaluate(async (slider) => {
      const setNativeValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set;
      for (let offset = 0; offset < 100; offset += 1) {
        setNativeValue.call(slider, String(200 + offset));
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
    // The rapid loop can outlive the original DOM node when React commits a
    // slice update. Finish through Playwright's current locator so the final
    // generation always targets the mounted slider.
    await axialSlider.fill('299');
    await expect(axialSlider).toHaveValue('299');
    await expect(page.getByTestId('mpr-pane-axial').locator('[data-slice-load-status="ready"]')).toHaveCount(1);
    await expect.poll(() => inFlightSliceRequests, { timeout: 20_000 }).toBe(0);
    const rapidScrubRequests = sliceRequests.slice(requestsBeforeRapidScrub);
    expect(rapidScrubRequests.length).toBeGreaterThanOrEqual(2);
    expect(rapidScrubRequests.length).toBeLessThanOrEqual(20);
    expect(rapidScrubRequests.some((request) => request.axis === 'axial' && request.index === 299)).toBe(true);
    expect(maxInFlightSliceRequests).toBeLessThanOrEqual(4);
    expect(volumeContentRequests).toEqual([]);

    await mprPanel.screenshot({ path: largeNpyLazyMprScreenshotPath });
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    await expect(page.locator('.error-message:visible')).toHaveCount(0);
  });
});

test.describe('PR-09 annotation controls screenshot artifact', () => {
  test('edits the defect type for annotations created by every 2D tool', async ({ page }) => {
    const toolAnnotations = [
      ['measurement', 'Measurement', 'Measure annotation'],
      ['annotation', 'Bounding Box', 'Box annotation'],
      ['annotation', 'Crop', 'Crop annotation'],
      ['annotation', 'Other', 'Other annotation'],
    ].map(([annotation_kind, defect_class, comment], index) => ({
      id: `annotation-tool-${index}`,
      annotation_kind,
      defect_class,
      comment,
      disposition: 'open',
      hidden: false,
      measurements: {},
      geometry: {},
      metadata: {},
      created_by: 'qa@example.com',
      created_at: '2026-07-27T12:00:00Z',
    }));
    const { projectId } = await mockInspectionWorkbenchRoutes(page, {
      type: 'PT1',
      scenario: 'advanced',
      seededAnnotations: toolAnnotations,
    });
    const patchBodies = [];
    page.on('request', (request) => {
      if (request.method() === 'PATCH' && request.url().includes('/annotations/')) {
        patchBodies.push(request.postDataJSON());
      }
    });

    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Inspection' }).click();

    for (const annotation of toolAnnotations) {
      await page.getByRole('button', { name: `Edit annotation ${annotation.comment}`, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Edit annotation' });
      const defectType = dialog.getByLabel('Edit annotation defect type');
      await expect(defectType).toHaveValue(annotation.defect_class);
      await expect(defectType.locator('option')).toHaveText([
        'Defect type',
        'advanced-surface',
        annotation.defect_class === 'Other' ? 'Other' : annotation.defect_class,
        ...(annotation.defect_class === 'Other' ? [] : ['Other']),
      ]);
      await defectType.selectOption('advanced-surface');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog).not.toBeVisible();
    }

    expect(patchBodies).toHaveLength(toolAnnotations.length);
    expect(patchBodies.every((body) => body.defect_class === 'advanced-surface')).toBe(true);

    await page.getByRole('button', { name: 'Edit annotation Measure annotation', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit annotation' });
    await dialog.getByLabel('Edit annotation defect type').selectOption('');
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    await dialog.screenshot({ path: annotationDefectTypeScreenshotPath });
  });

  test('captures PT1 annotation controls screenshot', async ({ page }) => {
    const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT1', scenario: 'advanced' });
    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Inspection' }).click();
    await expect(page.getByTestId('annotation-controls')).toBeVisible();
    await page.getByRole('button', { name: 'Other', exact: true }).click();
    await page.getByLabel('Annotation defect type').selectOption('Other');
    await page.getByPlaceholder('annotation comment').fill('qa-length review note');
    const panel = page.locator('section[aria-label="Inspection Workbench"]');
    await expect(panel).toBeVisible();
    await panel.screenshot({ path: pr09ScreenshotPath });
  });

  test('configures annotation transparency locally without mutating annotations', async ({ page }) => {
    const transparencyAnnotation = {
      id: 'annotation-transparency-1',
      annotation_kind: 'annotation',
      defect_class: 'Bounding Box',
      comment: 'Transparency review note',
      disposition: 'open',
      hidden: false,
      measurements: {},
      geometry: {},
      metadata: { annotation_fill_opacity: 1 },
      created_by: 'qa@example.com',
      created_at: '2026-07-27T12:00:00Z',
    };
    const { projectId } = await mockInspectionWorkbenchRoutes(page, {
      type: 'PT1',
      scenario: 'advanced',
      seededAnnotations: [transparencyAnnotation],
    });
    const annotationMutationRequests = [];
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (
        requestUrl.pathname.includes('/annotations')
        && ['POST', 'PATCH', 'DELETE'].includes(request.method())
      ) {
        annotationMutationRequests.push(`${request.method()} ${requestUrl.pathname}`);
      }
    });

    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Inspection' }).click();
    const controls = page.getByTestId('annotation-controls');
    await expect(controls).toBeVisible();

    // Transparency is a per-annotation property edited in the Edit annotation dialog,
    // so the draft stays local until Save issues the PATCH.
    await page.getByRole('button', {
      name: `Edit annotation ${transparencyAnnotation.comment}`,
      exact: true,
    }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit annotation' });
    const transparencyInput = dialog.getByRole('spinbutton', {
      name: 'Edit annotation overlay transparency percent',
    });
    await expect(transparencyInput).toHaveValue('0');
    await expect(transparencyInput).toHaveAttribute('min', '0');
    await expect(transparencyInput).toHaveAttribute('max', '100');
    await expect(transparencyInput).toHaveAttribute('step', '1');

    await transparencyInput.fill('120');
    await expect(transparencyInput).toHaveValue('100');
    await transparencyInput.fill('50');
    await expect(transparencyInput).toHaveValue('50');
    await dialog.screenshot({ path: annotationTransparencyScreenshotPath });

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(annotationMutationRequests).toEqual([]);
  });
});

for (const projectType of ['PT1', 'PT2', 'PT3']) {
  for (const simulatedUser of simulatedUsers) {
    test.describe(`PR-11 project configuration E2E (${projectType}) ${simulatedUser}`, () => {
      test(`saves, edits, and copies configuration for ${projectType} ${simulatedUser}`, async ({ page }) => {
        const { projectId, getSavedConfigurations } = await mockInspectionWorkbenchRoutes(page, {
          type: projectType,
          scenario: simulatedUser,
        });
        const defectLabel = `Escalated ${projectType} ${simulatedUser}`;

        await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
        await page.getByRole('tab', { name: 'Project Configuration' }).click();

        await expect(page.getByRole('heading', { name: 'Project Configuration' })).toBeVisible();
        await expect(page.getByTestId('project-configuration-summary')).toBeVisible();

        await page.getByRole('button', { name: 'Add Defect Type' }).click();
        const newDefectIndex = 2;
        await page.getByLabel(`Defect type name ${newDefectIndex}`).fill(defectLabel);
        await page.getByLabel(`Defect type color ${newDefectIndex}`).fill('#0ea5e9');
        await page.getByLabel(`Defect type definition ${newDefectIndex}`).fill('Synthetic E2E defect type update');

        await page.getByLabel('Default colormap').selectOption(simulatedUser === 'basic' ? 'magma' : 'viridis');
        await page.getByRole('button', { name: 'Save Configuration' }).click();
        await expect(page.getByText('Configuration saved.')).toBeVisible();

        await page.getByLabel('Source project').selectOption('proj-copy');
        await page.getByRole('button', { name: 'Copy from Project' }).click();
        await expect(page.getByText(/Configuration copied from/)).toBeVisible();
        await expect(page.getByLabel('Defect type name 1')).toHaveValue(`${simulatedUser}-copied-defect`);

        await expect.poll(() => getSavedConfigurations().length).toBeGreaterThanOrEqual(2);
        await expect.poll(() => getSavedConfigurations().some(
          ({ payload }) => JSON.stringify(payload).includes(defectLabel),
        )).toBeTruthy();
      });
    });
  }
}

test.describe('Project Configuration Access Group', () => {
  test('updates and persists Access Group without saving project configuration', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const {
      projectId,
      getProject,
      getProjectUpdateRequests,
      getSavedConfigurations,
    } = await mockInspectionWorkbenchRoutes(page, {
      type: 'PT2',
      scenario: 'intermediate',
    });
    const destinationAccessGroup = 'inspection-reviewers-west';

    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Project Configuration' }).click();
    await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');

    const accessGroupInput = page.getByRole('textbox', { name: 'Access Group', exact: true });
    const accessGroupCard = page.getByRole('heading', { name: 'Access Group', exact: true }).locator('..');
    await expect(accessGroupInput).toHaveValue('qa-team');

    await accessGroupInput.fill(destinationAccessGroup);
    await page.waitForTimeout(750);
    expect(getSavedConfigurations()).toEqual([]);
    expect(getProjectUpdateRequests()).toEqual([]);

    await page.getByRole('button', { name: 'Update Access Group' }).click();
    await expect(accessGroupCard.getByRole('status')).toHaveText('Access Group updated.');
    await expect(accessGroupInput).toHaveValue(destinationAccessGroup);
    expect(getProjectUpdateRequests()).toEqual([{
      projectId,
      payload: { meta_group_id: destinationAccessGroup },
    }]);
    expect(getSavedConfigurations()).toEqual([]);
    expect(getProject().meta_group_id).toBe(destinationAccessGroup);
    await accessGroupCard.screenshot({
      path: accessGroupDesktopScreenshotPath,
      animations: 'disabled',
    });

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Project Configuration' }).click();
    await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('textbox', { name: 'Access Group', exact: true })).toHaveValue(destinationAccessGroup);

    await page.setViewportSize({ width: 430, height: 900 });
    const narrowAccessGroupCard = page.getByRole('heading', { name: 'Access Group', exact: true }).locator('..');
    await expect(narrowAccessGroupCard).toBeVisible();
    await narrowAccessGroupCard.screenshot({
      path: accessGroupNarrowScreenshotPath,
      animations: 'disabled',
    });
  });
});

test.describe('PR-11 project configuration screenshot artifact', () => {
  test('captures PT3 advanced project configuration screenshot', async ({ page }) => {
    const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT3', scenario: 'advanced' });
    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Project Configuration' }).click();
    await expect(page.getByRole('heading', { name: 'Project Configuration' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Defect Type' }).click();
    await page.getByLabel('Defect type name 2').fill('Screenshot Defect');
    const panel = page.locator('section[aria-label="Project Configuration"]');
    await expect(panel).toBeVisible();
    await panel.screenshot({ path: pr11ScreenshotPath });
  });
});

test.describe('Project Data metadata hierarchy screenshot artifact', () => {
  test('captures PT3 advanced project metadata hierarchy screenshot', async ({ page }) => {
    const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT3', scenario: 'advanced' });
    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Project Data' }).click();
    await page.getByRole('tab', { name: 'Metadata' }).click();
    await expect(page.getByRole('button', { name: 'inspection_profile' })).toBeVisible();
    const panel = page.locator('.project-data-metadata-panel');
    await expect(panel).toBeVisible();
    await panel.screenshot({ path: pr14ScreenshotPath });
  });
});

test.describe('.nsipro part metadata screenshot artifact', () => {
  test('preserves the nested metadata UI after field-table materialization', async ({ page }) => {
    const { projectId } = await mockInspectionWorkbenchRoutes(page, {
      type: 'PT3',
      scenario: 'advanced',
      mockParts: [
        {
          id: 'part-adv-001',
          batch_id: 'batch-adv-a',
          serial_number: 'SN-NSIPRO-QUERY-001',
          display_name: 'Queryable .nsipro Part',
          review_state: 'unreviewed',
          metadata: {
            nsipro_payload_ref: 'associated_upload_metadata:queryable.nsipro',
            nsipro_metadata: {
              capture: {
                operator: 'alice',
                exposure_ms: 12.5,
                valid: true,
              },
              channels: [
                { name: 'brightfield' },
                { name: 'DAPI' },
              ],
            },
          },
        },
      ],
    });

    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Inspection' }).click();
    await page.getByRole('button', { name: 'Metadata' }).click();

    const modal = page.locator('.workbench-utility-modal');
    await expect(modal.getByRole('heading', { name: 'Part Metadata' })).toBeVisible();
    await expect(modal.getByRole('tab', { name: '.nsipro' })).toHaveAttribute('aria-selected', 'true');
    await expect(modal).toContainText('metadata.nsipro_metadata.capture.operator');
    await expect(modal).toContainText('alice');
    await expect(modal).toContainText('metadata.nsipro_metadata.capture.exposure_ms');
    await expect(modal).toContainText('12.5');
    await expect(modal).toContainText('metadata.nsipro_metadata.channels[1].name');
    await expect(modal).toContainText('DAPI');
    await modal.screenshot({ path: nsiproMetadataScreenshotPath });
  });
});
