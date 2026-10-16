import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import CalibrationEditForm from './CalibrationEditForm';
import CalibrationDisplay from './CalibrationDisplay';
import { fallbackOnHttpError } from '../api/client';
import { deleteImageMetadata, updateImageMetadata } from '../api/images';
import { fetchProjectMetadataDictionary, setProjectMetadata } from '../api/projects';
import { isUserMetadataKey } from '../utils/metadataKeys';
import useRouteRequestOwnership, { isAbortError } from '../utils/useRouteRequestOwnership';

const MM_PER_INCH = 25.4;

function validateAndBuildCalibration(editPixelsPerUnit, editUnit) {
  const num = parseFloat(editPixelsPerUnit);
  if (isNaN(num) || num <= 0) {
    return { error: 'Calibration must be a positive number' };
  }
  if (num < 0.1 || num > 10000) {
    return {
      warning: 'Warning: Calibration value seems unrealistic (expected between 0.1 and 10000 px/unit)',
      calibration: buildCalibrationData(num, editUnit)
    };
  }
  return { calibration: buildCalibrationData(num, editUnit) };
}

function buildCalibrationData(pixelsPerUnit, unit) {
  return {
    pixels_per_mm: unit === 'mm' ? pixelsPerUnit : pixelsPerUnit / MM_PER_INCH,
    pixels_per_inch: unit === 'inches' ? pixelsPerUnit : pixelsPerUnit * MM_PER_INCH,
    unit,
    updated_at: new Date().toISOString()
  };
}

export default function CalibrationManager({
  projectId,
  imageId,
  image,
  onCalibrationChange,
  readOnly = false
}) {
  const [calibration, setCalibration] = useState(null);
  const [isImageOverride, setIsImageOverride] = useState(false);
  const [matchedRule, setMatchedRule] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editUnit, setEditUnit] = useState('mm');
  const [editPixelsPerUnit, setEditPixelsPerUnit] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const overrideCleared = useRef(false);
  const currentLoadRef = useRef(null);
  const messageTimeoutRef = useRef(null);
  const pendingMutationsRef = useRef(new Map());
  const onCalibrationChangeRef = useRef(onCalibrationChange);
  const routeKey = JSON.stringify([projectId ?? null, imageId ?? null]);
  const {
    beginRequest,
    captureOwner,
    isCurrent,
    releaseRequest
  } = useRouteRequestOwnership(routeKey);

  onCalibrationChangeRef.current = onCalibrationChange;

  const rawMetadata = image?.metadata || image?.metadata_;
  const imageMetadata = useMemo(() => rawMetadata || {}, [rawMetadata]);

  const clearMessageTimer = useCallback(() => {
    if (messageTimeoutRef.current) {
      clearTimeout(messageTimeoutRef.current);
      messageTimeoutRef.current = null;
    }
  }, []);

  const showMessage = useCallback((nextMessage, duration, owner = captureOwner()) => {
    if (!isCurrent(owner)) {
      return;
    }

    clearMessageTimer();
    setMessage(nextMessage);
    if (duration) {
      messageTimeoutRef.current = setTimeout(() => {
        if (isCurrent(owner)) {
          setMessage(null);
        }
        messageTimeoutRef.current = null;
      }, duration);
    }
  }, [captureOwner, clearMessageTimer, isCurrent]);

  const commitCalibration = useCallback((nextCalibration, options, owner) => {
    if (!isCurrent(owner)) {
      return false;
    }

    setCalibration(nextCalibration);
    setIsImageOverride(Boolean(options?.isImageOverride));
    setMatchedRule(options?.matchedRule || null);
    onCalibrationChangeRef.current?.(nextCalibration);
    return true;
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
      setIsLoading(true);
      setError(null);
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
      setIsLoading(false);
    }
    releaseRequest(request);
  }, [isCurrent, releaseRequest]);

  const loadCalibration = useCallback(async () => {
    currentLoadRef.current?.controller.abort();
    const request = beginRequest();
    currentLoadRef.current = request;
    const metadata = imageMetadata;

    try {
      if (!isCurrent(request)) {
        return;
      }

      setError(null);
      setCalibration(null);
      setIsImageOverride(false);
      setMatchedRule(null);

      if (metadata?.calibration_override && !overrideCleared.current) {
        commitCalibration(
          metadata.calibration_override,
          { isImageOverride: true, matchedRule: null },
          request
        );
        return;
      }

      const responseData = await fallbackOnHttpError(fetchProjectMetadataDictionary(projectId, {
        signal: request.controller.signal
      }), null);
      if (!isCurrent(request)) {
        return;
      }

      if (responseData) {
        const data = responseData;
        if (!isCurrent(request)) {
          return;
        }

        // Check metadata-based calibration rules (priority between image override and project default)
        const rules = Array.isArray(data.calibration_rules) ? data.calibration_rules : [];
        if (metadata && rules.length > 0) {
          for (const rule of rules) {
            if (
              rule.metadata_key &&
              rule.metadata_value !== undefined &&
              rule.calibration?.pixels_per_mm &&
              rule.calibration?.pixels_per_inch &&
              metadata[rule.metadata_key] !== undefined &&
              String(metadata[rule.metadata_key]) === String(rule.metadata_value)
            ) {
              commitCalibration(
                rule.calibration,
                { isImageOverride: false, matchedRule: rule },
                request
              );
              return;
            }
          }
        }

        if (data.calibration_default) {
          commitCalibration(
            data.calibration_default,
            { isImageOverride: false, matchedRule: null },
            request
          );
          return;
        }
      }

      commitCalibration(
        null,
        { isImageOverride: false, matchedRule: null },
        request
      );
    } catch (err) {
      if (!isCurrent(request) || isAbortError(err, request)) {
        return;
      }
      console.error('Error loading project calibration:', err);
      commitCalibration(
        null,
        { isImageOverride: false, matchedRule: null },
        request
      );
    } finally {
      if (currentLoadRef.current === request) {
        currentLoadRef.current = null;
      }
      releaseRequest(request);
    }
  }, [beginRequest, commitCalibration, imageMetadata, isCurrent, projectId, releaseRequest]);

  useEffect(() => {
    overrideCleared.current = false;
    clearMessageTimer();
    setIsEditing(false);
    setIsLoading(false);
    setError(null);
    setMessage(null);
  }, [clearMessageTimer, routeKey]);

  useEffect(() => {
    loadCalibration();
  }, [loadCalibration]);

  useEffect(() => {
    if (readOnly) {
      setIsEditing(false);
    }
  }, [readOnly]);

  useEffect(() => {
    return () => {
      clearMessageTimer();
    };
  }, [clearMessageTimer]);

  const handleStartEdit = () => {
    if (readOnly) return;

    if (calibration) {
      setEditUnit(calibration.unit || 'mm');
      setEditPixelsPerUnit(
        calibration.unit === 'mm'
          ? calibration.pixels_per_mm.toString()
          : calibration.pixels_per_inch.toString()
      );
    } else {
      setEditUnit('mm');
      setEditPixelsPerUnit('');
    }
    setIsEditing(true);
    setError(null);
    clearMessageTimer();
    setMessage(null);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setError(null);
    clearMessageTimer();
    setMessage(null);
  };

  const prepareCalibration = () => {
    const result = validateAndBuildCalibration(editPixelsPerUnit, editUnit);
    if (result.error) {
      setError(result.error);
      return null;
    }
    if (result.warning) {
      showMessage(result.warning, 5000);
    }
    return result.calibration;
  };

  const handleSaveProjectDefault = async () => {
    if (readOnly) return;

    const calibrationData = prepareCalibration();
    if (!calibrationData) return;

    const request = beginMutation();

    try {
      await setProjectMetadata(projectId, 'calibration_default', calibrationData, {
        signal: request.controller.signal,
        errorLabel: 'Failed to save project calibration',
      });
      if (!isCurrent(request)) {
        return;
      }

      commitCalibration(
        calibrationData,
        { isImageOverride: false, matchedRule: null },
        request
      );
      setIsEditing(false);
      showMessage('Project calibration saved successfully', 3000, request);
    } catch (err) {
      if (!isCurrent(request) || isAbortError(err, request)) {
        return;
      }
      setError(err.message);
    } finally {
      finishMutation(request);
    }
  };

  const handleSaveImageOverride = async () => {
    if (readOnly) return;

    const calibrationData = prepareCalibration();
    if (!calibrationData) return;

    const request = beginMutation();

    try {
      await updateImageMetadata(imageId, 'calibration_override', calibrationData, {
        signal: request.controller.signal,
        errorLabel: 'Failed to save image calibration',
      });
      if (!isCurrent(request)) {
        return;
      }

      overrideCleared.current = false;
      commitCalibration(
        calibrationData,
        { isImageOverride: true, matchedRule: null },
        request
      );
      setIsEditing(false);
      showMessage('Image-specific calibration saved successfully', 3000, request);
    } catch (err) {
      if (!isCurrent(request) || isAbortError(err, request)) {
        return;
      }
      setError(err.message);
    } finally {
      finishMutation(request);
    }
  };

  const handleClearOverride = async () => {
    if (readOnly) return;

    if (!window.confirm('Clear image-specific calibration?')) {
      return;
    }

    const request = beginMutation();

    try {
      await deleteImageMetadata(imageId, 'calibration_override', {
        signal: request.controller.signal,
        errorLabel: 'Failed to clear override',
      });
      if (!isCurrent(request)) {
        return;
      }

      overrideCleared.current = true;

      showMessage('Image calibration override cleared', 3000, request);
      await loadCalibration();
    } catch (err) {
      if (!isCurrent(request) || isAbortError(err, request)) {
        return;
      }
      setError(err.message);
    } finally {
      finishMutation(request);
    }
  };

  const handleSaveMetadataRule = async (metadataKey, metadataValue) => {
    if (readOnly) return;

    const calibrationData = prepareCalibration();
    if (!calibrationData) return;

    const request = beginMutation();

    try {
      const fetchRespData = await fallbackOnHttpError(fetchProjectMetadataDictionary(projectId, {
        signal: request.controller.signal
      }), null);
      let existingRules = [];
      if (fetchRespData) {
        const data = fetchRespData;
        if (!isCurrent(request)) {
          return;
        }
        existingRules = Array.isArray(data.calibration_rules) ? data.calibration_rules : [];
      }
      if (!isCurrent(request)) {
        return;
      }

      const filteredRules = existingRules.filter(
        r => !(r.metadata_key === metadataKey && String(r.metadata_value) === String(metadataValue))
      );
      const newRules = [...filteredRules, {
        metadata_key: metadataKey,
        metadata_value: String(metadataValue),
        calibration: calibrationData
      }];

      await setProjectMetadata(projectId, 'calibration_rules', newRules, {
        signal: request.controller.signal,
        errorLabel: 'Failed to save metadata rule',
      });
      if (!isCurrent(request)) {
        return;
      }

      setIsEditing(false);
      showMessage(
        `Metadata calibration rule saved (${metadataKey} = ${metadataValue})`,
        3000,
        request
      );
      await loadCalibration();
    } catch (err) {
      if (!isCurrent(request) || isAbortError(err, request)) {
        return;
      }
      setError(err.message);
    } finally {
      finishMutation(request);
    }
  };

  const handleDeleteMetadataRule = async () => {
    if (readOnly) return;
    if (!matchedRule) return;
    const ruleToDelete = matchedRule;
    if (!window.confirm(
      `Remove calibration rule for ${ruleToDelete.metadata_key} = ${ruleToDelete.metadata_value}?`
    )) {
      return;
    }

    const request = beginMutation();

    try {
      const fetchRespData = await fallbackOnHttpError(fetchProjectMetadataDictionary(projectId, {
        signal: request.controller.signal
      }), null);
      let existingRules = [];
      if (fetchRespData) {
        const data = fetchRespData;
        if (!isCurrent(request)) {
          return;
        }
        existingRules = Array.isArray(data.calibration_rules) ? data.calibration_rules : [];
      }
      if (!isCurrent(request)) {
        return;
      }

      const updatedRules = existingRules.filter(
        r => !(r.metadata_key === ruleToDelete.metadata_key &&
               String(r.metadata_value) === String(ruleToDelete.metadata_value))
      );

      await setProjectMetadata(projectId, 'calibration_rules', updatedRules, {
        signal: request.controller.signal,
        errorLabel: 'Failed to delete metadata rule',
      });
      if (!isCurrent(request)) {
        return;
      }

      showMessage(
        `Metadata rule removed (${ruleToDelete.metadata_key} = ${ruleToDelete.metadata_value})`,
        3000,
        request
      );
      await loadCalibration();
    } catch (err) {
      if (!isCurrent(request) || isAbortError(err, request)) {
        return;
      }
      setError(err.message);
    } finally {
      finishMutation(request);
    }
  };

  return (
    <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Calibration</h3>
        {!readOnly && !isEditing && calibration && (
          <button
            onClick={handleStartEdit}
            style={{ padding: '4px 8px', fontSize: '12px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Edit
          </button>
        )}
      </div>

      {message && (
        <div style={{ padding: '8px', marginBottom: '12px', background: '#d1fae5', color: '#065f46', borderRadius: '4px', fontSize: '13px' }}>
          {message}
        </div>
      )}

      {error && (
        <div style={{ padding: '8px', marginBottom: '12px', background: '#fee2e2', color: '#991b1b', borderRadius: '4px', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {!isEditing || readOnly ? (
        <CalibrationDisplay
          calibration={calibration}
          isImageOverride={isImageOverride}
          matchedRule={matchedRule}
          isLoading={isLoading}
          readOnly={readOnly}
          onClearOverride={handleClearOverride}
          onDeleteMetadataRule={handleDeleteMetadataRule}
          onStartEdit={handleStartEdit}
        />
      ) : (
        <CalibrationEditForm
          editUnit={editUnit}
          setEditUnit={setEditUnit}
          editPixelsPerUnit={editPixelsPerUnit}
          setEditPixelsPerUnit={setEditPixelsPerUnit}
          isLoading={isLoading}
          onSaveProjectDefault={handleSaveProjectDefault}
          onSaveImageOverride={handleSaveImageOverride}
          onSaveMetadataRule={handleSaveMetadataRule}
          imageMetadataKeys={Object.entries(imageMetadata)
            .filter(([key]) => isUserMetadataKey(key))
            .map(([key, value]) => ({ key, value }))}
          onCancel={handleCancelEdit}
        />
      )}
    </div>
  );
}
