import React from 'react';
import { PROJECT_PHASE_LABELS, PROJECT_PHASE_SEQUENCE } from '../../utils/projectPhases';
import { normalizeConfigurationSection } from '../../features/projectConfiguration/configurationSchema';

export default function ProjectPhaseSettingsSection({ config, setConfig }) {
  return (
    <section className="part-detail-panel" aria-label="Project phase settings">
      <h3>Project Phase Settings</h3>
      <p>
        By default, projects progress automatically from Data Ingestion to Part Inspection to Reporting as data is
        loaded and annotated.
      </p>
      <label>
        <input
          type="checkbox"
          checked={Boolean(config.phase_settings?.manual_phase_selection_enabled)}
          onChange={(event) =>
            setConfig((previous) => ({
              ...previous,
              phase_settings: {
                ...normalizeConfigurationSection('phase_settings', previous),
                manual_phase_selection_enabled: event.target.checked,
              },
            }))
          }
        />
        Manually choose current project phase
      </label>
      <div className="workbench-controls-row">
        <label htmlFor="manual-project-phase">Manual phase</label>
        <select
          id="manual-project-phase"
          aria-label="Manual project phase"
          disabled={!config.phase_settings?.manual_phase_selection_enabled}
          value={config.phase_settings?.manual_phase || 'data_ingestion'}
          onChange={(event) =>
            setConfig((previous) => ({
              ...previous,
              phase_settings: {
                ...normalizeConfigurationSection('phase_settings', previous),
                manual_phase: event.target.value,
              },
            }))
          }
        >
          {PROJECT_PHASE_SEQUENCE.map((phaseKey) => (
            <option key={phaseKey} value={phaseKey}>
              {PROJECT_PHASE_LABELS[phaseKey]}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
