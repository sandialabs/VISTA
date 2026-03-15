import { useState, useCallback } from 'react';

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

  // Annotation creation handler
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
      await loadUserAnnotations();
    } catch (err) {
      console.error('Error creating annotation:', err);
      setError('Failed to create annotation.');
    }
  }, [activeClassId, imageId, loadUserAnnotations, setError]);

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
  };
}

export default useAnnotations;
