import React, { useState, useEffect, useCallback } from 'react';

function CompactImageClassifications({ imageId, classes, loading, setLoading, setError, onClassificationsChange }) {
  const [imageClassifications, setImageClassifications] = useState([]);
  const [showHelp, setShowHelp] = useState(false);

  // Generate hotkey mapping for classes
  const generateHotkeys = useCallback((classList) => {
    const usedKeys = new Set();
    const hotkeyMap = new Map();
    const priorityKeys = ['a', 's', 'd', 'f', 'q', 'w', 'e', 'r']; // Home row + top row
    const allKeys = 'abcdefghijklmnopqrstuvwxyz1234567890'.split('');

    // Reserve 'h' for help functionality
    usedKeys.add('h');

    // First pass: try first letter of class name
    classList.forEach(cls => {
      const firstLetter = cls.name.toLowerCase().charAt(0);
      if (!usedKeys.has(firstLetter) && allKeys.includes(firstLetter)) {
        hotkeyMap.set(cls.id, firstLetter);
        usedKeys.add(firstLetter);
      }
    });
    
    // Second pass: assign priority keys to unassigned classes
    let priorityIndex = 0;
    classList.forEach(cls => {
      if (!hotkeyMap.has(cls.id)) {
        while (priorityIndex < priorityKeys.length && usedKeys.has(priorityKeys[priorityIndex])) {
          priorityIndex++;
        }
        if (priorityIndex < priorityKeys.length) {
          hotkeyMap.set(cls.id, priorityKeys[priorityIndex]);
          usedKeys.add(priorityKeys[priorityIndex]);
          priorityIndex++;
        }
      }
    });
    
    // Third pass: assign any remaining keys
    let keyIndex = 0;
    classList.forEach(cls => {
      if (!hotkeyMap.has(cls.id)) {
        while (keyIndex < allKeys.length && usedKeys.has(allKeys[keyIndex])) {
          keyIndex++;
        }
        if (keyIndex < allKeys.length) {
          hotkeyMap.set(cls.id, allKeys[keyIndex]);
          usedKeys.add(allKeys[keyIndex]);
          keyIndex++;
        }
      }
    });
    
    return hotkeyMap;
  }, []);

  const hotkeyMap = generateHotkeys(classes);

  // Load classifications for the image
  useEffect(() => {
    const loadClassifications = async () => {
      try {
        const imageIdStr = String(imageId);
        const response = await fetch(`/api/images/${imageIdStr}/classifications`);
        
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const classificationsData = await response.json();
        setImageClassifications(classificationsData);
        if (onClassificationsChange) {
          onClassificationsChange(classificationsData);
        }
        
      } catch (error) {
        console.error('Error loading classifications:', error);
        setError('Failed to load classifications. Please try again later.');
      }
    };

    if (imageId) {
      loadClassifications();
    }
  }, [imageId, setError, onClassificationsChange]);

  // Handle deleting a classification
  const handleDeleteClassification = useCallback(async (id) => {
    try {
      setLoading(true);
      
      const idStr = String(id);
      const response = await fetch(`/api/classifications/${idStr}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      const newClassifications = imageClassifications.filter(classification => String(classification.id) !== idStr);
      setImageClassifications(newClassifications);
      if (onClassificationsChange) {
        onClassificationsChange(newClassifications);
      }
      setError(null);
      
    } catch (error) {
      console.error('Error removing classification:', error);
      setError('Failed to remove classification. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [imageClassifications, setLoading, setError, onClassificationsChange]);

  // Handle classifying an image
  const handleClassifyImage = useCallback(async (classId) => {
    try {
      setLoading(true);
      
      const classIdStr = String(classId);
      const existingClassification = imageClassifications.find(
        classification => String(classification.class_id) === classIdStr
      );
      
      if (existingClassification) {
        // If already classified, remove the classification
        await handleDeleteClassification(existingClassification.id);
        return;
      }
      
      const imageIdStr = String(imageId);
      const payload = {
        image_id: imageIdStr,
        class_id: classIdStr
      };
      
      const response = await fetch(`/api/images/${imageIdStr}/classifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! Status: ${response.status}, Details: ${errorText}`);
      }
      
      const newClassification = await response.json();
      const newClassifications = [...imageClassifications, newClassification];
      setImageClassifications(newClassifications);
      if (onClassificationsChange) {
        onClassificationsChange(newClassifications);
      }
      setError(null);
      
    } catch (error) {
      console.error('Error classifying image:', error);
      setError('Failed to classify image. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [imageId, imageClassifications, setLoading, setError, handleDeleteClassification, onClassificationsChange]);

  // Check if a class is selected
  const isClassSelected = (classId) => {
    const classIdStr = String(classId);
    return imageClassifications.some(
      classification => String(classification.class_id) === classIdStr
    );
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if user is typing in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      
      // Find class by hotkey
      for (const [classId, hotkey] of hotkeyMap) {
        if (e.key.toLowerCase() === hotkey) {
          e.preventDefault();
          handleClassifyImage(classId);
          
          // Visual feedback - highlight the button briefly
          const button = document.querySelector(`[data-class-id="${classId}"]`);
          if (button) {
            button.classList.add('hotkey-pressed');
            setTimeout(() => {
              button.classList.remove('hotkey-pressed');
            }, 200);
          }
          break;
        }
      }
      
      // Toggle help with 'h' key
      if (e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setShowHelp(!showHelp);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [hotkeyMap, handleClassifyImage, showHelp]);

  return (
    <div className="compact-classifications">
      <div className="compact-classifications-header">
        <div className="classifications-buttons">
          {classes.map(cls => {
            const hotkey = hotkeyMap.get(cls.id);
            const selected = isClassSelected(cls.id);
            return (
              <button 
                key={cls.id}
                type="button" 
                className={`compact-class-btn ${selected ? 'selected' : ''}`}
                onClick={() => handleClassifyImage(cls.id)}
                data-class-id={cls.id}
                title={`${cls.description || cls.name}${hotkey ? ` - Press '${hotkey}'` : ''}`}
              >
                {cls.name} {hotkey && <span className="hotkey">({hotkey})</span>}
              </button>
            );
          })}
        </div>
        <div className="compact-help-controls">
          <button 
            className="help-toggle-btn"
            onClick={() => setShowHelp(!showHelp)}
            title="Show/hide keyboard shortcuts (h)"
          >
            ?
          </button>
        </div>
      </div>
      
      {showHelp && (
        <div className="compact-help-panel">
          <div className="help-content">
            <h4>Quick Labeling Guide</h4>
            <div className="help-sections">
              <div className="help-section">
                <strong>Navigation:</strong>
                <ul>
                  <li>← → Arrow keys to navigate between images</li>
                  <li>Click buttons or use keyboard shortcuts to classify</li>
                </ul>
              </div>
              <div className="help-section">
                <strong>Classification Shortcuts:</strong>
                <ul>
                  {classes.map(cls => {
                    const hotkey = hotkeyMap.get(cls.id);
                    if (hotkey) {
                      return (
                        <li key={cls.id}>
                          <kbd>{hotkey}</kbd> - {cls.name}
                        </li>
                      );
                    }
                    return null;
                  })}
                </ul>
              </div>
              <div className="help-section">
                <strong>Other:</strong>
                <ul>
                  <li><kbd>h</kbd> - Toggle this help panel</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
      
    </div>
  );
}

export default CompactImageClassifications;