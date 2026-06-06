import React, { useState, useEffect } from 'react';
import UserAnnotationPanel from './UserAnnotationPanel';
import MeasurementPanel from './MeasurementPanel';

/**
 * AnnotationMeasurementTabs
 * Tabbed container that shows either Annotations or Measurements.
 * Auto-switches tab based on interaction mode:
 *   draw/select -> Annotations tab
 *   measure     -> Measurements tab
 * Manual tab clicks override until mode changes again.
 */
function AnnotationMeasurementTabs({
  interactionMode,
  // UserAnnotationPanel props
  imageId, projectId, bboxClasses, annotations, onAnnotationsChange,
  selectedAnnotationId, onSelectAnnotation, hoveredAnnotationId, onHoverAnnotation,
  // MeasurementPanel props
  measurements, calibration, selectedMeasurementId, onSelectMeasurement,
  onDeleteMeasurement, onRenameMeasurement, onToggleVisibility, visibleMeasurementIds,
}) {
  const [activeTab, setActiveTab] = useState('annotations');

  // Auto-switch tab based on interaction mode
  useEffect(() => {
    if (interactionMode === 'measure') {
      setActiveTab('measurements');
    } else if (interactionMode === 'draw') {
      setActiveTab('annotations');
    }
    // In select mode, don't auto-switch -- both types are selectable
  }, [interactionMode]);

  // Auto-switch tab when an item is selected (e.g. via Tab cycling or canvas click)
  useEffect(() => {
    if (selectedAnnotationId) setActiveTab('annotations');
  }, [selectedAnnotationId]);

  useEffect(() => {
    if (selectedMeasurementId) setActiveTab('measurements');
  }, [selectedMeasurementId]);

  const annotationCount = annotations?.length || 0;
  const measurementCount = measurements?.length || 0;

  const tabs = [
    { id: 'annotations', label: 'Annotations', count: annotationCount },
    { id: 'measurements', label: 'Measurements', count: measurementCount },
  ];

  return (
    <div style={{
      background: 'var(--bg-primary, #ffffff)',
      borderRadius: 'var(--radius-md, 8px)',
      border: '1px solid var(--border-light, #e2e8f0)',
      marginBottom: '0.5rem',
      overflow: 'hidden',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-light, #e2e8f0)',
      }}>
        {tabs.map(({ id, label, count }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                flex: 1,
                padding: '0.3rem 0.4rem',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--primary-color, #2563eb)' : '2px solid transparent',
                background: isActive ? 'var(--bg-primary, #ffffff)' : 'var(--bg-secondary, #f8fafc)',
                color: isActive ? 'var(--primary-color, #2563eb)' : 'var(--gray-500, #64748b)',
                fontWeight: isActive ? 700 : 500,
                fontSize: '0.75rem',
                cursor: 'pointer',
                transition: 'all 100ms',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '3px',
              }}
            >
              {label}
              <span style={{
                fontSize: '0.65rem', fontWeight: 600,
                padding: '0 4px', borderRadius: '8px',
                background: isActive ? '#eff6ff' : '#f1f5f9',
                color: isActive ? 'var(--primary-color, #2563eb)' : 'var(--gray-400, #94a3b8)',
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tab content -- panels rendered inline without their own outer border */}
      <div className="annotation-measurement-tab-content">
        {activeTab === 'annotations' && (
          <UserAnnotationPanel
            imageId={imageId}
            projectId={projectId}
            bboxClasses={bboxClasses}
            annotations={annotations}
            onAnnotationsChange={onAnnotationsChange}
            selectedAnnotationId={selectedAnnotationId}
            onSelectAnnotation={onSelectAnnotation}
            hoveredAnnotationId={hoveredAnnotationId}
            onHoverAnnotation={onHoverAnnotation}
            embedded
          />
        )}
        {activeTab === 'measurements' && (
          <MeasurementPanel
            measurements={measurements}
            calibration={calibration}
            selectedMeasurementId={selectedMeasurementId}
            onSelectMeasurement={onSelectMeasurement}
            onDeleteMeasurement={onDeleteMeasurement}
            onRenameMeasurement={onRenameMeasurement}
            onToggleVisibility={onToggleVisibility}
            visibleMeasurementIds={visibleMeasurementIds}
            embedded
          />
        )}
      </div>
    </div>
  );
}

export default AnnotationMeasurementTabs;
