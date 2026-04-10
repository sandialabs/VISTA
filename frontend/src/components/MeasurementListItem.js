import React from 'react';

export default function MeasurementListItem({
  measurement,
  calibration,
  isSelected,
  isEditing,
  editingName,
  setEditingName,
  isExpanded,
  isVisible,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onDelete,
  onToggleVisibility,
  onToggleExpanded,
  onMouseEnter,
  onMouseLeave
}) {
  // Calculate real-world distances dynamically from pixels using current calibration
  const calculateDistances = () => {
    if (!calibration || !calibration.pixels_per_mm) {
      return { mm: null, inches: null };
    }
    const mm = measurement.distance_pixels / calibration.pixels_per_mm;
    const inches = measurement.distance_pixels / calibration.pixels_per_inch;
    return { mm, inches };
  };

  const formatDistance = () => {
    const distances = calculateDistances();
    if (distances.mm === null) {
      return `${measurement.distance_pixels.toFixed(1)} px`;
    }
    if (calibration.unit === 'inches') {
      return `${distances.inches.toFixed(3)}"`;
    }
    return `${distances.mm.toFixed(2)} mm`;
  };

  return (
    <div
      style={{
        padding: '12px',
        background: isSelected ? '#eff6ff' : 'white',
        borderRadius: '4px',
        border: isSelected ? '2px solid #3b82f6' : '1px solid #e5e7eb'
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {isEditing ? (
        <div>
          <input
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveRename();
              if (e.key === 'Escape') onCancelRename();
            }}
            autoFocus
            style={{
              width: '100%',
              padding: '6px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              fontSize: '13px',
              marginBottom: '8px'
            }}
          />
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={onSaveRename}
              style={{
                flex: 1,
                padding: '4px',
                fontSize: '12px',
                background: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Save
            </button>
            <button
              onClick={onCancelRename}
              style={{
                flex: 1,
                padding: '4px',
                fontSize: '12px',
                background: 'white',
                color: '#6b7280',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '8px'
          }}>
            <div
              style={{
                fontSize: '14px',
                fontWeight: '500',
                color: '#1f2937',
                cursor: 'pointer',
                flex: 1
              }}
              onClick={(e) => {
                e.stopPropagation();
                onStartRename();
              }}
            >
              {measurement.name}
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility();
                }}
                style={{
                  padding: '2px 6px',
                  fontSize: '11px',
                  background: 'transparent',
                  color: isVisible ? '#3b82f6' : '#9ca3af',
                  border: 'none',
                  cursor: 'pointer'
                }}
                title={isVisible ? 'Hide' : 'Show'}
              >
                {isVisible ? '●' : '○'}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                style={{
                  padding: '2px 6px',
                  fontSize: '11px',
                  background: 'transparent',
                  color: '#dc2626',
                  border: 'none',
                  cursor: 'pointer'
                }}
                title="Delete"
              >
                x
              </button>
            </div>
          </div>

          <div
            style={{
              padding: '8px',
              background: '#f3f4f6',
              borderRadius: '4px',
              fontSize: '13px',
              color: '#374151',
              cursor: 'pointer'
            }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpanded();
            }}
          >
            {formatDistance()}
            {isExpanded && (
              <div style={{
                marginTop: '4px',
                fontSize: '11px',
                color: '#9ca3af',
                fontStyle: 'italic'
              }}>
                Click to collapse
              </div>
            )}
          </div>

          {isExpanded && (
            <div style={{
              marginTop: '8px',
              padding: '8px',
              background: '#eff6ff',
              borderRadius: '4px',
              fontSize: '12px',
              color: '#1f2937',
              borderLeft: '3px solid #3b82f6'
            }}>
              <div style={{ fontWeight: '600', marginBottom: '8px' }}>Measurement Details</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#6b7280' }}>Start Point:</span>
                  <span style={{ fontFamily: 'monospace' }}>
                    ({measurement.x1?.toFixed(0)}, {measurement.y1?.toFixed(0)})
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#6b7280' }}>End Point:</span>
                  <span style={{ fontFamily: 'monospace' }}>
                    ({measurement.x2?.toFixed(0)}, {measurement.y2?.toFixed(0)})
                  </span>
                </div>

                <div style={{ height: '1px', background: '#cbd5e1', margin: '4px 0' }} />

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#6b7280' }}>Distance (pixels):</span>
                  <span style={{ fontFamily: 'monospace' }}>
                    {measurement.distance_pixels?.toFixed(2)} px
                  </span>
                </div>

                {(() => {
                  const distances = calculateDistances();
                  if (distances.mm === null) return null;
                  const useInches = calibration.unit === 'inches';
                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#6b7280' }}>
                        Distance ({useInches ? 'inches' : 'mm'}):
                      </span>
                      <span style={{ fontFamily: 'monospace' }}>
                        {useInches
                          ? `${distances.inches.toFixed(6)}"`
                          : `${distances.mm.toFixed(4)} mm`}
                      </span>
                    </div>
                  );
                })()}

                {measurement.created_at && (
                  <>
                    <div style={{ height: '1px', background: '#cbd5e1', margin: '4px 0' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#6b7280' }}>Created:</span>
                      <span style={{ fontSize: '11px' }}>
                        {new Date(measurement.created_at).toLocaleString()}
                      </span>
                    </div>
                  </>
                )}

                {measurement.created_by && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#6b7280' }}>Created By:</span>
                    <span style={{ fontSize: '11px' }}>
                      {measurement.created_by}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {!isExpanded && measurement.created_at && (
            <div style={{
              marginTop: '4px',
              fontSize: '11px',
              color: '#9ca3af'
            }}>
              {new Date(measurement.created_at).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
