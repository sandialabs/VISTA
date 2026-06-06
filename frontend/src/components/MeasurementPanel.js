import React, { useState } from 'react';

/**
 * MeasurementPanel
 * Sidebar panel listing measurements for the current image.
 * Follows UserAnnotationPanel pattern for layout and interaction.
 */
function MeasurementPanel({
  measurements,
  calibration,
  selectedMeasurementId,
  onSelectMeasurement,
  onDeleteMeasurement,
  onRenameMeasurement,
  onToggleVisibility,
  visibleMeasurementIds,
  embedded,
}) {
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const isVisible = (id) => {
    if (!visibleMeasurementIds) return true;
    return visibleMeasurementIds.includes(id);
  };

  const formatDistance = (m) => {
    if (!calibration || !calibration.pixels_per_mm) {
      return `${m.distance_pixels.toFixed(1)} px`;
    }
    const mm = m.distance_pixels / calibration.pixels_per_mm;
    return `${mm.toFixed(2)} mm`;
  };

  const handleStartRename = (m) => {
    setEditingId(m.id);
    setEditingName(m.name);
  };

  const handleSaveRename = () => {
    if (editingName.trim() && onRenameMeasurement) {
      onRenameMeasurement(editingId, editingName.trim());
    }
    setEditingId(null);
    setEditingName('');
  };

  const handleDelete = (id, name) => {
    if (window.confirm(`Delete measurement "${name}"?`)) {
      if (onDeleteMeasurement) onDeleteMeasurement(id);
    }
  };

  const handleExportCSV = () => {
    if (!measurements || measurements.length === 0) return;
    const headers = ['Name', 'Distance (pixels)', 'Distance (mm)', 'Distance (inches)', 'Created At'];
    const rows = measurements.map(m => {
      let distMm = '';
      let distIn = '';
      if (calibration && calibration.pixels_per_mm) {
        distMm = (m.distance_pixels / calibration.pixels_per_mm).toFixed(4);
        distIn = (m.distance_pixels / calibration.pixels_per_inch).toFixed(6);
      }
      return [m.name, m.distance_pixels?.toFixed(2) || '', distMm, distIn, m.created_at || ''];
    });
    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `measurements-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="measurement-panel" style={embedded ? { padding: '4px 6px' } : {
      background: 'var(--bg-primary, #ffffff)',
      borderRadius: 'var(--radius-md, 8px)',
      border: '1px solid var(--border-light, #e2e8f0)',
      padding: '0.5rem',
      marginBottom: '0.5rem',
    }}>
      {/* Only show heading when not embedded (tab already shows count) */}
      {!embedded && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '4px',
        }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Measurements</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {measurements.length > 0 && (
              <button onClick={handleExportCSV} title="Export CSV" style={{
                padding: '1px 5px', fontSize: '0.6rem', background: 'none',
                border: '1px solid var(--border-light, #e2e8f0)',
                borderRadius: '3px', color: 'var(--gray-500, #64748b)', cursor: 'pointer',
              }}>CSV</button>
            )}
            <span style={{ fontSize: '0.68rem', color: 'var(--gray-500, #64748b)' }}>
              {measurements.length}
            </span>
          </div>
        </div>
      )}

      {/* CSV export when embedded - just a small button */}
      {embedded && measurements.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2px' }}>
          <button onClick={handleExportCSV} title="Export CSV" style={{
            padding: '1px 5px', fontSize: '0.6rem', background: 'none',
            border: '1px solid var(--border-light, #e2e8f0)',
            borderRadius: '3px', color: 'var(--gray-500, #64748b)', cursor: 'pointer',
          }}>CSV</button>
        </div>
      )}

      {measurements.length === 0 && (
        <div style={{
          fontSize: '0.72rem', color: 'var(--gray-400, #94a3b8)',
          textAlign: 'center', padding: '0.3rem',
        }}>
          No measurements yet. Press M to measure.
        </div>
      )}

      <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
        {measurements.map((m) => {
          const isSelected = selectedMeasurementId === m.id;
          const visible = isVisible(m.id);
          const lineColor = '#3b82f6';
          const isEditing = editingId === m.id;

          return (
            <div
              key={m.id}
              onMouseEnter={() => onSelectMeasurement && onSelectMeasurement(m.id)}
              onMouseLeave={() => onSelectMeasurement && onSelectMeasurement(null)}
              style={{
                padding: '0.35rem 0.5rem',
                marginBottom: '0.25rem',
                borderRadius: '4px',
                border: isSelected
                  ? `2px solid ${lineColor}`
                  : '1px solid var(--border-light, #e2e8f0)',
                background: isSelected ? `${lineColor}10` : 'transparent',
                opacity: visible ? 1 : 0.4,
                cursor: 'pointer',
                fontSize: '0.8rem',
                transition: 'border 100ms, background 100ms',
              }}
            >
              {isEditing ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename();
                      if (e.key === 'Escape') { setEditingId(null); setEditingName(''); }
                    }}
                    autoFocus
                    style={{ fontSize: '0.72rem', width: '100%', padding: '2px 4px' }}
                  />
                  <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                    <button
                      onClick={handleSaveRename}
                      style={{ fontSize: '0.65rem', padding: '1px 6px', cursor: 'pointer' }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setEditingId(null); setEditingName(''); }}
                      style={{ fontSize: '0.65rem', padding: '1px 6px', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{
                      display: 'inline-block',
                      width: 10,
                      height: 2,
                      backgroundColor: lineColor,
                      flexShrink: 0,
                    }} />
                    <span style={{ fontWeight: 600, flex: 1 }}>
                      {m.name}
                    </span>
                    <span style={{
                      fontSize: '0.72rem',
                      color: 'var(--gray-500, #64748b)',
                      fontFamily: 'monospace',
                    }}>
                      {formatDistance(m)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', marginLeft: 'auto' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleVisibility && onToggleVisibility(m.id); }}
                      style={{
                        fontSize: '0.65rem', background: 'none', border: 'none',
                        color: visible ? lineColor : '#94a3b8', cursor: 'pointer', padding: 0,
                      }}
                      title={visible ? 'Hide' : 'Show'}
                    >
                      {visible ? 'visible' : 'hidden'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStartRename(m); }}
                      style={{
                        fontSize: '0.65rem', background: 'none', border: 'none',
                        color: 'var(--primary-color, #2563eb)', cursor: 'pointer',
                        padding: 0, textDecoration: 'underline',
                      }}
                    >
                      Rename
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(m.id, m.name); }}
                      style={{
                        background: 'none', border: 'none',
                        color: '#dc2626', cursor: 'pointer',
                        fontSize: '0.7rem', padding: '1px 4px',
                      }}
                      title="Delete measurement"
                    >
                      Del
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MeasurementPanel;
