import React from 'react';
import ProjectAccessGroupControl from './ProjectAccessGroupControl';
import ProjectCalibrationControl from './ProjectCalibrationControl';
import AdvancedCalibrationControl from './AdvancedCalibrationControl';
import ProjectOwnerUserSection from './ProjectOwnerUserSection';
import ProjectProcessSettingsSection from './ProjectProcessSettingsSection';
import ProjectSerialSchemeSection from './ProjectSerialSchemeSection';
import ProjectPhaseSettingsSection from './ProjectPhaseSettingsSection';
import DefectTypesSection from './DefectTypesSection';
import DisplaySettingsSection from './DisplaySettingsSection';
import CopyConfigurationSection from './CopyConfigurationSection';

export default function GeneralConfigurationPanel({
  project,
  projectId,
  onProjectUpdated,
  config,
  setConfig,
  readOnly,
  saving,
  calibrationSectionVisible,
  updateCalibrationInputValidity,
  projectTypeUiSections,
  visibleGeneralSectionCount,
  addDefectType,
  updateDefectType,
  removeDefectType,
  currentProjectType,
  hasCompatibleCopySources,
  availableProjects,
  copySourceProjectId,
  setCopySourceProjectId,
  setError,
  setStatusMessage,
  copyingConfiguration,
  copyConfiguration,
}) {
  return (
    <div
      id="configuration-general-panel"
      className="configuration-sections-grid"
      data-testid="configuration-sections-grid"
      role="tabpanel"
      aria-label="General configuration"
    >
      {visibleGeneralSectionCount === 0 && (
        <section className="part-detail-panel" aria-live="polite">
          <p className="muted">No General configuration sections are enabled.</p>
        </section>
      )}
      <ProjectAccessGroupControl
        project={project}
        projectId={projectId}
        onProjectUpdated={onProjectUpdated}
      />
      {calibrationSectionVisible && (
        <>
          <ProjectCalibrationControl
            calibration={config.calibration}
            disabled={readOnly || saving}
            onChange={(calibration) => {
              setConfig((previous) => ({
                ...previous,
                calibration,
              }));
            }}
            onValidityChange={updateCalibrationInputValidity}
          />
          <AdvancedCalibrationControl
            projectId={projectId}
            disabled={readOnly || saving}
            modalityOptions={config.image_modalities}
          />
        </>
      )}
      <ProjectOwnerUserSection
        config={config}
        setConfig={setConfig}
        showOwnerSection={projectTypeUiSections['project_configuration.owner_section'] !== false}
        showUserSection={projectTypeUiSections['project_configuration.user_section'] !== false}
      />

      {projectTypeUiSections['project_configuration.process_settings'] !== false && (
        <ProjectProcessSettingsSection config={config} setConfig={setConfig} />
      )}

      {projectTypeUiSections['project_configuration.serial_scheme'] !== false && (
        <ProjectSerialSchemeSection config={config} setConfig={setConfig} />
      )}

      {projectTypeUiSections['project_configuration.project_phase_settings'] !== false && (
        <ProjectPhaseSettingsSection config={config} setConfig={setConfig} />
      )}

      {projectTypeUiSections['project_configuration.defect_types'] !== false && (
        <DefectTypesSection
          config={config}
          saving={saving}
          addDefectType={addDefectType}
          updateDefectType={updateDefectType}
          removeDefectType={removeDefectType}
        />
      )}

      {projectTypeUiSections['project_configuration.display_options'] !== false && (
        <DisplaySettingsSection config={config} setConfig={setConfig} />
      )}

      {projectTypeUiSections['project_configuration.copy_configuration'] !== false && (
        <CopyConfigurationSection
          currentProjectType={currentProjectType}
          hasCompatibleCopySources={hasCompatibleCopySources}
          availableProjects={availableProjects}
          copySourceProjectId={copySourceProjectId}
          setCopySourceProjectId={setCopySourceProjectId}
          setError={setError}
          setStatusMessage={setStatusMessage}
          readOnly={readOnly}
          copyingConfiguration={copyingConfiguration}
          copyConfiguration={copyConfiguration}
        />
      )}
    </div>
  );
}
