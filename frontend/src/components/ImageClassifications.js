import React, { useState, useEffect } from 'react';
import {
  createImageClassification,
  deleteImageClassification,
  fetchImageClassifications,
} from '../api/images';

function ImageClassifications({ imageId, classes, loading, setLoading, setError }) {
  const [imageClassifications, setImageClassifications] = useState([]);

  // Load classifications for the image
  useEffect(() => {
    const loadClassifications = async () => {
      try {
        // Ensure imageId is a string to match the format expected by the backend
        const imageIdStr = String(imageId);
        const classificationsData = await fetchImageClassifications(imageIdStr);
        setImageClassifications(classificationsData);
        
      } catch (error) {
        setError('Failed to load classifications. Please try again later.');
      }
    };

    if (imageId) {
      loadClassifications();
    }
  }, [imageId, setError]);

  // Handle classifying an image
  const handleClassifyImage = async (classId) => {
    try {
      setLoading(true);

      // Check if the image is already classified with this class
      const classIdStr = String(classId);

      const existingClassification = imageClassifications.find(
        classification => String(classification.class_id) === classIdStr
      );
      
      if (existingClassification) {
        // If already classified, remove the classification
        await handleDeleteClassification(existingClassification.id);
        return;
      }

      const newClassification = await createImageClassification(imageId, classIdStr);
      
      // Add the new classification to the list
      setImageClassifications(prev => [...prev, newClassification]);
      setError(null);
      
    } catch (error) {
      setError('Failed to classify image. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  // Handle deleting a classification
  const handleDeleteClassification = async (id) => {
    try {
      setLoading(true);
      
      // Ensure id is a string to match the format expected by the backend
      const idStr = String(id);
      
      await deleteImageClassification(idStr);
      
      // Remove the classification from the list
      // idStr is already declared above
      setImageClassifications(prev => prev.filter(classification => String(classification.id) !== idStr));
      setError(null);
      
    } catch (error) {
      setError('Failed to remove classification. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  // Check if a class is selected
  const isClassSelected = (classId) => {
    const classIdStr = String(classId);
    return imageClassifications.some(
      classification => String(classification.class_id) === classIdStr
    );
  };

  return (
    <div className="card" id="classifications-card">
      <div className="card-header">
        <h2>Classifications</h2>
      </div>
      <div className="card-content">
        <div id="classifications-container">
          {loading && !imageClassifications.length ? (
            <p>Loading classifications...</p>
          ) : imageClassifications.length > 0 ? (
            <ul className="classifications-list">
              {imageClassifications.map(classification => {
                const classIdStr = String(classification.class_id);
                const classInfo = classes.find(c => String(c.id) === classIdStr);
                return (
                  <li key={classification.id} className="classification-item">
                    <div className="classification-info">
                      <h4>{classInfo ? classInfo.name : 'Unknown class'}</h4>
                    </div>
                    <div className="classification-actions">
                      <button 
                        className="btn btn-small btn-danger"
                        onClick={() => handleDeleteClassification(classification.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>No classifications for this image. Add a classification to get started.</p>
          )}
        </div>
        
        <div id="class-buttons-container" className="form-group">
          <h3>Add Classification</h3>
          {loading && !classes.length ? (
            <p>Loading classes...</p>
          ) : classes.length > 0 ? (
            <div className="class-buttons">
              {classes.map(cls => (
                <button 
                  key={cls.id}
                  type="button" 
                  className={`btn class-button ${isClassSelected(cls.id) ? 'selected' : ''}`}
                  onClick={() => handleClassifyImage(cls.id)}
                >
                  {cls.name}
                </button>
              ))}
            </div>
          ) : (
            <p>No classes available. Please add classes to the project first.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default ImageClassifications;
