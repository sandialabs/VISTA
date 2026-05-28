import React, { useState, useMemo, useEffect } from 'react';

export const VISTA_HIERARCHY_KEYS = [
  'design_number',
  'lot_number',
  'set_number',
  'serial_number',
  'side',
  'modality',
  'overlay',
];
const VISTA_HIERARCHY_DELIMITER = '_';

const CONFIG_ID_TO_METADATA_KEY = {
  drawing_number: 'design_number',
  design_number: 'design_number',
  lot_number: 'lot_number',
  serial_number: 'serial_number',
  set_number: 'set_number',
  batch_number: 'batch_number',
  batch: 'batch_number',
  part_number: 'set_number',
  view: 'side',
  side: 'side',
  modality: 'modality',
  overlay: 'overlay',
};

function normalizeConfigEntry(entry) {
  const id = String(entry?.id || '').trim();
  return {
    id,
    key: CONFIG_ID_TO_METADATA_KEY[id] || id,
    abbreviation: String(entry?.abbreviation || '').trim(),
  };
}

function buildConfiguredFilenameFields(fileNamingScheme) {
  const hierarchyLevels = Array.isArray(fileNamingScheme?.hierarchy_levels)
    ? fileNamingScheme.hierarchy_levels
    : [];
  const imageDescriptors = Array.isArray(fileNamingScheme?.image_descriptors)
    ? fileNamingScheme.image_descriptors
    : [];
  const fields = [...hierarchyLevels, ...imageDescriptors]
    .map(normalizeConfigEntry)
    .filter((entry) => entry.key && entry.key !== 'revision' && entry.key !== 'timestamp' && entry.key !== 'operator');
  if (fields.length > 0 && !fields.some((entry) => entry.key === 'overlay')) {
    fields.push({ id: 'overlay', key: 'overlay', abbreviation: '' });
  }
  return fields;
}

function stripConfiguredAbbreviation(value, field) {
  const raw = String(value ?? '').trim();
  const abbreviation = String(field?.abbreviation || '').trim();
  if (!abbreviation) return raw;
  return raw.toLowerCase().startsWith(abbreviation.toLowerCase())
    ? raw.slice(abbreviation.length)
    : raw;
}

/**
 * FilenameMetadataExtractor - extracts key-value metadata from filenames.
 *
 * Supports two modes:
 *   Simple  - splits the filename stem on a user-supplied delimiter string.
 *   Advanced - uses a regular expression with capture groups.
 *
 * Props:
 *   files          - array of File objects currently selected for upload.
 *   onConfigChange - called with { isValid, hasPattern, extractMetadata }
 *                    whenever the extractor configuration changes.
 *                    extractMetadata(filename) returns a plain object or null.
 */

// Module-level helpers (no component state dependency).
function stripExtension(name) {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

function extractValues(stem, mode, pattern) {
  if (!pattern) return { values: [], error: null };

  if (mode === 'simple') {
    return { values: stem.split(pattern), error: null };
  }

  // Advanced (regex) mode.
  try {
    const regex = new RegExp(pattern);
    const match = stem.match(regex);
    if (!match) {
      return { values: [], error: 'Pattern does not match filename' };
    }
    // Use capture groups when present, otherwise fall back to the full match.
    const captured = match.slice(1);
    return { values: captured.length > 0 ? captured : [match[0]], error: null };
  } catch (e) {
    return { values: [], error: `Invalid regex: ${e.message}` };
  }
}

function FilenameMetadataExtractor({ files, onConfigChange, fileNamingScheme = null }) {
  const [mode, setMode] = useState('simple');
  const [pattern, setPattern] = useState('');
  const [keysInput, setKeysInput] = useState('');
  const [userEditedConfig, setUserEditedConfig] = useState(false);

  const configuredFields = useMemo(() => buildConfiguredFilenameFields(fileNamingScheme), [fileNamingScheme]);

  // The filename stem used for the live preview (first selected file).
  const previewStem = files.length > 0 ? stripExtension(files[0].name) : '';

  useEffect(() => {
    if (userEditedConfig || !previewStem || pattern || keysInput) return;
    const candidateDelimiters = [VISTA_HIERARCHY_DELIMITER, '-', '.'];
    const configuredMatch = configuredFields.length > 0
      ? candidateDelimiters
        .map((delimiter) => ({ delimiter, values: previewStem.split(delimiter) }))
        .find((candidate) => candidate.values.length === configuredFields.length)
      : null;
    if (configuredMatch) {
      setMode('simple');
      setPattern(configuredMatch.delimiter);
      setKeysInput(configuredFields.map((field) => field.key).join(', '));
      return;
    }

    const candidateValues = previewStem.split(VISTA_HIERARCHY_DELIMITER);
    if (candidateValues.length !== VISTA_HIERARCHY_KEYS.length) return;
    const hierarchyKeys = [...VISTA_HIERARCHY_KEYS];
    if (String(candidateValues[2] || '').toUpperCase().startsWith('BATCH')) {
      hierarchyKeys[2] = 'batch_number';
    }
    setMode('simple');
    setPattern(VISTA_HIERARCHY_DELIMITER);
    setKeysInput(hierarchyKeys.join(', '));
  }, [configuredFields, keysInput, pattern, previewStem, userEditedConfig]);

  // Live-preview results for the first selected filename.
  // Also validates the regex pattern even when no file is selected.
  const { values: previewValues, error: extractError } = useMemo(() => {
    if (!previewStem) {
      // Validate regex pattern even without a file to preview.
      if (mode === 'advanced' && pattern) {
        try {
          new RegExp(pattern); // eslint-disable-line no-new
        } catch (e) {
          return { values: [], error: `Invalid regex: ${e.message}` };
        }
      }
      return { values: [], error: null };
    }
    return extractValues(previewStem, mode, pattern);
  }, [mode, pattern, previewStem]);

  // Parse the comma-separated key list.
  const keys = useMemo(() => {
    if (!keysInput.trim()) return [];
    return keysInput
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  }, [keysInput]);

  // Determine whether there is a key/value count mismatch.
  const mismatch =
    pattern.length > 0 &&
    previewValues.length > 0 &&
    keys.length > 0 &&
    keys.length !== previewValues.length;

  // The extractor is considered invalid when there is an error or a mismatch.
  const isValid = !extractError && !mismatch;

  // Build the live-preview JSON string (shown only when counts match).
  const previewJson = useMemo(() => {
    if (
      keys.length === 0 ||
      previewValues.length === 0 ||
      keys.length !== previewValues.length
    ) {
      return null;
    }
    const obj = {};
    keys.forEach((k, i) => {
      obj[k] = previewValues[i];
    });
    return JSON.stringify(obj, null, 2);
  }, [keys, previewValues]);

  // Build the extractMetadata function exposed to the parent.
  const extractMetadata = useMemo(() => {
    return (filename) => {
      if (!pattern || keys.length === 0) return null;
      const stem = stripExtension(filename);
      const { values, error } = extractValues(stem, mode, pattern);
      if (error || values.length !== keys.length) return null;
      const obj = {};
      keys.forEach((k, i) => {
        const field = configuredFields[i];
        obj[k] = mode === 'simple' ? stripConfiguredAbbreviation(values[i], field) : values[i];
      });
      return obj;
    };
  }, [mode, pattern, keys, configuredFields]);

  // Notify the parent of configuration changes.
  useEffect(() => {
    if (onConfigChange) {
      onConfigChange({
        isValid,
        hasPattern: pattern.length > 0,
        extractMetadata,
        keys,
      });
    }
  }, [isValid, pattern, extractMetadata, onConfigChange, keys]);

  return (
    <div className="filename-extractor">
      <div className="filename-extractor-header">
        <h3 className="filename-extractor-title">Extract Metadata from Filenames (Optional)</h3>
        <div className="filename-extractor-modes">
          <label className="filename-extractor-mode-label">
            <input
              type="radio"
              name="extractor-mode"
              value="simple"
              checked={mode === 'simple'}
              onChange={() => {
                setUserEditedConfig(true);
                setMode('simple');
              }}
            />
            Simple
          </label>
          <label className="filename-extractor-mode-label">
            <input
              type="radio"
              name="extractor-mode"
              value="advanced"
              checked={mode === 'advanced'}
              onChange={() => {
                setUserEditedConfig(true);
                setMode('advanced');
              }}
            />
            Advanced (Regex)
          </label>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="extractor-pattern">
          {mode === 'simple' ? 'Delimiter' : 'Regex Pattern'}
        </label>
        <input
          id="extractor-pattern"
          type="text"
          value={pattern}
          onChange={(e) => {
            setUserEditedConfig(true);
            setPattern(e.target.value);
          }}
          placeholder={
            mode === 'simple'
              ? 'e.g. _ or - or .'
              : 'e.g. (.+)_(.+)_(.+)_(.+)'
          }
          className={extractError ? 'input-error' : ''}
        />
        {extractError && (
          <div className="filename-extractor-error">{extractError}</div>
        )}
      </div>

      {pattern && previewStem && previewValues.length > 0 && !extractError && (
        <div className="form-group">
          <label>Extracted Values (preview from &quot;{files[0].name}&quot;)</label>
          <div className="filename-extractor-array-preview">
            {JSON.stringify(previewValues)}
          </div>
        </div>
      )}

      {pattern && (
        <div className="form-group">
          <label htmlFor="extractor-keys">Keys (comma-separated)</label>
          <input
          id="extractor-keys"
          type="text"
          value={keysInput}
          onChange={(e) => {
            setUserEditedConfig(true);
            setKeysInput(e.target.value);
          }}
          placeholder="e.g. design_number, lot_number, set_number, serial_number, side, modality, overlay"
        />
      </div>
      )}

      {mismatch && (
        <div className="filename-extractor-warning">
          Number of values ({previewValues.length}) does not match number of
          keys ({keys.length})
        </div>
      )}

      {previewJson && (
        <div className="form-group">
          <label>Key-Value Preview (first file)</label>
          <pre className="filename-extractor-json-preview">{previewJson}</pre>
        </div>
      )}
    </div>
  );
}

export default FilenameMetadataExtractor;
