import React, { useEffect, useState } from 'react';
import { MM_PER_INCH, areCalibrationScalesConsistent } from '../../utils/calibration';
import { isValidOptionalProjectCalibration } from '../../features/projectConfiguration/configurationSchema';

function formatCalibrationScale(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '';
  return Number(Number(value).toPrecision(12)).toString();
}

export default function ProjectCalibrationControl({
  calibration,
  disabled,
  onChange,
  onValidityChange,
}) {
  const calibrationIsSet = isValidOptionalProjectCalibration(calibration) && calibration != null;
  const persistedUnit = calibration?.unit === 'inches' ? 'inches' : 'mm';
  const [unit, setUnit] = useState(persistedUnit);
  const [scaleTouched, setScaleTouched] = useState(false);
  const [draftScale, setDraftScale] = useState(() => (
    calibrationIsSet
      ? formatCalibrationScale(
        persistedUnit === 'inches' ? calibration.pixels_per_inch : calibration.pixels_per_mm,
      )
      : ''
  ));

  useEffect(() => {
    const nextUnit = calibration?.unit === 'inches' ? 'inches' : 'mm';
    setUnit(nextUnit);
    setDraftScale(calibration && isValidOptionalProjectCalibration(calibration)
      ? formatCalibrationScale(
        nextUnit === 'inches' ? calibration.pixels_per_inch : calibration.pixels_per_mm,
      )
      : '');
    setScaleTouched(false);
    onValidityChange(true);
  }, [
    calibration,
    calibration?.pixels_per_inch,
    calibration?.pixels_per_mm,
    calibration?.unit,
    onValidityChange,
  ]);

  const updateScale = (nextDraft) => {
    setDraftScale(nextDraft);
    setScaleTouched(true);
    const pixelsPerSelectedUnit = Number(nextDraft);
    const selectedScaleIsValid = nextDraft !== ''
      && Number.isFinite(pixelsPerSelectedUnit)
      && pixelsPerSelectedUnit > 0;
    const pixelsPerMm = unit === 'mm'
      ? pixelsPerSelectedUnit
      : pixelsPerSelectedUnit / MM_PER_INCH;
    const pixelsPerInch = pixelsPerMm * MM_PER_INCH;
    const nextScaleIsValid = selectedScaleIsValid
      && areCalibrationScalesConsistent(pixelsPerMm, pixelsPerInch);
    onValidityChange(nextScaleIsValid);
    if (!nextScaleIsValid) return;
    onChange({
      pixels_per_mm: pixelsPerMm,
      pixels_per_inch: pixelsPerInch,
      unit,
      updated_at: new Date().toISOString(),
    });
  };

  const updateUnit = (nextUnit) => {
    setUnit(nextUnit);
    setScaleTouched(false);
    onValidityChange(true);
    if (!calibrationIsSet) {
      setDraftScale('');
      return;
    }
    setDraftScale(formatCalibrationScale(
      nextUnit === 'inches' ? calibration.pixels_per_inch : calibration.pixels_per_mm,
    ));
    onChange({
      ...calibration,
      unit: nextUnit,
      updated_at: new Date().toISOString(),
    });
  };

  const draftPixelsPerSelectedUnit = Number(draftScale);
  const draftPixelsPerMm = unit === 'mm'
    ? draftPixelsPerSelectedUnit
    : draftPixelsPerSelectedUnit / MM_PER_INCH;
  const scaleIsInvalid = scaleTouched && (
    draftScale === ''
    || !areCalibrationScalesConsistent(
      draftPixelsPerMm,
      draftPixelsPerMm * MM_PER_INCH,
    )
  );
  const inputLabel = unit === 'inches' ? 'Pixels per inch' : 'Pixels per millimeter';
  const scaleDescriptionId = 'project-calibration-scale-description';
  const validationMessageId = 'project-calibration-scale-error';

  return (
    <section
      className="part-detail-panel project-calibration-card"
      aria-labelledby="project-calibration-heading"
    >
      <div className="project-calibration-heading">
        <div>
          <span>METROLOGY · PROJECT DEFAULT</span>
          <h3 id="project-calibration-heading">Project Calibration</h3>
        </div>
        <strong className={calibrationIsSet ? 'is-set' : ''}>
          {calibrationIsSet ? 'CALIBRATED' : 'NOT SET'}
        </strong>
      </div>
      <p>
        Set the global image scale used when an image has no session, image, or metadata-rule calibration.
      </p>
      <div className="project-calibration-controls">
        <label htmlFor="project-calibration-unit">Calibration unit</label>
        <select
          id="project-calibration-unit"
          aria-label="Project calibration unit"
          value={unit}
          disabled={disabled}
          onChange={(event) => updateUnit(event.target.value)}
        >
          <option value="mm">Millimeters (mm)</option>
          <option value="inches">Inches (in)</option>
        </select>

        <label htmlFor="project-calibration-scale">{inputLabel}</label>
        <div className="project-calibration-scale-field">
          <input
            id="project-calibration-scale"
            aria-label={inputLabel}
            aria-describedby={`${scaleDescriptionId}${scaleIsInvalid ? ` ${validationMessageId}` : ''}`}
            aria-invalid={scaleIsInvalid}
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            placeholder={unit === 'inches' ? 'e.g. 254' : 'e.g. 10'}
            value={draftScale}
            disabled={disabled}
            onChange={(event) => updateScale(event.target.value)}
          />
          <span>px/{unit === 'inches' ? 'in' : 'mm'}</span>
        </div>
      </div>
      <small id={scaleDescriptionId}>
        Enter a positive scale. VISTA stores the equivalent millimeter and inch values.
      </small>
      {scaleIsInvalid && (
        <div id={validationMessageId} className="project-calibration-error" role="alert">
          Calibration must be a positive finite number.
        </div>
      )}
      <div className="project-calibration-footer">
        <output aria-live="polite">
          {calibrationIsSet
            ? `1 ${unit === 'inches' ? 'in' : 'mm'} = ${formatCalibrationScale(
              unit === 'inches' ? calibration.pixels_per_inch : calibration.pixels_per_mm,
            )} px`
            : 'Measurements fall back to legacy project metadata when available.'}
        </output>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabled || calibration == null}
          onClick={() => {
            setScaleTouched(false);
            onValidityChange(true);
            onChange(null);
          }}
        >
          Clear Calibration
        </button>
      </div>
    </section>
  );
}
