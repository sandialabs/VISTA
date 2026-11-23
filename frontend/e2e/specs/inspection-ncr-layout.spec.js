const path = require('path');
const { test, expect } = require('@playwright/test');
const { mockInspectionWorkbenchRoutes } = require('../fixtures/inspectionWorkbenchMocks');

const NCR_CONFIGURATION = {
  failure_codes: [{ code: 'FC-01', description: 'Porosity' }],
  disposition_codes: [{ code: 'RWK', description: 'Rework' }],
};

// Geometry checks standing in for screenshot review: each control must be
// visible, inside the viewport, not clipped by its pane, and not overlapping.
async function box(locator) {
  const result = await locator.boundingBox();
  expect(result, 'element should be laid out').not.toBeNull();
  return result;
}

function inside(inner, outer, slack = 1) {
  return inner.x >= outer.x - slack
    && inner.y >= outer.y - slack
    && inner.x + inner.width <= outer.x + outer.width + slack
    && inner.y + inner.height <= outer.y + outer.height + slack;
}

for (const viewport of [{ width: 1600, height: 1000 }, { width: 1280, height: 800 }]) {
  test(`NCR tab and form lay out cleanly at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const longComment = 'Very long unbroken text '.repeat(40) + 'X'.repeat(300);
    const { projectId } = await mockInspectionWorkbenchRoutes(page, {
      type: 'PT2',
      scenario: 'basic',
      mockConfiguration: {
        image_modalities: [{ id: 'visual', label: 'Visual', calibration_required: false }],
        part_views: [{ id: 'front', label: 'Front', required_modalities: ['visual'], source: 'manual' }],
        defect_types: [{ name: 'surface', color: '#ef4444', definition: '' }],
        process_settings: {
          require_disposition_on_submit: true,
          require_measurement_for_critical: false,
          require_second_reviewer_for_reject: false,
          configurable_hotkeys: { accept_classification: 'a', reject_classification: 'r', toggle_shortcut_help: 'h' },
        },
        display_settings: { default_colormap: 'grayscale', anomaly_colormap: 'viridis', grayscale_base_image: true },
        ncr_configuration: NCR_CONFIGURATION,
      },
    });
    const ncr = {
      id: 'n1', ncr_number: 1, ncr_label: 'NCR-0001', part_serial_number: 'SN', status: 'approved',
      comment: longComment, failure_code: 'FC-01', failure_code_description: 'Porosity',
      disposition_code: 'RWK', disposition_code_description: 'Rework',
      disposition_instructions: longComment, version: 2,
      created_by: 'a.very.long.inspector.email.address@example.com', created_at: '2026-11-13T10:00:00Z',
      updated_by: 'a.very.long.inspector.email.address@example.com', updated_at: '2026-11-13T10:00:00Z',
      approved_by: 'approver@example.com', approved_at: '2026-11-13T11:00:00Z',
    };
    const history = [
      { id: 'h1', version: 1, action: 'created', actor: ncr.created_by, at: ncr.created_at, changes: { comment: { from: null, to: longComment } } },
      { id: 'h2', version: 2, action: 'approved', actor: 'approver@example.com', at: ncr.approved_at, changes: { status: { from: 'open', to: 'approved' } } },
    ];
    await page.route(/\/api\/projects\/[^/]+\/parts\/[^/]+\/ncrs(\/n1)?$/, async (route) => {
      const url = route.request().url();
      if (url.endsWith('/n1')) return route.fulfill({ json: { ...ncr, history } });
      return route.fulfill({ json: { ncrs: [ncr] } });
    });

    await page.setViewportSize(viewport);
    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Inspection', exact: true }).click();

    const annotationsTab = page.locator('.flexlayout__tab_button').filter({ hasText: /^Annotations$/ });
    const ncrTab = page.locator('.flexlayout__tab_button').filter({ hasText: /^NCR$/ });
    const annotationsBox = await box(annotationsTab);
    const ncrTabBox = await box(ncrTab);
    // NCR tab sits immediately to the right of Annotations on the same strip.
    expect(Math.abs(ncrTabBox.y - annotationsBox.y)).toBeLessThan(4);
    expect(ncrTabBox.x).toBeGreaterThanOrEqual(annotationsBox.x + annotationsBox.width - 1);

    const annotationsPaneBox = await box(page.locator('[data-layout-region="annotations"]'));
    await ncrTab.click();
    const pane = page.getByRole('region', { name: 'Nonconformance reports' });
    await expect(pane).toBeVisible();
    const paneBox = await box(pane);
    // The page may scroll vertically; the pane must fit horizontally and
    // occupy exactly the slot the Annotations pane uses.
    expect(paneBox.x).toBeGreaterThanOrEqual(0);
    expect(paneBox.x + paneBox.width).toBeLessThanOrEqual(viewport.width + 1);
    for (const key of ['x', 'y', 'width', 'height']) {
      expect(Math.abs(paneBox[key] - annotationsPaneBox[key])).toBeLessThan(2);
    }

    const addButton = pane.getByRole('button', { name: 'Add NCR' });
    await expect(addButton).toBeVisible();
    expect(inside(await box(addButton), paneBox)).toBeTruthy();

    const entry = pane.getByRole('button', { name: 'View NCR-0001' });
    const badge = pane.getByTestId('ncr-status');
    const entryBox = await box(entry);
    const badgeBox = await box(badge);
    expect(inside(entryBox, paneBox)).toBeTruthy();
    expect(inside(badgeBox, paneBox)).toBeTruthy();
    // Badge does not overlap the entry text.
    expect(badgeBox.x).toBeGreaterThanOrEqual(entryBox.x + entryBox.width - 1);

    await entry.click();
    const detail = pane.getByRole('region', { name: 'NCR-0001 details' });
    await expect(detail.getByRole('region', { name: 'Change history' })).toBeVisible();
    // Long unbroken text wraps instead of widening the pane.
    const overflow = await pane.evaluate((el) => el.scrollWidth - el.clientWidth);
    if (overflow > 1) {
      const culprits = await pane.evaluate((el) => {
        const limit = el.getBoundingClientRect().right;
        return [...el.querySelectorAll('*')]
          .filter((child) => child.getBoundingClientRect().right > limit + 1)
          .slice(0, 8)
          .map((child) => `${child.tagName}.${child.className} w=${Math.round(child.getBoundingClientRect().width)}`);
      });
      console.log('overflowing:', culprits.join(' | '));
    }
    expect(overflow).toBeLessThanOrEqual(1);
    for (const name of ['Edit', 'Approved', 'Delete']) {
      const button = detail.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      const buttonBox = await box(button);
      expect(buttonBox.width).toBeGreaterThan(20);
      expect(inside(buttonBox, await box(detail))).toBeTruthy();
    }

    await detail.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit NCR-0001' });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500); // open animation slides up 20px
    const dialogBox = await box(dialog);
    expect(inside(dialogBox, { x: 0, y: 0, ...viewport })).toBeTruthy();
    const labels = ['Comment', 'Failure code', 'Disposition code', 'Disposition Instructions'];
    let previousBottom = -Infinity;
    for (const label of labels) {
      const field = dialog.getByLabel(label);
      await expect(field).toBeVisible();
      const fieldBox = await box(field);
      expect(fieldBox.width).toBeGreaterThan(150);
      expect(fieldBox.x + fieldBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);
      // Fields stack vertically without overlapping.
      expect(fieldBox.y).toBeGreaterThanOrEqual(previousBottom - 1);
      previousBottom = fieldBox.y + fieldBox.height;
    }
    const save = dialog.getByRole('button', { name: 'Save' });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeVisible();
    await expect(save).toBeInViewport();
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  });
}

test('NCR Configuration subtab lays out its two code lists', async ({ page }) => {
  const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT2', scenario: 'basic' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Project Configuration' }).click();
  const tabs = page.getByRole('tablist', { name: 'Configuration sections' }).getByRole('tab');
  const tabBoxes = [];
  for (let i = 0; i < await tabs.count(); i += 1) tabBoxes.push(await box(tabs.nth(i)));
  // Subtabs share a row (or wrap) without overlapping.
  for (let i = 1; i < tabBoxes.length; i += 1) {
    const prev = tabBoxes[i - 1];
    const cur = tabBoxes[i];
    const sameRow = Math.abs(cur.y - prev.y) < 4;
    if (sameRow) expect(cur.x).toBeGreaterThanOrEqual(prev.x + prev.width - 1);
  }
  await page.getByRole('tab', { name: 'NCR Configuration' }).click();
  const panel = page.getByRole('tabpanel', { name: 'NCR configuration' });
  await panel.getByRole('button', { name: 'Add Failure code' }).click();
  const code = page.getByLabel('Failure Codes code 1');
  const description = page.getByLabel('Failure Codes description 1');
  const remove = page.getByRole('button', { name: 'Remove failure code 1' });
  for (const locator of [code, description, remove]) await expect(locator).toBeVisible();
  const [codeBox, descriptionBox, removeBox] = [await box(code), await box(description), await box(remove)];
  expect(codeBox.width).toBeGreaterThan(60);
  expect(descriptionBox.width).toBeGreaterThan(60);
  const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps(codeBox, descriptionBox)).toBeFalsy();
  expect(overlaps(descriptionBox, removeBox)).toBeFalsy();
  const failures = await box(panel.getByRole('region', { name: 'Failure Codes' }));
  const dispositions = await box(panel.getByRole('region', { name: 'Disposition Codes' }));
  const sideBySide = Math.abs(dispositions.y - failures.y) < 2
    && dispositions.x >= failures.x + failures.width - 1;
  const stacked = dispositions.y >= failures.y + failures.height - 1;
  expect(sideBySide || stacked).toBeTruthy();
  expect(await panel.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});

test('switching between Annotations and NCR keeps a dragged splitter width', async ({ page }) => {
  const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT2', scenario: 'basic' });
  await page.route(/\/api\/projects\/[^/]+\/parts\/[^/]+\/ncrs$/, (route) => route.fulfill({ json: { ncrs: [] } }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Inspection', exact: true }).click();

  const rightPane = page.locator('[data-layout-region="annotations"]');
  await expect(rightPane).toBeVisible();
  const before = await box(rightPane);
  const splitters = page.locator('.flexlayout__splitter_vert, .flexlayout__splitter');
  const splitter = splitters.last();
  const splitterBox = await box(splitter);
  const startX = splitterBox.x + splitterBox.width / 2;
  const startY = splitterBox.y + splitterBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 120, startY, { steps: 8 });
  await page.mouse.up();
  const dragged = await box(rightPane);
  expect(dragged.width).toBeGreaterThan(before.width + 60);

  const ncrTab = page.locator('.flexlayout__tab_button').filter({ hasText: /^NCR$/ });
  await ncrTab.click();
  const ncrPane = page.getByRole('region', { name: 'Nonconformance reports' });
  await expect(ncrPane).toBeVisible();
  expect(Math.abs((await box(ncrPane)).width - dragged.width)).toBeLessThan(3);

  await page.locator('.flexlayout__tab_button').filter({ hasText: /^Annotations$/ }).click();
  await expect(rightPane).toBeVisible();
  expect(Math.abs((await box(rightPane)).width - dragged.width)).toBeLessThan(3);
});

test('Project Report shows a readable NCR table', async ({ page }) => {
  const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT2', scenario: 'basic' });
  const ncrs = [
    {
      ncr_id: 'n1', ncr_label: 'NCR-0001', part_identifier: 'SN-BASIC-001', status: 'approved',
      failure_code: 'FC-01', failure_code_description: 'Porosity',
      disposition_code: 'RWK', disposition_code_description: 'Rework',
      comment: 'Porosity cluster on the flange face, 3 pores over 0.5 mm.',
      disposition_instructions: 'Blend per WI-12 and re-inspect with FPI.',
      created_by: 'inspector@example.com', created_at: '2026-11-13T14:00:00Z',
      approved_by: 'approver@example.com', approved_at: '2026-11-13T15:00:00Z',
    },
    {
      ncr_id: 'n2', ncr_label: 'NCR-0002', part_identifier: 'SN-BASIC-001', status: 'open',
      failure_code: 'FC-02', failure_code_description: 'Crack',
      disposition_code: 'SCR', disposition_code_description: 'Scrap',
      comment: 'Linear indication near the bore.', disposition_instructions: 'Scrap the part.',
      created_by: 'inspector@example.com', created_at: '2026-11-13T16:00:00Z',
      approved_by: null, approved_at: null,
    },
  ];
  await page.route(/\/report-json\?schema_version=3$/, async (route) => {
    await route.fulfill({
      json: {
        schema_version: 3,
        project: { id: projectId, name: 'Inspection Workbench PT2', project_type: 'PT2', meta_group_id: 'qa-team' },
        summary: { total_parts: 1, reviewed_parts: 0, unreviewed_parts: 1, part_status_counts: { pass: 0, reject: 0, unreviewed: 1 } },
        parts: [{ part_id: 'part-basic-001', part_identifier: 'SN-BASIC-001', inspection_result: 'unreviewed' }],
        ncrs,
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Report', exact: true }).click();
  await page.getByLabel(/export\/report mode/i).selectOption('report_json');
  await page.getByRole('button', { name: /run export\/report/i }).click();
  const section = page.getByRole('region', { name: 'Nonconformance reports' });
  await expect(section.getByRole('table')).toBeVisible();
  await expect(section.getByRole('row')).toHaveCount(3);
  // Every column must get real width (a fixed-layout table previously
  // collapsed seven of the nine columns to zero).
  const headers = section.getByRole('columnheader');
  await expect(headers).toHaveCount(9);
  for (let i = 0; i < 9; i += 1) {
    expect((await box(headers.nth(i))).width).toBeGreaterThan(60);
  }
  const firstRow = section.getByRole('row').nth(1);
  await expect(firstRow).toContainText('FC-01 - Porosity');
  await expect(firstRow).toContainText('approver@example.com');
  expect((await box(firstRow)).height).toBeLessThan(140);
  await section.screenshot({ path: path.resolve(__dirname, '../../artifacts/ncr-project-report.png') });
  const wrap = section.locator('.inspection-record-table-wrap');
  expect(await wrap.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
});

test('adding a code row keeps the editor usable through autosave', async ({ page }) => {
  const { projectId, getSavedConfigurations } = await mockInspectionWorkbenchRoutes(page, { type: 'PT2', scenario: 'basic' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Project Configuration' }).click();
  await page.getByRole('tab', { name: 'NCR Configuration' }).click();
  const panel = page.getByRole('tabpanel', { name: 'NCR configuration' });
  const savesBefore = getSavedConfigurations().length;

  for (const [button, label] of [['Add Disposition code', 'Disposition Codes'], ['Add Failure code', 'Failure Codes']]) {
    await panel.getByRole('button', { name: button }).click();
    const codeInput = page.getByLabel(`${label} code 1`);
    // The new code field receives focus so the user can type immediately.
    await expect(codeInput).toBeFocused();
    // Wait well past the 500 ms autosave delay: the editor must remain.
    await page.waitForTimeout(1200);
    await expect(panel).toBeVisible();
    await expect(codeInput).toBeVisible();
    await expect(codeInput).toHaveAttribute('aria-invalid', 'true');
    await expect(panel.getByText('Enter a code.').first()).toBeVisible();
  }
  await page.screenshot({ path: path.resolve(__dirname, '../../artifacts/ncr-config-blank-rows.png') });
  // An incomplete row is not sent to the server.
  expect(getSavedConfigurations().length).toBe(savesBefore);

  await page.getByLabel('Disposition Codes code 1').fill('RWK');
  await page.getByLabel('Disposition Codes description 1').fill('Rework');
  await page.getByLabel('Failure Codes code 1').fill('FC-01');
  await expect(panel.getByText('Enter a code.')).toHaveCount(0);
  await expect.poll(() => getSavedConfigurations().some(({ payload }) => (
    payload.config.ncr_configuration?.disposition_codes?.[0]?.code === 'RWK'
      && payload.config.ncr_configuration?.failure_codes?.[0]?.code === 'FC-01'
  )), { timeout: 5000 }).toBeTruthy();
  await expect(page.getByText('Configuration autosaved.')).toBeVisible();
  await expect(page.getByTestId('configuration-validation-error')).toHaveCount(0);
  await page.screenshot({ path: path.resolve(__dirname, '../../artifacts/ncr-config-filled.png') });

  // An explicit save with a blank row reports the problem but keeps the editor.
  await panel.getByRole('button', { name: 'Add Failure code' }).click();
  await page.getByRole('button', { name: 'Save Configuration' }).click();
  await expect(page.getByTestId('configuration-validation-error')).toContainText('Each entry in Failure Codes requires a code.');
  await expect(panel).toBeVisible();
  await page.getByRole('button', { name: 'Remove failure code 2' }).click();
  await expect(page.getByTestId('configuration-validation-error')).toHaveCount(0);
});

test('Add NCR dialog sits above the project header and scrolls in short windows', async ({ page }) => {
  const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT2', scenario: 'basic' });
  await page.route(/\/api\/projects\/[^/]+\/parts\/[^/]+\/ncrs$/, (route) => route.fulfill({ json: { ncrs: [] } }));
  for (const viewport of [{ width: 1440, height: 760 }, { width: 1280, height: 600 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: 'Inspection', exact: true }).click();
    await page.locator('.flexlayout__tab_button').filter({ hasText: /^NCR$/ }).click();
    await page.getByRole('button', { name: 'Add NCR' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add NCR' });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500); // open animation slides up 20px
    // Rendered at the document root, outside the flexlayout pane.
    expect(await dialog.evaluate((el) => el.closest('.flexlayout__layout') === null)).toBe(true);
    const dialogBox = await box(dialog);
    expect(dialogBox.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height + 1);
    // The title is the topmost element at its position (not under the header).
    const title = dialog.getByRole('heading', { name: 'Add NCR' });
    const titleBox = await box(title);
    expect(await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return Boolean(el && el.closest('.ncr-editor-modal'));
    }, { x: titleBox.x + 5, y: titleBox.y + titleBox.height / 2 })).toBe(true);
    await expect(dialog.getByLabel('Comment')).toBeFocused();
    expect((await box(dialog.getByLabel('Comment'))).height).toBeGreaterThan(70);
    const save = dialog.getByRole('button', { name: 'Save' });
    await expect(save).toBeInViewport();
    await dialog.getByLabel('Disposition Instructions').scrollIntoViewIfNeeded();
    expect((await box(dialog.getByLabel('Disposition Instructions'))).height).toBeGreaterThan(70);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  }
});

test('NCR code rows are compact, aligned, and do not shift when typing', async ({ page }) => {
  const { projectId } = await mockInspectionWorkbenchRoutes(page, { type: 'PT2', scenario: 'basic' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/project/${projectId}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Project Configuration' }).click();
  await page.getByRole('tab', { name: 'NCR Configuration' }).click();
  const panel = page.getByRole('tabpanel', { name: 'NCR configuration' });
  const failures = panel.getByRole('region', { name: 'Failure Codes' });
  const dispositions = panel.getByRole('region', { name: 'Disposition Codes' });
  // Side by side and sharing the width evenly on a wide screen.
  const [fBox, dBox, panelBox] = [await box(failures), await box(dispositions), await box(panel)];
  expect(Math.abs(fBox.y - dBox.y)).toBeLessThan(2);
  expect(fBox.width + dBox.width).toBeGreaterThan(panelBox.width * 0.95);

  await failures.getByRole('button', { name: 'Add Failure code' }).click();
  const code = page.getByLabel('Failure Codes code 1');
  const description = page.getByLabel('Failure Codes description 1');
  const remove = page.getByRole('button', { name: 'Remove failure code 1' });
  const before = await box(code);
  // Label, inputs, and button share one row and one height.
  const [descBox, removeBox] = [await box(description), await box(remove)];
  for (const other of [descBox, removeBox]) {
    expect(Math.abs(other.y - before.y)).toBeLessThan(2);
    expect(Math.abs(other.height - before.height)).toBeLessThan(2);
  }
  expect(descBox.x - (before.x + before.width)).toBeLessThan(16);
  expect(removeBox.x - (descBox.x + descBox.width)).toBeLessThan(16);
  expect(before.height).toBeLessThan(40);
  // A fresh blank row is not painted as an error.
  expect(await code.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe('rgb(220, 38, 38)');

  await code.fill('FC-01');
  const after = await box(code);
  for (const key of ['x', 'y', 'width', 'height']) {
    expect(Math.abs(after[key] - before[key])).toBeLessThan(1);
  }
  // A duplicate is flagged in red, still without moving the field.
  await failures.getByRole('button', { name: 'Add Failure code' }).click();
  const second = page.getByLabel('Failure Codes code 2');
  await second.fill('fc-01');
  await expect(page.getByText('This code is already in the list.').first()).toBeVisible();
  await expect(second).toHaveClass(/is-invalid/);
  // .form-control animates border color; poll for the settled value.
  await expect.poll(() => second.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe('rgb(220, 38, 38)');
  expect(Math.abs((await box(page.getByLabel('Failure Codes code 1'))).x - before.x)).toBeLessThan(1);
  await page.locator('.project-configuration-panel').screenshot({
    path: path.resolve(__dirname, '../../artifacts/ncr-configuration-compact.png'),
  });
});
