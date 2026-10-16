import { getDefaultSplatParameters, getNormalizedDisplayDomain, formatWindowValue } from './displayDomain';
import { clampRange } from './inspectionUtils';

export function SplatConfigurationModal(props) {
  const {
    splatConfigModalOpen,
    selectedPart,
    displayValueDomain,
    splatParameters,
    setSplatParameterOverridesByPart,
    setSplatConfigModalOpen,
  } = props;
  if (!splatConfigModalOpen || !selectedPart) return null;
  const defaults = getDefaultSplatParameters(selectedPart, displayValueDomain);
  const domain = getNormalizedDisplayDomain(displayValueDomain);
  const draft = splatParameters;
  const updateDraft = (patch) => {
    setSplatParameterOverridesByPart((previous) => ({
      ...previous,
      [selectedPart.id]: {
        ...(previous[selectedPart.id] || {}),
        ...patch,
      },
    }));
  };
  const resetDefaults = () => {
    setSplatParameterOverridesByPart((previous) => {
      const next = { ...previous };
      delete next[selectedPart.id];
      return next;
    });
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-content splat-config-modal" role="dialog" aria-modal="true" aria-labelledby="splat-config-title">
        <div className="modal-header">
          <h3 id="splat-config-title">Simplified 3DGS configuration</h3>
          <button type="button" className="modal-close" aria-label="Close splat configuration" onClick={() => setSplatConfigModalOpen(false)}>×</button>
        </div>
        <p className="muted">
          Defaults are derived from loaded mechanical-part image metadata: {formatWindowValue(domain.min)}-{formatWindowValue(domain.max)} {domain.label}, with a histogram-aware threshold when available.
        </p>
        <div className="splat-config-grid">
          <label htmlFor="splat-threshold">
            Intensity threshold
            <input
              id="splat-threshold"
              type="number"
              min={domain.min}
              max={domain.max}
              step={domain.step}
              value={draft.threshold}
              onChange={(event) => updateDraft({ threshold: Number(event.target.value) })}
            />
          </label>
          <label htmlFor="splat-downsample">
            Downsample stride
            <input
              id="splat-downsample"
              type="number"
              min="1"
              step="1"
              value={draft.downsample}
              onChange={(event) => updateDraft({ downsample: Math.max(1, Number(event.target.value) || 1) })}
            />
          </label>
          <label htmlFor="splat-max-count">
            Maximum splats
            <input
              id="splat-max-count"
              type="number"
              min="1"
              max="100000"
              step="1000"
              value={draft.maxSplats}
              onChange={(event) => updateDraft({
                maxSplats: Math.min(100000, Math.max(1, Number(event.target.value) || defaults.maxSplats)),
              })}
            />
          </label>
          <label htmlFor="splat-output-format">
            Output format
            <select
              id="splat-output-format"
              value={draft.outputFormat}
              onChange={(event) => updateDraft({ outputFormat: event.target.value })}
            >
              <option value="ply">PLY</option>
              <option value="splat">SPLAT JSON</option>
              <option value="json">Metadata JSON</option>
            </select>
          </label>
          <label htmlFor="splat-opacity-min">
            Min opacity
            <input
              id="splat-opacity-min"
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={draft.opacityMin}
              onChange={(event) => updateDraft({ opacityMin: clampRange(Number(event.target.value), 0, 1, defaults.opacityMin) })}
            />
          </label>
          <label htmlFor="splat-opacity-max">
            Max opacity
            <input
              id="splat-opacity-max"
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={draft.opacityMax}
              onChange={(event) => updateDraft({ opacityMax: clampRange(Number(event.target.value), 0, 1, defaults.opacityMax) })}
            />
          </label>
        </div>
        <div className="splat-config-summary" data-testid="splat-config-summary">
          Using threshold {formatWindowValue(draft.threshold)}, stride {draft.downsample}, max {draft.maxSplats.toLocaleString()} splats. Defaults: threshold {formatWindowValue(defaults.threshold)}, stride {defaults.downsample}.
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={resetDefaults}>Reset intelligent defaults</button>
          <button type="button" className="btn btn-primary" onClick={() => setSplatConfigModalOpen(false)}>Apply splat parameters</button>
        </div>
      </div>
    </div>
  );
}
