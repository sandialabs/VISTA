import React from 'react';

/**
 * OverlayControls
 * Provides toggles for different ML overlay layers and opacity control.
 * Props:
 *  - options: { showBoxes: bool, showHeatmap: bool, opacity: number }
 *  - onChange: (partial) => void
 */
export default function OverlayControls({ options, onChange }) {
  if (!options) return null;
  const update = (patch) => onChange && onChange({ ...options, ...patch });
  return (
    <div className="overlay-controls" style={{ border: '1px solid var(--border-color)', borderRadius: 6, padding: '0.5rem', marginTop: '0.75rem' }}>
      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: 14 }}>Overlays</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={options.showBoxes} onChange={e=>update({ showBoxes: e.target.checked })} />
          Bounding Boxes
        </label>
        {options.bitmapAvailable && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={options.showHeatmap} onChange={e=>update({ showHeatmap: e.target.checked })} />
              Heatmap / Segmentation
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              View:
              <select value={options.viewMode || 'overlay'} onChange={e=>update({ viewMode: e.target.value })} style={{ flex: 1 }}>
                <option value="overlay">Overlay</option>
                <option value="side-by-side">Side by Side</option>
              </select>
            </label>
          </>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          Opacity
          <input type="range" min={0.1} max={1} step={0.05} value={options.opacity} onChange={e=>update({ opacity: parseFloat(e.target.value) })} style={{ flex: 1 }} />
          <span style={{ width: 34, textAlign: 'right' }}>{Math.round(options.opacity*100)}%</span>
        </label>
      </div>
    </div>
  );
}
