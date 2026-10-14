import { PT3_GUIDE_FIELDS } from '../../components/projectConfiguration/Pt3GuideControls';
import {
  INSPECTION_TILE_MAX_COLUMNS_MAX,
  INSPECTION_TILE_MAX_COLUMNS_MIN,
  isSingleAlphanumeric,
  isValidOptionalProjectCalibration,
  normalizeLower,
} from './configurationSchema';

function isValidOptionalPt3GuideSettings(value) {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(PT3_GUIDE_FIELDS).every(([field, definition]) => {
    const candidate = value[field];
    if (candidate === undefined) return true;
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return false;
    if (candidate < definition.limits.min || candidate > definition.limits.max) return false;
    return definition.unit !== '%' || Number.isInteger(candidate);
  });
}

function hasValidTopLevelShape(clonedConfig) {
  return (
    typeof clonedConfig === 'object' &&
    Array.isArray(clonedConfig.image_modalities) &&
    Array.isArray(clonedConfig.part_views) &&
    Array.isArray(clonedConfig.defect_types) &&
    clonedConfig.process_settings &&
    typeof clonedConfig.process_settings === 'object' &&
    clonedConfig.display_settings &&
    typeof clonedConfig.display_settings === 'object'
  );
}

function hasValidCollectionEntries(clonedConfig) {
  return (
    clonedConfig.image_modalities.every(
      (modality) => modality && typeof modality === 'object',
    ) &&
    clonedConfig.part_views.every(
      (partView) =>
        partView &&
        typeof partView === 'object' &&
        Array.isArray(partView.required_modalities || []),
    ) &&
    clonedConfig.defect_types.every(
      (defectType) => defectType && typeof defectType === 'object',
    )
  );
}

function hasValidScalarFields(clonedConfig) {
  return (
    clonedConfig.image_modalities.every(
      (modality) => typeof modality.id === 'string' && typeof modality.label === 'string',
    ) &&
    clonedConfig.part_views.every(
      (partView) =>
        typeof partView.id === 'string' &&
        typeof partView.label === 'string' &&
        partView.required_modalities.every((requiredModality) => typeof requiredModality === 'string'),
    ) &&
    clonedConfig.defect_types.every(
      (defectType) => typeof defectType.name === 'string' && typeof defectType.color === 'string',
    )
  );
}

function hasValidSemanticScalarFields(clonedConfig) {
  return (
    clonedConfig.image_modalities.every(
      (modality) => normalizeLower(modality.id).length > 0 && (modality.label || '').trim().length > 0,
    ) &&
    clonedConfig.part_views.every(
      (partView) =>
        normalizeLower(partView.id).length > 0 &&
        (partView.label || '').trim().length > 0 &&
        partView.required_modalities.every(
          (requiredModality) => normalizeLower(requiredModality).length > 0,
        ),
    ) &&
    clonedConfig.defect_types.every(
      (defectType) =>
        (defectType.name || '').trim().length > 0 &&
        /^#[0-9a-fA-F]{6}$/.test((defectType.color || '').trim()),
    )
  );
}

function hasValidSettingsFields(clonedConfig) {
  return (
    typeof clonedConfig.process_settings.require_disposition_on_submit === 'boolean' &&
    typeof clonedConfig.process_settings.require_measurement_for_critical === 'boolean' &&
    typeof clonedConfig.process_settings.require_second_reviewer_for_reject === 'boolean' &&
    clonedConfig.process_settings.configurable_hotkeys &&
    typeof clonedConfig.process_settings.configurable_hotkeys === 'object' &&
    typeof clonedConfig.process_settings.configurable_hotkeys.accept_classification === 'string' &&
    typeof clonedConfig.process_settings.configurable_hotkeys.reject_classification === 'string' &&
    typeof clonedConfig.process_settings.configurable_hotkeys.toggle_shortcut_help === 'string' &&
    typeof clonedConfig.display_settings.default_colormap === 'string' &&
    typeof clonedConfig.display_settings.anomaly_colormap === 'string' &&
    typeof clonedConfig.display_settings.grayscale_base_image === 'boolean' &&
    (
      clonedConfig.display_settings.inspection_tile_max_columns === undefined ||
      Number.isInteger(clonedConfig.display_settings.inspection_tile_max_columns)
    ) &&
    isValidOptionalPt3GuideSettings(clonedConfig.display_settings.pt3_3d_guides) &&
    isValidOptionalProjectCalibration(clonedConfig.calibration)
  );
}

function hasValidDomainFields(clonedConfig) {
  const allowedColormaps = new Set(['grayscale', 'magma', 'viridis']);
  return (
    clonedConfig.part_views.every(
      (partView) => !partView.source || partView.source === 'manual' || partView.source === 'auto',
    ) &&
    allowedColormaps.has(clonedConfig.display_settings.default_colormap) &&
    allowedColormaps.has(clonedConfig.display_settings.anomaly_colormap) &&
    (
      clonedConfig.display_settings.inspection_tile_max_columns === undefined ||
      (
        clonedConfig.display_settings.inspection_tile_max_columns >= INSPECTION_TILE_MAX_COLUMNS_MIN &&
        clonedConfig.display_settings.inspection_tile_max_columns <= INSPECTION_TILE_MAX_COLUMNS_MAX
      )
    )
  );
}

function hasValidHotkeyDomainFields(clonedConfig) {
  const cloneHotkeys = clonedConfig.process_settings.configurable_hotkeys || {};
  const normalizedCloneHotkeys = [
    normalizeLower(cloneHotkeys.accept_classification),
    normalizeLower(cloneHotkeys.reject_classification),
    normalizeLower(cloneHotkeys.toggle_shortcut_help),
  ];
  return (
    normalizedCloneHotkeys.every((hotkeyValue) => isSingleAlphanumeric(hotkeyValue)) &&
    new Set(normalizedCloneHotkeys).size === normalizedCloneHotkeys.length
  );
}

function hasValidRelationalFields(clonedConfig) {
  const normalizedModalityIds = clonedConfig.image_modalities.map((modality) => normalizeLower(modality.id));
  const normalizedPartViewIds = clonedConfig.part_views.map((partView) => normalizeLower(partView.id));
  const normalizedDefectNames = clonedConfig.defect_types.map((defectType) => normalizeLower(defectType.name));
  const hasDuplicateModalityIds = new Set(normalizedModalityIds).size !== normalizedModalityIds.length;
  const hasDuplicatePartViewIds = new Set(normalizedPartViewIds).size !== normalizedPartViewIds.length;
  const hasDuplicateDefectNames = new Set(normalizedDefectNames).size !== normalizedDefectNames.length;
  const hasUnknownRequiredModalities = clonedConfig.part_views.some((partView) =>
    partView.required_modalities.some(
      (requiredModalityId) => !normalizedModalityIds.includes(normalizeLower(requiredModalityId)),
    ),
  );
  return !(hasDuplicateModalityIds || hasDuplicatePartViewIds || hasDuplicateDefectNames || hasUnknownRequiredModalities);
}

export function getCloneConfigOrThrow(cloneResponseData) {
  if (!cloneResponseData || typeof cloneResponseData !== 'object' || !cloneResponseData.config) {
    throw new Error('Failed to copy project configuration (missing config payload)');
  }
  const clonedConfig = cloneResponseData.config;

  if (!hasValidTopLevelShape(clonedConfig)) {
    throw new Error('Failed to copy project configuration (invalid config payload shape)');
  }
  if (!hasValidCollectionEntries(clonedConfig)) {
    throw new Error('Failed to copy project configuration (invalid config payload entries)');
  }
  if (!hasValidScalarFields(clonedConfig)) {
    throw new Error('Failed to copy project configuration (invalid config scalar fields)');
  }
  if (!hasValidSemanticScalarFields(clonedConfig)) {
    throw new Error('Failed to copy project configuration (invalid config semantic fields)');
  }
  if (!hasValidSettingsFields(clonedConfig)) {
    throw new Error('Failed to copy project configuration (invalid config settings fields)');
  }
  if (!hasValidDomainFields(clonedConfig)) {
    throw new Error('Failed to copy project configuration (invalid config domain fields)');
  }
  if (!hasValidHotkeyDomainFields(clonedConfig)) {
    throw new Error('Failed to copy project configuration (invalid config hotkey domain fields)');
  }
  if (!hasValidRelationalFields(clonedConfig)) {
    throw new Error('Failed to copy project configuration (invalid config relational fields)');
  }

  return clonedConfig;
}
