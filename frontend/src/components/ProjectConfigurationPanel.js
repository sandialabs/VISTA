import React, {
  forwardRef,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { buildErrorWithServiceDiagnostics } from '../utils/serviceDiagnostics';
import { rethrowWithServerDetail } from '../api/client';
import {
  cloneProjectConfiguration,
  saveProjectInterfaceLayoutDefault,
  saveProjectTypeInterfaceLayoutDefault,
} from '../api/projects';
import {
  PT1_HIDDEN_UI_SECTION_KEYS,
  isPt1ProjectType,
  normalizeConfigurationSection,
  normalizeProjectConfiguration,
  normalizeProjectTypeSuffix,
} from '../features/projectConfiguration/configurationSchema';
import { getCloneConfigOrThrow } from '../features/projectConfiguration/cloneConfigValidation';
import { useConfigEntryMutations } from '../features/projectConfiguration/useConfigEntryMutations';
import { useProjectConfigurationEditor } from '../features/projectConfiguration/useProjectConfigurationEditor';
import { useUiSectionSearch } from '../features/projectConfiguration/useUiSectionSearch';
import { usePt3GuideSettings } from '../features/projectConfiguration/usePt3GuideSettings';
import {
  buildExpectedFilenameExample,
  getFilenameConventionSegments,
} from '../features/projectConfiguration/filenameConventionHelpers';
import GeneralConfigurationPanel from './projectConfiguration/GeneralConfigurationPanel';
import UiConfigurationPanel from './projectConfiguration/UiConfigurationPanel';
import FilenameConventionPanel from './projectConfiguration/FilenameConventionPanel';
import HotkeysConfigurationPanel from './projectConfiguration/HotkeysConfigurationPanel';

const CONFIGURATION_SUBTABS = [
  { id: 'general', label: 'General', sectionKey: 'project_configuration.general', panelId: 'configuration-general-panel' },
  { id: 'filenameConvention', label: 'Filename Convention', sectionKey: 'project_configuration.filename_convention', panelId: 'configuration-filename-convention-panel' },
  { id: 'hotkeys', label: 'Hotkeys', sectionKey: 'project_configuration.hotkeys', panelId: 'configuration-hotkeys-panel' },
  { id: 'uiConfiguration', label: 'UI Configuration', sectionKey: 'project_configuration.ui_configuration', panelId: 'configuration-ui-panel' },
];

const GENERAL_CONFIGURATION_SECTIONS = [
  'project_configuration.owner_section',
  'project_configuration.user_section',
  'project_configuration.calibration',
  'project_configuration.process_settings',
  'project_configuration.serial_scheme',
  'project_configuration.project_phase_settings',
  'project_configuration.defect_types',
  'project_configuration.display_options',
  'project_configuration.copy_configuration',
];

const ProjectConfigurationPanel = forwardRef(function ProjectConfigurationPanel({
  projectId,
  project = null,
  projectType,
  currentInterfaceLayout = null,
  isAdminUser = false,
  onConfigurationSaved = null,
  onProjectUpdated = null,
  onActiveSubtabChange = null,
}, ref) {
  const readOnly = project?.is_archived === true;

  const {
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
    saveConfiguration,
    markConfigurationSynced,
  } = useProjectConfigurationEditor({
    ref,
    projectId,
    projectType,
    readOnly,
    onConfigurationSaved,
  });

  const [copySourceProjectId, setCopySourceProjectId] = useState('');
  const [copyingConfiguration, setCopyingConfiguration] = useState(false);
  const [activeConfigurationSubtab, setActiveConfigurationSubtab] = useState('general');

  useEffect(() => {
    onActiveSubtabChange?.(activeConfigurationSubtab);
  }, [activeConfigurationSubtab, onActiveSubtabChange]);

  const [savingInterfaceLayoutDefault, setSavingInterfaceLayoutDefault] = useState(false);
  const [savingProjectTypeLayoutDefault, setSavingProjectTypeLayoutDefault] = useState(false);
  const hasCompatibleCopySources = availableProjects.length > 0;
  const selectedCopySourceProject = availableProjects.find((project) => project.id === copySourceProjectId) || null;
  const [primaryError, diagnosticError] = typeof error === 'string'
    ? error.split('\n\n', 2)
    : ['', ''];
  const activeProjectType = projectType || currentProjectType;
  const isPt1Project = isPt1ProjectType(activeProjectType);
  const projectTypeUiSections = useMemo(
    () => normalizeConfigurationSection('ui_sections', config, activeProjectType),
    [activeProjectType, config],
  );
  const hiddenUiSectionKeys = useMemo(
    () => (isPt1Project ? PT1_HIDDEN_UI_SECTION_KEYS : new Set()),
    [isPt1Project],
  );
  const {
    uiSearchQuery,
    setUiSearchQuery,
    uiSearchIndex,
    setUiSearchIndex,
    expandedUiGroups,
    toggleUiGroup,
    uiSectionSearchResults,
    selectedUiSectionSearchResult,
  } = useUiSectionSearch(hiddenUiSectionKeys);
  const visibleConfigurationSubtabs = useMemo(
    () => CONFIGURATION_SUBTABS.filter((subtab) => projectTypeUiSections[subtab.sectionKey] !== false),
    [projectTypeUiSections],
  );
  const visibleConfigurationSubtabIds = useMemo(
    () => new Set(visibleConfigurationSubtabs.map((subtab) => subtab.id)),
    [visibleConfigurationSubtabs],
  );
  const visibleGeneralSectionCount = useMemo(
    () => GENERAL_CONFIGURATION_SECTIONS.filter((sectionKey) => projectTypeUiSections[sectionKey] !== false).length,
    [projectTypeUiSections],
  );
  const calibrationSectionVisible = projectTypeUiSections['project_configuration.calibration'] !== false;
  useEffect(() => {
    if (!calibrationSectionVisible) {
      updateCalibrationInputValidity(true);
    }
  }, [calibrationSectionVisible, updateCalibrationInputValidity]);
  const isPt3Project = normalizeProjectTypeSuffix(activeProjectType) === 'PT3';
  const {
    pt3GuideSettings,
    pt3GuideSettingsAreDefault,
    updatePt3GuideSetting,
    resetPt3GuideSettings,
  } = usePt3GuideSettings(config, setConfig);

  useEffect(() => {
    if (visibleConfigurationSubtabs.length === 0 || visibleConfigurationSubtabIds.has(activeConfigurationSubtab)) {
      return;
    }
    setActiveConfigurationSubtab(visibleConfigurationSubtabs[0].id);
  }, [activeConfigurationSubtab, visibleConfigurationSubtabIds, visibleConfigurationSubtabs]);

  const normalizedFileNamingScheme = useMemo(
    () => (isPt1Project ? null : normalizeConfigurationSection('file_naming_scheme', config)),
    [config, isPt1Project],
  );
  const filenameConvention = useMemo(
    () => (normalizedFileNamingScheme ? getFilenameConventionSegments(normalizedFileNamingScheme) : { delimiter: '', segments: [] }),
    [normalizedFileNamingScheme],
  );
  const expectedFilenameExample = useMemo(
    () => (normalizedFileNamingScheme ? buildExpectedFilenameExample(normalizedFileNamingScheme) : ''),
    [normalizedFileNamingScheme],
  );

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

  const saveInterfaceLayoutAsProjectDefault = async () => {
    if (!currentInterfaceLayout || savingInterfaceLayoutDefault) return;
    try {
      setSavingInterfaceLayoutDefault(true);
      setError(null);
      setStatusMessage('');
      const payload = await saveProjectInterfaceLayoutDefault(
        projectId,
        currentInterfaceLayout, { errorLabel: 'Failed to save project interface default' },
      );
      if (payload?.config) {
        setConfig((previous) => normalizeProjectConfiguration({
          ...previous,
          ...payload.config,
        }, activeProjectType));
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
      const payload = await saveProjectTypeInterfaceLayoutDefault(
        projectId,
        currentInterfaceLayout,
        { errorLabel: `Failed to save ${projectType || 'project type'} interface default` },
      );
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

  const {
    addDefectType,
    updateDefectType,
    removeDefectType,
    addImageModality,
    updateImageModality,
    removeImageModality,
    addPartView,
    updatePartView,
    removePartView,
    updateFileNameEntry,
    addFileNameEntry,
    removeFileNameEntry,
    updateOverlayIndicator,
  } = useConfigEntryMutations(setConfig);

  const copyConfiguration = async () => {
    if (readOnly || !copySourceProjectId || copyingConfiguration) return;

    try {
      setCopyingConfiguration(true);
      setError(null);
      setStatusMessage('');
      const cloneData = await cloneProjectConfiguration(projectId, copySourceProjectId)
        .catch(rethrowWithServerDetail('Failed to copy project configuration'));

      const clonedConfig = getCloneConfigOrThrow(cloneData);
      const nextClonedConfig = normalizeProjectConfiguration(
        clonedConfig,
        currentProjectType || projectType,
      );
      markConfigurationSynced(nextClonedConfig);
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
            Configure filename side and modality labels, defect definitions, process controls, and display options.
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
              <h3>Modalities</h3>
              <p>{config.image_modalities.length} filename labels configured</p>
            </article>
            <article className="summary-card">
              <h3>Sides</h3>
              <p>{config.part_views.length} filename labels configured</p>
            </article>
            <article className="summary-card">
              <h3>Defect Types</h3>
              <p>{config.defect_types.length} configured</p>
            </article>
          </div>

          {visibleConfigurationSubtabs.length > 0 ? (
            <div className="configuration-subtabs project-tabs" role="tablist" aria-label="Configuration sections">
              {visibleConfigurationSubtabs.map((subtab) => (
                <button
                  key={subtab.id}
                  type="button"
                  className={`project-tab ${activeConfigurationSubtab === subtab.id ? 'active' : ''}`}
                  role="tab"
                  aria-selected={activeConfigurationSubtab === subtab.id}
                  aria-controls={subtab.panelId}
                  onClick={() => setActiveConfigurationSubtab(subtab.id)}
                >
                  {subtab.label}
                </button>
              ))}
            </div>
          ) : (
            <section className="part-detail-panel" aria-live="polite">
              <p className="muted">No Project Configuration sections are enabled. Re-enable sections from a project default or administrator configuration.</p>
            </section>
          )}

          {visibleConfigurationSubtabIds.has('general') && activeConfigurationSubtab === 'general' && (
            <GeneralConfigurationPanel
              project={project}
              projectId={projectId}
              onProjectUpdated={onProjectUpdated}
              config={config}
              setConfig={setConfig}
              readOnly={readOnly}
              saving={saving}
              calibrationSectionVisible={calibrationSectionVisible}
              updateCalibrationInputValidity={updateCalibrationInputValidity}
              projectTypeUiSections={projectTypeUiSections}
              visibleGeneralSectionCount={visibleGeneralSectionCount}
              addDefectType={addDefectType}
              updateDefectType={updateDefectType}
              removeDefectType={removeDefectType}
              currentProjectType={currentProjectType}
              hasCompatibleCopySources={hasCompatibleCopySources}
              availableProjects={availableProjects}
              copySourceProjectId={copySourceProjectId}
              setCopySourceProjectId={setCopySourceProjectId}
              setError={setError}
              setStatusMessage={setStatusMessage}
              copyingConfiguration={copyingConfiguration}
              copyConfiguration={copyConfiguration}
            />
          )}


          {visibleConfigurationSubtabIds.has('uiConfiguration') && activeConfigurationSubtab === 'uiConfiguration' && (
            <UiConfigurationPanel
              projectTypeUiSections={projectTypeUiSections}
              isPt3Project={isPt3Project}
              uiSearchQuery={uiSearchQuery}
              setUiSearchQuery={setUiSearchQuery}
              uiSectionSearchResults={uiSectionSearchResults}
              uiSearchIndex={uiSearchIndex}
              setUiSearchIndex={setUiSearchIndex}
              config={config}
              setConfig={setConfig}
              expandedUiGroups={expandedUiGroups}
              toggleUiGroup={toggleUiGroup}
              selectedUiSectionSearchResult={selectedUiSectionSearchResult}
              hiddenUiSectionKeys={hiddenUiSectionKeys}
              pt3GuideSettings={pt3GuideSettings}
              pt3GuideSettingsAreDefault={pt3GuideSettingsAreDefault}
              resetPt3GuideSettings={resetPt3GuideSettings}
              updatePt3GuideSetting={updatePt3GuideSetting}
            />
          )}

          {visibleConfigurationSubtabIds.has('filenameConvention') && activeConfigurationSubtab === 'filenameConvention' && (
            <FilenameConventionPanel
              expectedFilenameExample={expectedFilenameExample}
              filenameConvention={filenameConvention}
              normalizedFileNamingScheme={normalizedFileNamingScheme}
              setConfig={setConfig}
              updateFileNameEntry={updateFileNameEntry}
              addFileNameEntry={addFileNameEntry}
              removeFileNameEntry={removeFileNameEntry}
              updateOverlayIndicator={updateOverlayIndicator}
              projectTypeUiSections={projectTypeUiSections}
              config={config}
              saving={saving}
              addPartView={addPartView}
              updatePartView={updatePartView}
              removePartView={removePartView}
              addImageModality={addImageModality}
              updateImageModality={updateImageModality}
              removeImageModality={removeImageModality}
            />
          )}


          {visibleConfigurationSubtabIds.has('hotkeys') && activeConfigurationSubtab === 'hotkeys' && (
            <HotkeysConfigurationPanel config={config} setConfig={setConfig} />
          )}

          <div
            className={[
              'workbench-controls-row',
              'configuration-action-bar',
              activeConfigurationSubtab === 'general'
                ? 'configuration-action-bar--calibration-safe'
                : '',
            ].filter(Boolean).join(' ')}
          >
            <button
              className="btn btn-primary"
              type="button"
              disabled={readOnly || saving || !calibrationInputValid}
              onClick={saveConfiguration}
            >
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
