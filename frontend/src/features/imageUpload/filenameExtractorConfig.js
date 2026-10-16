import {
  applyOverlayIndicatorMetadata,
  buildConfiguredFilenameFields,
  extractValues,
  isFilenameConventionEnabled,
  stripConfiguredAbbreviation,
  stripExtension,
} from '../../components/FilenameMetadataExtractor';

// Builds the filename metadata extractor config implied by a project's saved
// file naming scheme, before any in-session override from the decoder UI.
export function buildSavedFilenameExtractorConfig(projectConfiguration) {
  const scheme = projectConfiguration?.file_naming_scheme || {};
  const conventionEnabled = isFilenameConventionEnabled(scheme);
  const extractor = scheme.metadata_extractor || {};
  const mode = extractor.mode === 'advanced' ? 'advanced' : 'simple';
  const pattern = String(extractor.pattern || extractor.delimiter || (conventionEnabled ? scheme.delimiter : '') || '');
  const keys = Array.isArray(extractor.keys) ? extractor.keys.filter(Boolean) : [];
  const configuredFields = buildConfiguredFilenameFields(scheme);
  const isValid = pattern.length === 0 || keys.length > 0;

  return {
    isValid,
    hasPattern: pattern.length > 0,
    keys,
    extractMetadata: (filename) => {
      if (!pattern || keys.length === 0) return null;
      const stem = stripExtension(filename);
      const { values, error } = extractValues(stem, mode, pattern);
      if (error || values.length !== keys.length) return null;
      const obj = {};
      keys.forEach((key, index) => {
        const field = configuredFields[index];
        obj[key] = mode === 'simple' ? stripConfiguredAbbreviation(values[index], field) : values[index];
      });
      return applyOverlayIndicatorMetadata(filename, obj, values, keys, mode, pattern, scheme);
    },
  };
}
