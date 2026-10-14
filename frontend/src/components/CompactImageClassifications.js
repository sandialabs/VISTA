import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  createImageClassification,
  deleteImageClassification,
  fetchImageClassifications,
} from '../api/images';
import useRouteRequestOwnership, { isAbortError } from '../utils/useRouteRequestOwnership';

function CompactImageClassifications({ imageId, classes, loading, setLoading, setError, onClassificationsChange, readOnly = false }) {
  const [imageClassifications, setImageClassifications] = useState([]);
  const [showHelp, setShowHelp] = useState(false);
  const imageIdStr = imageId == null ? '' : String(imageId);
  const classificationsRef = useRef([]);
  const pendingMutationsRef = useRef(new Map());
  const setLoadingRef = useRef(setLoading);
  const setErrorRef = useRef(setError);
  const onClassificationsChangeRef = useRef(onClassificationsChange);
  const {
    beginRequest,
    isCurrent,
    releaseRequest
  } = useRouteRequestOwnership(`image:${imageIdStr}`);

  setLoadingRef.current = setLoading;
  setErrorRef.current = setError;
  onClassificationsChangeRef.current = onClassificationsChange;

  const commitClassifications = useCallback((nextClassifications, owner) => {
    if (owner && !isCurrent(owner)) {
      return;
    }

    classificationsRef.current = nextClassifications;
    setImageClassifications(nextClassifications);
    onClassificationsChangeRef.current?.(nextClassifications);
  }, [isCurrent]);

  const beginMutation = useCallback(() => {
    const request = beginRequest();
    pendingMutationsRef.current.forEach((_, generation) => {
      if (generation !== request.generation) {
        pendingMutationsRef.current.delete(generation);
      }
    });
    const pendingCount = pendingMutationsRef.current.get(request.generation) || 0;
    pendingMutationsRef.current.set(request.generation, pendingCount + 1);
    if (isCurrent(request)) {
      setLoadingRef.current?.(true);
    }
    return request;
  }, [beginRequest, isCurrent]);

  const finishMutation = useCallback((request) => {
    const pendingCount = pendingMutationsRef.current.get(request.generation) || 0;
    const nextCount = Math.max(0, pendingCount - 1);
    if (nextCount === 0) {
      pendingMutationsRef.current.delete(request.generation);
    } else {
      pendingMutationsRef.current.set(request.generation, nextCount);
    }

    if (isCurrent(request) && nextCount === 0) {
      setLoadingRef.current?.(false);
    }
    releaseRequest(request);
  }, [isCurrent, releaseRequest]);

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
    classificationsRef.current = [];
    setImageClassifications([]);

    if (!imageIdStr) {
      return undefined;
    }

    const request = beginRequest();

    const loadClassifications = async () => {
      try {
        const classificationsData = await fetchImageClassifications(imageIdStr, {
          signal: request.controller.signal
        });

        if (!Array.isArray(classificationsData)) {
          throw new Error('Invalid classifications response');
        }
        if (!isCurrent(request)) {
          return;
        }

        commitClassifications(classificationsData, request);
      } catch (error) {
        if (!isCurrent(request) || isAbortError(error, request)) {
          return;
        }
        console.error('Error loading classifications:', error);
        setErrorRef.current?.('Failed to load classifications. Please try again later.');
      } finally {
        releaseRequest(request);
      }
    };

    loadClassifications();

    return () => {
      request.controller.abort();
    };
  }, [beginRequest, commitClassifications, imageIdStr, isCurrent, releaseRequest]);

  // Handle deleting a classification
  const handleDeleteClassification = useCallback(async (id) => {
    const request = beginMutation();
    try {
      const idStr = String(id);
      await deleteImageClassification(idStr, {
        signal: request.controller.signal,
      });
      if (!isCurrent(request)) {
        return;
      }

      const newClassifications = classificationsRef.current.filter(
        classification => String(classification.id) !== idStr
      );
      commitClassifications(newClassifications, request);
      setErrorRef.current?.(null);
      
    } catch (error) {
      if (!isCurrent(request) || isAbortError(error, request)) {
        return;
      }
      console.error('Error removing classification:', error);
      setErrorRef.current?.('Failed to remove classification. Please try again later.');
    } finally {
      finishMutation(request);
    }
  }, [beginMutation, commitClassifications, finishMutation, isCurrent]);

  // Handle classifying an image
  const handleClassifyImage = useCallback(async (classId) => {
    const classIdStr = String(classId);
    const existingClassification = classificationsRef.current.find(
      classification => String(classification.class_id) === classIdStr
    );

    if (existingClassification) {
      // If already classified, remove the classification.
      await handleDeleteClassification(existingClassification.id);
      return;
    }

    const request = beginMutation();
    try {
      const newClassification = await createImageClassification(imageIdStr, classIdStr, {
        signal: request.controller.signal,
      });
      if (!isCurrent(request)) {
        return;
      }

      const newClassifications = [
        ...classificationsRef.current.filter(
          classification => String(classification.id) !== String(newClassification.id)
        ),
        newClassification
      ];
      commitClassifications(newClassifications, request);
      setErrorRef.current?.(null);
      
    } catch (error) {
      if (!isCurrent(request) || isAbortError(error, request)) {
        return;
      }
      console.error('Error classifying image:', error);
      setErrorRef.current?.('Failed to classify image. Please try again later.');
    } finally {
      finishMutation(request);
    }
  }, [beginMutation, commitClassifications, finishMutation, handleDeleteClassification, imageIdStr, isCurrent]);

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
  }, [hotkeyMap, handleClassifyImage, showHelp, readOnly]);

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
