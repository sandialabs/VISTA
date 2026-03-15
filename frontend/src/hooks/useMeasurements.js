import { useState, useCallback } from 'react';

/**
 * Custom hook encapsulating measurement state and handlers.
 *
 * @param {string} imageId  - current image ID
 * @param {function} setImage - image-setter from the parent component
 * @param {function} setError - error-setter from the parent component
 * @returns measurement state values and handler functions
 */
function useMeasurements(imageId, setImage, setError) {
  const [calibration, setCalibration] = useState(null);
  const [measurements, setMeasurements] = useState([]);
  const [measurementActive, setMeasurementActive] = useState(false);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState(null);
  const [visibleMeasurementIds, setVisibleMeasurementIds] = useState(null);

  const handleSaveMeasurement = useCallback(async (measurement) => {
    const originalMeasurements = [...measurements];
    const originalVisibleIds = visibleMeasurementIds ? [...visibleMeasurementIds] : null;

    const updatedMeasurements = [...measurements, measurement];

    // Optimistic update
    setMeasurements(updatedMeasurements);
    setVisibleMeasurementIds(updatedMeasurements.map(m => m.id));

    try {
      const response = await fetch(`/api/images/${imageId}/metadata`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'measurements',
          value: updatedMeasurements
        })
      });

      if (!response.ok) {
        throw new Error('Failed to save measurement');
      }

      const updatedImage = await response.json();
      setImage(updatedImage);
    } catch (err) {
      console.error('Error saving measurement:', err);
      setError('Failed to save measurement. Please try again.');
      setMeasurements(originalMeasurements);
      setVisibleMeasurementIds(originalVisibleIds);
    }
  }, [measurements, visibleMeasurementIds, imageId, setImage, setError]);

  const handleDeleteMeasurement = useCallback(async (measurementId) => {
    const originalMeasurements = [...measurements];
    const originalVisibleIds = visibleMeasurementIds ? [...visibleMeasurementIds] : null;

    const updatedMeasurements = measurements.filter(m => m.id !== measurementId);

    // Optimistic update
    setMeasurements(updatedMeasurements);
    setVisibleMeasurementIds(updatedMeasurements.map(m => m.id));

    try {
      const response = await fetch(`/api/images/${imageId}/metadata`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'measurements',
          value: updatedMeasurements
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete measurement: ${response.status} - ${errorText}`);
      }

      const updatedImage = await response.json();
      setImage(updatedImage);
    } catch (err) {
      console.error('Error deleting measurement:', err);
      setError('Failed to delete measurement. Please try again.');
      setMeasurements(originalMeasurements);
      setVisibleMeasurementIds(originalVisibleIds);
    }
  }, [measurements, visibleMeasurementIds, imageId, setImage, setError]);

  const handleRenameMeasurement = useCallback(async (measurementId, newName) => {
    const originalMeasurements = [...measurements];

    const updatedMeasurements = measurements.map(m =>
      m.id === measurementId ? { ...m, name: newName } : m
    );

    // Optimistic update
    setMeasurements(updatedMeasurements);

    try {
      const response = await fetch(`/api/images/${imageId}/metadata`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'measurements',
          value: updatedMeasurements
        })
      });

      if (!response.ok) {
        throw new Error('Failed to rename measurement');
      }

      const updatedImage = await response.json();
      setImage(updatedImage);
    } catch (err) {
      console.error('Error renaming measurement:', err);
      setError('Failed to rename measurement. Please try again.');
      setMeasurements(originalMeasurements);
    }
  }, [measurements, imageId, setImage, setError]);

  const handleToggleVisibility = useCallback((measurementId) => {
    setVisibleMeasurementIds(prev => {
      if (!prev) return [measurementId];
      if (prev.includes(measurementId)) {
        return prev.filter(id => id !== measurementId);
      } else {
        return [...prev, measurementId];
      }
    });
  }, []);

  return {
    calibration,
    setCalibration,
    measurements,
    setMeasurements,
    measurementActive,
    setMeasurementActive,
    selectedMeasurementId,
    setSelectedMeasurementId,
    visibleMeasurementIds,
    setVisibleMeasurementIds,
    handleSaveMeasurement,
    handleDeleteMeasurement,
    handleRenameMeasurement,
    handleToggleVisibility,
  };
}

export default useMeasurements;
