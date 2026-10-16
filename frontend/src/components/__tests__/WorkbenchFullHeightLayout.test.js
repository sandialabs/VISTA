const fs = require('fs');
const path = require('path');

const appCss = fs.readFileSync(path.join(__dirname, '../../App.css'), 'utf8');

function cssRuleBody(selector) {
  const selectorIndex = appCss.indexOf(selector);
  expect(selectorIndex).toBeGreaterThanOrEqual(0);
  const bodyStart = appCss.indexOf('{', selectorIndex);
  const bodyEnd = appCss.indexOf('}', bodyStart);
  expect(bodyStart).toBeGreaterThan(selectorIndex);
  expect(bodyEnd).toBeGreaterThan(bodyStart);
  return appCss.slice(bodyStart + 1, bodyEnd);
}

describe('full-height workbench layout CSS contracts', () => {
  test('Analyze active tab keeps a viewport-backed graph height instead of collapsing', () => {
    expect(appCss).toMatch(
      /\.project-main-tab-shell\[data-active-main-tab="analyze"\][\s\S]*?min-height:\s*calc\(100vh - 180px\);/,
    );
    expect(appCss).toMatch(
      /\.project-main-panel\[data-active-main-tab="analyze"\][\s\S]*?min-height:\s*calc\(100vh - 180px\);/,
    );

    const graphBody = cssRuleBody('.project-main-panel[data-active-main-tab="analyze"] .analyze-graph');
    expect(graphBody).toMatch(/flex:\s*1;/);
    expect(graphBody).toMatch(/min-height:\s*max\(540px,\s*calc\(100vh - 340px\)\);/);
    expect(graphBody).not.toMatch(/min-height:\s*0\b/);
  });

  test('Inspection active tab keeps FlexLayout at a viewport-backed height instead of auto height', () => {
    expect(appCss).toMatch(
      /\.project-main-panel\[data-active-main-tab="inspection"\][\s\S]*?min-height:\s*calc\(100vh - 180px\);/,
    );

    const flexLayoutBody = cssRuleBody('.project-main-panel[data-active-main-tab="inspection"] .workbench-flexlayout-shell');
    expect(flexLayoutBody).toMatch(/flex:\s*1 1 auto;/);
    expect(flexLayoutBody).toMatch(
      /height:\s*max\(var\(--inspection-layout-min-height,\s*620px\),\s*calc\(100vh - 330px\)\);/,
    );
    expect(flexLayoutBody).toMatch(
      /min-height:\s*max\(var\(--inspection-layout-min-height,\s*620px\),\s*calc\(100vh - 330px\)\);/,
    );
    expect(flexLayoutBody).not.toMatch(/height:\s*auto\b/);
    expect(flexLayoutBody).not.toMatch(/min-height:\s*0\b/);
  });
});

describe('fullscreen 3D layout CSS contracts', () => {
  test('pins the close control to the upper-right corner and reserves header space for it', () => {
    const headerBody = cssRuleBody('.mpr-pane-volume-fullscreen .mpr-pane-header');
    const closeBody = cssRuleBody('.mpr-3d-fullscreen-close');

    expect(headerBody).toMatch(/padding:\s*0 50px 0 4px;/);
    expect(closeBody).toMatch(/position:\s*absolute;/);
    expect(closeBody).toMatch(/top:\s*8px;/);
    expect(closeBody).toMatch(/right:\s*8px;/);
    expect(closeBody).toMatch(/z-index:\s*12;/);
  });

  test('keeps the annotation rail below a wrapped header at intermediate widths', () => {
    const guardStart = appCss.indexOf('@media (min-width: 641px) and (max-width: 960px)');
    const nextBreakpoint = appCss.indexOf('@media (max-width: 640px)', guardStart);

    expect(guardStart).toBeGreaterThanOrEqual(0);
    expect(nextBreakpoint).toBeGreaterThan(guardStart);
    expect(appCss.slice(guardStart, nextBreakpoint)).toMatch(
      /\.mpr-pane-volume-fullscreen \.mpr-3d-annotation-list\s*\{[\s\S]*?top:\s*108px;/,
    );
  });

  test('moves the annotation rail below the three-row header at compact widths', () => {
    const compactGuardStart = appCss.indexOf('@media (max-width: 420px)');
    const nextRule = appCss.indexOf('.mpr-volume-overlay', compactGuardStart);
    const compactRailGuardStart = appCss.lastIndexOf('@media (max-width: 420px)');
    const compactRailGuardEnd = appCss.indexOf('.splat-config-modal', compactRailGuardStart);

    expect(compactGuardStart).toBeGreaterThanOrEqual(0);
    expect(nextRule).toBeGreaterThan(compactGuardStart);
    expect(appCss.slice(compactGuardStart, nextRule)).toMatch(
      /\.mpr-pane-volume-fullscreen \.mpr-3d-annotation-list\s*\{[\s\S]*?top:\s*144px;/,
    );
    expect(compactRailGuardStart).toBeGreaterThan(compactGuardStart);
    expect(compactRailGuardEnd).toBeGreaterThan(compactRailGuardStart);
    expect(appCss.slice(compactRailGuardStart, compactRailGuardEnd)).toMatch(
      /\.pt3-ray-march-controls,[\s\S]*?min-width:\s*0;[\s\S]*?width:\s*min\(180px,\s*calc\(55% - 8px\)\);/,
    );
    expect(appCss.slice(compactRailGuardStart, compactRailGuardEnd)).toMatch(
      /\.mpr-3d-annotation-list\s*\{[\s\S]*?width:\s*min\(150px,\s*calc\(45% - 20px\)\);/,
    );
  });

  test('aggregate part label on inspection tiles stays visible in the tile title', () => {
    // jsdom ignores stylesheets, so the render tests cannot catch a rule that hides
    // this label. Guard it here: a blanket small-element hide previously blanked the
    // part name on every All Images tile.
    expect(appCss).not.toMatch(/\.view-cell-title-text small:not\(/);

    const partLabelBody = cssRuleBody('.inspection-image-part-label');
    expect(partLabelBody).toMatch(/display:\s*block;/);
    expect(partLabelBody).not.toMatch(/display:\s*none;/);
  });
});
