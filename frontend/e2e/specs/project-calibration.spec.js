const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

const configurationScreenshotPath = path.resolve(
  __dirname,
  '../../artifacts/project-calibration-configuration.png',
);
const measurementScreenshotPath = path.resolve(
  __dirname,
  '../../artifacts/project-calibration-measurement.png',
);

const calibrationImageId = 'calibration-image-1000';
const calibrationImageFilename = 'calibration-front.svg';
const calibrationImageSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500" viewBox="0 0 1000 500">
    <rect width="1000" height="500" fill="#e2e8f0"/>
    <path d="M0 250H1000M500 0V500" stroke="#64748b" stroke-width="4"/>
    <circle cx="250" cy="250" r="18" fill="#0f766e"/>
    <circle cx="750" cy="250" r="18" fill="#0f766e"/>
    <text x="500" y="80" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#0f172a">
      500 px calibration span
    </text>
  </svg>
`;

test.describe('Project calibration configuration and measurement workflow', () => {
  test('persists unit conversion, calibrates a known line, and clears the default', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const mockPart = {
      id: 'part-calibration-001',
      batch_id: 'batch-basic',
      serial_number: 'SN-CAL-001',
      display_name: 'Calibration Coupon',
      review_state: 'unreviewed',
      metadata: {
        configured_views: ['front'],
        modalities: ['visual'],
        view_images: {
          front: {
            filename: calibrationImageFilename,
            image_id: calibrationImageId,
          },
        },
        source_images: [{
          filename: calibrationImageFilename,
          image_id: calibrationImageId,
          side: 'front',
          modality: 'visual',
        }],
      },
    };
    const {
      projectId,
      getAnnotations,
      getSavedConfigurations,
    } = await mockInspectionWorkbenchRoutes(page, {
      type: 'PT1',
      scenario: 'basic',
      images: [{
        id: calibrationImageId,
        filename: calibrationImageFilename,
        size: calibrationImageSvg.length,
        metadata: {},
      }],
      mockParts: [mockPart],
    });
    await page.route(`**/api/images/${calibrationImageId}/content`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: calibrationImageSvg,
      });
    });

    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Project Configuration' }).click();

    const calibrationCard = page.locator('.project-calibration-card');
    await expect(calibrationCard).toBeVisible();
    await expect(calibrationCard.getByText('NOT SET')).toBeVisible();
    await page.getByLabel('Project calibration unit').selectOption('inches');
    await page.getByLabel('Pixels per inch', { exact: true }).fill('254');
    await expect(calibrationCard.getByText('CALIBRATED')).toBeVisible();
    await expect(calibrationCard.getByText('1 in = 254 px')).toBeVisible();

    await page.getByLabel('Project calibration unit').selectOption('mm');
    await expect(page.getByLabel('Pixels per millimeter', { exact: true })).toHaveValue('10');
    await page.getByLabel('Project calibration unit').selectOption('inches');
    await expect(page.getByLabel('Pixels per inch', { exact: true })).toHaveValue('254');

    await page.getByRole('button', { name: 'Save Configuration' }).click();
    await expect(page.getByText('Configuration saved.')).toBeVisible();
    await expect.poll(() => getSavedConfigurations().length).toBeGreaterThan(0);
    const savedCalibration = getSavedConfigurations().at(-1).payload.config.calibration;
    expect(savedCalibration).toEqual(expect.objectContaining({
      pixels_per_mm: 10,
      pixels_per_inch: 254,
      unit: 'inches',
      updated_at: expect.any(String),
    }));
    expect(Number.isFinite(Date.parse(savedCalibration.updated_at))).toBe(true);
    await calibrationCard.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    const calibrationCardBox = await calibrationCard.boundingBox();
    const actionBarBox = await page.locator('.configuration-action-bar').boundingBox();
    expect(calibrationCardBox).toBeTruthy();
    expect(actionBarBox).toBeTruthy();
    expect(calibrationCardBox.y + calibrationCardBox.height).toBeLessThanOrEqual(actionBarBox.y);
    await calibrationCard.screenshot({ path: configurationScreenshotPath });

    await page.getByRole('tab', { name: 'Inspection' }).click();
    const workbench = page.locator('section[aria-label="Inspection Workbench"]');
    await expect(workbench).toBeVisible();
    const image = page.getByAltText('front view');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element) => ({
      complete: element.complete,
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
    }))).toEqual({ complete: true, naturalWidth: 1000, naturalHeight: 500 });
    const imageBox = await image.boundingBox();
    expect(imageBox).toBeTruthy();
    const firstPoint = { x: imageBox.width * 0.25, y: imageBox.height * 0.5 };
    const secondPoint = { x: imageBox.width * 0.75, y: imageBox.height * 0.5 };

    await page.getByRole('button', { name: 'Measure on tiles' }).click();
    await image.click({ position: firstPoint });
    await image.click({ position: secondPoint });

    await expect.poll(() => {
      const annotations = getAnnotations()[mockPart.id] || [];
      return annotations.length;
    }).toBe(1);
    const [measurement] = getAnnotations()[mockPart.id];
    expect(measurement.annotation_kind).toBe('measurement');
    expect(measurement.image_id).toBe(calibrationImageId);
    expect(measurement.measurements.length_px).toBeCloseTo(500, 0);
    expect(measurement.measurements.length_mm).toBeCloseTo(50, 1);
    await expect(page.getByTestId('annotation-list')).toContainText('50.00 mm');
    await expect(page.getByRole('dialog', { name: 'Measurement calibration required' })).toHaveCount(0);
    await workbench.screenshot({ path: measurementScreenshotPath });

    await page.getByRole('tab', { name: 'Project Configuration' }).click();
    await expect(page.getByLabel('Project calibration unit')).toHaveValue('inches');
    await expect(page.getByLabel('Pixels per inch', { exact: true })).toHaveValue('254');
    const saveCountBeforeClear = getSavedConfigurations().length;
    await page.getByRole('button', { name: 'Clear Calibration' }).click();
    await page.getByRole('button', { name: 'Save Configuration' }).click();
    await expect.poll(() => getSavedConfigurations()
      .slice(saveCountBeforeClear)
      .some(({ payload }) => payload.config.calibration === null)).toBe(true);

    await page.getByRole('tab', { name: 'Inspection' }).click();
    await expect(image).toBeVisible();
    const clearedImageBox = await image.boundingBox();
    expect(clearedImageBox).toBeTruthy();
    await page.getByRole('button', { name: 'Measure on tiles' }).click();
    await image.click({
      position: {
        x: clearedImageBox.width * 0.1,
        y: clearedImageBox.height * 0.15,
      },
    });
    await expect(page.getByRole('dialog', { name: 'Measurement calibration required' })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
