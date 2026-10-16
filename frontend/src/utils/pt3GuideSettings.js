export const DEFAULT_PT3_3D_GUIDE_SETTINGS = Object.freeze({
  crosshair_transparency_percent: 50,
  crosshair_line_width_px: 1.25,
  plane_outline_transparency_percent: 0,
  plane_outline_line_width_px: 1.25,
});

export const PT3_3D_GUIDE_LIMITS = Object.freeze({
  transparencyPercent: Object.freeze({ min: 0, max: 100, step: 1 }),
  lineWidthPx: Object.freeze({ min: 0.5, max: 6, step: 0.25 }),
});

function normalizedFiniteNumber(value, fallback, minimum, maximum, { integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const bounded = Math.min(maximum, Math.max(minimum, value));
  return integer ? Math.round(bounded) : bounded;
}

export function normalizePt3GuideSettings(candidate = {}) {
  const source = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate
    : {};
  const transparencyLimits = PT3_3D_GUIDE_LIMITS.transparencyPercent;
  const widthLimits = PT3_3D_GUIDE_LIMITS.lineWidthPx;
  return {
    crosshair_transparency_percent: normalizedFiniteNumber(
      source.crosshair_transparency_percent,
      DEFAULT_PT3_3D_GUIDE_SETTINGS.crosshair_transparency_percent,
      transparencyLimits.min,
      transparencyLimits.max,
      { integer: true },
    ),
    crosshair_line_width_px: normalizedFiniteNumber(
      source.crosshair_line_width_px,
      DEFAULT_PT3_3D_GUIDE_SETTINGS.crosshair_line_width_px,
      widthLimits.min,
      widthLimits.max,
    ),
    plane_outline_transparency_percent: normalizedFiniteNumber(
      source.plane_outline_transparency_percent,
      DEFAULT_PT3_3D_GUIDE_SETTINGS.plane_outline_transparency_percent,
      transparencyLimits.min,
      transparencyLimits.max,
      { integer: true },
    ),
    plane_outline_line_width_px: normalizedFiniteNumber(
      source.plane_outline_line_width_px,
      DEFAULT_PT3_3D_GUIDE_SETTINGS.plane_outline_line_width_px,
      widthLimits.min,
      widthLimits.max,
    ),
  };
}

export function pt3TransparencyPercentToOpacity(transparencyPercent) {
  const limits = PT3_3D_GUIDE_LIMITS.transparencyPercent;
  const normalizedTransparency = normalizedFiniteNumber(
    transparencyPercent,
    0,
    limits.min,
    limits.max,
  );
  return 1 - normalizedTransparency / 100;
}

export function getPt3GuideAppearance(candidate = {}) {
  const settings = normalizePt3GuideSettings(candidate);
  return {
    settings,
    crosshairOpacity: pt3TransparencyPercentToOpacity(
      settings.crosshair_transparency_percent,
    ),
    crosshairLineWidthPx: settings.crosshair_line_width_px,
    planeOutlineOpacity: pt3TransparencyPercentToOpacity(
      settings.plane_outline_transparency_percent,
    ),
    planeOutlineLineWidthPx: settings.plane_outline_line_width_px,
  };
}
