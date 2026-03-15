import React from 'react';

/**
 * AnnotationToolbar
 * Three interaction modes: Pan, Select, Draw.
 * Number keys 1-9 select a class and enter draw mode (handled in useAnnotations).
 * V/S enters select mode, B/D enters draw mode, Escape returns to pan.
 */
function AnnotationToolbar({
  interactionMode,
  onModeChange,
  bboxClasses,
  activeClassId,
  onActiveClassChange,
  showUserAnnotations,
  onToggleShowAnnotations,
  selectedAnnotationId,
  onDeleteSelected,
}) {
  const activeClass = bboxClasses.find(c => c.id === activeClassId);

  const handleClassClick = (classId) => {
    onActiveClassChange(classId);
    onModeChange('draw');
  };

  const modeButtons = [
    {
      mode: 'pan',
      label: 'Pan',
      hint: 'Esc',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v1M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v6"/>
          <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/>
          <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
        </svg>
      ),
    },
    {
      mode: 'select',
      label: 'Select',
      hint: 'V',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
          <path d="M13 13l6 6"/>
        </svg>
      ),
    },
    {
      mode: 'draw',
      label: 'Draw',
      hint: 'B',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 2"/>
          <line x1="12" y1="8" x2="12" y2="16"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      ),
    },
  ];

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
        {/* Mode buttons */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {modeButtons.map(({ mode, label, hint, icon }) => {
            const isActive = interactionMode === mode;
            return (
              <button
                key={mode}
                onClick={() => onModeChange(mode)}
                title={`${label} mode (${hint})`}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                  padding: '0.35rem 0.5rem',
                  border: isActive
                    ? '2px solid var(--primary-color, #2563eb)'
                    : '1px solid var(--border-light, #e2e8f0)',
                  borderRadius: 'var(--radius-sm, 6px)',
                  background: isActive ? '#eff6ff' : 'var(--bg-secondary, #f8fafc)',
                  color: isActive ? 'var(--primary-color, #2563eb)' : 'var(--gray-700, #334155)',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  transition: 'all 100ms',
                }}
              >
                {icon}
                {label}
                <span style={{
                  fontSize: '0.6rem',
                  opacity: 0.5,
                  fontWeight: 400,
                  marginLeft: '2px',
                }}>
                  {hint}
                </span>
              </button>
            );
          })}
        </div>

        {/* Active class indicator + class selector (visible in draw mode) */}
        {interactionMode === 'draw' && bboxClasses.length > 0 && (
          <div>
            <label style={{
              fontSize: '0.75rem',
              color: 'var(--gray-500, #64748b)',
              display: 'block',
              marginBottom: '4px',
            }}>
              Drawing class (press 1-{Math.min(9, bboxClasses.length)} or click)
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {bboxClasses.map((cls, idx) => {
                const isActive = activeClassId === cls.id;
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
            {activeClass && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                marginTop: '4px',
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
          </div>
        )}

        {/* Select mode hint */}
        {interactionMode === 'select' && (
          <div style={{
            fontSize: '0.75rem',
            color: 'var(--gray-500, #64748b)',
            padding: '4px 8px',
            background: 'var(--bg-secondary, #f8fafc)',
            borderRadius: '4px',
          }}>
            Click a box to select it. Tab/Shift+Tab to cycle.
            {selectedAnnotationId && ' Delete/Backspace to remove.'}
          </div>
        )}

        {/* Delete selected button (when something is selected) */}
        {selectedAnnotationId && onDeleteSelected && (
          <button
            onClick={onDeleteSelected}
            style={{
              padding: '0.3rem 0.6rem',
              border: '1px solid #fca5a5',
              borderRadius: 'var(--radius-sm, 6px)',
              background: '#fef2f2',
              color: '#dc2626',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Delete Selected (Del)
          </button>
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
