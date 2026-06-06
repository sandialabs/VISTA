import React, { useState, useEffect, useCallback } from 'react';

function CompactImageClassifications({ imageId, classes, loading, setLoading, setError, onClassificationsChange, readOnly = false }) {
  const [imageClassifications, setImageClassifications] = useState([]);

  // Generate hotkey mapping for classes
  const generateHotkeys = useCallback((classList) => {
    const usedKeys = new Set();
    const hotkeyMap = new Map();
    const priorityKeys = ['a', 'f', 'q', 'w', 'e', 'g', 'j', 'k']; // Home/top row, excluding reserved keys
    const allKeys = 'abcdefghijklmnopqrstuvwxyz1234567890'.split('');

    // Reserve keys owned by other handlers so classification hotkeys never
    // collide with them. Pressing one of these otherwise triggers two unrelated
    // actions at once (e.g. 'b' both classifies and enters draw mode).
    //   h           -> help dialog
    //   b d v s m   -> interaction modes (useAnnotations: draw/select/measure)
    //   1-9         -> select bbox class + draw mode (useAnnotations)
    //   p r         -> review pass/reject (ReviewPanel)
    ['h', 'b', 'd', 'v', 's', 'm', 'p', 'r', '1', '2', '3', '4', '5', '6', '7', '8', '9']
      .forEach(k => usedKeys.add(k));

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
      // Ignore if project is archived or user is typing in an input field
      if (readOnly) return;
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
      
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [hotkeyMap, handleClassifyImage, readOnly]);

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
                onClick={() => { if (!readOnly) handleClassifyImage(cls.id); }}
                disabled={readOnly}
                data-class-id={cls.id}
                title={readOnly ? 'Project is archived (read-only)' : `${cls.description || cls.name}${hotkey ? ` - Press '${hotkey}'` : ''}`}
              >
                {cls.name} {hotkey && <span className="hotkey">({hotkey})</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default CompactImageClassifications;