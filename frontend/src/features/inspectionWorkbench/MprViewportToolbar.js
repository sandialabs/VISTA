import { DisplayWindowControl } from './DisplayWindowControl';
import { formatWindowValue } from './displayDomain';
import {
  MPR_RECONSTRUCTION_MODES,
  RAY_MARCH_RECONSTRUCTION_IDS,
  RAY_MARCH_RECONSTRUCTION_OPTIONS,
  RAY_MARCH_SELECTOR_PREFIX,
  normalizeMprReconstructionMode,
} from './mprConstants';

export function MprViewportToolbar({ selectedPart, projectType, filteredParts, readOnly, volume, display, handlers }) {
  const {
    canShowStackReconstruction,
    canShowGaussianSplatPreview,
    mprReconstructionSelectorValue,
  } = volume;
  const {
    displayWindow,
    displayValueDomain,
    tooltipValues,
  } = display;
  const {
    setSelectedPartId,
    setDisplayWindow,
    setMprReconstructionMode,
    setRayMarchSettings,
    openSegmentationHelper,
    setSplatConfigModalOpen,
  } = handlers;
  return (
    <div className="mpr-control-strip">
      {projectType === 'PT3' && filteredParts.length > 1 && (
        <label htmlFor="mpr-part-selector" className="mpr-part-selector">
          Part
          <select
            id="mpr-part-selector"
            data-testid="mpr-part-selector"
            value={selectedPart?.id || ''}
            onChange={(event) => setSelectedPartId(event.target.value)}
          >
            {filteredParts.map((part) => (
              <option key={part.id} value={part.id}>
                {part.display_name || part.serial_number || part.id}
              </option>
            ))}
          </select>
        </label>
      )}
      <DisplayWindowControl
        displayWindow={displayWindow}
        displayDomain={displayValueDomain}
        onChange={setDisplayWindow}
      />
      <span className="group-badge">{formatWindowValue(displayWindow.min)}-{formatWindowValue(displayWindow.max)}</span>
      <label className="mpr-reconstruction-selector" htmlFor="mpr-reconstruction-mode">
        3D view
        <select
          id="mpr-reconstruction-mode"
          value={mprReconstructionSelectorValue}
          onChange={(event) => {
            const selectedValue = event.target.value;
            if (selectedValue.startsWith(RAY_MARCH_SELECTOR_PREFIX)) {
              const reconstructionStyle = selectedValue.slice(RAY_MARCH_SELECTOR_PREFIX.length);
              if (RAY_MARCH_RECONSTRUCTION_IDS.has(reconstructionStyle)) {
                setMprReconstructionMode(MPR_RECONSTRUCTION_MODES.volume3d);
                setRayMarchSettings((current) => ({
                  ...current,
                  reconstructionStyle,
                }));
              }
              return;
            }
            setMprReconstructionMode(normalizeMprReconstructionMode(selectedValue));
          }}
        >
          <option value={MPR_RECONSTRUCTION_MODES.orientation}>Orientation only</option>
          <option value={MPR_RECONSTRUCTION_MODES.stack} disabled={!canShowStackReconstruction}>
            Stack reconstruction
          </option>
          <optgroup label="Ray marching">
            {RAY_MARCH_RECONSTRUCTION_OPTIONS.map(({ value, label }) => (
              <option
                key={value}
                value={`${RAY_MARCH_SELECTOR_PREFIX}${value}`}
                disabled={!canShowGaussianSplatPreview}
              >
                {label}
              </option>
            ))}
          </optgroup>
          <option value={MPR_RECONSTRUCTION_MODES.splat} disabled={!canShowGaussianSplatPreview}>
            Simplified 3DGS
          </option>
          <option value={MPR_RECONSTRUCTION_MODES.realSplat} disabled={!canShowGaussianSplatPreview}>
            Real 3DGS
          </option>
        </select>
      </label>
      {mprReconstructionSelectorValue === MPR_RECONSTRUCTION_MODES.splat && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          data-testid="splat-config-button"
          onClick={() => setSplatConfigModalOpen(true)}
        >
          3DGS configuration
        </button>
      )}
      <span className="mpr-probe-readout">Probe {tooltipValues.base}</span>
      <div className="mpr-ml-actions">
        {projectType === 'PT3' && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={openSegmentationHelper}
            disabled={!selectedPart || readOnly}
          >
            Segmentation Helpers
          </button>
        )}
      </div>
    </div>
  );
}
