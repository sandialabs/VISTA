import { PROJECT_PHASE_SEQUENCE } from '../../utils/projectPhases';
import { normalizeUiSections } from '../../utils/uiSections';
import {
  DEFAULT_PT3_3D_GUIDE_SETTINGS,
  normalizePt3GuideSettings,
} from '../../utils/pt3GuideSettings';
import { areCalibrationScalesConsistent } from '../../utils/calibration';

// Per-section project configuration schema. Each entry may define:
// - default: value used for EMPTY_CONFIG (omitted sections are not defaulted);
// - normalize(value, { projectType }): normalized section value;
// - includeFor(projectType): false drops the section from normalized output;
// - validate(value, config): list of validation error messages.
// Entry order fixes both EMPTY_CONFIG key order and validation message order.

export const INSPECTION_TILE_MAX_COLUMNS_MIN = 1;
export const INSPECTION_TILE_MAX_COLUMNS_MAX = 64;
const DEFAULT_INSPECTION_TILE_MAX_COLUMNS = 8;
const DEFAULT_DEFECT_TYPE_COLORS = ['#ef4444', '#f59e0b', '#3b82f6'];
const DEFAULT_OVERLAY_VALUES = ['true', 'overlay', 'ov', 'mask', 'heatmap'];
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export const PT1_HIDDEN_UI_SECTION_KEYS = new Set([
  'project_configuration.filename_convention',
  'project_configuration.view_options',
]);

export function isSingleAlphanumeric(value) {
  return /^[a-z0-9]$/i.test((value || '').trim());
}

export function normalizeLower(value) {
  return (value || '').trim().toLowerCase();
}

export function normalizeProjectTypeSuffix(projectType) {
  const suffix = String(projectType || 'PT1').trim().toUpperCase();
  return suffix || 'PT1';
}

export function isPt1ProjectType(projectType) {
  return normalizeProjectTypeSuffix(projectType) === 'PT1';
}

export function normalizeInspectionTileMaxColumns(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_INSPECTION_TILE_MAX_COLUMNS;
  return Math.min(
    INSPECTION_TILE_MAX_COLUMNS_MAX,
    Math.max(INSPECTION_TILE_MAX_COLUMNS_MIN, Math.round(numeric)),
  );
}

export function normalizeOverlayIndicator(source = {}) {
  const values = Array.isArray(source.values) ? source.values : String(source.values || '').split(',');
  const normalizedValues = values
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return {
    enabled: source.enabled !== false,
    field_key: String(source.field_key || 'overlay').trim() || 'overlay',
    values: normalizedValues.length > 0 ? normalizedValues : [...DEFAULT_OVERLAY_VALUES],
    remove_from_base_filename: source.remove_from_base_filename !== false,
  };
}

export function isValidOptionalProjectCalibration(value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  if (
    !areCalibrationScalesConsistent(value.pixels_per_mm, value.pixels_per_inch)
    || !['mm', 'inches'].includes(value.unit)
  ) {
    return false;
  }
  return value.updated_at === undefined
    || value.updated_at === null
    || (typeof value.updated_at === 'string' && Number.isFinite(Date.parse(value.updated_at)));
}

function findDuplicates(values) {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

function getDefaultDefectTypes(projectType) {
  const projectTypeSuffix = normalizeProjectTypeSuffix(projectType);
  return DEFAULT_DEFECT_TYPE_COLORS.map((color, index) => ({
    name: `DefectType${index + 1}_${projectTypeSuffix}`,
    color,
    definition: '',
  }));
}

function validateModalities(value) {
  const modalities = (value || []).map((modality) => ({
    id: normalizeLower(modality.id),
    label: (modality.label || '').trim(),
  }));
  const modalityIds = modalities.map((modality) => modality.id).filter(Boolean);
  const errors = [];
  if (modalities.some((modality) => !modality.id || !modality.label)) {
    errors.push('Each modality requires both a filename value and label.');
  }
  if (findDuplicates(modalityIds).length > 0) {
    errors.push('Modality filename values must be unique.');
  }
  return errors;
}

function validatePartViews(value, config) {
  const modalityIds = (config.image_modalities || [])
    .map((modality) => normalizeLower(modality.id))
    .filter(Boolean);
  const partViews = (value || []).map((view) => ({
    id: normalizeLower(view.id),
    label: (view.label || '').trim(),
    required_modalities: (view.required_modalities || []).map(normalizeLower).filter(Boolean),
  }));
  const errors = [];
  if (partViews.some((view) => !view.id || !view.label)) {
    errors.push('Each side requires both a filename value and label.');
  }
  if (findDuplicates(partViews.map((view) => view.id).filter(Boolean)).length > 0) {
    errors.push('Side filename values must be unique.');
  }
  const unknownModalityReference = partViews.some((view) =>
    view.required_modalities.some((requiredModality) => !modalityIds.includes(requiredModality)),
  );
  if (unknownModalityReference) {
    errors.push('Stored side modality requirements must reference configured modalities.');
  }
  return errors;
}

function validateDefectTypes(value) {
  const defectTypes = (value || []).map((defectType) => ({
    name: (defectType.name || '').trim(),
    color: (defectType.color || '').trim(),
  }));
  const errors = [];
  if (defectTypes.some((defectType) => !defectType.name)) {
    errors.push('Each defect type requires a name.');
  }
  const normalizedNames = defectTypes.map((defectType) => normalizeLower(defectType.name)).filter(Boolean);
  if (findDuplicates(normalizedNames).length > 0) {
    errors.push('Defect type names must be unique (case-insensitive).');
  }
  if (defectTypes.some((defectType) => !HEX_COLOR_PATTERN.test(defectType.color))) {
    errors.push('Defect type colors must be valid 6-digit hex values (for example #ef4444).');
  }
  return errors;
}

function validateProcessSettings(value) {
  const hotkeys = value?.configurable_hotkeys || {};
  const hotkeyValues = [
    normalizeLower(hotkeys.accept_classification),
    normalizeLower(hotkeys.reject_classification),
    normalizeLower(hotkeys.toggle_shortcut_help),
  ];
  const errors = [];
  if (hotkeyValues.some((hotkeyValue) => !isSingleAlphanumeric(hotkeyValue))) {
    errors.push('Hotkeys must be single alphanumeric characters.');
  }
  if (new Set(hotkeyValues).size !== hotkeyValues.length) {
    errors.push('Hotkeys must be unique across accept, reject, and help actions.');
  }
  return errors;
}

function validateCalibration(value) {
  return isValidOptionalProjectCalibration(value)
    ? []
    : ['Project calibration requires positive finite pixel scales and a valid unit.'];
}

const DEFAULT_DISPLAY_SETTINGS = {
  default_colormap: 'grayscale',
  anomaly_colormap: 'viridis',
  grayscale_base_image: true,
  inspection_tile_max_columns: DEFAULT_INSPECTION_TILE_MAX_COLUMNS,
  pt3_3d_guides: {
    ...DEFAULT_PT3_3D_GUIDE_SETTINGS,
  },
};

function normalizeDisplaySettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...DEFAULT_DISPLAY_SETTINGS,
    ...source,
    inspection_tile_max_columns: normalizeInspectionTileMaxColumns(source.inspection_tile_max_columns),
    pt3_3d_guides: normalizePt3GuideSettings(source.pt3_3d_guides),
  };
}

function normalizeSerialNumberScheme(value) {
  const candidate = value || {};
  return {
    batch_sn_enabled: candidate.batch_sn_enabled !== false,
    sub_batching_enabled: candidate.sub_batching_enabled === true,
    sub_batch_sn_enabled: candidate.sub_batch_sn_enabled === true,
    part_sn_enabled: candidate.part_sn_enabled !== false,
  };
}

function normalizePhaseSettings(value) {
  const candidate = value || {};
  return {
    manual_phase_selection_enabled: candidate.manual_phase_selection_enabled === true,
    manual_phase: PROJECT_PHASE_SEQUENCE.includes(candidate.manual_phase)
      ? candidate.manual_phase
      : 'data_ingestion',
  };
}

const DEFAULT_NSIPRO_PARSER_ID = 'default';

function normalizeMetadataParsers(value) {
  const nsipro = value?.nsipro || {};
  const parserId = typeof nsipro.parser_id === 'string' && nsipro.parser_id.trim()
    ? nsipro.parser_id.trim()
    : DEFAULT_NSIPRO_PARSER_ID;
  return {
    nsipro: {
      ...nsipro,
      parser_id: parserId,
    },
  };
}

function normalizeUiSectionsForProjectType(value, { projectType } = {}) {
  const sections = normalizeUiSections({ ui_sections: value });
  if (isPt1ProjectType(projectType)) {
    PT1_HIDDEN_UI_SECTION_KEYS.forEach((sectionKey) => {
      sections[sectionKey] = false;
    });
  }
  return sections;
}

const DEFAULT_FILE_NAMING_SCHEME = {
  use_filename_convention: true,
  hierarchy_levels: [
    { id: 'drawing_number', label: 'Drawing Number', abbreviation: 'D' },
    { id: 'part_number', label: 'Part Number', abbreviation: 'P' },
    { id: 'lot_number', label: 'Lot Number', abbreviation: 'L' },
    { id: 'serial_number', label: 'Serial Number', abbreviation: 'S' },
    { id: 'revision', label: 'Revision', abbreviation: 'R' },
  ],
  image_descriptors: [
    { id: 'view', label: 'View', abbreviation: 'V' },
    { id: 'modality', label: 'Modality', abbreviation: 'M' },
  ],
  overlay_indicator: {
    enabled: true,
    field_key: 'overlay',
    values: [...DEFAULT_OVERLAY_VALUES],
    remove_from_base_filename: true,
  },
};

function normalizeFilenameEntry(entry) {
  return {
    id: (entry?.id || 'other').trim() || 'other',
    label: (entry?.label || '').trim(),
    abbreviation: (entry?.abbreviation || '').trim(),
  };
}

function normalizeFilenameEntries(entries, defaults) {
  return Array.isArray(entries) && entries.length > 0 ? entries.map(normalizeFilenameEntry) : defaults;
}

function normalizeFileNamingScheme(value) {
  const source = value || {};
  return {
    use_filename_convention: source.use_filename_convention !== false,
    hierarchy_levels: normalizeFilenameEntries(source.hierarchy_levels, DEFAULT_FILE_NAMING_SCHEME.hierarchy_levels),
    image_descriptors: normalizeFilenameEntries(source.image_descriptors, DEFAULT_FILE_NAMING_SCHEME.image_descriptors),
    delimiter: String(source.delimiter || '_'),
    metadata_extractor: source.metadata_extractor && typeof source.metadata_extractor === 'object'
      ? source.metadata_extractor
      : null,
    overlay_indicator: normalizeOverlayIndicator(source.overlay_indicator || DEFAULT_FILE_NAMING_SCHEME.overlay_indicator),
  };
}

export const CONFIGURATION_SECTIONS = Object.freeze({
  image_modalities: { default: [], validate: validateModalities },
  part_views: { default: [], validate: validatePartViews },
  defect_types: {
    default: [],
    normalize: (value, { projectType }) => (Array.isArray(value) ? value : getDefaultDefectTypes(projectType)),
    validate: validateDefectTypes,
  },
  process_settings: {
    default: {
      require_disposition_on_submit: true,
      require_measurement_for_critical: false,
      require_second_reviewer_for_reject: false,
      configurable_hotkeys: {
        accept_classification: 'a',
        reject_classification: 'r',
        toggle_shortcut_help: 'h',
      },
    },
    validate: validateProcessSettings,
  },
  display_settings: { default: DEFAULT_DISPLAY_SETTINGS, normalize: normalizeDisplaySettings },
  serial_number_scheme: { default: normalizeSerialNumberScheme(), normalize: normalizeSerialNumberScheme },
  phase_settings: { default: normalizePhaseSettings(), normalize: normalizePhaseSettings },
  metadata_parsers: { default: normalizeMetadataParsers(), normalize: normalizeMetadataParsers },
  project_owner: { default: { name: '', email: '' } },
  current_user: { default: { username: '', sso_authenticated: false } },
  ui_sections: { default: normalizeUiSections(), normalize: normalizeUiSectionsForProjectType },
  file_naming_scheme: {
    default: DEFAULT_FILE_NAMING_SCHEME,
    normalize: normalizeFileNamingScheme,
    includeFor: (projectType) => !isPt1ProjectType(projectType),
  },
  calibration: { validate: validateCalibration },
});

const SECTION_ENTRIES = Object.entries(CONFIGURATION_SECTIONS);

export const EMPTY_CONFIG = SECTION_ENTRIES.reduce((defaults, [key, section]) => {
  if ('default' in section) defaults[key] = section.default;
  return defaults;
}, {});

// Normalizes one section read from a whole configuration object.
export function normalizeConfigurationSection(key, config, projectType) {
  return CONFIGURATION_SECTIONS[key].normalize(config?.[key], { projectType });
}

export function normalizeProjectConfiguration(config, projectType) {
  const incomingConfig = config && typeof config === 'object' ? config : {};
  const normalizedConfig = { ...EMPTY_CONFIG, ...incomingConfig };
  SECTION_ENTRIES.forEach(([key, section]) => {
    if (section.includeFor && !section.includeFor(projectType)) {
      delete normalizedConfig[key];
    } else if (section.normalize) {
      normalizedConfig[key] = section.normalize(incomingConfig[key], { projectType });
    }
  });
  return normalizedConfig;
}

export function validateConfiguration(config) {
  return SECTION_ENTRIES.flatMap(([key, section]) => (
    section.validate ? section.validate(config[key], config) : []
  ));
}
