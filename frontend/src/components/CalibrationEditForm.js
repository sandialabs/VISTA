import React, { useState } from 'react';

const MM_PER_INCH = 25.4;

export default function CalibrationEditForm({
  editUnit,
  setEditUnit,
  editPixelsPerUnit,
  setEditPixelsPerUnit,
  isLoading,
  onSaveProjectDefault,
  onSaveImageOverride,
  onSaveMetadataRule,
  imageMetadataKeys,
  onCancel
}) {
  const [selectedMetaKey, setSelectedMetaKey] = useState('');
  return (
    <div>
      <div style={{ marginBottom: '12px' }}>
        <label style={{
          display: 'block',
          fontSize: '13px',
          fontWeight: '500',
          marginBottom: '4px'
        }}>
          Pixels per:
        </label>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input
              type="radio"
              value="mm"
              checked={editUnit === 'mm'}
              onChange={(e) => setEditUnit(e.target.value)}
            />
            Millimeter
          </label>
          <label style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input
              type="radio"
              value="inches"
              checked={editUnit === 'inches'}
              onChange={(e) => setEditUnit(e.target.value)}
            />
            Inch
          </label>
        </div>
        <input
          type="number"
          step="any"
          value={editPixelsPerUnit}
          onChange={(e) => setEditPixelsPerUnit(e.target.value)}
          placeholder={`Enter pixels per ${editUnit}`}
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            fontSize: '14px'
          }}
        />
        {editPixelsPerUnit && !isNaN(parseFloat(editPixelsPerUnit)) && (
          <div style={{
            marginTop: '8px',
            fontSize: '12px',
            color: '#6b7280',
            padding: '8px',
            background: '#f3f4f6',
            borderRadius: '4px'
          }}>
            <div>
              = {editUnit === 'mm'
                ? (parseFloat(editPixelsPerUnit) * MM_PER_INCH).toFixed(2)
                : (parseFloat(editPixelsPerUnit) / MM_PER_INCH).toFixed(2)
              } px/{editUnit === 'mm' ? 'inch' : 'mm'}
            </div>
            <div>
              = {(1 / parseFloat(editPixelsPerUnit)).toFixed(6)} {editUnit}/px
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={onSaveProjectDefault}
          disabled={isLoading || !editPixelsPerUnit}
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: '13px',
            background: '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: editPixelsPerUnit && !isLoading ? 'pointer' : 'not-allowed',
            opacity: editPixelsPerUnit && !isLoading ? 1 : 0.5
          }}
        >
          {isLoading ? 'Saving...' : 'Save as Project Default'}
        </button>
        <button
          onClick={onSaveImageOverride}
          disabled={isLoading || !editPixelsPerUnit}
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: '13px',
            background: '#f59e0b',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: editPixelsPerUnit && !isLoading ? 'pointer' : 'not-allowed',
            opacity: editPixelsPerUnit && !isLoading ? 1 : 0.5
          }}
        >
          {isLoading ? 'Saving...' : 'Save for This Image Only'}
        </button>
      </div>

      {onSaveMetadataRule && imageMetadataKeys && imageMetadataKeys.length > 0 && (
        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: '13px', fontWeight: '500', marginBottom: '6px', color: '#374151' }}>
            Save for Matching Metadata
          </div>
          <select
            value={selectedMetaKey}
            onChange={e => setSelectedMetaKey(e.target.value)}
            style={{
              width: '100%',
              padding: '6px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              fontSize: '13px',
              marginBottom: '6px'
            }}
          >
            <option value="">Select metadata key...</option>
            {imageMetadataKeys.map(({ key, value }) => (
              <option key={key} value={key}>{key} = {String(value)}</option>
            ))}
          </select>
          {selectedMetaKey && (() => {
            const selectedEntry = imageMetadataKeys.find(e => e.key === selectedMetaKey);
            return (
              <button
                onClick={() => {
                  if (selectedEntry) onSaveMetadataRule(selectedEntry.key, selectedEntry.value);
                }}
                disabled={isLoading || !editPixelsPerUnit}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: '13px',
                  background: '#7c3aed',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: editPixelsPerUnit && !isLoading ? 'pointer' : 'not-allowed',
                  opacity: editPixelsPerUnit && !isLoading ? 1 : 0.5
                }}
              >
                {isLoading
                  ? 'Saving...'
                  : `Save for ${selectedMetaKey} = ${selectedEntry?.value}`}
              </button>
            );
          })()}
        </div>
      )}

      <button
        onClick={onCancel}
        disabled={isLoading}
        style={{
          width: '100%',
          marginTop: '8px',
          padding: '6px 12px',
          fontSize: '13px',
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
  );
}
