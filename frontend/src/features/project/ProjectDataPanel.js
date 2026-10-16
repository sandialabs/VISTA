import React, { memo, useCallback } from 'react';

import ImageUploader from '../../components/ImageUploader';
import ProjectDataSummaryTab from '../../components/ProjectDataSummaryTab';
import ProjectDataExportPanel from '../../components/ProjectDataExportPanel';
import ImagesToPartsTab from '../../components/ImagesToPartsTab';
import BatchesTab from '../../components/BatchesTab';
import RemoveImagesTab from '../../components/RemoveImagesTab';
import UnloadPartsTab from '../../components/UnloadPartsTab';
import OverlaysTab from '../../components/OverlaysTab';
import ProjectDataMetadataTab from '../../components/ProjectDataMetadataTab';
import { isUiSectionEnabled } from '../../utils/uiSections';
import { IngestValidationPanel, RecentlyDeletedOverlaysPanel } from './ProjectDataActionPanels';
import { resolveProjectCollectionReadiness } from './projectDataUtils';
import { LazyProjectDataState } from './projectTabs';

// Project Data main tab: summary, subtab bar, and the active subtab. Memoized
// so unrelated Project state changes do not re-render the data tabs.
function ProjectDataPanel({
  activeProjectDataTab,
  countsLoading,
  dataCounts,
  handleBundleImportComplete,
  handleInspectBatch,
  handleMetadataAssociationsChanged,
  handlePartsUnloaded,
  handleProjectCollectionsChanged,
  handleProjectDataTabChange,
  handleProjectMetadataLoaded,
  handleUploadComplete,
  ingestResult,
  loadProjectImages,
  loadProjectParts,
  metadata,
  project,
  projectConfiguration,
  projectId,
  projectImages,
  projectImagesState,
  projectParts,
  projectPartsState,
  recentlyDeletedLoading,
  recentlyDeletedOverlays,
  refreshRecentlyDeletedOverlays,
  requestIngestValidation,
  restoreRecentlyDeletedOverlay,
  setActiveProjectError,
  visibleProjectDataTabs,
}) {
  const {
    completeProjectCollectionsAvailable,
    completeProjectCollectionsError,
    completeProjectCollectionsReady,
    projectImagesReady,
    projectPartsAvailable,
    projectPartsReady,
  } = resolveProjectCollectionReadiness(projectPartsState, projectImagesState);
  const retryCompleteCollections = useCallback(() => {
    if (!projectPartsReady) loadProjectParts();
    if (!projectImagesReady) loadProjectImages();
  }, [loadProjectImages, loadProjectParts, projectImagesReady, projectPartsReady]);

  return (
    <>
      {isUiSectionEnabled(projectConfiguration, 'project_data.summary') && (
        <ProjectDataSummaryTab counts={dataCounts} loading={countsLoading} />
      )}

      <div className="project-data-subtabs project-tabs" role="tablist" aria-label="Project data sections">
        {visibleProjectDataTabs.map(([tabKey, definition]) => (
          <button
            key={tabKey}
            type="button"
            className={`project-tab ${activeProjectDataTab === tabKey ? 'active' : ''}`}
            role="tab"
            aria-selected={activeProjectDataTab === tabKey}
            onClick={() => handleProjectDataTabChange(tabKey)}
          >
            {definition.label}
          </button>
        ))}
      </div>

      {activeProjectDataTab === 'load_images' && (
        <div className="project-data-tab-panel" role="tabpanel" aria-label="Load Images">
          {!project?.is_archived && (
            <div className="management-sections project-data-upload-first">
              <div className="upload-section">
                <ImageUploader
                  projectId={projectId}
                  projectType={project?.project_type}
                  projectConfiguration={projectConfiguration}
                  onUploadComplete={handleUploadComplete}
                  onProjectMetadataLoaded={handleProjectMetadataLoaded}
                  setError={setActiveProjectError}
                />
              </div>
              <div className="export-section">
                <ProjectDataExportPanel
                  projectId={projectId}
                  projectName={project?.name}
                  counts={dataCounts}
                  setError={setActiveProjectError}
                  onImportComplete={handleBundleImportComplete}
                />
              </div>
            </div>
          )}
          {isUiSectionEnabled(projectConfiguration, 'project_data.data_validation') && (
            <IngestValidationPanel
              ingestResult={ingestResult}
              onRequestIngestValidation={requestIngestValidation}
            />
          )}
        </div>
      )}

      {activeProjectDataTab === 'batches' && !projectPartsReady && (
        <LazyProjectDataState
          label="Batches"
          error={projectPartsState.error}
          onRetry={loadProjectParts}
        />
      )}

      {activeProjectDataTab === 'batches' && projectPartsReady && (
        <BatchesTab
          projectId={projectId}
          parts={projectParts}
          onAssignmentsChanged={handleProjectCollectionsChanged}
          setError={setActiveProjectError}
          onInspectBatch={handleInspectBatch}
        />
      )}

      {activeProjectDataTab === 'images_to_parts' && !completeProjectCollectionsReady && (
        <LazyProjectDataState
          label="Images to Parts"
          error={completeProjectCollectionsError}
          onRetry={retryCompleteCollections}
        />
      )}

      {activeProjectDataTab === 'images_to_parts' && completeProjectCollectionsReady && (
        <ImagesToPartsTab
          projectId={projectId}
          parts={projectParts}
          images={projectImages}
          projectConfiguration={projectConfiguration}
          onAssignmentsChanged={handleProjectCollectionsChanged}
          setError={setActiveProjectError}
        />
      )}

      {activeProjectDataTab === 'overlays' && !completeProjectCollectionsAvailable && (
        <LazyProjectDataState
          label="Overlays"
          error={completeProjectCollectionsError}
          onRetry={retryCompleteCollections}
        />
      )}

      {activeProjectDataTab === 'overlays' && completeProjectCollectionsAvailable && (
        <OverlaysTab
          projectId={projectId}
          parts={projectParts}
          images={projectImages}
          projectConfiguration={projectConfiguration}
          onAssignmentsChanged={handleProjectCollectionsChanged}
          setError={setActiveProjectError}
        />
      )}

      {activeProjectDataTab === 'metadata' && !projectPartsReady && (
        <LazyProjectDataState
          label="Metadata"
          error={projectPartsState.error}
          onRetry={loadProjectParts}
        />
      )}

      {activeProjectDataTab === 'metadata' && projectPartsReady && (
        <ProjectDataMetadataTab
          projectId={projectId}
          metadata={metadata}
          parts={projectParts}
          onAssociationsChanged={handleMetadataAssociationsChanged}
          setError={setActiveProjectError}
        />
      )}

      {activeProjectDataTab === 'unload_parts' && !projectPartsAvailable && (
        <LazyProjectDataState
          label="Unload Parts"
          error={projectPartsState.error}
          onRetry={loadProjectParts}
        />
      )}

      {activeProjectDataTab === 'unload_parts' && projectPartsAvailable && (
        <UnloadPartsTab
          projectId={projectId}
          parts={projectParts}
          onPartsUnloaded={handlePartsUnloaded}
          setError={setActiveProjectError}
        />
      )}

      {activeProjectDataTab === 'remove_images' && !completeProjectCollectionsReady && (
        <LazyProjectDataState
          label="Unload Images"
          error={completeProjectCollectionsError}
          onRetry={retryCompleteCollections}
        />
      )}

      {activeProjectDataTab === 'remove_images' && completeProjectCollectionsReady && (
        <RemoveImagesTab
          projectId={projectId}
          parts={projectParts}
          images={projectImages}
          onImagesRemoved={handleProjectCollectionsChanged}
          setError={setActiveProjectError}
        />
      )}

      {activeProjectDataTab === 'recently_deleted' && (
        <RecentlyDeletedOverlaysPanel
          onRefresh={refreshRecentlyDeletedOverlays}
          onRestore={restoreRecentlyDeletedOverlay}
          recentlyDeletedLoading={recentlyDeletedLoading}
          recentlyDeletedOverlays={recentlyDeletedOverlays}
        />
      )}
    </>
  );
}

export default memo(ProjectDataPanel);
