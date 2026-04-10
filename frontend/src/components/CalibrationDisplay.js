import React from 'react';

function formatCalibration(cal) {
  if (!cal) return null;
  const useInches = cal.unit === 'inches';
  const pxPerUnit = useInches ? cal.pixels_per_inch : cal.pixels_per_mm;
  const unitLabel = useInches ? 'inch' : 'mm';
  return (
    <div style={{ fontSize: '14px', color: '#4b5563' }}>
      <div>{pxPerUnit.toFixed(2)} px/{unitLabel}</div>
      <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
        ({(1 / pxPerUnit).toFixed(4)} {unitLabel}/px)
      </div>
    </div>
  );
}

export default function CalibrationDisplay({
  calibration,
  isImageOverride,
  matchedRule,
  isLoading,
  onClearOverride,
  onDeleteMetadataRule,
  onStartEdit
}) {
  if (!calibration) {
    return (
      <div>
        <div style={{
          padding: '12px',
          background: '#fef3c7',
          color: '#92400e',
          borderRadius: '4px',
          fontSize: '13px',
          marginBottom: '12px'
        }}>
          No calibration set. Set calibration to enable measurements.
        </div>
        <button
          onClick={onStartEdit}
          style={{
            padding: '8px 12px',
            fontSize: '14px',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            width: '100%'
          }}
        >
          Set Calibration
        </button>
      </div>
    );
  }

  const statusColor = isImageOverride ? '#d97706' : matchedRule ? '#7c3aed' : '#059669';
  const statusLabel = isImageOverride
    ? 'Using image-specific calibration'
    : matchedRule
      ? `Using metadata rule: ${matchedRule.metadata_key} = ${matchedRule.metadata_value}`
      : 'Using project default calibration';

  const actionButtonStyle = {
    padding: '6px 12px',
    fontSize: '13px',
    background: 'white',
    color: '#dc2626',
    border: '1px solid #dc2626',
    borderRadius: '4px',
    cursor: 'pointer',
    width: '100%'
  };

  return (
    <div>
      <div style={{
        padding: '8px',
        background: 'white',
        borderRadius: '4px',
        marginBottom: '8px'
      }}>
        {formatCalibration(calibration)}
      </div>
      <div style={{
        fontSize: '12px',
        color: statusColor,
        fontWeight: '500',
        marginBottom: '8px'
      }}>
        {statusLabel}
      </div>
      {isImageOverride && (
        <button
          onClick={onClearOverride}
          disabled={isLoading}
          style={actionButtonStyle}
        >
          {isLoading ? 'Clearing...' : 'Clear Image Override'}
        </button>
      )}
      {matchedRule && !isImageOverride && (
        <button
          onClick={onDeleteMetadataRule}
          disabled={isLoading}
          style={actionButtonStyle}
        >
          {isLoading ? 'Removing...' : 'Remove Metadata Rule'}
        </button>
      )}
    </div>
  );
}
