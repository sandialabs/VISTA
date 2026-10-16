import React from 'react';

export default function ProjectProcessSettingsSection({ config, setConfig }) {
  return (
    <section className="part-detail-panel" aria-label="Process settings">
      <h3>Process Settings</h3>
      <label>
        <input
          type="checkbox"
          checked={Boolean(config.process_settings?.require_disposition_on_submit)}
          onChange={(event) => {
            setConfig((previous) => ({
              ...previous,
              process_settings: {
                ...previous.process_settings,
                require_disposition_on_submit: event.target.checked,
              },
            }));
          }}
        />
        Require disposition on submit
      </label>
      <label>
        <input
          type="checkbox"
          aria-label="Require measurement for critical defects"
          checked={Boolean(config.process_settings?.require_measurement_for_critical)}
          onChange={(event) => {
            setConfig((previous) => ({
              ...previous,
              process_settings: {
                ...previous.process_settings,
                require_measurement_for_critical: event.target.checked,
              },
            }));
          }}
        />
        Require measurement for critical defects
      </label>
      <label>
        <input
          type="checkbox"
          aria-label="Require second reviewer for rejects"
          checked={Boolean(config.process_settings?.require_second_reviewer_for_reject)}
          onChange={(event) => {
            setConfig((previous) => ({
              ...previous,
              process_settings: {
                ...previous.process_settings,
                require_second_reviewer_for_reject: event.target.checked,
              },
            }));
          }}
        />
        Require second reviewer for rejects
      </label>
    </section>
  );
}
