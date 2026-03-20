import React from 'react';

/**
 * AnnotationToolbar
 * Four interaction modes: Pan, Select, Draw, Measure.
 * Number keys 1-9 select a class and enter draw mode (handled in useAnnotations).
 * V/S enters select mode, B/D enters draw mode, M enters measure mode,
 * Escape returns to pan.
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
    {
      mode: 'measure',
      label: 'Measure',
      hint: 'M',
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="21" x2="21" y2="3"/>
          <line x1="3" y1="21" x2="3" y2="16"/>
          <line x1="3" y1="21" x2="8" y2="21"/>
          <line x1="21" y1="3" x2="21" y2="8"/>
          <line x1="21" y1="3" x2="16" y2="3"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="annotation-toolbar" style={{
      background: 'var(--bg-primary, #ffffff)',
      borderRadius: 'var(--radius-md, 8px)',
      border: '1px solid var(--border-light, #e2e8f0)',
      padding: '0.5rem',
      marginBottom: '0.5rem',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {/* Header row: title + show toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--gray-700, #334155)' }}>Tools</span>
          <label style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: '0.7rem', cursor: 'pointer', userSelect: 'none',
            color: 'var(--gray-500, #64748b)',
          }}>
            <input
              type="checkbox"
              checked={showUserAnnotations}
              onChange={onToggleShowAnnotations}
              style={{ cursor: 'pointer', width: 12, height: 12 }}
            />
            Show
          </label>
        </div>

        {/* Mode buttons - 2x2 grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px' }}>
          {modeButtons.map(({ mode, label, hint, icon }) => {
            const isActive = interactionMode === mode;
            const isDisabled = mode === 'draw' && bboxClasses.length === 0;
            return (
              <button
                key={mode}
                onClick={() => !isDisabled && onModeChange(mode)}
                disabled={isDisabled}
                title={isDisabled ? `${label} mode requires bbox classes` : `${label} mode (${hint})`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '3px',
                  padding: '0.25rem 0.4rem',
                  border: isActive
                    ? '2px solid var(--primary-color, #2563eb)'
                    : '1px solid var(--border-light, #e2e8f0)',
                  borderRadius: 'var(--radius-sm, 6px)',
                  background: isActive ? '#eff6ff' : 'var(--bg-secondary, #f8fafc)',
                  color: isDisabled ? 'var(--gray-400, #94a3b8)'
                    : isActive ? 'var(--primary-color, #2563eb)' : 'var(--gray-700, #334155)',
                  fontWeight: isActive ? 700 : 500,
                  fontSize: '0.75rem',
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  opacity: isDisabled ? 0.5 : 1,
                  transition: 'all 100ms',
                }}
              >
                {icon}
                {label}
                <span style={{ fontSize: '0.55rem', opacity: 0.5, fontWeight: 400 }}>{hint}</span>
              </button>
            );
          })}
        </div>

        {/* Active class selector (visible in draw mode) - compact */}
        {interactionMode === 'draw' && bboxClasses.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
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
                    gap: '3px',
                    padding: '2px 6px',
                    fontSize: '0.72rem',
                    fontWeight: isActive ? 700 : 500,
                    border: isActive
                      ? `2px solid ${cls.color || '#4CAF50'}`
                      : '1px solid var(--border-light, #e2e8f0)',
                    borderRadius: '3px',
                    background: isActive ? `${cls.color}18` : 'var(--bg-secondary, #f8fafc)',
                    cursor: 'pointer',
                    transition: 'all 100ms',
                  }}
                >
                  <span style={{
                    display: 'inline-block', width: 8, height: 8,
                    borderRadius: '50%', backgroundColor: cls.color || '#4CAF50',
                    flexShrink: 0,
                  }} />
                  {hotkey && (
                    <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--gray-400, #94a3b8)' }}>
                      {hotkey}
                    </span>
                  )}
                  {cls.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Delete selected - compact inline */}
        {selectedAnnotationId && onDeleteSelected && (
          <button
            onClick={onDeleteSelected}
            style={{
              padding: '2px 8px',
              border: '1px solid #fca5a5',
              borderRadius: '3px',
              background: '#fef2f2',
              color: '#dc2626',
              fontSize: '0.72rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Delete Selected (Del)
          </button>
        )}
      </div>
    </div>
  );
}

export default AnnotationToolbar;
