import React from 'react';
import { normalizeConfigurationSection } from '../../features/projectConfiguration/configurationSchema';

export default function ProjectSerialSchemeSection({ config, setConfig }) {
  return (
    <section className="part-detail-panel" aria-label="Serial number scheme">
      <h3>Serial Number Scheme</h3>
      <p>Choose whether serial numbers are tracked at batch, sub-batch, and part levels.</p>
      <label>
        <input
          type="checkbox"
          checked={Boolean(config.serial_number_scheme?.batch_sn_enabled)}
          onChange={(event) =>
            setConfig((previous) => ({
              ...previous,
              serial_number_scheme: {
                ...normalizeConfigurationSection('serial_number_scheme', previous),
                batch_sn_enabled: event.target.checked,
              },
            }))
          }
        />
        Track serial number at batch level
      </label>
      <label>
        <input
          type="checkbox"
          checked={Boolean(config.serial_number_scheme?.sub_batching_enabled)}
          onChange={(event) =>
            setConfig((previous) => {
              const enabled = event.target.checked;
              return {
                ...previous,
                serial_number_scheme: {
                  ...normalizeConfigurationSection('serial_number_scheme', previous),
                  sub_batching_enabled: enabled,
                  sub_batch_sn_enabled: enabled ? previous.serial_number_scheme?.sub_batch_sn_enabled === true : false,
                },
              };
            })
          }
        />
        Organize each batch into sub-batches
      </label>
      <label>
        <input
          type="checkbox"
          checked={Boolean(config.serial_number_scheme?.sub_batch_sn_enabled)}
          disabled={!config.serial_number_scheme?.sub_batching_enabled}
          onChange={(event) =>
            setConfig((previous) => ({
              ...previous,
              serial_number_scheme: {
                ...normalizeConfigurationSection('serial_number_scheme', previous),
                sub_batch_sn_enabled: event.target.checked,
              },
            }))
          }
        />
        Track serial number at sub-batch level
      </label>
      <label>
        <input
          type="checkbox"
          checked={Boolean(config.serial_number_scheme?.part_sn_enabled)}
          onChange={(event) =>
            setConfig((previous) => ({
              ...previous,
              serial_number_scheme: {
                ...normalizeConfigurationSection('serial_number_scheme', previous),
                part_sn_enabled: event.target.checked,
              },
            }))
          }
        />
        Track serial number at part level
      </label>
    </section>
  );
}
