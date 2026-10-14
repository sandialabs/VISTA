import React, { useEffect, useState } from 'react';
import MeasurementListItem from './MeasurementListItem';

export default function MeasurementList({
  measurements,
  calibration,
  onDeleteMeasurement,
  onRenameMeasurement,
  onToggleVisibility,
  visibleMeasurementIds,
  selectedMeasurementId,
  onSelectMeasurement,
  readOnly = false
}) {
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    if (readOnly) {
      setEditingId(null);
      setEditingName('');
    }
  }, [readOnly]);

  const handleStartRename = (measurement) => {
    if (readOnly) return;
    setEditingId(measurement.id);
    setEditingName(measurement.name);
  };

  const handleSaveRename = () => {
    if (readOnly) {
      setEditingId(null);
      setEditingName('');
      return;
    }
    if (editingName.trim() && onRenameMeasurement) {
      onRenameMeasurement(editingId, editingName.trim());
    }
    setEditingId(null);
    setEditingName('');
  };

  const handleCancelRename = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleDelete = (measurementId, measurementName) => {
    if (readOnly) return;
    if (window.confirm(`Delete measurement "${measurementName}"?`)) {
      if (onDeleteMeasurement) {
        onDeleteMeasurement(measurementId);
      }
    }
  };

  const handleExportCSV = () => {
    if (!measurements || measurements.length === 0) return;

    const headers = ['Name', 'Distance (pixels)', 'Distance (mm)', 'Distance (inches)', 'Created At'];
    const rows = measurements.map(m => {
      // Calculate distances dynamically from current calibration
      let distanceMm = '';
      let distanceInches = '';
      if (calibration && calibration.pixels_per_mm) {
        distanceMm = (m.distance_pixels / calibration.pixels_per_mm).toFixed(4);
        distanceInches = (m.distance_pixels / calibration.pixels_per_inch).toFixed(6);
      }
      return [
        m.name,
        m.distance_pixels?.toFixed(2) || '',
        distanceMm,
        distanceInches,
        m.created_at || ''
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `measurements-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const isVisible = (id) => {
    if (!visibleMeasurementIds) return true;
    return visibleMeasurementIds.includes(id);
  };

  const toggleExpanded = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  if (!measurements || measurements.length === 0) {
    return (
      <div style={{
        padding: '16px',
        borderBottom: '1px solid #e5e7eb',
        background: '#f9fafb'
      }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '600' }}>
          Measurements
        </h3>
        <div style={{
          padding: '12px',
          background: 'white',
          borderRadius: '4px',
          fontSize: '13px',
          color: '#6b7280',
          textAlign: 'center'
        }}>
          No measurements yet. Click "Measure" to start.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: '16px',
      borderBottom: '1px solid #e5e7eb',
      background: '#f9fafb'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px'
      }}>
        <h3
          style={{
            margin: 0,
            fontSize: '16px',
            fontWeight: '600',
            cursor: 'pointer',
            userSelect: 'none'
          }}
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          Measurements ({measurements.length}) {isCollapsed ? '+' : '-'}
        </h3>
        <button
          onClick={handleExportCSV}
          style={{
            padding: '4px 8px',
            fontSize: '12px',
            background: '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Export CSV
        </button>
      </div>

      {!isCollapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {measurements.map((measurement) => (
            <MeasurementListItem
              key={measurement.id}
              measurement={measurement}
              calibration={calibration}
              readOnly={readOnly}
              isSelected={selectedMeasurementId === measurement.id}
              isEditing={editingId === measurement.id}
              editingName={editingName}
              setEditingName={setEditingName}
              isExpanded={expandedId === measurement.id}
              isVisible={isVisible(measurement.id)}
              onStartRename={() => handleStartRename(measurement)}
              onSaveRename={handleSaveRename}
              onCancelRename={handleCancelRename}
              onDelete={() => handleDelete(measurement.id, measurement.name)}
              onToggleVisibility={() => onToggleVisibility && onToggleVisibility(measurement.id)}
              onToggleExpanded={() => toggleExpanded(measurement.id)}
              onMouseEnter={() => onSelectMeasurement && onSelectMeasurement(measurement.id)}
              onMouseLeave={() => onSelectMeasurement && onSelectMeasurement(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
