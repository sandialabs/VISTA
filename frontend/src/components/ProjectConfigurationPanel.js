import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { PROJECT_PHASE_LABELS, PROJECT_PHASE_SEQUENCE } from '../utils/projectPhases';
import { buildErrorWithServiceDiagnostics } from '../utils/serviceDiagnostics';
import FilenameMetadataExtractor from './FilenameMetadataExtractor';


function isSingleAlphanumeric(value) {
  return /^[a-z0-9]$/i.test((value || '').trim());
}

function normalizeLower(value) {
  return (value || '').trim().toLowerCase();
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function getCloneConfigOrThrow(cloneResponseData) {
  if (!cloneResponseData || typeof cloneResponseData !== 'object' || !cloneResponseData.config) {
    throw new Error('Failed to copy project configuration (missing config payload)');
  }
  const clonedConfig = cloneResponseData.config;
  const hasValidTopLevelShape =
    typeof clonedConfig === 'object' &&
    Array.isArray(clonedConfig.image_modalities) &&
    Array.isArray(clonedConfig.part_views) &&
    Array.isArray(clonedConfig.defect_types) &&
    clonedConfig.process_settings &&
    typeof clonedConfig.process_settings === 'object' &&
    clonedConfig.display_settings &&
    typeof clonedConfig.display_settings === 'object';

  if (!hasValidTopLevelShape) {
    throw new Error('Failed to copy project configuration (invalid config payload shape)');
  }

  const hasValidCollectionEntries =
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
    );

  if (!hasValidCollectionEntries) {
    throw new Error('Failed to copy project configuration (invalid config payload entries)');
  }

  const hasValidScalarFields =
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
    );

  if (!hasValidScalarFields) {
    throw new Error('Failed to copy project configuration (invalid config scalar fields)');
  }

  const hasValidSemanticScalarFields =
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
    );

  if (!hasValidSemanticScalarFields) {
    throw new Error('Failed to copy project configuration (invalid config semantic fields)');
  }

  const hasValidSettingsFields =
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
    typeof clonedConfig.display_settings.grayscale_base_image === 'boolean';

  if (!hasValidSettingsFields) {
    throw new Error('Failed to copy project configuration (invalid config settings fields)');
  }

  const allowedColormaps = new Set(['grayscale', 'magma', 'viridis']);
  const hasValidDomainFields =
    clonedConfig.part_views.every(
      (partView) => !partView.source || partView.source === 'manual' || partView.source === 'auto',
    ) &&
    allowedColormaps.has(clonedConfig.display_settings.default_colormap) &&
    allowedColormaps.has(clonedConfig.display_settings.anomaly_colormap);

  if (!hasValidDomainFields) {
    throw new Error('Failed to copy project configuration (invalid config domain fields)');
  }

  const cloneHotkeys = clonedConfig.process_settings.configurable_hotkeys || {};
  const normalizedCloneHotkeys = [
    normalizeLower(cloneHotkeys.accept_classification),
    normalizeLower(cloneHotkeys.reject_classification),
    normalizeLower(cloneHotkeys.toggle_shortcut_help),
  ];
  const hasValidHotkeyDomainFields =
    normalizedCloneHotkeys.every((hotkeyValue) => isSingleAlphanumeric(hotkeyValue)) &&
    new Set(normalizedCloneHotkeys).size === normalizedCloneHotkeys.length;

  if (!hasValidHotkeyDomainFields) {
    throw new Error('Failed to copy project configuration (invalid config hotkey domain fields)');
  }

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

  if (hasDuplicateModalityIds || hasDuplicatePartViewIds || hasDuplicateDefectNames || hasUnknownRequiredModalities) {
    throw new Error('Failed to copy project configuration (invalid config relational fields)');
  }

  return clonedConfig;
}

function validateConfiguration(config) {
  const errors = [];

  const modalities = (config.image_modalities || []).map((modality) => ({
    id: normalizeLower(modality.id),
    label: (modality.label || '').trim(),
  }));
  const modalityIds = modalities.map((modality) => modality.id).filter(Boolean);
  const duplicateModalityIds = modalityIds.filter((id, index) => modalityIds.indexOf(id) !== index);

  if (modalities.some((modality) => !modality.id || !modality.label)) {
    errors.push('Each image modality requires both identifier and label.');
  }
  if (duplicateModalityIds.length > 0) {
    errors.push('Image modality identifiers must be unique.');
  }

  const partViews = (config.part_views || []).map((view) => ({
    id: normalizeLower(view.id),
    label: (view.label || '').trim(),
    required_modalities: (view.required_modalities || []).map(normalizeLower).filter(Boolean),
  }));
  const partViewIds = partViews.map((view) => view.id).filter(Boolean);
  const duplicatePartViewIds = partViewIds.filter((id, index) => partViewIds.indexOf(id) !== index);

  if (partViews.some((view) => !view.id || !view.label)) {
    errors.push('Each part view requires both identifier and label.');
  }
  if (duplicatePartViewIds.length > 0) {
    errors.push('Part view identifiers must be unique.');
  }

  const unknownModalityReference = partViews.some((view) =>
    view.required_modalities.some((requiredModality) => !modalityIds.includes(requiredModality)),
  );
  if (unknownModalityReference) {
    errors.push('Part views can only require modalities configured in Image Modalities.');
  }

  const defectTypes = (config.defect_types || []).map((defectType) => ({
    name: (defectType.name || '').trim(),
    color: (defectType.color || '').trim(),
  }));
  if (defectTypes.some((defectType) => !defectType.name)) {
    errors.push('Each defect type requires a name.');
  }
  const normalizedDefectNames = defectTypes.map((defectType) => normalizeLower(defectType.name)).filter(Boolean);
  const duplicateDefectNames = normalizedDefectNames.filter(
    (name, index) => normalizedDefectNames.indexOf(name) !== index,
  );
  if (duplicateDefectNames.length > 0) {
    errors.push('Defect type names must be unique (case-insensitive).');
  }
  if (defectTypes.some((defectType) => !/^#[0-9a-fA-F]{6}$/.test(defectType.color))) {
    errors.push('Defect type colors must be valid 6-digit hex values (for example #ef4444).');
  }

  const hotkeys = config.process_settings?.configurable_hotkeys || {};
  const hotkeyValues = [
    normalizeLower(hotkeys.accept_classification),
    normalizeLower(hotkeys.reject_classification),
    normalizeLower(hotkeys.toggle_shortcut_help),
  ];

  if (hotkeyValues.some((hotkeyValue) => !isSingleAlphanumeric(hotkeyValue))) {
    errors.push('Hotkeys must be single alphanumeric characters.');
  }
  if (new Set(hotkeyValues).size !== hotkeyValues.length) {
    errors.push('Hotkeys must be unique across accept, reject, and help actions.');
  }

  return errors;
}

const EMPTY_CONFIG = {
  image_modalities: [],
  part_views: [],
  defect_types: [],
  process_settings: {
    require_disposition_on_submit: true,
    require_measurement_for_critical: false,
    require_second_reviewer_for_reject: false,
    configurable_hotkeys: {
      accept_classification: 'a',
      reject_classification: 'r',
      toggle_shortcut_help: 'h',
    },
  },
  display_settings: {
    default_colormap: 'grayscale',
    anomaly_colormap: 'viridis',
    grayscale_base_image: true,
  },
  serial_number_scheme: {
    batch_sn_enabled: true,
    sub_batching_enabled: false,
    sub_batch_sn_enabled: false,
    part_sn_enabled: true,
  },
  phase_settings: {
    manual_phase_selection_enabled: false,
    manual_phase: 'data_ingestion',
  },
  project_owner: {
    name: '',
    email: '',
  },
  current_user: {
    username: '',
    sso_authenticated: false,
  },
  file_naming_scheme: {
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
  },
};
const FILE_NAME_ELEMENT_OPTIONS = [
  { id: 'drawing_number', label: 'Drawing Number', abbreviation: 'D' },
  { id: 'part_number', label: 'Part Number', abbreviation: 'P' },
  { id: 'lot_number', label: 'Lot Number', abbreviation: 'L' },
  { id: 'serial_number', label: 'Serial Number', abbreviation: 'S' },
  { id: 'revision', label: 'Revision', abbreviation: 'R' },
  { id: 'batch', label: 'Batch', abbreviation: 'B' },
  { id: 'sub_batch', label: 'Sub Batch', abbreviation: 'SB' },
  { id: 'timestamp', label: 'Timestamp', abbreviation: 'T' },
  { id: 'operator', label: 'Operator', abbreviation: 'O' },
  { id: 'view', label: 'View', abbreviation: 'V' },
  { id: 'side', label: 'Side', abbreviation: 'SIDE' },
  { id: 'modality', label: 'Modality', abbreviation: 'M' },
  { id: 'overlay', label: 'Overlay', abbreviation: 'OV' },
];

const DEFAULT_DEFECT_TYPE_COLORS = ['#ef4444', '#f59e0b', '#3b82f6'];


function getFilenameEntryName(entry, fallback) {
  const candidate = (entry?.label || entry?.id || fallback || '').trim();
  return candidate || fallback;
}

function normalizeFilenameToken(value, fallback) {
  const token = String(value || fallback || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return token || fallback;
}

function buildExpectedFilenameExample(fileNamingScheme) {
  const normalizedScheme = normalizeFileNamingScheme({ file_naming_scheme: fileNamingScheme });
  const hierarchySegments = normalizedScheme.hierarchy_levels.map((level, index) => {
    const prefix = (level.abbreviation || getFilenameEntryName(level, `level ${index + 1}`)).trim();
    return `${prefix}001`;
  });
  const descriptorSegments = normalizedScheme.image_descriptors.map((descriptor, index) => {
    const descriptorName = descriptor.id === 'view'
      ? 'side'
      : getFilenameEntryName(descriptor, `descriptor ${index + 1}`);
    return normalizeFilenameToken(descriptorName, `descriptor${index + 1}`);
  });
  const delimiter = normalizedScheme.delimiter || '_';
  return [...hierarchySegments, ...descriptorSegments].filter(Boolean).join(delimiter) + '.type';
}


const FILENAME_CONVENTION_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#0891b2',
  '#16a34a',
  '#f97316',
  '#dc2626',
  '#4f46e5',
  '#0f766e',
];

function getFilenameConventionSegments(fileNamingScheme) {
  const normalizedScheme = normalizeFileNamingScheme({ file_naming_scheme: fileNamingScheme });
  const delimiter = normalizedScheme.delimiter || '_';
  const hierarchySegments = normalizedScheme.hierarchy_levels.map((level, index) => {
    const prefix = (level.abbreviation || getFilenameEntryName(level, `level ${index + 1}`)).trim();
    return {
      type: 'hierarchy',
      index,
      key: `hierarchy-${index}`,
      label: getFilenameEntryName(level, `Level ${index + 1}`),
      token: `${prefix}001`,
      color: FILENAME_CONVENTION_COLORS[index % FILENAME_CONVENTION_COLORS.length],
    };
  });
  const descriptorSegments = normalizedScheme.image_descriptors.map((descriptor, index) => {
    const descriptorName = descriptor.id === 'view'
      ? 'side'
      : getFilenameEntryName(descriptor, `descriptor ${index + 1}`);
    return {
      type: 'descriptor',
      index,
      key: `descriptor-${index}`,
      label: getFilenameEntryName(descriptor, `Descriptor ${index + 1}`),
      token: normalizeFilenameToken(descriptorName, `descriptor${index + 1}`),
      color: FILENAME_CONVENTION_COLORS[(hierarchySegments.length + index) % FILENAME_CONVENTION_COLORS.length],
    };
  });
  return {
    delimiter,
    segments: [...hierarchySegments, ...descriptorSegments],
  };
}

function normalizeProjectTypeSuffix(projectType) {
  const suffix = String(projectType || 'PT1').trim().toUpperCase();
  return suffix || 'PT1';
}

function getDefaultDefectTypes(projectType) {
  const projectTypeSuffix = normalizeProjectTypeSuffix(projectType);
  return DEFAULT_DEFECT_TYPE_COLORS.map((color, index) => ({
    name: `DefectType${index + 1}_${projectTypeSuffix}`,
    color,
    definition: '',
  }));
}

function normalizeSerialNumberScheme(config) {
  const candidate = config?.serial_number_scheme || {};
  return {
    batch_sn_enabled: candidate.batch_sn_enabled !== false,
    sub_batching_enabled: candidate.sub_batching_enabled === true,
    sub_batch_sn_enabled: candidate.sub_batch_sn_enabled === true,
    part_sn_enabled: candidate.part_sn_enabled !== false,
  };
}

function normalizePhaseSettings(config) {
  const candidate = config?.phase_settings || {};
  return {
    manual_phase_selection_enabled: candidate.manual_phase_selection_enabled === true,
    manual_phase: PROJECT_PHASE_SEQUENCE.includes(candidate.manual_phase)
      ? candidate.manual_phase
      : 'data_ingestion',
  };
}

function normalizeProjectConfiguration(config, projectType) {
  const incomingConfig = config && typeof config === 'object' ? config : {};
  const defectTypes = Array.isArray(incomingConfig.defect_types)
    ? incomingConfig.defect_types
    : getDefaultDefectTypes(projectType);

  return {
    ...EMPTY_CONFIG,
    ...incomingConfig,
    defect_types: defectTypes,
    serial_number_scheme: normalizeSerialNumberScheme(incomingConfig),
    phase_settings: normalizePhaseSettings(incomingConfig),
    file_naming_scheme: normalizeFileNamingScheme(incomingConfig),
  };
}

function normalizeFileNamingScheme(config) {
  const source = config?.file_naming_scheme || {};
  const normalizeEntry = (entry) => ({
    id: (entry?.id || 'other').trim() || 'other',
    label: (entry?.label || '').trim(),
    abbreviation: (entry?.abbreviation || '').trim(),
  });
  const defaultScheme = EMPTY_CONFIG.file_naming_scheme;
  const hierarchyLevels = Array.isArray(source.hierarchy_levels) && source.hierarchy_levels.length > 0
    ? source.hierarchy_levels.map(normalizeEntry)
    : defaultScheme.hierarchy_levels;
  const imageDescriptors = Array.isArray(source.image_descriptors) && source.image_descriptors.length > 0
    ? source.image_descriptors.map(normalizeEntry)
    : defaultScheme.image_descriptors;
  return {
    hierarchy_levels: hierarchyLevels,
    image_descriptors: imageDescriptors,
    delimiter: String(source.delimiter || '_'),
    metadata_extractor: source.metadata_extractor && typeof source.metadata_extractor === 'object'
      ? source.metadata_extractor
      : null,
  };
}

const AUTOSAVE_DELAY_MS = 500;

const getConfigurationSignature = (configuration) => JSON.stringify(configuration || {});

const ProjectConfigurationPanel = forwardRef(function ProjectConfigurationPanel({
  projectId,
  projectType,
  currentInterfaceLayout = null,
  isAdminUser = false,
  onConfigurationSaved = null,
}, ref) {
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [availableProjects, setAvailableProjects] = useState([]);
  const [currentProjectType, setCurrentProjectType] = useState('');
  const [copySourceProjectId, setCopySourceProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [copyingConfiguration, setCopyingConfiguration] = useState(false);
  const configRef = useRef(config);
  const autosaveTimerRef = useRef(null);
  const loadCompleteRef = useRef(false);
  const lastSavedSignatureRef = useRef(getConfigurationSignature(EMPTY_CONFIG));
  const saveLoopPromiseRef = useRef(null);
  const filenameExtractorInitializedRef = useRef(false);
  const autosaveRequestedDuringSaveRef = useRef(false);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => () => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const loadCurrentUser = async () => {
      try {
        const resp = await fetch('/api/users/me');
        if (!resp.ok) return;
        const data = await resp.json();
        const username = String(data?.email || data?.username || "").trim();
        if (!username) return;
        setConfig((previous) => ({
          ...previous,
          current_user: {
            username,
            sso_authenticated: true,
          },
        }));
      } catch (_err) {}
    };
    loadCurrentUser();
  }, []);
  const [savingInterfaceLayoutDefault, setSavingInterfaceLayoutDefault] = useState(false);
  const [savingProjectTypeLayoutDefault, setSavingProjectTypeLayoutDefault] = useState(false);
  const hasCompatibleCopySources = availableProjects.length > 0;
  const selectedCopySourceProject = availableProjects.find((project) => project.id === copySourceProjectId) || null;
  const [primaryError, diagnosticError] = typeof error === 'string'
    ? error.split('\n\n', 2)
    : ['', ''];
  const normalizedFileNamingScheme = normalizeFileNamingScheme(config);
  const filenameConvention = useMemo(
    () => getFilenameConventionSegments(normalizedFileNamingScheme),
    [normalizedFileNamingScheme],
  );
  const expectedFilenameExample = useMemo(
    () => buildExpectedFilenameExample(normalizedFileNamingScheme),
    [normalizedFileNamingScheme],
  );

  useEffect(() => {
    const loadConfiguration = async () => {
      try {
        setLoading(true);
        loadCompleteRef.current = false;
        setError(null);
        setStatusMessage('');

        const [configResp, projectsResp] = await Promise.all([
          fetch(`/api/projects/${projectId}/configuration`),
          fetch('/api/projects/'),
        ]);

        if (!configResp.ok) {
          throw new Error(`Failed to load project configuration (${configResp.status})`);
        }

        const configData = await configResp.json();
        const incomingConfig = configData?.config && typeof configData.config === 'object' ? configData.config : {};
        let targetProjectType = configData?.project_type || projectType || '';

        if (projectsResp.ok) {
          const projectsData = await projectsResp.json();
          const projectList = Array.isArray(projectsData) ? projectsData : [];
          const currentProject = projectList.find((project) => project.id === projectId);
          targetProjectType = currentProject?.project_type || targetProjectType;
          setCurrentProjectType(targetProjectType);
          const filtered = projectList.filter((project) => {
            if (project.id === projectId) {
              return false;
            }
            if (!targetProjectType) {
              return true;
            }
            return project.project_type === targetProjectType;
          });
          setAvailableProjects(filtered);
        }

        const normalizedConfig = normalizeProjectConfiguration(incomingConfig, targetProjectType);
        lastSavedSignatureRef.current = getConfigurationSignature(normalizedConfig);
        loadCompleteRef.current = true;
        setConfig(normalizedConfig);
      } catch (err) {
        const message = err.message || 'Failed to load project configuration';
        setError(await buildErrorWithServiceDiagnostics(message, projectId));
      } finally {
        setLoading(false);
      }
    };

    loadConfiguration();
  }, [projectId, projectType]);

  useEffect(() => {
    if (!copySourceProjectId) {
      return;
    }
    const stillAvailable = availableProjects.some((project) => project.id === copySourceProjectId);
    if (!stillAvailable) {
      setCopySourceProjectId('');
    }
  }, [availableProjects, copySourceProjectId]);

  const hasConfiguration = useMemo(
    () =>
      config.image_modalities.length > 0 ||
      config.part_views.length > 0 ||
      config.defect_types.length > 0,
    [config.defect_types.length, config.image_modalities.length, config.part_views.length],
  );

  const persistConfiguration = useCallback(async (configurationToSave, statusLabel = 'Configuration saved.') => {
    const validationErrors = validateConfiguration(configurationToSave);
    if (validationErrors.length > 0) {
      setError(validationErrors.join(' '));
      setStatusMessage('');
      return false;
    }

    try {
      setSaving(true);
      setError(null);
      const response = await fetch(`/api/projects/${projectId}/configuration`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: configurationToSave }),
      });
      if (!response.ok) {
        throw new Error(`Failed to save project configuration (${response.status})`);
      }
      const payload = await response.json();
      lastSavedSignatureRef.current = getConfigurationSignature(configurationToSave);
      setStatusMessage(statusLabel);
      if (payload?.config && typeof onConfigurationSaved === 'function') {
        onConfigurationSaved(payload.config);
      }
      return true;
    } catch (err) {
      const message = err.message || 'Failed to save project configuration';
      setError(await buildErrorWithServiceDiagnostics(message, projectId));
      return false;
    } finally {
      setSaving(false);
    }
  }, [onConfigurationSaved, projectId]);

  const runAutosave = useCallback((statusLabel = 'Configuration autosaved.') => {
    if (saveLoopPromiseRef.current) {
      autosaveRequestedDuringSaveRef.current = true;
      return saveLoopPromiseRef.current;
    }

    saveLoopPromiseRef.current = (async () => {
      let shouldContinue = true;
      while (shouldContinue) {
        autosaveRequestedDuringSaveRef.current = false;
        const latestConfig = configRef.current;
        const latestSignature = getConfigurationSignature(latestConfig);
        if (latestSignature === lastSavedSignatureRef.current) {
          return true;
        }
        const saved = await persistConfiguration(latestConfig, statusLabel);
        if (!saved) {
          return false;
        }
        shouldContinue =
          autosaveRequestedDuringSaveRef.current ||
          getConfigurationSignature(configRef.current) !== lastSavedSignatureRef.current;
      }
      return true;
    })().finally(() => {
      saveLoopPromiseRef.current = null;
    });

    return saveLoopPromiseRef.current;
  }, [persistConfiguration]);

  const hasPendingAutosave = useCallback(() => {
    if (!loadCompleteRef.current) return false;
    return Boolean(
      autosaveTimerRef.current ||
      saveLoopPromiseRef.current ||
      getConfigurationSignature(configRef.current) !== lastSavedSignatureRef.current,
    );
  }, []);

  const flushPendingAutosave = useCallback(async (statusLabel = 'Configuration autosaved.') => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (!hasPendingAutosave()) {
      return true;
    }
    return runAutosave(statusLabel);
  }, [hasPendingAutosave, runAutosave]);

  useImperativeHandle(ref, () => ({
    hasPendingAutosave,
    flushPendingAutosave,
  }), [flushPendingAutosave, hasPendingAutosave]);

  useEffect(() => {
    if (!loadCompleteRef.current || loading) {
      return;
    }
    const latestSignature = getConfigurationSignature(config);
    if (latestSignature === lastSavedSignatureRef.current) {
      return;
    }
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    setStatusMessage('Unsaved changes will autosave shortly.');
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      runAutosave();
    }, AUTOSAVE_DELAY_MS);
  }, [config, loading, runAutosave]);

  const saveConfiguration = async () => {
    if (hasPendingAutosave()) {
      await flushPendingAutosave('Configuration saved.');
      return;
    }
    await persistConfiguration(configRef.current, 'Configuration saved.');
  };

  const saveInterfaceLayoutAsProjectDefault = async () => {
    if (!currentInterfaceLayout || savingInterfaceLayoutDefault) return;
    try {
      setSavingInterfaceLayoutDefault(true);
      setError(null);
      setStatusMessage('');
      const response = await fetch(`/api/projects/${projectId}/configuration/interface-layout/default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout_model: currentInterfaceLayout }),
      });
      if (!response.ok) {
        throw new Error(`Failed to save project interface default (${response.status})`);
      }
      const payload = await response.json();
      if (payload?.config) {
        setConfig((previous) => ({
          ...previous,
          ...payload.config,
          serial_number_scheme: normalizeSerialNumberScheme(payload.config),
          phase_settings: normalizePhaseSettings(payload.config),
          file_naming_scheme: normalizeFileNamingScheme(payload.config),
        }));
        if (typeof onConfigurationSaved === 'function') {
          onConfigurationSaved(payload.config);
        }
      }
      setStatusMessage('Current interface saved as this project default.');
    } catch (err) {
      const message = err.message || 'Failed to save project interface default';
      setError(await buildErrorWithServiceDiagnostics(message, projectId));
    } finally {
      setSavingInterfaceLayoutDefault(false);
    }
  };

  const saveInterfaceLayoutAsProjectTypeDefault = async () => {
    if (!currentInterfaceLayout || savingProjectTypeLayoutDefault || !isAdminUser) return;
    try {
      setSavingProjectTypeLayoutDefault(true);
      setError(null);
      setStatusMessage('');
      const response = await fetch(`/api/projects/${projectId}/configuration/interface-layout/project-type-default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout_model: currentInterfaceLayout }),
      });
      if (!response.ok) {
        throw new Error(`Failed to save ${projectType || 'project type'} interface default (${response.status})`);
      }
      const payload = await response.json();
      if (payload?.config && typeof onConfigurationSaved === 'function') {
        onConfigurationSaved(payload.config);
      }
      setStatusMessage(`Current interface saved as the default for ${projectType || 'this project type'}.`);
    } catch (err) {
      const message = err.message || 'Failed to save project type interface default';
      setError(await buildErrorWithServiceDiagnostics(message, projectId));
    } finally {
      setSavingProjectTypeLayoutDefault(false);
    }
  };

  const addDefectType = () => {
    setConfig((previous) => ({
      ...previous,
      defect_types: [
        ...previous.defect_types,
        {
          name: '',
          color: '#ef4444',
          definition: '',
        },
      ],
    }));
  };

  const updateDefectType = (index, patch) => {
    setConfig((previous) => ({
      ...previous,
      defect_types: previous.defect_types.map((defectType, defectIndex) =>
        defectIndex === index ? { ...defectType, ...patch } : defectType,
      ),
    }));
  };

  const removeDefectType = (index) => {
    setConfig((previous) => ({
      ...previous,
      defect_types: previous.defect_types.filter((_, defectIndex) => defectIndex !== index),
    }));
  };

  const addImageModality = () => {
    setConfig((previous) => ({
      ...previous,
      image_modalities: [
        ...(previous.image_modalities || []),
        {
          id: '',
          label: '',
          calibration_required: false,
          example_image_uploaded: false,
        },
      ],
    }));
  };

  const updateImageModality = (index, patch) => {
    setConfig((previous) => ({
      ...previous,
      image_modalities: (previous.image_modalities || []).map((modality, modalityIndex) =>
        modalityIndex === index ? { ...modality, ...patch } : modality,
      ),
    }));
  };

  const removeImageModality = (index) => {
    setConfig((previous) => ({
      ...previous,
      image_modalities: (previous.image_modalities || []).filter((_, modalityIndex) => modalityIndex !== index),
    }));
  };

  const addPartView = () => {
    setConfig((previous) => ({
      ...previous,
      part_views: [
        ...(previous.part_views || []),
        {
          id: '',
          label: '',
          required_modalities: [],
          source: 'manual',
        },
      ],
    }));
  };

  const updatePartView = (index, patch) => {
    setConfig((previous) => ({
      ...previous,
      part_views: (previous.part_views || []).map((partView, partViewIndex) =>
        partViewIndex === index ? { ...partView, ...patch } : partView,
      ),
    }));
  };

  const removePartView = (index) => {
    setConfig((previous) => ({
      ...previous,
      part_views: (previous.part_views || []).filter((_, partViewIndex) => partViewIndex !== index),
    }));
  };

  const updateFileNameEntry = (entryType, index, patch) => {
    setConfig((previous) => ({
      ...previous,
      file_naming_scheme: {
        ...normalizeFileNamingScheme(previous),
        [entryType]: normalizeFileNamingScheme(previous)[entryType].map((entry, entryIndex) =>
          entryIndex === index ? { ...entry, ...patch } : entry,
        ),
      },
    }));
  };

  const addFileNameEntry = (entryType) => {
    setConfig((previous) => ({
      ...previous,
      file_naming_scheme: {
        ...normalizeFileNamingScheme(previous),
        [entryType]: [...normalizeFileNamingScheme(previous)[entryType], { id: 'other', label: '', abbreviation: '' }],
      },
    }));
  };

  const removeFileNameEntry = (entryType, index) => {
    setConfig((previous) => ({
      ...previous,
      file_naming_scheme: {
        ...normalizeFileNamingScheme(previous),
        [entryType]: normalizeFileNamingScheme(previous)[entryType].filter((_, entryIndex) => entryIndex !== index),
      },
    }));
  };


  const handleFilenameExtractorConfigChange = useCallback((extractorState) => {
    if (!filenameExtractorInitializedRef.current) {
      filenameExtractorInitializedRef.current = true;
      return;
    }
    const nextMetadataExtractor = {
      mode: extractorState.mode,
      pattern: extractorState.pattern,
      keys: extractorState.keys,
    };
    setConfig((previous) => {
      const currentScheme = normalizeFileNamingScheme(previous);
      const nextScheme = {
        ...currentScheme,
        delimiter: extractorState.mode === 'simple' ? extractorState.pattern : currentScheme.delimiter,
        metadata_extractor: nextMetadataExtractor,
      };
      if (JSON.stringify(currentScheme.metadata_extractor || null) === JSON.stringify(nextScheme.metadata_extractor)
        && currentScheme.delimiter === nextScheme.delimiter) {
        return previous;
      }
      return {
        ...previous,
        file_naming_scheme: nextScheme,
      };
    });
  }, []);

  const copyConfiguration = async () => {
    if (!copySourceProjectId || copyingConfiguration) return;

    try {
      setCopyingConfiguration(true);
      setError(null);
      setStatusMessage('');
      const cloneResp = await fetch(`/api/projects/${projectId}/configuration/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_project_id: copySourceProjectId }),
      });

      const cloneData = await parseJsonSafely(cloneResp);
      if (!cloneResp.ok) {
        throw new Error(cloneData?.detail || `Failed to copy project configuration (${cloneResp.status})`);
      }

      const clonedConfig = getCloneConfigOrThrow(cloneData);
      const nextClonedConfig = {
        ...EMPTY_CONFIG,
        ...clonedConfig,
        serial_number_scheme: normalizeSerialNumberScheme(clonedConfig),
        phase_settings: normalizePhaseSettings(clonedConfig),
        file_naming_scheme: normalizeFileNamingScheme(clonedConfig),
      };
      lastSavedSignatureRef.current = getConfigurationSignature(nextClonedConfig);
      setConfig(nextClonedConfig);
      const copiedFromProject = selectedCopySourceProject?.name || 'existing project';
      setCopySourceProjectId('');
      setStatusMessage(`Configuration copied from ${copiedFromProject}.`);
    } catch (err) {
      setStatusMessage('');
      const message = err.message || 'Failed to copy project configuration';
      setError(await buildErrorWithServiceDiagnostics(message, projectId));
    } finally {
      setCopyingConfiguration(false);
    }
  };

  return (
    <section className="workbench-panel project-configuration-panel" aria-label="Project Configuration">
      <header className="workbench-header">
        <div>
          <h2>Project Configuration</h2>
          <p>
            Configure modalities, part views, defect definitions, process controls, and display options.
          </p>
        </div>
      </header>

      {loading && <div className="loading-text">Loading project configuration…</div>}
      {error && !loading && (
        <div className="alert alert-error service-diagnostic-alert">
          <div>{primaryError}</div>
          {diagnosticError && <pre>{diagnosticError}</pre>}
        </div>
      )}
      {statusMessage && !loading && <div className="alert alert-success">{statusMessage}</div>}

      {!loading && !error && (
        <>
          <div className="workbench-summary-grid" data-testid="project-configuration-summary">
            <article className="summary-card">
              <h3>Image Modalities</h3>
              <p>{config.image_modalities.length} configured</p>
            </article>
            <article className="summary-card">
              <h3>Part Views</h3>
              <p>{config.part_views.length} configured</p>
            </article>
            <article className="summary-card">
              <h3>Defect Types</h3>
              <p>{config.defect_types.length} configured</p>
            </article>
          </div>

          <div className="configuration-sections-grid" data-testid="configuration-sections-grid">
            <section className="part-detail-panel" aria-label="Project owner">
            <h3>Project Owner</h3>
            <div className="workbench-controls-row">
              <label htmlFor="project-owner-name">Owner Name</label>
              <input id="project-owner-name" className="form-control" value={config.project_owner?.name || ''} onChange={(event) => setConfig((previous) => ({ ...previous, project_owner: { ...(previous.project_owner || {}), name: event.target.value } }))} />
              <label htmlFor="project-owner-email">Owner Email</label>
              <input id="project-owner-email" className="form-control" value={config.project_owner?.email || ''} onChange={(event) => setConfig((previous) => ({ ...previous, project_owner: { ...(previous.project_owner || {}), email: event.target.value } }))} />
            </div>
          </section>
          
          <section className="part-detail-panel" aria-label="Current user">
            <h3>Current User</h3>
            <div className="workbench-controls-row">
              <label htmlFor="current-user-name">Active Username</label>
              <input id="current-user-name" className="form-control" value={config.current_user?.username || ''} onChange={(event) => setConfig((previous) => ({ ...previous, current_user: { ...(previous.current_user || {}), username: event.target.value, sso_authenticated: false } }))} />
              <p className="muted">
                Status: {config.current_user?.sso_authenticated ? 'Authenticated via SSO' : 'Manual (manual)'}
              </p>
            </div>
          </section>

          <section className="part-detail-panel filename-convention-panel" aria-label="Filename convention">
            <div className="filename-convention-heading">
              <div>
                <h3>Filename Convention</h3>
                <p>
                  Build the filename from left to right. Colors link each filename segment to the
                  hierarchy, descriptor, modality, and decoding controls that define it.
                </p>
              </div>
              <code data-testid="expected-filename-preview">{expectedFilenameExample}</code>
            </div>

            <div className="filename-breakdown" aria-label="Expected filename preview">
              {filenameConvention.segments.map((segment, index) => (
                <React.Fragment key={segment.key}>
                  <div className="filename-breakdown-segment" style={{ '--segment-color': segment.color }}>
                    <span className="filename-breakdown-label">{segment.label}</span>
                    <strong>{segment.token}</strong>
                    <span className="filename-breakdown-decodes">
                      {segment.type === 'hierarchy' ? 'ID value: 001' : 'Filename descriptor'}
                    </span>
                  </div>
                  {index < filenameConvention.segments.length - 1 && (
                    <span className="filename-breakdown-delimiter">{filenameConvention.delimiter}</span>
                  )}
                </React.Fragment>
              ))}
              <span className="filename-breakdown-extension">.type</span>
            </div>

            <p>
              Configure each option directly under the filename part it controls. Numeric placeholders use
              <strong> 001 </strong> because these fields normally decode image or part identifiers from the filename.
            </p>

            <h4>Hierarchy Levels</h4>
            <div className="filename-option-grid">
              {normalizedFileNamingScheme.hierarchy_levels.map((level, index) => {
                const segment = filenameConvention.segments.find((item) => item.type === 'hierarchy' && item.index === index);
                return (
                  <div className="filename-option-card" style={{ '--segment-color': segment?.color }} key={`hierarchy-level-${index}`}>
                    <div className="filename-option-card-header">
                      <span>{segment?.token}</span>
                      <button className="btn btn-secondary" type="button" onClick={() => removeFileNameEntry('hierarchy_levels', index)}>Remove</button>
                    </div>
                    <label htmlFor={`hierarchy-level-select-${index}`}>Level {index + 1}</label>
                    <select
                      id={`hierarchy-level-select-${index}`}
                      value={level.id}
                      onChange={(event) => {
                        const selected = FILE_NAME_ELEMENT_OPTIONS.find((option) => option.id === event.target.value);
                        updateFileNameEntry('hierarchy_levels', index, selected
                          ? { id: selected.id, label: selected.label, abbreviation: selected.abbreviation }
                          : { id: 'other', label: '', abbreviation: '' });
                      }}
                    >
                      {FILE_NAME_ELEMENT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                      <option value="other">Other</option>
                    </select>
                    {level.id === 'other' && (
                      <>
                        <label htmlFor={`hierarchy-level-custom-label-${index}`}>Custom Label</label>
                        <input id={`hierarchy-level-custom-label-${index}`} value={level.label} onChange={(event) => updateFileNameEntry('hierarchy_levels', index, { label: event.target.value })} />
                      </>
                    )}
                    <label htmlFor={`hierarchy-level-abbreviation-${index}`}>Abbreviation</label>
                    <input id={`hierarchy-level-abbreviation-${index}`} value={level.abbreviation} onChange={(event) => updateFileNameEntry('hierarchy_levels', index, { abbreviation: event.target.value })} />
                  </div>
                );
              })}
            </div>
            <div className="workbench-controls-row">
              <button className="btn btn-secondary" type="button" onClick={() => addFileNameEntry('hierarchy_levels')}>
                Add Hierarchy Level
              </button>
            </div>

            <h4>Image Descriptors</h4>
            <div className="filename-option-grid">
              {normalizedFileNamingScheme.image_descriptors.map((descriptor, index) => {
                const segment = filenameConvention.segments.find((item) => item.type === 'descriptor' && item.index === index);
                return (
                  <div className="filename-option-card" style={{ '--segment-color': segment?.color }} key={`image-descriptor-${index}`}>
                    <div className="filename-option-card-header">
                      <span>{segment?.token}</span>
                      <button className="btn btn-secondary" type="button" onClick={() => removeFileNameEntry('image_descriptors', index)}>Remove</button>
                    </div>
                    <label htmlFor={`image-descriptor-select-${index}`}>Descriptor {index + 1}</label>
                    <select
                      id={`image-descriptor-select-${index}`}
                      value={descriptor.id}
                      onChange={(event) => {
                        const selected = FILE_NAME_ELEMENT_OPTIONS.find((option) => option.id === event.target.value);
                        updateFileNameEntry('image_descriptors', index, selected
                          ? { id: selected.id, label: selected.label, abbreviation: selected.abbreviation }
                          : { id: 'other', label: '', abbreviation: '' });
                      }}
                    >
                      {FILE_NAME_ELEMENT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                      <option value="other">Other</option>
                    </select>
                    {descriptor.id === 'other' && (
                      <>
                        <label htmlFor={`image-descriptor-custom-label-${index}`}>Custom Label</label>
                        <input id={`image-descriptor-custom-label-${index}`} value={descriptor.label} onChange={(event) => updateFileNameEntry('image_descriptors', index, { label: event.target.value })} />
                      </>
                    )}
                    <label htmlFor={`image-descriptor-abbreviation-${index}`}>Abbreviation</label>
                    <input id={`image-descriptor-abbreviation-${index}`} value={descriptor.abbreviation} onChange={(event) => updateFileNameEntry('image_descriptors', index, { abbreviation: event.target.value })} />
                  </div>
                );
              })}
            </div>
            <div className="workbench-controls-row">
              <button className="btn btn-secondary" type="button" onClick={() => addFileNameEntry('image_descriptors')}>
                Add Image Descriptor
              </button>
            </div>

            <h4>Image Modalities</h4>
            <p>Modalities are also filename values, so define their labels and identifiers alongside the filename descriptor they populate.</p>
            <div className="workbench-controls-row">
              <button className="btn btn-secondary" type="button" onClick={addImageModality} disabled={saving}>
                Add Modality
              </button>
            </div>
            {(config.image_modalities || []).length === 0 ? (
              <p>No image modalities configured yet.</p>
            ) : (
              <div className="filename-option-grid modality-option-grid">
                {(config.image_modalities || []).map((modality, index) => (
                  <div className="filename-option-card" style={{ '--segment-color': '#f97316' }} key={`image-modality-${index}`}>
                    <div className="filename-option-card-header">
                      <span>{modality.id || `modality-${index + 1}`}</span>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        aria-label={`Remove image modality ${index + 1}`}
                        onClick={() => removeImageModality(index)}
                        disabled={saving}
                      >
                        Remove
                      </button>
                    </div>
                    <label htmlFor={`image-modality-label-${index}`}>Label</label>
                    <input
                      id={`image-modality-label-${index}`}
                      aria-label={`Image modality label ${index + 1}`}
                      type="text"
                      value={modality.label || ''}
                      onChange={(event) => updateImageModality(index, { label: event.target.value })}
                    />
                    <label htmlFor={`image-modality-id-${index}`}>Identifier</label>
                    <input
                      id={`image-modality-id-${index}`}
                      aria-label={`Image modality id ${index + 1}`}
                      type="text"
                      value={modality.id || ''}
                      onChange={(event) => updateImageModality(index, { id: event.target.value })}
                    />
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`Image modality calibration required ${index + 1}`}
                        checked={Boolean(modality.calibration_required)}
                        onChange={(event) =>
                          updateImageModality(index, { calibration_required: event.target.checked })
                        }
                      />
                      Calibration required
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`Image modality example uploaded ${index + 1}`}
                        checked={Boolean(modality.example_image_uploaded)}
                        onChange={(event) =>
                          updateImageModality(index, { example_image_uploaded: event.target.checked })
                        }
                      />
                      Example uploaded
                    </label>
                  </div>
                ))}
              </div>
            )}

            <div className="filename-decoder-utility">
              <FilenameMetadataExtractor
                fileNamingScheme={normalizedFileNamingScheme}
                initialConfig={normalizedFileNamingScheme.metadata_extractor || { mode: 'simple', pattern: normalizedFileNamingScheme.delimiter, keys: [] }}
                previewFilename={expectedFilenameExample}
                title="Filename Regex & Delimiter Decoder"
                onConfigChange={handleFilenameExtractorConfigChange}
              />
            </div>
          </section>
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
            <div className="workbench-controls-row">
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
          </section>

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
                      ...normalizeSerialNumberScheme(previous),
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
                        ...normalizeSerialNumberScheme(previous),
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
                      ...normalizeSerialNumberScheme(previous),
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
                      ...normalizeSerialNumberScheme(previous),
                      part_sn_enabled: event.target.checked,
                    },
                  }))
                }
              />
              Track serial number at part level
            </label>
          </section>

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
                      ...normalizePhaseSettings(previous),
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
                      ...normalizePhaseSettings(previous),
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

          <section className="part-detail-panel" aria-label="Defect types">
            <h3>Defect Types</h3>
            <p>Define the defect taxonomy used in annotations and review workflows.</p>
            <div className="workbench-controls-row">
              <button className="btn btn-secondary" type="button" onClick={addDefectType} disabled={saving}>
                Add Defect Type
              </button>
            </div>
            {config.defect_types.length === 0 ? (
              <p>No defect types configured yet.</p>
            ) : (
              config.defect_types.map((defectType, index) => (
                <div className="workbench-controls-row config-entry-grid" key={`defect-type-${index}`}>
                  <label htmlFor={`defect-type-name-${index}`}>Name</label>
                  <input
                    id={`defect-type-name-${index}`}
                    aria-label={`Defect type name ${index + 1}`}
                    type="text"
                    value={defectType.name}
                    onChange={(event) => updateDefectType(index, { name: event.target.value })}
                  />
                  <label htmlFor={`defect-type-color-${index}`}>Color</label>
                  <input
                    id={`defect-type-color-${index}`}
                    aria-label={`Defect type color ${index + 1}`}
                    type="text"
                    value={defectType.color}
                    onChange={(event) => updateDefectType(index, { color: event.target.value })}
                  />
                  <label htmlFor={`defect-type-definition-${index}`}>Definition</label>
                  <input
                    id={`defect-type-definition-${index}`}
                    aria-label={`Defect type definition ${index + 1}`}
                    type="text"
                    value={defectType.definition || ''}
                    onChange={(event) => updateDefectType(index, { definition: event.target.value })}
                  />
                  <button
                    className="btn btn-secondary"
                    type="button"
                    aria-label={`Remove defect type ${index + 1}`}
                    onClick={() => removeDefectType(index)}
                    disabled={saving}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </section>

          <section className="part-detail-panel" aria-label="Part views">
            <h3>Part Views</h3>
            <p>Configure external/internal views and required modalities for each view.</p>
            <div className="workbench-controls-row">
              <button className="btn btn-secondary" type="button" onClick={addPartView} disabled={saving}>
                Add Part View
              </button>
            </div>
            {(config.part_views || []).length === 0 ? (
              <p>No part views configured yet.</p>
            ) : (
              (config.part_views || []).map((partView, index) => (
                <div className="workbench-controls-row config-entry-grid" key={`part-view-${index}`}>
                  <label htmlFor={`part-view-label-${index}`}>Label</label>
                  <input
                    id={`part-view-label-${index}`}
                    aria-label={`Part view label ${index + 1}`}
                    type="text"
                    value={partView.label || ''}
                    onChange={(event) => updatePartView(index, { label: event.target.value })}
                  />
                  <label htmlFor={`part-view-id-${index}`}>Identifier</label>
                  <input
                    id={`part-view-id-${index}`}
                    aria-label={`Part view id ${index + 1}`}
                    type="text"
                    value={partView.id || ''}
                    onChange={(event) => updatePartView(index, { id: event.target.value })}
                  />
                  <label htmlFor={`part-view-required-modalities-${index}`}>Required modalities</label>
                  <input
                    id={`part-view-required-modalities-${index}`}
                    aria-label={`Part view required modalities ${index + 1}`}
                    type="text"
                    value={(partView.required_modalities || []).join(', ')}
                    onChange={(event) =>
                      updatePartView(index, {
                        required_modalities: event.target.value
                          .split(',')
                          .map((value) => value.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                  <label htmlFor={`part-view-source-${index}`}>Source</label>
                  <select
                    id={`part-view-source-${index}`}
                    aria-label={`Part view source ${index + 1}`}
                    value={partView.source || 'manual'}
                    onChange={(event) => updatePartView(index, { source: event.target.value })}
                  >
                    <option value="manual">manual</option>
                    <option value="auto">auto</option>
                  </select>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    aria-label={`Remove part view ${index + 1}`}
                    onClick={() => removePartView(index)}
                    disabled={saving}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </section>

          <section className="part-detail-panel" aria-label="Display settings">
            <h3>Display Settings</h3>
            <label htmlFor="default-colormap">Default colormap</label>
            <select
              id="default-colormap"
              value={config.display_settings?.default_colormap || 'grayscale'}
              onChange={(event) => {
                const nextValue = event.target.value;
                setConfig((previous) => ({
                  ...previous,
                  display_settings: {
                    ...previous.display_settings,
                    default_colormap: nextValue,
                  },
                }));
              }}
            >
              <option value="grayscale">grayscale</option>
              <option value="magma">magma</option>
              <option value="viridis">viridis</option>
            </select>
            <label htmlFor="anomaly-colormap">Anomaly colormap</label>
            <select
              id="anomaly-colormap"
              aria-label="Anomaly colormap"
              value={config.display_settings?.anomaly_colormap || 'viridis'}
              onChange={(event) => {
                const nextValue = event.target.value;
                setConfig((previous) => ({
                  ...previous,
                  display_settings: {
                    ...previous.display_settings,
                    anomaly_colormap: nextValue,
                  },
                }));
              }}
            >
              <option value="grayscale">grayscale</option>
              <option value="magma">magma</option>
              <option value="viridis">viridis</option>
            </select>
            <label>
              <input
                type="checkbox"
                aria-label="Use grayscale base image"
                checked={Boolean(config.display_settings?.grayscale_base_image)}
                onChange={(event) => {
                  setConfig((previous) => ({
                    ...previous,
                    display_settings: {
                      ...previous.display_settings,
                      grayscale_base_image: event.target.checked,
                    },
                  }));
                }}
              />
              Use grayscale base image
            </label>
          </section>

          <section className="part-detail-panel" aria-label="Copy configuration">
            <h3>Copy Configuration</h3>
            <p>
              Copy settings from another project into this one.
              {currentProjectType
                ? ` Only ${currentProjectType} source projects are listed.`
                : ''}
            </p>
            {!hasCompatibleCopySources && (
              <p className="muted" data-testid="no-compatible-copy-sources">
                No compatible source projects are available yet.
              </p>
            )}
            <div className="workbench-controls-row" aria-busy={copyingConfiguration}>
              <select
                aria-label="Source project"
                value={copySourceProjectId}
                disabled={!hasCompatibleCopySources || copyingConfiguration}
                onChange={(event) => {
                  setCopySourceProjectId(event.target.value);
                  setError(null);
                  setStatusMessage('');
                }}
              >
                <option value="">Select project</option>
                {availableProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={!copySourceProjectId || !hasCompatibleCopySources || copyingConfiguration}
                onClick={copyConfiguration}
              >
                {copyingConfiguration ? 'Copying...' : 'Copy from Project'}
              </button>
            </div>
          </section>
          </div>

          <div className="workbench-controls-row configuration-action-bar">
            <button className="btn btn-primary" type="button" disabled={saving} onClick={saveConfiguration}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={!currentInterfaceLayout || savingInterfaceLayoutDefault}
              onClick={saveInterfaceLayoutAsProjectDefault}
            >
              {savingInterfaceLayoutDefault ? 'Saving Layout...' : 'Save Current Interface as Project Default'}
            </button>
            {isAdminUser && (
              <button
                className="btn btn-secondary"
                type="button"
                disabled={!currentInterfaceLayout || savingProjectTypeLayoutDefault}
                onClick={saveInterfaceLayoutAsProjectTypeDefault}
              >
                {savingProjectTypeLayoutDefault
                  ? 'Saving Type Layout...'
                  : `Save Current Interface as ${projectType || 'Type'} Default`}
              </button>
            )}
            <span>{hasConfiguration ? 'Configuration is populated.' : 'Using defaults until sections are configured.'}</span>
          </div>
        </>
      )}
    </section>
  );
});

export default ProjectConfigurationPanel;
