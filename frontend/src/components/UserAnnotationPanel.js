import React, { useState, useEffect, useCallback } from 'react';

/**
 * UserAnnotationPanel
 * Sidebar panel listing user annotations for the current image.
 * Follows ReviewPanel.js pattern for layout and state management.
 */
function UserAnnotationPanel({
  imageId,
  projectId,
  bboxClasses,
  annotations: externalAnnotations,
  onAnnotationsChange,
  selectedAnnotationId,
  onSelectAnnotation,
  hoveredAnnotationId,
  onHoverAnnotation,
  embedded,
}) {
  const [localAnnotations, setLocalAnnotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingNotes, setEditingNotes] = useState({});
  const [reclassifying, setReclassifying] = useState(null);

  // Use externally provided annotations when available, fall back to local fetch
  const annotations = externalAnnotations || localAnnotations;

  const loadAnnotations = useCallback(async () => {
    if (!imageId) return;
    if (externalAnnotations) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/images/${imageId}/user-annotations`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setLocalAnnotations(data);
    } catch (err) {
      console.error('Failed to load annotations:', err);
      setError('Failed to load annotations');
    } finally {
      setLoading(false);
    }
  }, [imageId, externalAnnotations]);

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  const handleDelete = async (annotationId) => {
    if (!window.confirm('Delete this annotation?')) return;
    try {
      const response = await fetch(`/api/user-annotations/${annotationId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await loadAnnotations();
      if (onAnnotationsChange) onAnnotationsChange();
      if (selectedAnnotationId === annotationId && onSelectAnnotation) {
        onSelectAnnotation(null);
      }
    } catch (err) {
      console.error('Failed to delete annotation:', err);
      setError('Failed to delete annotation');
    }
  };

  const handleNotesUpdate = async (annotationId) => {
    const notes = editingNotes[annotationId];
    if (notes === undefined) return;
    try {
      const response = await fetch(`/api/user-annotations/${annotationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setEditingNotes(prev => {
        const next = { ...prev };
        delete next[annotationId];
        return next;
      });
      await loadAnnotations();
      if (onAnnotationsChange) onAnnotationsChange();
    } catch (err) {
      console.error('Failed to update notes:', err);
      setError('Failed to update notes');
    }
  };

  const handleReclassify = async (annotationId, newClassId) => {
    try {
      const response = await fetch(`/api/user-annotations/${annotationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox_class_id: newClassId }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setReclassifying(null);
      await loadAnnotations();
      if (onAnnotationsChange) onAnnotationsChange();
    } catch (err) {
      console.error('Failed to reclassify annotation:', err);
      setError('Failed to reclassify annotation');
    }
  };

  return (
    <div className="user-annotation-panel" style={embedded ? { padding: '4px 6px' } : {
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
          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Annotations</span>
          <span style={{ fontSize: '0.68rem', color: 'var(--gray-500, #64748b)' }}>
            {loading ? '...' : `${annotations.length}`}
          </span>
        </div>
      )}

      {error && (
        <div style={{
          padding: '3px 6px', marginBottom: '4px',
          background: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: '3px', fontSize: '0.72rem', color: '#dc2626',
        }}>
          {error}
          <button onClick={() => setError(null)} style={{
            float: 'right', background: 'none', border: 'none',
            cursor: 'pointer', fontSize: '0.8rem', color: '#dc2626',
          }} aria-label="Dismiss error">x</button>
        </div>
      )}

      {!loading && annotations.length === 0 && (
        <div style={{
          fontSize: '0.72rem', color: 'var(--gray-400, #94a3b8)',
          textAlign: 'center', padding: '0.3rem',
        }}>
          No annotations yet. Press B to draw.
        </div>
      )}

      <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
        {annotations.map((ann) => {
          const isSelected = selectedAnnotationId === ann.id;
          const isHovered = hoveredAnnotationId === ann.id;
          const color = ann.class_color || '#4CAF50';
          const isEditingNotes = editingNotes[ann.id] !== undefined;
          const highlighted = isSelected || isHovered;

          return (
            <div
              key={ann.id}
              onClick={() => onSelectAnnotation && onSelectAnnotation(ann.id)}
              onMouseEnter={() => onHoverAnnotation && onHoverAnnotation(ann.id)}
              onMouseLeave={() => onHoverAnnotation && onHoverAnnotation(null)}
              style={{
                padding: '0.35rem 0.5rem',
                marginBottom: '0.25rem',
                borderRadius: '4px',
                border: highlighted
                  ? `2px solid ${color}`
                  : '1px solid var(--border-light, #e2e8f0)',
                background: highlighted ? `${color}10` : 'transparent',
                cursor: 'pointer',
                fontSize: '0.8rem',
                transition: 'border 100ms, background 100ms',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  backgroundColor: color,
                  flexShrink: 0,
                }} />
                <span style={{ fontWeight: 600, flex: 1 }}>
                  {ann.class_name || 'Unknown'}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(ann.id); }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#dc2626',
                    cursor: 'pointer',
                    fontSize: '0.7rem',
                    padding: '1px 4px',
                  }}
                  title="Delete annotation"
                >
                  Del
                </button>
              </div>

              {/* Reclassify dropdown */}
              {reclassifying === ann.id ? (
                <div style={{ marginTop: '3px' }} onClick={(e) => e.stopPropagation()}>
                  <select
                    value={ann.bbox_class_id || ''}
                    onChange={(e) => handleReclassify(ann.id, e.target.value)}
                    style={{ fontSize: '0.72rem', width: '100%', padding: '2px' }}
                  >
                    {bboxClasses.map(cls => (
                      <option key={cls.id} value={cls.id}>{cls.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={(e) => { e.stopPropagation(); setReclassifying(null); }}
                    style={{ fontSize: '0.65rem', marginTop: '2px', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  {/* Inline notes editing */}
                  {isEditingNotes ? (
                    <div style={{ marginTop: '3px' }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editingNotes[ann.id] || ''}
                        onChange={(e) => setEditingNotes(prev => ({ ...prev, [ann.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleNotesUpdate(ann.id); }}
                        style={{ fontSize: '0.72rem', width: '100%', padding: '2px 4px' }}
                        placeholder="Add notes..."
                      />
                      <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                        <button
                          onClick={() => handleNotesUpdate(ann.id)}
                          style={{ fontSize: '0.65rem', padding: '1px 6px', cursor: 'pointer' }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingNotes(prev => { const n = { ...prev }; delete n[ann.id]; return n; })}
                          style={{ fontSize: '0.65rem', padding: '1px 6px', cursor: 'pointer' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                      {ann.notes && (
                        <span style={{ fontSize: '0.68rem', color: 'var(--gray-600, #475569)', flex: 1 }}>
                          {ann.notes}
                        </span>
                      )}
                      <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); setReclassifying(ann.id); }}
                          style={{
                            fontSize: '0.65rem', background: 'none', border: 'none',
                            color: 'var(--primary-color, #2563eb)', cursor: 'pointer',
                            padding: 0, textDecoration: 'underline',
                          }}
                        >
                          Reclassify
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingNotes(prev => ({ ...prev, [ann.id]: ann.notes || '' }));
                          }}
                          style={{
                            fontSize: '0.65rem', background: 'none', border: 'none',
                            color: 'var(--primary-color, #2563eb)', cursor: 'pointer',
                            padding: 0, textDecoration: 'underline',
                          }}
                        >
                          {ann.notes ? 'Edit notes' : 'Add notes'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default UserAnnotationPanel;
