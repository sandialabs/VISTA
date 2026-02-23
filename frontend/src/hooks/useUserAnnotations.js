import { useState, useEffect, useCallback } from 'react';

export default function useUserAnnotations(imageId, collectionId) {
  const [annotations, setAnnotations] = useState([]);
  const [bboxClasses, setBboxClasses] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchAnnotations = useCallback(async () => {
    if (!imageId) return;
    setLoading(true);
    try {
      let url = `/api/images/${imageId}/annotations`;
      if (collectionId) url += `?collection_id=${collectionId}`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        setAnnotations(data.annotations || []);
      }
    } catch (err) {
      console.error('Failed to fetch annotations:', err);
    } finally {
      setLoading(false);
    }
  }, [imageId, collectionId]);

  const fetchBboxClasses = useCallback(async () => {
    if (!collectionId) return;
    try {
      const resp = await fetch(`/api/collections/${collectionId}/bbox-classes`);
      if (resp.ok) {
        const data = await resp.json();
        setBboxClasses(data);
      }
    } catch (err) {
      console.error('Failed to fetch bbox classes:', err);
    }
  }, [collectionId]);

  useEffect(() => {
    fetchAnnotations();
  }, [fetchAnnotations]);

  useEffect(() => {
    fetchBboxClasses();
  }, [fetchBboxClasses]);

  const createAnnotation = useCallback(async (annotationData) => {
    const resp = await fetch(`/api/images/${imageId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(annotationData),
    });
    if (!resp.ok) throw new Error('Failed to create annotation');
    const created = await resp.json();
    setAnnotations(prev => [...prev, created]);
    return created;
  }, [imageId]);

  const updateAnnotation = useCallback(async (annotationId, data) => {
    const resp = await fetch(`/api/annotations/${annotationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!resp.ok) throw new Error('Failed to update annotation');
    const updated = await resp.json();
    setAnnotations(prev => prev.map(a => a.id === annotationId ? updated : a));
    return updated;
  }, []);

  const deleteAnnotation = useCallback(async (annotationId) => {
    const resp = await fetch(`/api/annotations/${annotationId}`, {
      method: 'DELETE',
    });
    if (!resp.ok) throw new Error('Failed to delete annotation');
    setAnnotations(prev => prev.filter(a => a.id !== annotationId));
  }, []);

  const getClassById = useCallback((classId) => {
    return bboxClasses.find(c => c.id === classId);
  }, [bboxClasses]);

  return {
    annotations,
    bboxClasses,
    loading,
    createAnnotation,
    updateAnnotation,
    deleteAnnotation,
    getClassById,
    refresh: fetchAnnotations,
    refreshClasses: fetchBboxClasses,
  };
}
