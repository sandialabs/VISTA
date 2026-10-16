import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { rethrowWithServerDetail } from '../../api/client';
import { fetchProjectMetadataDictionary, setProjectMetadata } from '../../api/projects';
import { MM_PER_INCH, areCalibrationScalesConsistent } from '../../utils/calibration';

const MODALITY_METADATA_KEY = 'modality';

function formatScale(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '';
  return Number(Number(value).toPrecision(12)).toString();
}

function buildCalibrationData(pixelsPerUnit, unit) {
  const pixelsPerMm = unit === 'mm' ? pixelsPerUnit : pixelsPerUnit / MM_PER_INCH;
  const pixelsPerInch = pixelsPerMm * MM_PER_INCH;
  return {
    pixels_per_mm: pixelsPerMm,
    pixels_per_inch: pixelsPerInch,
    unit,
    updated_at: new Date().toISOString(),
  };
}

function getModalityRules(calibrationRules) {
  return (Array.isArray(calibrationRules) ? calibrationRules : [])
    .filter((rule) => rule?.metadata_key === MODALITY_METADATA_KEY);
}

function getModalityLabel(modalityOptions, modalityId) {
  const match = (modalityOptions || []).find((modality) => modality?.id === modalityId);
  return match?.label || modalityId;
}

export default function AdvancedCalibrationControl({
  projectId,
  disabled,
  modalityOptions = [],
}) {
  const idPrefix = useId();
  const [modalityRules, setModalityRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draftModalityId, setDraftModalityId] = useState('');
  const [draftUnit, setDraftUnit] = useState('mm');
  const [draftScale, setDraftScale] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const requestTokenRef = useRef(0);

  const loadModalityRules = useCallback(async () => {
    if (!projectId) return;
    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;
    setLoading(true);
    try {
      const data = await fetchProjectMetadataDictionary(projectId);
      if (requestToken !== requestTokenRef.current) return;
      setModalityRules(getModalityRules(data?.calibration_rules));
    } catch (err) {
      if (requestToken !== requestTokenRef.current) return;
      setError(err.message || 'Failed to load advanced calibration rules.');
    } finally {
      if (requestToken === requestTokenRef.current) {
        setLoading(false);
      }
    }
  }, [projectId]);

  useEffect(() => {
    loadModalityRules();
  }, [loadModalityRules]);

  const availableModalityOptions = modalityOptions.filter(
    (modality) => !modalityRules.some((rule) => rule.metadata_value === modality.id),
  );

  useEffect(() => {
    if (draftModalityId && !availableModalityOptions.some((modality) => modality.id === draftModalityId)) {
      setDraftModalityId('');
    }
  }, [availableModalityOptions, draftModalityId]);

  const draftPixelsPerSelectedUnit = Number(draftScale);
  const draftPixelsPerMm = draftUnit === 'mm'
    ? draftPixelsPerSelectedUnit
    : draftPixelsPerSelectedUnit / MM_PER_INCH;
  const draftScaleIsValid = draftScale !== ''
    && Number.isFinite(draftPixelsPerSelectedUnit)
    && draftPixelsPerSelectedUnit > 0
    && areCalibrationScalesConsistent(draftPixelsPerMm, draftPixelsPerMm * MM_PER_INCH);
  const canAddRule = Boolean(draftModalityId) && draftScaleIsValid;

  const saveModalityRules = async (nextRules, successMessage) => {
    setSaving(true);
    setError('');
    setStatus('');
    try {
      await setProjectMetadata(projectId, 'calibration_rules', nextRules)
        .catch(rethrowWithServerDetail('Failed to save advanced calibration'));
      setModalityRules(getModalityRules(nextRules));
      setStatus(successMessage);
    } catch (err) {
      setError(err.message || 'Failed to save advanced calibration.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddRule = async () => {
    if (disabled || saving || !canAddRule) return;
    const calibration = buildCalibrationData(draftPixelsPerSelectedUnit, draftUnit);
    const nextRules = [
      ...modalityRules.filter((rule) => rule.metadata_value !== draftModalityId),
      { metadata_key: MODALITY_METADATA_KEY, metadata_value: draftModalityId, calibration },
    ];
    const modalityLabel = getModalityLabel(modalityOptions, draftModalityId);
    await saveModalityRules(nextRules, `Calibration saved for ${modalityLabel}.`);
    setDraftModalityId('');
    setDraftScale('');
  };

  const handleRemoveRule = async (modalityId) => {
    if (disabled || saving) return;
    const nextRules = modalityRules.filter((rule) => rule.metadata_value !== modalityId);
    const modalityLabel = getModalityLabel(modalityOptions, modalityId);
    await saveModalityRules(nextRules, `Calibration removed for ${modalityLabel}.`);
  };

  const headingId = `${idPrefix}-advanced-calibration-heading`;
  const modalitySelectId = `${idPrefix}-advanced-calibration-modality`;
  const scaleInputId = `${idPrefix}-advanced-calibration-scale`;
  const errorId = `${idPrefix}-advanced-calibration-error`;
  const statusId = `${idPrefix}-advanced-calibration-status`;
  const inputLabel = draftUnit === 'inches' ? 'Advanced calibration pixels per inch' : 'Advanced calibration pixels per millimeter';

  return (
    <section className="part-detail-panel" aria-labelledby={headingId}>
      <h3 id={headingId}>Advanced Calibration</h3>
      <p>
        Add a calibration for a specific image modality (for example optical vs. acoustic). A modality
        calibration takes priority over Project Calibration for images of that modality.
      </p>
      {loading ? (
        <p className="muted">Loading advanced calibration rules...</p>
      ) : (
        <>
          {modalityRules.length === 0 ? (
            <p className="muted">No per-modality calibration configured yet.</p>
          ) : (
            modalityRules.map((rule) => (
              <div className="workbench-controls-row config-entry-grid" key={rule.metadata_value}>
                <strong>{getModalityLabel(modalityOptions, rule.metadata_value)}</strong>
                <span>
                  {formatScale(rule.calibration.unit === 'inches' ? rule.calibration.pixels_per_inch : rule.calibration.pixels_per_mm)}
                  {' '}
                  px/{rule.calibration.unit === 'inches' ? 'in' : 'mm'}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  aria-label={`Remove calibration for ${getModalityLabel(modalityOptions, rule.metadata_value)}`}
                  onClick={() => handleRemoveRule(rule.metadata_value)}
                  disabled={disabled || saving}
                >
                  Remove
                </button>
              </div>
            ))
          )}

          {modalityOptions.length === 0 ? (
            <p className="muted">
              Configure image modalities under Filename Convention before adding per-modality calibration.
            </p>
          ) : availableModalityOptions.length === 0 ? (
            <p className="muted">Every configured modality already has a calibration.</p>
          ) : (
            <div className="project-calibration-controls">
              <label htmlFor={modalitySelectId}>Modality</label>
              <select
                id={modalitySelectId}
                aria-label="Modality"
                value={draftModalityId}
                disabled={disabled || saving}
                onChange={(event) => setDraftModalityId(event.target.value)}
              >
                <option value="">Select modality...</option>
                {availableModalityOptions.map((modality) => (
                  <option key={modality.id} value={modality.id}>{modality.label}</option>
                ))}
              </select>

              <label htmlFor={`${idPrefix}-advanced-calibration-unit`}>Calibration unit</label>
              <select
                id={`${idPrefix}-advanced-calibration-unit`}
                aria-label="Advanced calibration unit"
                value={draftUnit}
                disabled={disabled || saving}
                onChange={(event) => setDraftUnit(event.target.value)}
              >
                <option value="mm">Millimeters (mm)</option>
                <option value="inches">Inches (in)</option>
              </select>

              <label htmlFor={scaleInputId}>{inputLabel}</label>
              <div className="project-calibration-scale-field">
                <input
                  id={scaleInputId}
                  aria-label={inputLabel}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder={draftUnit === 'inches' ? 'e.g. 254' : 'e.g. 10'}
                  value={draftScale}
                  disabled={disabled || saving}
                  onChange={(event) => setDraftScale(event.target.value)}
                />
                <span>px/{draftUnit === 'inches' ? 'in' : 'mm'}</span>
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleAddRule}
                disabled={disabled || saving || !canAddRule}
              >
                {saving ? 'Saving...' : 'Add Calibration'}
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <div id={errorId} className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {status && (
        <div id={statusId} className="alert alert-success" role="status">
          {status}
        </div>
      )}
    </section>
  );
}
