import React, { useMemo } from 'react';

export default function MeasurementOverlay({
  measurements,
  naturalSize,
  containerSize,
  calibration,
  selectedMeasurementId,
  visibleMeasurementIds,
  onSelectMeasurement,
  zoomLevel = 1
}) {
  const transformedMeasurements = useMemo(() => {
    if (!measurements || !measurements.length) return [];

    const scaleX = containerSize.width / naturalSize.width;
    const scaleY = containerSize.height / naturalSize.height;

    return measurements
      .filter(m => !visibleMeasurementIds || visibleMeasurementIds.includes(m.id))
      .map(m => ({
        ...m,
        displayX1: m.x1 * scaleX,
        displayY1: m.y1 * scaleY,
        displayX2: m.x2 * scaleX,
        displayY2: m.y2 * scaleY
      }));
  }, [measurements, naturalSize, containerSize, visibleMeasurementIds]);

  // Calculate real-world distances dynamically from pixels using current calibration
  const formatDistance = (measurement) => {
    if (!calibration || !calibration.pixels_per_mm) {
      return `${measurement.distance_pixels.toFixed(1)} px`;
    }
    if (calibration.unit === 'inches') {
      const inches = measurement.distance_pixels / calibration.pixels_per_inch;
      return `${inches.toFixed(3)}"`;
    }
    const mm = measurement.distance_pixels / calibration.pixels_per_mm;
    return `${mm.toFixed(2)} mm`;
  };

  if (!transformedMeasurements.length) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: containerSize.width,
        height: containerSize.height,
        pointerEvents: onSelectMeasurement ? 'auto' : 'none'
      }}
    >
      <svg
        width={containerSize.width}
        height={containerSize.height}
        style={{ display: 'block' }}
      >
        {transformedMeasurements.map((m, idx) => {
          const isSelected = selectedMeasurementId === m.id;
          const lineColor = '#3b82f6';
          const lineWidth = isSelected ? 3 : 2;
          const opacity = isSelected ? 1 : 0.8;

          // Calculate tooltip position with bounds checking
          const tooltipWidth = 170;
          const tooltipHeight = 40;
          const padding = 10;

          let centerX = (m.displayX1 + m.displayX2) / 2;
          let centerY = (m.displayY1 + m.displayY2) / 2;

          // Adjust X position if tooltip would be cut off
          let tooltipX = centerX - tooltipWidth / 2;
          if (tooltipX < padding) {
            tooltipX = padding;
          } else if (tooltipX + tooltipWidth > containerSize.width - padding) {
            tooltipX = containerSize.width - tooltipWidth - padding;
          }

          // Adjust Y position if tooltip would be cut off
          let tooltipY = centerY - tooltipHeight - 15; // Above the line by default
          if (tooltipY < padding) {
            tooltipY = centerY + 15; // Below the line if too close to top
          }
          if (tooltipY + tooltipHeight > containerSize.height - padding) {
            tooltipY = containerSize.height - tooltipHeight - padding;
          }

          return (
            <g key={m.id} opacity={opacity}
              style={{ cursor: onSelectMeasurement ? 'pointer' : 'default' }}
              onClick={onSelectMeasurement ? (e) => { e.stopPropagation(); onSelectMeasurement(m.id); } : undefined}
            >
              {/* Invisible wider hit area for easier clicking */}
              {onSelectMeasurement && (
                <line
                  x1={m.displayX1} y1={m.displayY1}
                  x2={m.displayX2} y2={m.displayY2}
                  stroke="transparent" strokeWidth={14}
                />
              )}
              <line
                x1={m.displayX1}
                y1={m.displayY1}
                x2={m.displayX2}
                y2={m.displayY2}
                stroke={lineColor}
                strokeWidth={lineWidth}
              />
              <circle
                cx={m.displayX1}
                cy={m.displayY1}
                r={4}
                fill={lineColor}
                stroke="white"
                strokeWidth={1}
              />
              <circle
                cx={m.displayX2}
                cy={m.displayY2}
                r={4}
                fill={lineColor}
                stroke="white"
                strokeWidth={1}
              />
              {isSelected && (() => {
                // Scale around the line's center point to keep tooltip anchored to measurement
                const scaleTransform = `translate(${centerX}, ${centerY}) scale(${1 / zoomLevel}) translate(${-centerX}, ${-centerY})`;

                return (
                  <g transform={scaleTransform}>
                    {/* Shadow for depth */}
                    <rect
                      x={tooltipX + 3}
                      y={tooltipY + 3}
                      width={tooltipWidth}
                      height={tooltipHeight}
                      fill="rgba(0, 0, 0, 0.3)"
                      rx="6"
                    />
                    {/* Main background */}
                    <rect
                      x={tooltipX}
                      y={tooltipY}
                      width={tooltipWidth}
                      height={tooltipHeight}
                      fill="#1f2937"
                      stroke="#3b82f6"
                      strokeWidth="2"
                      rx="6"
                    />
                    {/* Measurement name */}
                    <text
                      x={tooltipX + tooltipWidth / 2}
                      y={tooltipY + 15}
                      fill="white"
                      fontSize="13"
                      fontWeight="700"
                      textAnchor="middle"
                    >
                      {m.name}
                    </text>
                    {/* Distance value */}
                    <text
                      x={tooltipX + tooltipWidth / 2}
                      y={tooltipY + 30}
                      fill="#60a5fa"
                      fontSize="12"
                      fontWeight="600"
                      textAnchor="middle"
                    >
                      {formatDistance(m)}
                    </text>
                  </g>
                );
              })()}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
