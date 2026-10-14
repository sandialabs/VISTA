import React from 'react';

export default function HotkeysConfigurationPanel({ config, setConfig }) {
  return (
    <div
      id="configuration-hotkeys-panel"
      className="configuration-hotkeys-panel"
      role="tabpanel"
      aria-label="Hotkeys configuration"
    >
      <section className="part-detail-panel" aria-label="Hotkeys">
        <h3>Hotkeys</h3>
        <p>Customize the single-key shortcuts used while classifying inspection results.</p>
        <div className="workbench-controls-row config-entry-grid">
          <label htmlFor="hotkey-accept">Accept hotkey</label>
          <input
            id="hotkey-accept"
            aria-label="Accept hotkey"
            type="text"
            maxLength={1}
            value={config.process_settings?.configurable_hotkeys?.accept_classification || 'a'}
            onChange={(event) => {
              const nextValue = event.target.value.toLowerCase();
              setConfig((previous) => ({
                ...previous,
                process_settings: {
                  ...previous.process_settings,
                  configurable_hotkeys: {
                    ...(previous.process_settings?.configurable_hotkeys || {}),
                    accept_classification: nextValue,
                  },
                },
              }));
            }}
          />
          <label htmlFor="hotkey-reject">Reject hotkey</label>
          <input
            id="hotkey-reject"
            aria-label="Reject hotkey"
            type="text"
            maxLength={1}
            value={config.process_settings?.configurable_hotkeys?.reject_classification || 'r'}
            onChange={(event) => {
              const nextValue = event.target.value.toLowerCase();
              setConfig((previous) => ({
                ...previous,
                process_settings: {
                  ...previous.process_settings,
                  configurable_hotkeys: {
                    ...(previous.process_settings?.configurable_hotkeys || {}),
                    reject_classification: nextValue,
                  },
                },
              }));
            }}
          />
          <label htmlFor="hotkey-help">Help hotkey</label>
          <input
            id="hotkey-help"
            aria-label="Help hotkey"
            type="text"
            maxLength={1}
            value={config.process_settings?.configurable_hotkeys?.toggle_shortcut_help || 'h'}
            onChange={(event) => {
              const nextValue = event.target.value.toLowerCase();
              setConfig((previous) => ({
                ...previous,
                process_settings: {
                  ...previous.process_settings,
                  configurable_hotkeys: {
                    ...(previous.process_settings?.configurable_hotkeys || {}),
                    toggle_shortcut_help: nextValue,
                  },
                },
              }));
            }}
          />
        </div>
        <p className="muted">Hotkeys must be unique single alphanumeric characters.</p>
      </section>
    </div>
  );
}
