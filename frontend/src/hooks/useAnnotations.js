import { useState, useCallback, useEffect } from 'react';

/**
 * Custom hook encapsulating user annotation state and handlers.
 *
 * Interaction modes:
 *   'pan'    -- default: left-click pans the image
 *   'select' -- left-click selects/resizes existing annotations
 *   'draw'   -- left-click draws new bounding boxes
 *
 * Hotkeys (active when not focused on an input):
 *   V / S         Enter select mode
 *   B / D         Enter draw mode (with active class)
 *   1-9           Select bbox class N and enter draw mode
 *   Tab           Select next annotation on current image
 *   Shift+Tab     Select previous annotation
 *   Delete/Bksp   Delete selected annotation
 *   Escape        Deselect annotation -> exit mode -> pan
 */
function useAnnotations(imageId, projectId, setError) {
  const [interactionMode, setInteractionMode] = useState('pan');
  const [userAnnotations, setUserAnnotations] = useState([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState(null);
  const [showUserAnnotations, setShowUserAnnotations] = useState(true);
  const [bboxClasses, setBBoxClasses] = useState([]);
  const [activeClassId, setActiveClassId] = useState(null);

  // Derived booleans for backward compatibility
  const annotationMode = interactionMode === 'draw';
  const selectMode = interactionMode === 'select';

  const setAnnotationMode = useCallback((val) => {
    if (typeof val === 'function') {
      setInteractionMode(prev => {
        const prevBool = prev === 'draw';
        const next = val(prevBool);
        return next ? 'draw' : 'pan';
      });
    } else {
      setInteractionMode(val ? 'draw' : 'pan');
    }
  }, []);

  const loadBBoxClasses = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/bbox-classes`);
      if (!response.ok) return;
      const data = await response.json();
      setBBoxClasses(data);
      if (data.length > 0 && !activeClassId) {
        setActiveClassId(data[0].id);
      }
    } catch (error) {
      console.error('Error loading bbox classes:', error);
    }
  }, [projectId, activeClassId]);

  const loadUserAnnotations = useCallback(async () => {
    if (!imageId) return;
    try {
      const response = await fetch(`/api/images/${imageId}/user-annotations`);
      if (!response.ok) return;
      const data = await response.json();
      setUserAnnotations(data);
    } catch (error) {
      console.error('Error loading user annotations:', error);
    }
  }, [imageId]);

  // Create annotation -- auto-selects the new one
  const handleAnnotationCreated = useCallback(async (bbox) => {
    if (!activeClassId) return;
    try {
      const response = await fetch(`/api/images/${imageId}/user-annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bbox_class_id: activeClassId,
          ...bbox,
        }),
      });
      if (!response.ok) throw new Error('Failed to create annotation');
      const created = await response.json();
      await loadUserAnnotations();
      if (created && created.id) {
        setSelectedAnnotationId(created.id);
      }
    } catch (err) {
      console.error('Error creating annotation:', err);
      setError('Failed to create annotation.');
    }
  }, [activeClassId, imageId, loadUserAnnotations, setError]);

  // Update annotation bbox (resize)
  const handleAnnotationUpdate = useCallback(async (annotationId, bboxUpdate) => {
    try {
      const response = await fetch(`/api/user-annotations/${annotationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bboxUpdate),
      });
      if (!response.ok) throw new Error('Failed to update annotation');
      await loadUserAnnotations();
    } catch (err) {
      console.error('Error updating annotation:', err);
      setError('Failed to update annotation.');
    }
  }, [loadUserAnnotations, setError]);

  // Delete selected annotation
  const handleDeleteSelected = useCallback(async () => {
    if (!selectedAnnotationId) return;
    try {
      const response = await fetch(`/api/user-annotations/${selectedAnnotationId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete annotation');
      setSelectedAnnotationId(null);
      await loadUserAnnotations();
    } catch (err) {
      console.error('Error deleting annotation:', err);
      setError('Failed to delete annotation.');
    }
  }, [selectedAnnotationId, loadUserAnnotations, setError]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // 1-9: select class and enter draw mode
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9 && bboxClasses.length >= num) {
        const cls = bboxClasses[num - 1];
        setActiveClassId(cls.id);
        setInteractionMode('draw');
        return;
      }

      // V or S: enter select mode
      if ((e.key === 'v' || e.key === 's') && !e.ctrlKey && !e.metaKey) {
        setInteractionMode('select');
        return;
      }

      // B or D: enter draw mode
      if ((e.key === 'b' || e.key === 'd') && !e.ctrlKey && !e.metaKey) {
        if (bboxClasses.length > 0) {
          setInteractionMode('draw');
        }
        return;
      }

      // Delete / Backspace: delete selected annotation
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotationId) {
        e.preventDefault();
        handleDeleteSelected();
        return;
      }

      // Tab / Shift+Tab: cycle through annotations
      if (e.key === 'Tab' && userAnnotations.length > 0) {
        e.preventDefault();
        // Switch to select mode when tabbing through annotations
        if (interactionMode !== 'select') {
          setInteractionMode('select');
        }
        const currentIdx = userAnnotations.findIndex(a => a.id === selectedAnnotationId);
        let nextIdx;
        if (e.shiftKey) {
          nextIdx = currentIdx <= 0 ? userAnnotations.length - 1 : currentIdx - 1;
        } else {
          nextIdx = currentIdx < 0 || currentIdx >= userAnnotations.length - 1 ? 0 : currentIdx + 1;
        }
        setSelectedAnnotationId(userAnnotations[nextIdx].id);
        return;
      }

      // Escape: deselect annotation -> exit mode -> pan
      if (e.key === 'Escape') {
        if (selectedAnnotationId) {
          setSelectedAnnotationId(null);
        } else if (interactionMode !== 'pan') {
          setInteractionMode('pan');
        }
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bboxClasses, userAnnotations, selectedAnnotationId, interactionMode, handleDeleteSelected]);

  return {
    interactionMode,
    setInteractionMode,
    annotationMode,
    selectMode,
    setAnnotationMode,
    userAnnotations,
    selectedAnnotationId,
    setSelectedAnnotationId,
    hoveredAnnotationId,
    setHoveredAnnotationId,
    showUserAnnotations,
    setShowUserAnnotations,
    bboxClasses,
    activeClassId,
    setActiveClassId,
    loadBBoxClasses,
    loadUserAnnotations,
    handleAnnotationCreated,
    handleAnnotationUpdate,
    handleDeleteSelected,
  };
}

export default useAnnotations;
