import React from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import './App.css';

import InspectionWorkbenchPanel from './components/InspectionWorkbenchPanel';
import AnalyzeWorkbenchTab from './components/AnalyzeWorkbenchTab';
import ProjectConfigurationPanel from './components/ProjectConfigurationPanel';
import ProjectReportTab from './components/ProjectReportTab';
import ProjectPhaseFlow from './components/ProjectPhaseFlow';
import { useInspectionWorkbenchSessionController } from './components/inspectionWorkbenchSession';
import { resolveCurrentProjectPhase } from './utils/projectPhases';
import { getProjectTypeLabel } from './projectTypes';
import { MAIN_TAB_DEFINITIONS } from './features/project/projectTabs';
import ProjectDataPanel from './features/project/ProjectDataPanel';
import useIngestValidation from './features/project/useIngestValidation';
import useProjectBootstrap from './features/project/useProjectBootstrap';
import useProjectCollections from './features/project/useProjectCollections';
import useProjectDataCounts from './features/project/useProjectDataCounts';
import useProjectDataTabLoads from './features/project/useProjectDataTabLoads';
import useProjectRecord from './features/project/useProjectRecord';
import useProjectRouteOwnership from './features/project/useProjectRouteOwnership';
import useProjectShareLink from './features/project/useProjectShareLink';
import useProjectTabNavigation from './features/project/useProjectTabNavigation';
import useProjectUploadHandlers from './features/project/useProjectUploadHandlers';
import useRecentlyDeletedOverlays from './features/project/useRecentlyDeletedOverlays';

function Project({ currentUserGroups = [] }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeOwnership = useProjectRouteOwnership(id);
  const record = useProjectRecord({ projectId: id, routeOwnership });
  const {
    error,
    loading,
    project,
    projectConfiguration,
    setActiveProjectConfigurationValue,
    setActiveProjectError,
    setActiveProjectValue,
  } = record;
  const tabs = useProjectTabNavigation({
    location,
    navigate,
    projectConfiguration,
    routeOwnership,
  });
  const {
    activeMainTab,
    activeProjectDataTab,
    autosaveTabDelayMessage,
    handleInspectionShareStateChange,
    handleMainTabChange,
    inspectionLaunchFilters,
    interfaceHierarchy,
    projectConfigurationPanelRef,
    visibleMainTabs,
  } = tabs;
  const {
    session: inspectionMprSession,
    updateSession: handleInspectionMprSessionChange,
  } = useInspectionWorkbenchSessionController(id);
  const { handleCopySessionLink, shareLinkMessage } = useProjectShareLink({ routeOwnership });
  const counts = useProjectDataCounts({
    isActiveProject: routeOwnership.isActiveProject,
    projectId: id,
    setError: setActiveProjectError,
  });
  const collections = useProjectCollections({
    isActiveProject: routeOwnership.isActiveProject,
    projectId: id,
  });
  useProjectBootstrap({
    abortProjectCollectionRequests: collections.abortProjectCollectionRequests,
    loadProjectRecord: record.loadProjectRecord,
    refreshProjectCounts: counts.refreshProjectCounts,
    resetProjectCollections: collections.resetProjectCollections,
    resetProjectCounts: counts.resetProjectCounts,
    routeOwnership,
  });
  useProjectDataTabLoads({
    activeMainTab,
    activeProjectDataTab,
    loadProjectImages: collections.loadProjectImages,
    loadProjectParts: collections.loadProjectParts,
    projectImagesState: collections.projectImagesState,
    projectPartsState: collections.projectPartsState,
  });
  const dataHandlers = useProjectUploadHandlers({
    collections,
    projectId: id,
    refreshProjectConfiguration: record.refreshProjectConfiguration,
    refreshProjectCounts: counts.refreshProjectCounts,
    refreshProjectMetadata: record.refreshProjectMetadata,
    routeOwnership,
  });
  const recentlyDeleted = useRecentlyDeletedOverlays({
    activeMainTab,
    activeProjectDataTab,
    onProjectCollectionsChanged: dataHandlers.handleProjectCollectionsChanged,
    projectId: id,
    routeOwnership,
    setError: setActiveProjectError,
  });
  const { ingestResult, requestIngestValidation } = useIngestValidation({
    onProjectCollectionsChanged: dataHandlers.handleProjectCollectionsChanged,
    projectId: id,
    routeOwnership,
  });

  const currentPhase = resolveCurrentProjectPhase({
    phaseSettings: projectConfiguration?.phase_settings,
    partsLoaded: counts.dataCounts.partsLoaded,
    annotations: counts.dataCounts.annotations,
  });

  const renderMainPanel = () => {
    if (activeMainTab === 'inspection') {
      return (
        <InspectionWorkbenchPanel
          projectId={id}
          projectType={project?.project_type}
          readOnly={project?.is_archived !== false}
          hierarchy={interfaceHierarchy.inspection}
          launchFilters={inspectionLaunchFilters}
          mprSession={inspectionMprSession}
          onMprSessionChange={handleInspectionMprSessionChange}
          onInspectionShareStateChange={handleInspectionShareStateChange}
        />
      );
    }
    if (activeMainTab === 'project_data') {
      return (
        <ProjectDataPanel
          activeProjectDataTab={activeProjectDataTab}
          countsLoading={counts.countsLoading}
          dataCounts={counts.dataCounts}
          handleBundleImportComplete={dataHandlers.handleBundleImportComplete}
          handleInspectBatch={tabs.handleInspectBatch}
          handleMetadataAssociationsChanged={dataHandlers.handleMetadataAssociationsChanged}
          handlePartsUnloaded={dataHandlers.handlePartsUnloaded}
          handleProjectCollectionsChanged={dataHandlers.handleProjectCollectionsChanged}
          handleProjectDataTabChange={tabs.handleProjectDataTabChange}
          handleProjectMetadataLoaded={record.handleProjectMetadataLoaded}
          handleUploadComplete={dataHandlers.handleUploadComplete}
          ingestResult={ingestResult}
          loadProjectImages={collections.loadProjectImages}
          loadProjectParts={collections.loadProjectParts}
          metadata={record.metadata}
          project={project}
          projectConfiguration={projectConfiguration}
          projectId={id}
          projectImages={collections.projectImages}
          projectImagesState={collections.projectImagesState}
          projectParts={collections.projectParts}
          projectPartsState={collections.projectPartsState}
          recentlyDeletedLoading={recentlyDeleted.recentlyDeletedLoading}
          recentlyDeletedOverlays={recentlyDeleted.recentlyDeletedOverlays}
          refreshRecentlyDeletedOverlays={recentlyDeleted.refreshRecentlyDeletedOverlays}
          requestIngestValidation={requestIngestValidation}
          restoreRecentlyDeletedOverlay={recentlyDeleted.restoreRecentlyDeletedOverlay}
          setActiveProjectError={setActiveProjectError}
          visibleProjectDataTabs={tabs.visibleProjectDataTabs}
        />
      );
    }
    if (activeMainTab === 'analyze') {
      return (
        <AnalyzeWorkbenchTab
          projectId={id}
          projectType={project?.project_type}
          setError={setActiveProjectError}
        />
      );
    }
    if (activeMainTab === 'project_configuration') {
      return (
        <>
          <ProjectConfigurationPanel
            projectId={id}
            project={project}
            projectType={project?.project_type}
            currentInterfaceLayout={interfaceHierarchy}
            isAdminUser={currentUserGroups.includes('admin') || currentUserGroups.includes('admins')}
            ref={projectConfigurationPanelRef}
            onConfigurationSaved={setActiveProjectConfigurationValue}
            onProjectUpdated={setActiveProjectValue}
          />
        </>
      );
    }
    if (activeMainTab === 'report') {
      return <ProjectReportTab projectId={id} projectName={project?.name} setError={setActiveProjectError} />;
    }
    return null;
  };

  const renderMainTabs = (className = '') => (
    <div className={`project-tabs project-main-tabs ${className}`.trim()} role="tablist" aria-label="Project sections">
      {visibleMainTabs.map((tabKey) => (
        <button
          key={tabKey}
          type="button"
          className={`project-tab ${activeMainTab === tabKey ? 'active' : ''}`}
          role="tab"
          aria-selected={activeMainTab === tabKey}
          onClick={() => handleMainTabChange(tabKey)}
        >
          {MAIN_TAB_DEFINITIONS[tabKey]?.label || tabKey}
        </button>
      ))}
    </div>
  );

  return (
    <div className="App">
      <header className="project-header">
        <div className="project-header-content">
          <div className="project-header-top">
            <div className="project-nav">
              <button className="back-btn" onClick={() => navigate('/')}>
                <span className="back-icon">←</span>
                <span>Back to Dashboard</span>
              </button>
              <button className="back-btn share-link-btn" onClick={handleCopySessionLink}>
                Copy session link
              </button>
            </div>
            <div className="project-info">
              <div className="project-title-row">
                <h1 className="project-title">{project ? project.name : 'Loading project...'}</h1>
                <span className="project-group">Type: {getProjectTypeLabel(project?.project_type, { short: true })}</span>
              </div>
            </div>
          </div>
          <div className="project-header-bottom">
            {!loading && renderMainTabs('project-header-tabs')}
            <ProjectPhaseFlow currentPhase={currentPhase} />
          </div>
        </div>
      </header>

      <div className="project-container">
        {error && (
          <div className="alert alert-error alert-dismissible" role="alert">
            <div>
              <strong>Error:</strong> {error}
            </div>
            <button
              type="button"
              className="alert-dismiss-btn"
              aria-label="Clear error message"
              onClick={() => setActiveProjectError(null)}
            >
              ×
            </button>
          </div>
        )}

        {autosaveTabDelayMessage && (
          <div className="alert alert-info" role="status">
            {autosaveTabDelayMessage}
          </div>
        )}

        {shareLinkMessage && (
          <div className={`alert alert-${shareLinkMessage.type}`} role="status">
            {shareLinkMessage.text}
          </div>
        )}

        {loading && (
          <div className="loading-container">
            <div className="spinner"></div>
            <div className="loading-text">Loading project data...</div>
          </div>
        )}

        {!loading && (
          <div className="project-content project-main-tab-shell" data-active-main-tab={activeMainTab}>
            <section className="project-main-panel" data-active-main-tab={activeMainTab} aria-label="Selected project section">
              {renderMainPanel()}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default Project;
