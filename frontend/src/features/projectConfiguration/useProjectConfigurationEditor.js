import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { buildErrorWithServiceDiagnostics } from '../../utils/serviceDiagnostics';
import { fallbackOnHttpError } from '../../api/client';
import {
  fetchProjectConfiguration,
  fetchProjects,
  updateProjectConfiguration,
} from '../../api/projects';
import { fetchOptionalCurrentUser } from '../../api/users';
import {
  EMPTY_CONFIG,
  normalizeProjectConfiguration,
  validateConfiguration,
} from './configurationSchema';

const AUTOSAVE_DELAY_MS = 500;

export const getConfigurationSignature = (configuration) => JSON.stringify(configuration || {});

// Owns the project configuration load, save, and autosave/dirty-tracking
// lifecycle: fetching the configuration and candidate copy-source projects,
// persisting edits (manual save and debounced autosave), tracking whether a
// save is pending, and exposing the imperative flush/pending API the panel
// forwards to its ref.
export function useProjectConfigurationEditor({
  ref,
  projectId,
  projectType,
  readOnly,
  onConfigurationSaved,
}) {
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [availableProjects, setAvailableProjects] = useState([]);
  const [currentProjectType, setCurrentProjectType] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [calibrationInputValid, setCalibrationInputValid] = useState(true);

  const configRef = useRef(config);
  const autosaveTimerRef = useRef(null);
  const loadCompleteRef = useRef(false);
  const lastSavedSignatureRef = useRef(getConfigurationSignature(EMPTY_CONFIG));
  const saveLoopPromiseRef = useRef(null);
  const autosaveRequestedDuringSaveRef = useRef(false);
  const calibrationInputValidRef = useRef(true);

  const updateCalibrationInputValidity = useCallback((isValid) => {
    calibrationInputValidRef.current = isValid;
    setCalibrationInputValid(isValid);
  }, []);

  const markConfigurationSynced = useCallback((nextConfig) => {
    lastSavedSignatureRef.current = getConfigurationSignature(nextConfig);
  }, []);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => () => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (readOnly) return undefined;
    const loadCurrentUser = async () => {
      try {
        const data = await fetchOptionalCurrentUser();
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
    return undefined;
  }, [readOnly]);

  useEffect(() => {
    const loadConfiguration = async () => {
      try {
        setLoading(true);
        loadCompleteRef.current = false;
        setError(null);
        setStatusMessage('');

        const [configData, projectsData] = await Promise.all([
          fetchProjectConfiguration(projectId),
          fallbackOnHttpError(fetchProjects(), []),
        ]);
        const incomingConfig = configData?.config && typeof configData.config === 'object' ? configData.config : {};
        let targetProjectType = configData?.project_type || projectType || '';

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

        const normalizedConfig = normalizeProjectConfiguration(incomingConfig, targetProjectType);
        markConfigurationSynced(normalizedConfig);
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
  }, [markConfigurationSynced, projectId, projectType]);

  const persistConfiguration = useCallback(async (configurationToSave, statusLabel = 'Configuration saved.') => {
    if (readOnly) return false;
    const validationErrors = validateConfiguration(configurationToSave);
    if (validationErrors.length > 0) {
      setError(validationErrors.join(' '));
      setStatusMessage('');
      return false;
    }

    try {
      setSaving(true);
      setError(null);
      const payload = await updateProjectConfiguration(projectId, configurationToSave, { errorLabel: 'Failed to save project configuration' });
      markConfigurationSynced(configurationToSave);
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
  }, [markConfigurationSynced, onConfigurationSaved, projectId, readOnly]);

  const runAutosave = useCallback((statusLabel = 'Configuration autosaved.') => {
    if (readOnly) return Promise.resolve(true);
    if (!calibrationInputValidRef.current) {
      setError('Enter a valid project calibration before saving or leaving Configuration.');
      setStatusMessage('');
      return Promise.resolve(false);
    }
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
  }, [persistConfiguration, readOnly]);

  const hasPendingAutosave = useCallback(() => {
    if (!loadCompleteRef.current || readOnly) return false;
    return Boolean(
      autosaveTimerRef.current ||
      saveLoopPromiseRef.current ||
      !calibrationInputValidRef.current ||
      getConfigurationSignature(configRef.current) !== lastSavedSignatureRef.current,
    );
  }, [readOnly]);

  const flushPendingAutosave = useCallback(async (statusLabel = 'Configuration autosaved.') => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (!hasPendingAutosave()) {
      return true;
    }
    if (!calibrationInputValidRef.current) {
      setError('Enter a valid project calibration before saving or leaving Configuration.');
      setStatusMessage('');
      return false;
    }
    return runAutosave(statusLabel);
  }, [hasPendingAutosave, runAutosave]);

  useImperativeHandle(ref, () => ({
    hasPendingAutosave,
    flushPendingAutosave,
  }), [flushPendingAutosave, hasPendingAutosave]);

  useEffect(() => {
    if (!loadCompleteRef.current || loading || readOnly) {
      if (readOnly && autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
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
  }, [config, loading, readOnly, runAutosave]);

  const saveConfiguration = useCallback(async () => {
    if (readOnly || !calibrationInputValidRef.current) return;
    if (hasPendingAutosave()) {
      await flushPendingAutosave('Configuration saved.');
      return;
    }
    await persistConfiguration(configRef.current, 'Configuration saved.');
  }, [flushPendingAutosave, hasPendingAutosave, persistConfiguration, readOnly]);

  return {
    config,
    setConfig,
    availableProjects,
    currentProjectType,
    loading,
    saving,
    error,
    setError,
    statusMessage,
    setStatusMessage,
    calibrationInputValid,
    updateCalibrationInputValidity,
    hasPendingAutosave,
    flushPendingAutosave,
    saveConfiguration,
    markConfigurationSynced,
  };
}
