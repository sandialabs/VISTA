import React from 'react';

export default function MeasurementSaveDialog({
  measurementName,
  setMeasurementName,
  validationError,
  setValidationError,
  formattedDistance,
  onSave,
  onCancel
}) {
  return (
    <div
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: 'white',
        padding: '24px',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        minWidth: '350px',
        zIndex: 2000
      }}
    >
      <h3 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>Save Measurement</h3>

      <div style={{ marginBottom: '16px' }}>
        <div style={{
          padding: '12px',
          background: '#f3f4f6',
          borderRadius: '4px',
          fontSize: '14px',
          color: '#374151'
        }}>
          {formattedDistance}
        </div>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{
          display: 'block',
          fontSize: '13px',
          fontWeight: '500',
          marginBottom: '4px',
          color: '#374151'
        }}>
          Measurement Name
        </label>
        <input
          type="text"
          value={measurementName}
          onChange={(e) => {
            setMeasurementName(e.target.value);
            if (validationError) setValidationError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onSave();
            }
          }}
          placeholder="Enter name"
          autoFocus
          style={{
            width: '100%',
            padding: '8px',
            border: validationError ? '1px solid #dc2626' : '1px solid #d1d5db',
            borderRadius: '4px',
            fontSize: '14px'
          }}
        />
        {validationError && (
          <div style={{
            marginTop: '4px',
            fontSize: '12px',
            color: '#dc2626'
          }}>
            {validationError}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={onSave}
          style={{
            flex: 1,
            padding: '10px',
            background: '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          Save
        </button>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '10px',
            background: 'white',
            color: '#6b7280',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          Cancel
        </button>
      </div>

      <div style={{
        marginTop: '12px',
        fontSize: '12px',
        color: '#9ca3af',
        textAlign: 'center'
      }}>
        Press Enter to save, Escape to cancel
      </div>
    </div>
  );
}
