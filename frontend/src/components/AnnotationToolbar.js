import React from 'react';

/**
 * AnnotationToolbar
 * Annotation mode controls with quick-select class buttons.
 * Number keys 1-9 select a class and enter draw mode (handled in useAnnotations).
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

  const handleClassClick = (classId) => {
    onActiveClassChange(classId);
    if (!annotationMode) {
      onToggleAnnotationMode();
    }
  };

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

        {/* Quick class buttons -- one click enters draw mode for that class */}
        {bboxClasses.length > 0 && (
          <div>
            <label style={{
              fontSize: '0.75rem',
              color: 'var(--gray-500, #64748b)',
              display: 'block',
              marginBottom: '4px',
            }}>
              Quick Draw (press 1-{Math.min(9, bboxClasses.length)} or click)
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {bboxClasses.map((cls, idx) => {
                const isActive = activeClassId === cls.id && annotationMode;
                const hotkey = idx < 9 ? idx + 1 : null;
                return (
                  <button
                    key={cls.id}
                    onClick={() => handleClassClick(cls.id)}
                    title={`${cls.name}${hotkey ? ` (${hotkey})` : ''}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '3px 8px',
                      fontSize: '0.78rem',
                      fontWeight: isActive ? 700 : 500,
                      border: isActive
                        ? `2px solid ${cls.color || '#4CAF50'}`
                        : '1px solid var(--border-light, #e2e8f0)',
                      borderRadius: '4px',
                      background: isActive ? `${cls.color}18` : 'var(--bg-secondary, #f8fafc)',
                      cursor: 'pointer',
                      transition: 'all 100ms',
                    }}
                  >
                    <span style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      backgroundColor: cls.color || '#4CAF50',
                      border: '1px solid #ccc',
                      flexShrink: 0,
                    }} />
                    {hotkey && (
                      <span style={{
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        color: 'var(--gray-400, #94a3b8)',
                        minWidth: 12,
                        textAlign: 'center',
                      }}>
                        {hotkey}
                      </span>
                    )}
                    {cls.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Active class indicator (when in draw mode) */}
        {annotationMode && activeClass && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            background: `${activeClass.color}12`,
            borderRadius: '4px',
            fontSize: '0.78rem',
          }}>
            <span style={{
              display: 'inline-block',
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: activeClass.color || '#4CAF50',
              border: '1px solid #ccc',
            }} />
            Drawing: <strong>{activeClass.name}</strong>
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
