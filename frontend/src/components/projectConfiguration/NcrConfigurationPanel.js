import React, { useEffect, useRef } from 'react';
import {
  NCR_CODE_DESCRIPTION_MAX_LENGTH,
  NCR_CODE_LISTS,
  NCR_CODE_MAX_LENGTH,
  foldCode,
  normalizeNcrConfiguration,
} from '../../features/projectConfiguration/ncrConfiguration';

// Per-row problem for inline display; mirrors validateNcrConfiguration.
function getRowProblems(entries) {
  const counts = new Map();
  entries.forEach((entry) => {
    const key = foldCode(entry.code);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return entries.map((entry) => {
    const key = foldCode(entry.code);
    if (!key) return 'Enter a code.';
    if (counts.get(key) > 1) return 'This code is already in the list.';
    return '';
  });
}

function updateNcrList(setConfig, listKey, updateEntries) {
  setConfig((previous) => {
    const ncrConfiguration = normalizeNcrConfiguration(previous.ncr_configuration);
    return {
      ...previous,
      ncr_configuration: {
        ...ncrConfiguration,
        [listKey]: updateEntries(ncrConfiguration[listKey]),
      },
    };
  });
}

function NcrCodeListSection({ list, entries, setConfig, disabled }) {
  const { key, label, singular, description } = list;
  const idPrefix = `ncr-${key}`;
  const focusIndexRef = useRef(null);
  const rowProblems = getRowProblems(entries);

  useEffect(() => {
    if (focusIndexRef.current === null) return;
    const input = document.getElementById(`${idPrefix}-code-${focusIndexRef.current}`);
    focusIndexRef.current = null;
    input?.focus();
  }, [entries.length, idPrefix]);

  const addEntry = () => {
    focusIndexRef.current = entries.length;
    updateNcrList(setConfig, key, (current) => [...current, { code: '', description: '' }]);
  };
  const updateEntry = (index, patch) => updateNcrList(setConfig, key, (current) => (
    current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, ...patch } : entry))
  ));
  const removeEntry = (index) => updateNcrList(setConfig, key, (current) => (
    current.filter((_, entryIndex) => entryIndex !== index)
  ));

  const addLabel = `Add ${singular.replace(/^\w/, (letter) => letter.toUpperCase())}`;

  return (
    <section className="part-detail-panel ncr-code-list" aria-label={label}>
      <div className="ncr-code-list-header">
        <h3>{label}</h3>
        <span className="ncr-code-count">{entries.length}</span>
      </div>
      <p className="ncr-code-list-description">{description}</p>
      {entries.length === 0 ? (
        <p className="muted ncr-code-empty">{`No ${singular}s configured yet.`}</p>
      ) : (
        <div className="ncr-code-table" role="table" aria-label={`${label} entries`} data-testid={`${idPrefix}-list`}>
          <div className="ncr-code-row ncr-code-row-head" role="row">
            <span role="columnheader" id={`${idPrefix}-code-head`}>Code</span>
            <span role="columnheader" id={`${idPrefix}-description-head`}>Description</span>
            <span role="columnheader" className="ncr-code-actions-head"><span className="visually-hidden">Actions</span></span>
          </div>
          {entries.map((entry, index) => (
            <div className="ncr-code-row-group" role="rowgroup" key={`${idPrefix}-${index}`}>
              <div className="ncr-code-row" role="row">
                <span role="cell">
                  <input
                    id={`${idPrefix}-code-${index}`}
                    aria-label={`${label} code ${index + 1}`}
                    type="text"
                    className={`form-control ncr-code-input${rowProblems[index] && entry.code.trim() ? ' is-invalid' : ''}`}
                    maxLength={NCR_CODE_MAX_LENGTH}
                    placeholder="e.g. FC-01"
                    value={entry.code}
                    disabled={disabled}
                    aria-invalid={rowProblems[index] ? 'true' : 'false'}
                    aria-describedby={rowProblems[index] ? `${idPrefix}-problem-${index}` : undefined}
                    onChange={(event) => updateEntry(index, { code: event.target.value })}
                  />
                </span>
                <span role="cell">
                  <input
                    id={`${idPrefix}-description-${index}`}
                    aria-label={`${label} description ${index + 1}`}
                    type="text"
                    className="form-control ncr-code-input"
                    maxLength={NCR_CODE_DESCRIPTION_MAX_LENGTH}
                    placeholder="Optional description"
                    value={entry.description}
                    disabled={disabled}
                    onChange={(event) => updateEntry(index, { description: event.target.value })}
                  />
                </span>
                <span role="cell" className="ncr-code-actions">
                  <button
                    className="btn btn-secondary btn-sm ncr-code-remove"
                    type="button"
                    aria-label={`Remove ${singular} ${index + 1}`}
                    title={`Remove ${singular}`}
                    onClick={() => removeEntry(index)}
                    disabled={disabled}
                  >
                    Remove
                  </button>
                </span>
              </div>
              {rowProblems[index] && (
                <p
                  id={`${idPrefix}-problem-${index}`}
                  className={`ncr-code-problem${entry.code.trim() ? ' ncr-code-problem-error' : ''}`}
                >
                  {rowProblems[index]}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <button className="btn btn-secondary btn-sm ncr-code-add" type="button" onClick={addEntry} disabled={disabled}>
        <span aria-hidden="true" className="ncr-code-add-icon">+</span>
        {addLabel}
      </button>
    </section>
  );
}

export default function NcrConfigurationPanel({ config, setConfig, readOnly = false }) {
  const ncrConfiguration = normalizeNcrConfiguration(config?.ncr_configuration);
  // Saving must not disable editing: autosave runs while the user types.
  const disabled = readOnly;

  return (
    <div
      id="configuration-ncr-panel"
      className="configuration-ncr-panel"
      role="tabpanel"
      aria-label="NCR configuration"
    >
      <section className="part-detail-panel ncr-config-intro" aria-label="NCR configuration overview">
        <h3>NCR Configuration</h3>
        <p>
          Codes offered when inspectors raise a nonconformance report. Existing NCRs keep the code and description
          they were saved with.
        </p>
      </section>
      {NCR_CODE_LISTS.map((list) => (
        <NcrCodeListSection
          key={list.key}
          list={list}
          entries={ncrConfiguration[list.key]}
          setConfig={setConfig}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
