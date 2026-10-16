import React from 'react';
import {
  INSPECTION_TILE_MAX_COLUMNS_MAX,
  INSPECTION_TILE_MAX_COLUMNS_MIN,
  normalizeConfigurationSection,
  normalizeInspectionTileMaxColumns,
} from '../../features/projectConfiguration/configurationSchema';

export default function DisplaySettingsSection({ config, setConfig }) {
  return (
    <section className="part-detail-panel" aria-label="Display settings">
      <h3>Display Settings</h3>
      <label htmlFor="default-colormap">Default colormap</label>
      <select
        id="default-colormap"
        value={config.display_settings?.default_colormap || 'grayscale'}
        onChange={(event) => {
          const nextValue = event.target.value;
          setConfig((previous) => ({
            ...previous,
            display_settings: {
              ...previous.display_settings,
              default_colormap: nextValue,
            },
          }));
        }}
      >
        <option value="grayscale">grayscale</option>
        <option value="magma">magma</option>
        <option value="viridis">viridis</option>
      </select>
      <label htmlFor="anomaly-colormap">Anomaly colormap</label>
      <select
        id="anomaly-colormap"
        aria-label="Anomaly colormap"
        value={config.display_settings?.anomaly_colormap || 'viridis'}
        onChange={(event) => {
          const nextValue = event.target.value;
          setConfig((previous) => ({
            ...previous,
            display_settings: {
              ...previous.display_settings,
              anomaly_colormap: nextValue,
            },
          }));
        }}
      >
        <option value="grayscale">grayscale</option>
        <option value="magma">magma</option>
        <option value="viridis">viridis</option>
      </select>
      <label>
        <input
          type="checkbox"
          aria-label="Use grayscale base image"
          checked={Boolean(config.display_settings?.grayscale_base_image)}
          onChange={(event) => {
            setConfig((previous) => ({
              ...previous,
              display_settings: {
                ...previous.display_settings,
                grayscale_base_image: event.target.checked,
              },
            }));
          }}
        />
        Use grayscale base image
      </label>
      <div className="workbench-controls-row">
        <label htmlFor="inspection-tile-max-columns">Maximum inspection images per row</label>
        <input
          id="inspection-tile-max-columns"
          aria-label="Maximum inspection images per row"
          type="number"
          min={INSPECTION_TILE_MAX_COLUMNS_MIN}
          max={INSPECTION_TILE_MAX_COLUMNS_MAX}
          step="1"
          value={normalizeInspectionTileMaxColumns(config.display_settings?.inspection_tile_max_columns)}
          onChange={(event) => {
            const nextValue = normalizeInspectionTileMaxColumns(event.target.value);
            setConfig((previous) => ({
              ...previous,
              display_settings: {
                ...normalizeConfigurationSection('display_settings', previous),
                inspection_tile_max_columns: nextValue,
              },
            }));
          }}
        />
        <span className="muted">Sets the upper limit for the Inspection tile size slider.</span>
      </div>
    </section>
  );
}
