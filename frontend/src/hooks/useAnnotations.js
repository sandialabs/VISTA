import { useState, useCallback, useEffect } from 'react';

/**
 * Custom hook encapsulating user annotation state and handlers.
 *
 * Hotkeys (active when not focused on an input):
 *   1-9       Select bbox class N and enter draw mode
 *   Tab       Select next annotation on current image
 *   Shift+Tab Select previous annotation
 *   Escape    Deselect annotation / exit draw mode
 */
function useAnnotations(imageId, projectId, setError) {
  const [annotationMode, setAnnotationMode] = useState(false);
  const [userAnnotations, setUserAnnotations] = useState([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
  const [showUserAnnotations, setShowUserAnnotations] = useState(true);
  const [bboxClasses, setBBoxClasses] = useState([]);
  const [activeClassId, setActiveClassId] = useState(null);

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
        setAnnotationMode(true);
        return;
      }

      // Tab / Shift+Tab: cycle through annotations
      if (e.key === 'Tab' && userAnnotations.length > 0) {
        e.preventDefault();
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

      // Escape: deselect annotation, then exit draw mode
      if (e.key === 'Escape') {
        if (selectedAnnotationId) {
          setSelectedAnnotationId(null);
        } else if (annotationMode) {
          setAnnotationMode(false);
        }
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bboxClasses, userAnnotations, selectedAnnotationId, annotationMode]);

  return {
    annotationMode,
    setAnnotationMode,
    userAnnotations,
    selectedAnnotationId,
    setSelectedAnnotationId,
    showUserAnnotations,
    setShowUserAnnotations,
    bboxClasses,
    activeClassId,
    setActiveClassId,
    loadBBoxClasses,
    loadUserAnnotations,
    handleAnnotationCreated,
    handleAnnotationUpdate,
  };
}

export default useAnnotations;
