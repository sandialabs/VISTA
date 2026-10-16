import React from 'react';

export default function ImageNavigationSettings({
  setSkipDeletedImages,
  skipDeletedImages,
}) {
  return (
    <div style={{
      marginTop: '1rem',
      padding: '0.75rem',
      background: 'var(--bg-secondary, #f8f9fa)',
      borderRadius: '6px',
      border: '1px solid var(--border-color, #dee2e6)'
    }}>
      <label style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: '0.9rem',
        cursor: 'pointer',
        userSelect: 'none'
      }}>
        <input
          type="checkbox"
          checked={skipDeletedImages}
          onChange={(event) => setSkipDeletedImages(event.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <span>Skip deleted images when navigating (arrow keys)</span>
      </label>
      <div style={{
        marginTop: '0.5rem',
        fontSize: '0.85rem',
        color: 'var(--text-muted, #6c757d)',
        paddingLeft: '1.5rem'
      }}>
        When enabled, arrow key navigation will automatically skip over soft-deleted images.
      </div>
    </div>
  );
}
