import {
  DEFAULT_PT3_3D_GUIDE_SETTINGS,
  getPt3GuideAppearance,
  normalizePt3GuideSettings,
  pt3TransparencyPercentToOpacity,
} from '../pt3GuideSettings';

describe('PT3 3D guide settings', () => {
  test('uses the shared Canvas locator appearance as the canonical legacy-config defaults', () => {
    expect(normalizePt3GuideSettings()).toEqual(DEFAULT_PT3_3D_GUIDE_SETTINGS);
    expect(getPt3GuideAppearance()).toEqual({
      settings: DEFAULT_PT3_3D_GUIDE_SETTINGS,
      crosshairOpacity: 0.5,
      crosshairLineWidthPx: 1.25,
      planeOutlineOpacity: 1,
      planeOutlineLineWidthPx: 1.25,
    });
  });

  test('preserves exact boundary values and converts transparency to opacity', () => {
    const settings = normalizePt3GuideSettings({
      crosshair_transparency_percent: 0,
      crosshair_line_width_px: 0.5,
      plane_outline_transparency_percent: 100,
      plane_outline_line_width_px: 6,
    });

    expect(settings).toEqual({
      crosshair_transparency_percent: 0,
      crosshair_line_width_px: 0.5,
      plane_outline_transparency_percent: 100,
      plane_outline_line_width_px: 6,
    });
    expect(pt3TransparencyPercentToOpacity(0)).toBe(1);
    expect(pt3TransparencyPercentToOpacity(25)).toBe(0.75);
    expect(pt3TransparencyPercentToOpacity(100)).toBe(0);
  });

  test('clamps finite out-of-range values and rounds transparency percentages', () => {
    expect(normalizePt3GuideSettings({
      crosshair_transparency_percent: -20,
      crosshair_line_width_px: 99,
      plane_outline_transparency_percent: 44.6,
      plane_outline_line_width_px: -3,
    })).toEqual({
      crosshair_transparency_percent: 0,
      crosshair_line_width_px: 6,
      plane_outline_transparency_percent: 45,
      plane_outline_line_width_px: 0.5,
    });
  });

  test.each([
    null,
    [],
    {
      crosshair_transparency_percent: '25',
      crosshair_line_width_px: true,
      plane_outline_transparency_percent: Number.NaN,
      plane_outline_line_width_px: Number.POSITIVE_INFINITY,
    },
  ])('falls back for malformed values without emitting unsafe numbers', (candidate) => {
    expect(normalizePt3GuideSettings(candidate)).toEqual(DEFAULT_PT3_3D_GUIDE_SETTINGS);
  });
});
