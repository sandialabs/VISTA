import React, { useState, useMemo, useEffect, useRef } from 'react';

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

export const CONFIG_ID_TO_METADATA_KEY = {
  drawing_number: 'design_number',
  design_number: 'design_number',
  lot_number: 'lot_number',
  serial_number: 'serial_number',
  set_number: 'set_number',
  batch_number: 'batch_number',
  batch: 'batch_number',
  sub_batch: 'sub_batch',
  part_number: 'set_number',
  view: 'side',
  side: 'side',
  modality: 'modality',
  overlay: 'overlay',
  version: 'version',
  image_version: 'version',
  image_identifier: 'image_identifier',
  image_sequence: 'image_sequence',
  channel: 'channel',
  wavelength: 'wavelength',
  exposure: 'exposure',
  lighting: 'lighting',
};

export function metadataKeyFromFilenameEntry(entry, fallback = '') {
  const id = String(entry?.id || '').trim();
  const label = String(entry?.label || '').trim();
  const rawKey = CONFIG_ID_TO_METADATA_KEY[id] || (id && id !== 'other' ? id : label) || fallback;
  return String(rawKey || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeConfigEntry(entry) {
  const id = String(entry?.id || '').trim();
  const key = metadataKeyFromFilenameEntry(entry);
  return {
    id,
    key,
    abbreviation: String(entry?.abbreviation || '').trim(),
  };
}


export function normalizeOverlayIndicatorConfig(source = {}) {
  const values = Array.isArray(source.values) ? source.values : String(source.values || '').split(',');
  const normalizedValues = values
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return {
    enabled: source.enabled !== false,
    field_key: String(source.field_key || 'overlay').trim() || 'overlay',
    values: normalizedValues.length > 0 ? normalizedValues : ['true', 'overlay', 'ov', 'mask', 'heatmap'],
    remove_from_base_filename: source.remove_from_base_filename !== false,
  };
}

function isOverlayIndicatorValue(value, overlayIndicator) {
  const normalizedValue = String(value ?? '').trim().toLowerCase();
  if (!normalizedValue) return false;
  return overlayIndicator.values.some((candidate) => normalizedValue === String(candidate).trim().toLowerCase());
}

function replaceExtension(filename, stem) {
  const name = String(filename || '');
  const idx = name.lastIndexOf('.');
  return idx > 0 ? `${stem}${name.slice(idx)}` : stem;
}

export function deriveOverlayBaseFilename(filename, values, keys, mode, pattern, overlayIndex) {
  if (overlayIndex < 0 || mode !== 'simple' || !pattern) return '';
  const stem = stripExtension(filename);
  const segments = Array.isArray(values) && values.length > 0 ? [...values] : stem.split(pattern);
  if (overlayIndex >= segments.length) return '';
  segments.splice(overlayIndex, 1);
  if (segments.length === 0) return '';
  return replaceExtension(filename, segments.join(pattern));
}

export function applyOverlayIndicatorMetadata(filename, metadata, values, keys, mode, pattern, fileNamingScheme = null) {
  if (!fileNamingScheme?.overlay_indicator) return metadata;
  const overlayIndicator = normalizeOverlayIndicatorConfig(fileNamingScheme.overlay_indicator);
  if (!overlayIndicator.enabled || !metadata || typeof metadata !== 'object') return metadata;
  const overlayKey = overlayIndicator.field_key;
  const overlayIndex = keys.findIndex((key) => key === overlayKey);
  const overlayRawValue = overlayIndex >= 0 ? values[overlayIndex] : metadata[overlayKey];
  if (!isOverlayIndicatorValue(overlayRawValue, overlayIndicator)) {
    if (overlayKey === 'overlay' && metadata.overlay !== undefined) {
      return { ...metadata, overlay: false };
    }
    return metadata;
  }
  const nextMetadata = { ...metadata, overlay: true };
  if (overlayIndicator.remove_from_base_filename) {
    const baseFilename = deriveOverlayBaseFilename(filename, values, keys, mode, pattern, overlayIndex);
    if (baseFilename) nextMetadata.overlay_base_filename = baseFilename;
  }
  return nextMetadata;
}

export function buildConfiguredFilenameFields(fileNamingScheme) {
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

export function stripConfiguredAbbreviation(value, field) {
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
export function stripExtension(name) {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

export function extractValues(stem, mode, pattern) {
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

function FilenameMetadataExtractor({
  files = [],
  onConfigChange,
  fileNamingScheme = null,
  initialConfig = null,
  previewFilename = '',
  title = 'Extract Metadata from Filenames (Optional)',
}) {
  const initialMode = initialConfig?.mode === 'advanced' ? 'advanced' : 'simple';
  const initialPattern = String(initialConfig?.pattern || initialConfig?.delimiter || fileNamingScheme?.delimiter || '');
  const initialKeys = Array.isArray(initialConfig?.keys)
    ? initialConfig.keys.join(', ')
    : String(initialConfig?.keysInput || '');
  const [mode, setMode] = useState(initialMode);
  const [pattern, setPattern] = useState(initialPattern);
  const [keysInput, setKeysInput] = useState(initialKeys);
  const [userEditedConfig, setUserEditedConfig] = useState(false);
  const lastConfigSignatureRef = useRef('');

  const configuredFields = useMemo(() => buildConfiguredFilenameFields(fileNamingScheme), [fileNamingScheme]);

  // The filename stem used for the live preview (first selected file).
  const activePreviewFilename = files.length > 0 ? files[0].name : previewFilename;
  const previewStem = activePreviewFilename ? stripExtension(activePreviewFilename) : '';

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
      return applyOverlayIndicatorMetadata(filename, obj, values, keys, mode, pattern, fileNamingScheme);
    };
  }, [mode, pattern, keys, configuredFields, fileNamingScheme]);

  // Notify the parent of configuration changes.
  useEffect(() => {
    if (onConfigChange) {
      const error = extractError || (mismatch ? `Number of values (${previewValues.length}) does not match number of keys (${keys.length})` : null);
      const signature = JSON.stringify({
        isValid,
        hasPattern: pattern.length > 0,
        keys,
        mode,
        pattern,
        previewValues,
        previewJson,
        error,
      });
      if (signature === lastConfigSignatureRef.current) return;
      lastConfigSignatureRef.current = signature;
      onConfigChange({
        isValid,
        hasPattern: pattern.length > 0,
        extractMetadata,
        keys,
        mode,
        pattern,
        previewValues,
        previewJson,
        error,
      });
    }
  }, [isValid, pattern, extractMetadata, onConfigChange, keys, mode, previewValues, previewJson, extractError, mismatch]);

  return (
    <div className="filename-extractor">
      <div className="filename-extractor-header">
        <h3 className="filename-extractor-title">{title}</h3>
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
          <label>Extracted Values (preview from &quot;{activePreviewFilename}&quot;)</label>
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
