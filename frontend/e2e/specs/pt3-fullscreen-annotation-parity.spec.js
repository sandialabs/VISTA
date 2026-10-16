const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

const desktopScreenshotPath = path.resolve(
  __dirname,
  '../../artifacts/pt3-fullscreen-annotation-parity.png',
);
const compactScreenshotPath = path.resolve(
  __dirname,
  '../../artifacts/pt3-fullscreen-annotation-parity-compact.png',
);

const SEEDED_ANNOTATIONS = [
  {
    id: 'annotation-measurement-magenta',
    annotation_kind: 'measurement',
    defect_class: 'Measurement',
    modality: 'volume',
    comment: 'Axial gauge line',
    disposition: 'open',
    hidden: false,
    image_id: null,
    measurements: { length_px: 52.3, length_mm: 12.34 },
    geometry: {
      axis: 'axial',
      slice_index: 20,
      line: {
        axis: 'axial',
        slice_index: 20,
        x1: 12,
        y1: 18,
        x2: 68,
        y2: 72,
        imageWidth: 80,
        imageHeight: 96,
      },
    },
    metadata: {
      measurement_color: '#ff00ff',
      annotation_color: '#ff00ff',
      annotation_fill_opacity: 0.9,
    },
    bbox: { x: 12, y: 18, width: 56, height: 54 },
    created_by: 'e2e@example.com',
    created_at: '2026-07-23T12:00:00Z',
  },
  {
    id: 'annotation-box-cyan',
    annotation_kind: 'annotation',
    defect_class: 'Bounding Box',
    modality: 'volume',
    comment: 'Coronal bearing pocket',
    disposition: 'open',
    hidden: false,
    image_id: null,
    measurements: {
      width_px: 28,
      height_px: 18,
      width_mm: 4.5,
      height_mm: 2.25,
    },
    geometry: {
      axis: 'coronal',
      slice_index: 16,
      imageWidth: 80,
      imageHeight: 128,
      box: {
        axis: 'coronal',
        slice_index: 16,
        x: 18,
        y: 34,
        width: 28,
        height: 18,
        imageWidth: 80,
        imageHeight: 128,
      },
    },
    metadata: {
      annotation_color: '#22d3ee',
      annotation_fill_opacity: 0.42,
    },
    bbox: { x: 18, y: 34, width: 28, height: 18 },
    created_by: 'e2e@example.com',
    created_at: '2026-07-23T12:01:00Z',
  },
  {
    id: 'annotation-cube-orange',
    annotation_kind: 'annotation',
    defect_class: '3D Box',
    modality: 'volume',
    comment: 'Sagittal inclusion volume',
    disposition: 'open',
    hidden: false,
    image_id: null,
    measurements: { width_px: 30, height_px: 20, depth_slices: 4 },
    geometry: {
      cube: {
        axis: 'sagittal',
        startSlice: 8,
        endSlice: 12,
        x: 20,
        y: 42,
        width: 30,
        height: 20,
        imageWidth: 96,
        imageHeight: 128,
      },
    },
    metadata: {
      annotation_color: '#f97316',
      annotation_fill_opacity: 0.38,
    },
    bbox: { x: 20, y: 42, width: 30, height: 20 },
    created_by: 'e2e@example.com',
    created_at: '2026-07-23T12:02:00Z',
  },
  {
    id: 'annotation-segment-green',
    annotation_kind: 'vista_segment',
    defect_class: 'Internal void segment',
    modality: 'volume',
    comment: 'Seeded VISTA segment',
    disposition: 'open',
    hidden: false,
    image_id: null,
    measurements: {},
    geometry: {
      segment: {
        version: 1,
        axis: 'axial',
        min_slice: 19,
        max_slice: 21,
        image_width: 80,
        image_height: 96,
        areas: [{
          id: 'segment-rectangle',
          tool: 'rectangle',
          operation: 'add',
          start: { x: 48, y: 24 },
          end: { x: 70, y: 46 },
        }],
      },
    },
    metadata: {
      annotation_color: '#22c55e',
      annotation_fill_opacity: 0.5,
    },
    bbox: null,
    created_by: 'e2e@example.com',
    created_at: '2026-07-23T12:03:00Z',
  },
  {
    id: 'annotation-note',
    annotation_kind: 'annotation',
    defect_class: 'Inspection Note',
    modality: 'volume',
    comment: 'Surface note without coordinates',
    disposition: 'open',
    hidden: false,
    image_id: null,
    measurements: {},
    geometry: null,
    metadata: { annotation_color: '#a78bfa' },
    bbox: null,
    created_by: 'e2e@example.com',
    created_at: '2026-07-23T12:04:00Z',
  },
];

const EXPECTED_PRESENTATIONS = [
  ['Measurement', '12.34 mm'],
  ['Bounding Box', '4.50 x 2.25 mm'],
  ['3D Box', '30.0 x 20.0 px'],
  ['VISTA segment', 'Internal void segment'],
  ['Inspection Note', 'Surface note without coordinates'],
];

function boxesOverlap(left, right, tolerance = 1) {
  return left.x < right.x + right.width - tolerance
    && left.x + left.width > right.x + tolerance
    && left.y < right.y + right.height - tolerance
    && left.y + left.height > right.y + tolerance;
}

async function expectNoFullscreenControlOverlap(fullscreen) {
  const closeButton = fullscreen.getByRole('button', { name: 'Close fullscreen 3D view' });
  const displayOptions = fullscreen.getByRole('group', { name: 'Fullscreen 3D display options' });
  const annotationList = fullscreen.getByRole('complementary', { name: '3D annotations' });
  const reconstructionControls = fullscreen.getByRole('group', { name: 'Ray-march controls' });
  const title = fullscreen.locator('#mpr-3d-fullscreen-title');
  const mode = fullscreen.locator('#mpr-3d-fullscreen-mode');
  const dialogBox = await fullscreen.boundingBox();
  const entries = [
    ['close button', await closeButton.boundingBox()],
    ['display options', await displayOptions.boundingBox()],
    ['annotation list', await annotationList.boundingBox()],
    ['reconstruction controls', await reconstructionControls.boundingBox()],
    ['title', await title.boundingBox()],
    ['mode', await mode.boundingBox()],
  ];

  expect(dialogBox).not.toBeNull();
  entries.forEach(([label, box]) => {
    expect(box, `${label} must have layout geometry`).not.toBeNull();
    expect(box.x, `${label} left edge`).toBeGreaterThanOrEqual(dialogBox.x - 1);
    expect(box.y, `${label} top edge`).toBeGreaterThanOrEqual(dialogBox.y - 1);
    expect(box.x + box.width, `${label} right edge`).toBeLessThanOrEqual(
      dialogBox.x + dialogBox.width + 1,
    );
    expect(box.y + box.height, `${label} bottom edge`).toBeLessThanOrEqual(
      dialogBox.y + dialogBox.height + 1,
    );
  });

  const boxByLabel = Object.fromEntries(entries);
  [
    ['close button', 'display options'],
    ['close button', 'title'],
    ['close button', 'mode'],
    ['close button', 'annotation list'],
    ['close button', 'reconstruction controls'],
    ['display options', 'annotation list'],
    ['display options', 'reconstruction controls'],
    ['title', 'display options'],
    ['mode', 'display options'],
    ['annotation list', 'reconstruction controls'],
  ].forEach(([leftLabel, rightLabel]) => {
    expect(
      boxesOverlap(boxByLabel[leftLabel], boxByLabel[rightLabel]),
      `${leftLabel} must not overlap ${rightLabel}`,
    ).toBe(false);
  });

  const closeRightInset = (dialogBox.x + dialogBox.width)
    - (boxByLabel['close button'].x + boxByLabel['close button'].width);
  const closeTopInset = boxByLabel['close button'].y - dialogBox.y;
  expect(closeRightInset).toBeGreaterThanOrEqual(0);
  expect(closeRightInset).toBeLessThanOrEqual(12);
  expect(closeTopInset).toBeGreaterThanOrEqual(0);
  expect(closeTopInset).toBeLessThanOrEqual(12);
}

async function countMagentaAnnotationPixels(canvas) {
  return canvas.evaluate((element) => {
    if (element.width < 1 || element.height < 1) return 0;
    const context = element.getContext('2d');
    if (!context) return 0;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const alpha = pixels[offset + 3];
      if (red > 170 && blue > 170 && green < 110 && alpha > 15) count += 1;
    }
    return count;
  });
}

test.describe('PT3 fullscreen annotation parity', () => {
  test('shares MPR names, renders spatial annotations, and keeps compact controls separate', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      const nativeGetContext = window.HTMLCanvasElement.prototype.getContext;
      window.HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
        if (['webgl', 'webgl2', 'experimental-webgl'].includes(String(type).toLowerCase())) {
          return null;
        }
        return nativeGetContext.call(this, type, ...args);
      };
    });

    const { projectId } = await mockInspectionWorkbenchRoutes(page, {
      type: 'PT3',
      scenario: 'advanced',
      seededAnnotations: SEEDED_ANNOTATIONS,
    });

    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Inspection' }).click();
    await expect(page.getByTestId('mpr-panel')).toBeVisible();

    const mprAnnotationList = page.getByTestId('annotation-list');
    await expect(mprAnnotationList.locator('.annotation-entry')).toHaveCount(
      EXPECTED_PRESENTATIONS.length,
    );
    for (const [typeLabel, displayName] of EXPECTED_PRESENTATIONS) {
      const row = mprAnnotationList.locator('.annotation-entry').filter({ hasText: displayName });
      await expect(row).toHaveCount(1);
      await expect(row.locator('.annotation-entry-type')).toHaveText(typeLabel);
      await expect(row.locator('.annotation-entry-value')).toHaveText(displayName);
    }

    await page.getByLabel('3D view').selectOption('ray-march:composite');
    const viewer = page.getByTestId('pt3-gaussian-splat-viewer');
    await expect(viewer).toBeVisible();
    await expect(viewer).toHaveAttribute('data-renderer-type', 'canvas2d-fallback');
    await page.getByRole('button', { name: 'Open 3D part view fullscreen' }).click();

    const fullscreen = page.getByRole('dialog', { name: '3D reconstruction' });
    const fullscreenAnnotationList = fullscreen.getByRole('complementary', { name: '3D annotations' });
    const reconstructionControls = fullscreen.getByRole('group', { name: 'Ray-march controls' });
    const overlayCanvas = viewer.getByLabel('Mechanical 3DGS preview');
    await expect(fullscreen).toBeVisible();
    await expect(fullscreenAnnotationList).toBeVisible();
    await expect(reconstructionControls).toBeVisible();

    for (const [typeLabel, displayName] of EXPECTED_PRESENTATIONS) {
      const row = fullscreenAnnotationList.locator('li').filter({ hasText: displayName });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(`${typeLabel} — ${displayName}`);
    }

    await expect.poll(() => countMagentaAnnotationPixels(overlayCanvas)).toBeGreaterThan(8);
    const measurement3dRow = fullscreenAnnotationList.locator('li').filter({ hasText: '12.34 mm' });
    await measurement3dRow.getByRole('button', { name: 'Hide 3D annotation 12.34 mm' }).click();
    await expect(
      measurement3dRow.getByRole('button', { name: 'Show 3D annotation 12.34 mm' }),
    ).toBeVisible();
    const measurementMprRow = mprAnnotationList.locator('.annotation-entry').filter({ hasText: '12.34 mm' });
    await expect(measurementMprRow).toHaveClass(/annotation-entry-hidden/);
    await expect(
      measurementMprRow.getByRole('button', { name: 'Show measurement 12.34 mm' }),
    ).toBeVisible();
    await expect.poll(() => countMagentaAnnotationPixels(overlayCanvas)).toBe(0);

    await measurement3dRow.getByRole('button', { name: 'Show 3D annotation 12.34 mm' }).click();
    await expect(
      measurement3dRow.getByRole('button', { name: 'Hide 3D annotation 12.34 mm' }),
    ).toBeVisible();
    await expect.poll(() => countMagentaAnnotationPixels(overlayCanvas)).toBeGreaterThan(8);

    const renderAnnotationsToggle = fullscreen.getByLabel('Render annotations');
    await renderAnnotationsToggle.uncheck();
    await expect(fullscreenAnnotationList).toBeVisible();
    await expect.poll(() => countMagentaAnnotationPixels(overlayCanvas)).toBe(0);
    await renderAnnotationsToggle.check();
    await expect.poll(() => countMagentaAnnotationPixels(overlayCanvas)).toBeGreaterThan(8);

    await expectNoFullscreenControlOverlap(fullscreen);
    await fullscreen.screenshot({ path: desktopScreenshotPath });

    await page.setViewportSize({ width: 375, height: 600 });
    await expect(fullscreen).toBeVisible();
    await expect(fullscreenAnnotationList).toBeVisible();
    await expect(reconstructionControls).toBeVisible();
    await expectNoFullscreenControlOverlap(fullscreen);
    await fullscreen.screenshot({ path: compactScreenshotPath });
  });
});
