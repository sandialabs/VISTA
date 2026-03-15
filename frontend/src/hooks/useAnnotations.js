import { useState, useCallback, useEffect } from 'react';

/**
 * Custom hook encapsulating user annotation state and handlers.
 *
 * @param {string} imageId  - current image ID
 * @param {string} projectId - current project ID
 * @param {function} setError - error-setter from the parent component
 * @returns annotation state values and handler functions
 */
function useAnnotations(imageId, projectId, setError) {
  const [annotationMode, setAnnotationMode] = useState(false);
  const [userAnnotations, setUserAnnotations] = useState([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
  const [showUserAnnotations, setShowUserAnnotations] = useState(true);
  const [bboxClasses, setBBoxClasses] = useState([]);
  const [activeClassId, setActiveClassId] = useState(null);

  // Load bbox classes for the project
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

  // Load user annotations for current image
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

  // Annotation creation handler -- auto-selects the new annotation
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
      // Auto-select the newly created annotation so user can adjust it
      if (created && created.id) {
        setSelectedAnnotationId(created.id);
      }
    } catch (err) {
      console.error('Error creating annotation:', err);
      setError('Failed to create annotation.');
    }
  }, [activeClassId, imageId, loadUserAnnotations, setError]);

  // Annotation bbox update handler (for resize)
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

  // Hotkeys: number keys 1-9 to select class and enter draw mode
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if user is typing in an input field
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9 && bboxClasses.length >= num) {
        const cls = bboxClasses[num - 1];
        setActiveClassId(cls.id);
        setAnnotationMode(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bboxClasses]);

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
