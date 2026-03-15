import React from 'react';

/**
 * AnnotationToolbar
 * Simple toolbar with annotation mode controls.
 */
function AnnotationToolbar({
  annotationMode,
  onToggleAnnotationMode,
  bboxClasses,
  activeClassId,
  onActiveClassChange,
  showUserAnnotations,
  onToggleShowAnnotations
}) {
  const activeClass = bboxClasses.find(c => c.id === activeClassId);

  return (
    <div className="annotation-toolbar" style={{
      background: 'var(--bg-primary, #ffffff)',
      borderRadius: 'var(--radius-md, 8px)',
      border: '1px solid var(--border-light, #e2e8f0)',
      padding: '0.75rem',
      marginBottom: '0.75rem',
    }}>
      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', fontWeight: 600 }}>
        Annotation Tools
      </h4>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {/* Draw mode toggle */}
        <button
          onClick={onToggleAnnotationMode}
          style={{
            padding: '0.4rem 0.75rem',
            border: annotationMode
              ? '2px solid var(--primary-color, #2563eb)'
              : '1px solid var(--border-light, #e2e8f0)',
            borderRadius: 'var(--radius-sm, 6px)',
            background: annotationMode ? '#eff6ff' : 'var(--bg-secondary, #f8fafc)',
            color: annotationMode ? 'var(--primary-color, #2563eb)' : 'var(--gray-700, #334155)',
            fontWeight: 600,
            fontSize: '0.85rem',
            cursor: 'pointer',
            transition: 'all 150ms',
          }}
        >
          {annotationMode ? 'Done Drawing' : 'Draw Bounding Box'}
        </button>

        {/* Active class selector */}
        {bboxClasses.length > 0 && (
          <div>
            <label style={{ fontSize: '0.75rem', color: 'var(--gray-500, #64748b)', display: 'block', marginBottom: '2px' }}>
              Active Class
            </label>
            <select
              value={activeClassId || ''}
              onChange={(e) => onActiveClassChange(e.target.value)}
              style={{
                width: '100%',
                padding: '0.3rem 0.4rem',
                fontSize: '0.8rem',
                borderRadius: '4px',
                border: '1px solid var(--border-light, #e2e8f0)',
              }}
            >
              {bboxClasses.map(cls => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
            {activeClass && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                <span style={{
                  display: 'inline-block',
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: activeClass.color || '#4CAF50',
                  border: '1px solid #ccc',
                }} />
                <span style={{ fontSize: '0.75rem', color: 'var(--gray-500, #64748b)' }}>
                  {activeClass.color || '#4CAF50'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Show/hide annotations */}
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          fontSize: '0.8rem',
          cursor: 'pointer',
          userSelect: 'none',
        }}>
          <input
            type="checkbox"
            checked={showUserAnnotations}
            onChange={onToggleShowAnnotations}
            style={{ cursor: 'pointer' }}
          />
          Show annotations
        </label>
      </div>
    </div>
  );
}

export default AnnotationToolbar;
