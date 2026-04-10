import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import CalibrationEditForm from './CalibrationEditForm';
import CalibrationDisplay from './CalibrationDisplay';
import { isUserMetadataKey } from '../utils/metadataKeys';

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
  onCalibrationChange
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

  const rawMetadata = image?.metadata || image?.metadata_;
  const imageMetadata = useMemo(() => rawMetadata || {}, [rawMetadata]);

  const loadCalibration = useCallback(async () => {
    setError(null);

    const metadata = imageMetadata;
    if (metadata?.calibration_override && !overrideCleared.current) {
      setCalibration(metadata.calibration_override);
      setIsImageOverride(true);
      setMatchedRule(null);
      if (onCalibrationChange) {
        onCalibrationChange(metadata.calibration_override);
      }
      return;
    }

    setIsImageOverride(false);

    try {
      const response = await fetch(`/api/projects/${projectId}/metadata-dict`);
      if (response.ok) {
        const data = await response.json();

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
              setCalibration(rule.calibration);
              setIsImageOverride(false);
              setMatchedRule(rule);
              if (onCalibrationChange) {
                onCalibrationChange(rule.calibration);
              }
              return;
            }
          }
        }

        setMatchedRule(null);

        if (data.calibration_default) {
          setCalibration(data.calibration_default);
          if (onCalibrationChange) {
            onCalibrationChange(data.calibration_default);
          }
          return;
        }
      }
    } catch (err) {
      console.error('Error loading project calibration:', err);
    }

    setMatchedRule(null);
    setCalibration(null);
    if (onCalibrationChange) {
      onCalibrationChange(null);
    }
  }, [imageMetadata, projectId, onCalibrationChange]);

  useEffect(() => {
    overrideCleared.current = false;
    loadCalibration();
  }, [loadCalibration]);

  const handleStartEdit = () => {
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
    setMessage(null);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setError(null);
    setMessage(null);
  };

  const prepareCalibration = () => {
    const result = validateAndBuildCalibration(editPixelsPerUnit, editUnit);
    if (result.error) {
      setError(result.error);
      return null;
    }
    if (result.warning) {
      setMessage(result.warning);
      setTimeout(() => setMessage(null), 5000);
    }
    return result.calibration;
  };

  const handleSaveProjectDefault = async () => {
    const calibrationData = prepareCalibration();
    if (!calibrationData) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'calibration_default', value: calibrationData })
      });

      if (!response.ok) {
        throw new Error(`Failed to save project calibration: ${response.statusText}`);
      }

      setCalibration(calibrationData);
      setIsImageOverride(false);
      setIsEditing(false);
      setMessage('Project calibration saved successfully');
      setTimeout(() => setMessage(null), 3000);

      if (onCalibrationChange) {
        onCalibrationChange(calibrationData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveImageOverride = async () => {
    const calibrationData = prepareCalibration();
    if (!calibrationData) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/images/${imageId}/metadata`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'calibration_override', value: calibrationData })
      });

      if (!response.ok) {
        throw new Error(`Failed to save image calibration: ${response.statusText}`);
      }

      overrideCleared.current = false;
      setCalibration(calibrationData);
      setIsImageOverride(true);
      setIsEditing(false);
      setMessage('Image-specific calibration saved successfully');
      setTimeout(() => setMessage(null), 3000);

      if (onCalibrationChange) {
        onCalibrationChange(calibrationData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearOverride = async () => {
    if (!window.confirm('Clear image-specific calibration?')) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/images/${imageId}/metadata/calibration_override`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error(`Failed to clear override: ${response.statusText}`);
      }

      overrideCleared.current = true;

      setMessage('Image calibration override cleared');
      setTimeout(() => setMessage(null), 3000);
      await loadCalibration();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveMetadataRule = async (metadataKey, metadataValue) => {
    const calibrationData = prepareCalibration();
    if (!calibrationData) return;

    setIsLoading(true);
    setError(null);

    try {
      const fetchResp = await fetch(`/api/projects/${projectId}/metadata-dict`);
      let existingRules = [];
      if (fetchResp.ok) {
        const data = await fetchResp.json();
        existingRules = Array.isArray(data.calibration_rules) ? data.calibration_rules : [];
      }

      const filteredRules = existingRules.filter(
        r => !(r.metadata_key === metadataKey && String(r.metadata_value) === String(metadataValue))
      );
      const newRules = [...filteredRules, {
        metadata_key: metadataKey,
        metadata_value: String(metadataValue),
        calibration: calibrationData
      }];

      const saveResp = await fetch(`/api/projects/${projectId}/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'calibration_rules', value: newRules })
      });

      if (!saveResp.ok) {
        throw new Error(`Failed to save metadata rule: ${saveResp.statusText}`);
      }

      setIsEditing(false);
      setMessage(`Metadata calibration rule saved (${metadataKey} = ${metadataValue})`);
      setTimeout(() => setMessage(null), 3000);
      await loadCalibration();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteMetadataRule = async () => {
    if (!matchedRule) return;
    if (!window.confirm(
      `Remove calibration rule for ${matchedRule.metadata_key} = ${matchedRule.metadata_value}?`
    )) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const fetchResp = await fetch(`/api/projects/${projectId}/metadata-dict`);
      let existingRules = [];
      if (fetchResp.ok) {
        const data = await fetchResp.json();
        existingRules = Array.isArray(data.calibration_rules) ? data.calibration_rules : [];
      }

      const updatedRules = existingRules.filter(
        r => !(r.metadata_key === matchedRule.metadata_key &&
               String(r.metadata_value) === String(matchedRule.metadata_value))
      );

      const saveResp = await fetch(`/api/projects/${projectId}/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'calibration_rules', value: updatedRules })
      });

      if (!saveResp.ok) {
        throw new Error(`Failed to delete metadata rule: ${saveResp.statusText}`);
      }

      setMessage(`Metadata rule removed (${matchedRule.metadata_key} = ${matchedRule.metadata_value})`);
      setTimeout(() => setMessage(null), 3000);
      await loadCalibration();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Calibration</h3>
        {!isEditing && calibration && (
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

      {!isEditing ? (
        <CalibrationDisplay
          calibration={calibration}
          isImageOverride={isImageOverride}
          matchedRule={matchedRule}
          isLoading={isLoading}
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
