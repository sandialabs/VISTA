import React from 'react';
import { PT3_3D_GUIDE_LIMITS, getPt3GuideAppearance } from '../../utils/pt3GuideSettings';

export const PT3_GUIDE_FIELDS = Object.freeze({
  crosshair_transparency_percent: Object.freeze({
    label: 'Crosshair transparency',
    limits: PT3_3D_GUIDE_LIMITS.transparencyPercent,
    unit: '%',
  }),
  crosshair_line_width_px: Object.freeze({
    label: 'Crosshair line width',
    limits: PT3_3D_GUIDE_LIMITS.lineWidthPx,
    unit: 'px',
  }),
  plane_outline_transparency_percent: Object.freeze({
    label: 'Plane outline transparency',
    limits: PT3_3D_GUIDE_LIMITS.transparencyPercent,
    unit: '%',
  }),
  plane_outline_line_width_px: Object.freeze({
    label: 'Plane outline line width',
    limits: PT3_3D_GUIDE_LIMITS.lineWidthPx,
    unit: 'px',
    description: 'The selected plane uses this width; the other planes use half for visual hierarchy.',
  }),
});

function formatPt3GuideValue(value, unit) {
  if (unit === '%') return `${Math.round(value)}%`;
  return `${Number(value).toFixed(2).replace(/\.?0+$/, '')} px`;
}

export function Pt3GuideRangeControl({ field, value, onChange }) {
  const definition = PT3_GUIDE_FIELDS[field];
  const controlId = `pt3-guide-${field.replaceAll('_', '-')}`;
  const descriptionId = definition.description ? `${controlId}-description` : undefined;
  return (
    <div className="pt3-guide-control">
      <span className="pt3-guide-control-heading">
        <label htmlFor={controlId}>{definition.label}</label>
        <output>{formatPt3GuideValue(value, definition.unit)}</output>
      </span>
      <input
        id={controlId}
        type="range"
        aria-label={definition.label}
        min={definition.limits.min}
        max={definition.limits.max}
        step={definition.limits.step}
        value={value}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(field, Number(event.target.value))}
      />
      {definition.description && (
        <small id={descriptionId} className="pt3-guide-control-note">
          {definition.description}
        </small>
      )}
    </div>
  );
}

export function Pt3GuidePreview({ settings }) {
  const appearance = getPt3GuideAppearance(settings);
  const inactivePlaneWidth = appearance.planeOutlineLineWidthPx / 2;
  return (
    <figure className="pt3-guide-preview">
      <svg
        viewBox="0 0 260 158"
        role="img"
        aria-label="Live 3D guide appearance preview"
        data-testid="pt3-guide-preview"
      >
        <title>Live 3D guide appearance preview</title>
        <desc>Three orthogonal slice planes and their shared crosshair.</desc>
        <defs>
          <linearGradient id="pt3-guide-preview-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#0f172a" />
            <stop offset="1" stopColor="#020617" />
          </linearGradient>
        </defs>
        <rect width="260" height="158" rx="12" fill="url(#pt3-guide-preview-bg)" />
        <path
          d="M53 43 L174 24 L218 61 L96 80 Z M53 43 L53 111 L96 139 L96 80 M96 139 L218 112 L218 61"
          fill="none"
          stroke="rgba(148,163,184,0.26)"
          strokeWidth="1"
        />
        <g
          fill="none"
          opacity={appearance.planeOutlineOpacity}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        >
          <path
            d="M62 72 L183 50 L211 73 L90 97 Z"
            stroke="#3b82f6"
            strokeWidth={appearance.planeOutlineLineWidthPx}
          />
          <path
            d="M81 40 L160 31 L160 121 L81 132 Z"
            stroke="#f59e0b"
            strokeWidth={inactivePlaneWidth}
          />
          <path
            d="M123 34 L199 66 L178 124 L103 91 Z"
            stroke="#10b981"
            strokeWidth={inactivePlaneWidth}
          />
        </g>
        <g
          fill="none"
          opacity={appearance.crosshairOpacity}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        >
          <path d="M62 83 L211 68" stroke="#3b82f6" strokeWidth={appearance.crosshairLineWidthPx} />
          <path d="M82 86 L188 77" stroke="#f59e0b" strokeWidth={appearance.crosshairLineWidthPx} />
          <path d="M136 37 L136 128" stroke="#10b981" strokeWidth={appearance.crosshairLineWidthPx} />
          <circle cx="136" cy="78" r="4.2" fill="#f8fafc" stroke="#020617" strokeWidth="2" />
        </g>
      </svg>
      <figcaption aria-live="polite">
        Crosshair {settings.crosshair_transparency_percent}% transparent
        <span aria-hidden="true"> · </span>
        Plane outlines {settings.plane_outline_transparency_percent}% transparent
      </figcaption>
    </figure>
  );
}
