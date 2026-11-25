const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

// Covers the Inspection annotation usability fixes:
// - every new line and bounding box uses the same color,
// - Measure, Draw box, and New Crop stay selected after each drawing (Escape or a
//   second button click turns them off),
// - anchor handles are transparent rings with a center dot and no shadow,
// - measurement text never sits under its line,
// - the selected entry in the single image view Annotations list is clearly highlighted.

// Screenshots land in the git-ignored artifacts folder for visual review.
const shot = (name) => path.resolve(__dirname, `../../artifacts/annotation-usability-${name}.png`);

const imageId = 'usability-image-1000';
const imageFilename = 'usability-front.svg';
const imageSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500" viewBox="0 0 1000 500">
    <rect width="1000" height="500" fill="#cbd5e1"/>
    <path d="M0 250H1000M500 0V500" stroke="#64748b" stroke-width="2"/>
  </svg>
`;
const NEW_ANNOTATION_COLOR = '#3b82f6';

async function setup(page) {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const mockPart = {
    id: 'part-usability-001',
    batch_id: 'batch-basic',
    serial_number: 'SN-USE-001',
    display_name: 'Usability Coupon',
    review_state: 'unreviewed',
    metadata: {
      configured_views: ['front'],
      modalities: ['visual'],
      source_images: [{ filename: imageFilename, image_id: imageId, side: 'front', modality: 'visual' }],
    },
  };
  const mocks = await mockInspectionWorkbenchRoutes(page, {
    type: 'PT1',
    scenario: 'basic',
    images: [{
      id: imageId,
      filename: imageFilename,
      size: imageSvg.length,
      metadata: { calibration_override: { pixels_per_mm: 10 } },
    }],
    mockParts: [mockPart],
  });
  await page.route(`**/api/images/${imageId}/content`, (route) => route.fulfill({
    status: 200, contentType: 'image/svg+xml', body: imageSvg,
  }));
  await page.goto(`/project/${mocks.projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Inspection' }).click();
  const tile = page.getByAltText(`${imageFilename} view`);
  await expect(tile).toBeVisible();
  await expect.poll(() => tile.evaluate((element) => element.complete && element.naturalWidth)).toBe(1000);
  const annotations = () => mocks.getAnnotations()[mockPart.id] || [];
  return { ...mocks, tile, annotations, pageErrors };
}

// Visible image area of an <img> with object-fit: contain, after any modal
// entry animation has finished.
async function getRenderedImageBox(image) {
  await image.evaluate((element) => Promise.all(
    (element.closest('.modal') || element).getAnimations({ subtree: true }).map((animation) => animation.finished),
  ));
  return image.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const scale = Math.min(rect.width / element.naturalWidth, rect.height / element.naturalHeight);
    const width = element.naturalWidth * scale;
    const height = element.naturalHeight * scale;
    return {
      x: rect.left + ((rect.width - width) / 2),
      y: rect.top + ((rect.height - height) / 2),
      width,
      height,
    };
  });
}

async function drag(page, box, from, to) {
  await page.mouse.move(box.x + (box.width * from[0]), box.y + (box.height * from[1]));
  await page.mouse.down();
  await page.mouse.move(box.x + (box.width * to[0]), box.y + (box.height * to[1]), { steps: 8 });
  await page.mouse.up();
}

// Returns true when any measurement label's rendered box intersects its own line.
async function labelsOverlapLines(container) {
  return container.evaluate((root) => {
    const hits = [];
    root.querySelectorAll('.inspection-measurement-label').forEach((label) => {
      const line = label.parentElement.querySelector('line');
      if (!line) return;
      const box = label.getBBox();
      const x1 = Number(line.getAttribute('x1'));
      const y1 = Number(line.getAttribute('y1'));
      const x2 = Number(line.getAttribute('x2'));
      const y2 = Number(line.getAttribute('y2'));
      for (let step = 0; step <= 200; step += 1) {
        const t = step / 200;
        const x = x1 + ((x2 - x1) * t);
        const y = y1 + ((y2 - y1) * t);
        if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
          hits.push(label.textContent);
          return;
        }
      }
    });
    return hits;
  });
}

test.describe('Inspection annotation usability', () => {
  test('multiple image view: tools stay selected, one color, labels clear of lines', async ({ page }) => {
    const { tile, annotations, pageErrors } = await setup(page);
    const tileBox = await getRenderedImageBox(tile);

    const measure = page.getByRole('button', { name: 'Measure on tiles' });
    await measure.click();
    await drag(page, tileBox, [0.1, 0.8], [0.45, 0.2]); // up and to the right
    await expect.poll(() => annotations().length).toBe(1);
    await expect(measure).toHaveClass(/active/);
    await drag(page, tileBox, [0.55, 0.2], [0.9, 0.8]); // down and to the right
    await drag(page, tileBox, [0.5, 0.1], [0.5, 0.9]); // vertical
    await expect.poll(() => annotations().length).toBe(3);
    await expect(measure).toHaveClass(/active/);

    const drawBox = page.getByRole('button', { name: 'Draw box on tiles' });
    await drawBox.click();
    await drag(page, tileBox, [0.05, 0.05], [0.25, 0.3]);
    await drag(page, tileBox, [0.7, 0.6], [0.95, 0.95]);
    await expect.poll(() => annotations().length).toBe(5);
    await expect(drawBox).toHaveClass(/active/);

    const colors = annotations().map((annotation) => annotation.metadata?.annotation_color);
    expect(new Set(colors)).toEqual(new Set([NEW_ANNOTATION_COLOR]));

    const overlay = page.getByLabel('tile measurement overlay').first();
    expect(await labelsOverlapLines(overlay)).toEqual([]);
    await page.locator('section[aria-label="Inspection Workbench"]').screenshot({ path: shot('tile-sticky-tools-and-labels') });

    await page.keyboard.press('Escape');
    await expect(drawBox).not.toHaveClass(/active/);
    expect(pageErrors).toEqual([]);
  });

  test('single image view: sticky tools, anchors, labels, and selected list entry', async ({ page }) => {
    const { tile, annotations, pageErrors } = await setup(page);
    await tile.click();
    const modal = page.locator('.inspection-fullscreen-modal-content');
    const image = page.getByAltText(/fullscreen$/i);
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth)).toBe(1000);
    const imageBox = await getRenderedImageBox(image);

    await page.getByRole('button', { name: 'Measure', exact: true }).click();
    await drag(page, imageBox, [0.1, 0.85], [0.45, 0.15]); // up and to the right
    await expect.poll(() => annotations().length).toBe(1);
    await expect(page.getByRole('button', { name: 'Done Measuring' })).toHaveClass(/active/);
    await drag(page, imageBox, [0.6, 0.2], [0.9, 0.2]);
    await expect.poll(() => annotations().length).toBe(2);

    const drawBox = page.getByRole('button', { name: 'Draw box', exact: true });
    await drawBox.click();
    await drag(page, imageBox, [0.6, 0.5], [0.8, 0.8]);
    await drag(page, imageBox, [0.25, 0.55], [0.4, 0.9]);
    await expect.poll(() => annotations().length).toBe(4);
    await expect(drawBox).toHaveClass(/active/);
    const colors = annotations().map((annotation) => annotation.metadata?.annotation_color);
    expect(new Set(colors)).toEqual(new Set([NEW_ANNOTATION_COLOR]));
    await modal.screenshot({ path: shot('fullscreen-sticky-draw-box') });

    await page.keyboard.press('Escape');
    await expect(drawBox).not.toHaveClass(/active/);
    await expect(image).toBeVisible();

    const overlay = page.getByLabel('fullscreen measurement overlay');
    expect(await labelsOverlapLines(overlay)).toEqual([]);

    // Select the first measurement (the up-and-to-the-right line) to show its anchors.
    const list = page.getByTestId('fullscreen-annotation-list');
    const firstEntry = list.locator('li.inspection-fullscreen-annotation')
      .filter({ has: page.locator('.inspection-fullscreen-annotation-length', { hasText: /mm$/ }) })
      .filter({ hasNotText: 'Width' })
      .first();
    await firstEntry.locator('.inspection-fullscreen-annotation-body').click();
    await expect(firstEntry).toHaveClass(/selected/);
    await expect(firstEntry).toHaveAttribute('aria-current', 'true');
    const entryStyle = await firstEntry.evaluate((element) => {
      const style = getComputedStyle(element);
      return { boxShadow: style.boxShadow, background: style.backgroundColor };
    });
    expect(entryStyle.boxShadow).not.toBe('none');
    expect(entryStyle.background).not.toBe('rgb(255, 255, 255)');

    const handle = overlay.locator('.inspection-measurement-endpoint-dot').first();
    await expect(handle).toBeVisible();
    const handleStyle = await handle.evaluate((element) => ({
      fill: element.getAttribute('fill'),
      filter: getComputedStyle(element).filter,
      hasCenterDot: element.nextElementSibling?.classList.contains('inspection-anchor-center-dot') || false,
    }));
    expect(handleStyle).toEqual({ fill: 'transparent', filter: 'none', hasCenterDot: true });
    await modal.screenshot({ path: shot('fullscreen-anchors-and-selected-entry') });
    expect(pageErrors).toEqual([]);
  });
});
