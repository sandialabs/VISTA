import { useCallback, useEffect, useState } from 'react';
import {
  getNormalizedDisplayDomain,
  formatWindowValue,
  normalizeDisplayWindow,
  getWindowPercent,
} from './displayDomain';

export function DisplayWindowControl({ displayWindow, displayDomain, onChange }) {
  const domain = getNormalizedDisplayDomain(displayDomain);
  const normalizedWindow = normalizeDisplayWindow(displayWindow, domain);
  const [draftValues, setDraftValues] = useState({
    min: formatWindowValue(normalizedWindow.min),
    max: formatWindowValue(normalizedWindow.max),
  });

  useEffect(() => {
    setDraftValues({
      min: formatWindowValue(normalizedWindow.min),
      max: formatWindowValue(normalizedWindow.max),
    });
  }, [normalizedWindow.max, normalizedWindow.min]);

  const updateWindow = useCallback((patch) => {
    onChange((previous) => normalizeDisplayWindow({ ...previous, ...patch }, domain, normalizedWindow));
  }, [domain, normalizedWindow, onChange]);

  const handleTextChange = (edge, value) => {
    setDraftValues((previous) => ({ ...previous, [edge]: value }));
    if (value.trim() === '') return;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    updateWindow({ [edge]: numeric });
  };

  const handleTextBlur = () => {
    setDraftValues({
      min: formatWindowValue(normalizedWindow.min),
      max: formatWindowValue(normalizedWindow.max),
    });
  };

  const minPercent = getWindowPercent(normalizedWindow.min, domain);
  const maxPercent = getWindowPercent(normalizedWindow.max, domain);

  return (
    <fieldset
      className="pt3-window-control"
      style={{
        '--window-min-percent': `${minPercent}%`,
        '--window-max-percent': `${maxPercent}%`,
      }}
    >
      <legend>Display window</legend>
      <div className="pt3-window-range-control" data-testid="display-window-slider">
        <div className="pt3-window-range-track" aria-hidden="true">
          <span className="pt3-window-range-fill" />
        </div>
        <input
          type="range"
          aria-label="Display window minimum handle"
          min={domain.min}
          max={domain.max}
          step={domain.step}
          value={normalizedWindow.min}
          onChange={(event) => updateWindow({ min: Number(event.target.value) })}
        />
        <input
          type="range"
          aria-label="Display window maximum handle"
          min={domain.min}
          max={domain.max}
          step={domain.step}
          value={normalizedWindow.max}
          onChange={(event) => updateWindow({ max: Number(event.target.value) })}
        />
      </div>
      <div className="pt3-window-number-row">
        <label htmlFor="mpr-window-min">
          Min
          <input
            id="mpr-window-min"
            type="number"
            aria-label="Display window minimum"
            min={domain.min}
            max={domain.max}
            step={domain.step}
            value={draftValues.min}
            onChange={(event) => handleTextChange('min', event.target.value)}
            onBlur={handleTextBlur}
          />
        </label>
        <label htmlFor="mpr-window-max">
          Max
          <input
            id="mpr-window-max"
            type="number"
            aria-label="Display window maximum"
            min={domain.min}
            max={domain.max}
            step={domain.step}
            value={draftValues.max}
            onChange={(event) => handleTextChange('max', event.target.value)}
            onBlur={handleTextBlur}
          />
        </label>
      </div>
      <span className="pt3-window-domain">
        {formatWindowValue(domain.min)}-{formatWindowValue(domain.max)} {domain.label}
      </span>
    </fieldset>
  );
}
