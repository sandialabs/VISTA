import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './App.css';

import ImageUploader from './components/ImageUploader';
import MetadataManager from './components/MetadataManager';
import ClassManager from './components/ClassManager';
import InspectionWorkbenchPanel from './components/InspectionWorkbenchPanel';
import AnalyzeWorkbenchTab from './components/AnalyzeWorkbenchTab';
import ProjectConfigurationPanel from './components/ProjectConfigurationPanel';
import ProjectDataSummaryTab from './components/ProjectDataSummaryTab';
import ProjectDataExportPanel from './components/ProjectDataExportPanel';
import ProjectReportTab from './components/ProjectReportTab';
import ProjectPhaseFlow from './components/ProjectPhaseFlow';
import ImagesToPartsTab from './components/ImagesToPartsTab';
import BatchesTab from './components/BatchesTab';
import RemoveImagesTab from './components/RemoveImagesTab';
import { resolveCurrentProjectPhase } from './utils/projectPhases';
import { DEFAULT_INTERFACE_HIERARCHY, loadInterfaceHierarchy } from './utils/interfaceHierarchy';

const MAIN_TAB_DEFINITIONS = {
  project_configuration: { label: 'Project Configuration' },
  project_data: { label: 'Project Data' },
  analyze: { label: 'Analyze' },
  inspection: { label: 'Inspection' },
  report: { label: 'Report' },
};
const PROJECT_DATA_TABS = {
  load_images: { label: 'Load Images' },
  batches: { label: 'Batches' },
  images_to_parts: { label: 'Images to Parts' },
  remove_images: { label: 'Remove Images' },
  recently_deleted: { label: 'Recently Deleted' },
};

async function buildHttpErrorMessage(response, fallbackLabel) {
  const requestId = response.headers.get('x-request-id') || response.headers.get('x-correlation-id');
  let details = '';
  try {
    const payload = await response.clone().json();
    if (payload?.detail) details = typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail);
    else if (payload?.message) details = String(payload.message);
  } catch (_) {
    try {
      const text = (await response.clone().text()).trim();
      if (text) details = text;
    } catch (_) {
      // Ignore response parse failures.
    }
  }

  return [
    `${fallbackLabel} (${response.status}${response.statusText ? ` ${response.statusText}` : ''})`,
    `endpoint=${response.url || 'unknown'}`,
    requestId ? `request_id=${requestId}` : null,
    details ? `details=${details.slice(0, 280)}` : null,
  ].filter(Boolean).join(' | ');
}

function Project({ currentUserGroups = [] }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [metadata, setMetadata] = useState({});
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [projectConfiguration, setProjectConfiguration] = useState(null);
  const [interfaceHierarchy, setInterfaceHierarchy] = useState(DEFAULT_INTERFACE_HIERARCHY);
  const [activeMainTab, setActiveMainTab] = useState(DEFAULT_INTERFACE_HIERARCHY.mainTabs[0]);
  const [activeProjectDataTab, setActiveProjectDataTab] = useState('load_images');
  const [dataCounts, setDataCounts] = useState({
    partsLoaded: 0,
    rawImages: 0,
    imageMetadata: 0,
    overlayImages: 0,
    annotations: 0,
  });
  const [projectParts, setProjectParts] = useState([]);
  const [projectImages, setProjectImages] = useState([]);
  const [recentlyDeletedOverlays, setRecentlyDeletedOverlays] = useState([]);
  const [recentlyDeletedLoading, setRecentlyDeletedLoading] = useState(false);
  const [countsLoading, setCountsLoading] = useState(true);
  const [ingestResult, setIngestResult] = useState({
    loading: false,
    error: null,
    payload: null,
  });
  const [inspectionLaunchFilters, setInspectionLaunchFilters] = useState(null);

  const fetchImages = useCallback(async (projId) => {
    const PAGE_SIZE = 200;
    let skip = 0;
    let allImages = [];
    let hasMore = true;
    while (hasMore) {
      const params = new URLSearchParams();
      params.set('skip', String(skip));
      params.set('limit', String(PAGE_SIZE));
      const resp = await fetch(`/api/projects/${projId}/images?${params}`);
      if (!resp.ok) break;
      const batch = await resp.json();
      allImages = allImages.concat(batch);
      hasMore = batch.length === PAGE_SIZE;
      skip += PAGE_SIZE;
    }
    return allImages;
  }, []);

  const refreshProjectCounts = useCallback(async () => {
    setCountsLoading(true);
    try {
      const [partsResp, bundleResp, imageResp, configResp] = await Promise.all([
        fetch(`/api/projects/${id}/parts`),
        fetch(`/api/projects/${id}/export-bundle-json`),
        fetch(`/api/projects/${id}/images?include_deleted=true&limit=2000`),
        fetch(`/api/projects/${id}/configuration`),
      ]);

      const partsPayload = partsResp.ok ? await partsResp.json() : [];
      const bundlePayload = bundleResp.ok ? await bundleResp.json() : {};
      const imagePayload = imageResp.ok ? await imageResp.json() : [];
      const configPayload = configResp.ok ? await configResp.json() : {};

      const allImages = Array.isArray(imagePayload) ? imagePayload : [];
      setProjectImages(allImages);
      setProjectParts(Array.isArray(partsPayload) ? partsPayload : []);
      const activeImageCount = allImages.filter((image) => !image?.deleted_at).length;
      const imageMetadata = allImages.reduce((count, image) => {
        const metadataObj = image?.metadata;
        return count + (metadataObj && typeof metadataObj === 'object' ? Object.keys(metadataObj).length : 0);
      }, 0);
      const bundleRawImageCount = Number(bundlePayload?.bundle_summary?.images?.total) || 0;

      setProjectConfiguration(configPayload?.config || null);
      setDataCounts({
        partsLoaded: Array.isArray(partsPayload) ? partsPayload.length : 0,
        rawImages: Math.max(bundleRawImageCount, activeImageCount),
        imageMetadata,
        overlayImages: bundlePayload?.bundle_summary?.overlays?.configured_layers || 0,
        annotations: bundlePayload?.bundle_summary?.annotations?.total || 0,
      });
    } catch (err) {
      setError(err.message || 'Failed to load project summary counts');
    } finally {
      setCountsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const fetchProjectData = async () => {
      try {
        setLoading(true);
        const projectResponse = await fetch(`/api/projects/${id}`);
        if (!projectResponse.ok) {
          throw new Error(`HTTP error! status: ${projectResponse.status}`);
        }
        const projectData = await projectResponse.json();
        setProject(projectData);

        const metadataResponse = await fetch(`/api/projects/${id}/metadata-dict`);
        if (metadataResponse.ok) {
          const metadataData = await metadataResponse.json();
          setMetadata(metadataData);
        }

        const classesResponse = await fetch(`/api/projects/${id}/classes`);
        if (classesResponse.ok) {
          const classesData = await classesResponse.json();
          setClasses(classesData);
        }

        await fetchImages(id);
        await refreshProjectCounts();
        setLoading(false);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    fetchProjectData();
  }, [id, fetchImages, refreshProjectCounts]);

  useEffect(() => {
    let cancelled = false;
    let lastSerializedHierarchy = '';

    const loadHierarchy = async ({ cacheBust = false } = {}) => {
      const hierarchy = await loadInterfaceHierarchy({ cacheBust });
      if (cancelled) return;
      const validTabs = hierarchy.mainTabs.filter((tabKey) => MAIN_TAB_DEFINITIONS[tabKey]);
      const nextHierarchy = validTabs.length === 0
        ? DEFAULT_INTERFACE_HIERARCHY
        : { ...hierarchy, mainTabs: validTabs };
      const serializedHierarchy = JSON.stringify(nextHierarchy);
      if (serializedHierarchy === lastSerializedHierarchy) return;
      lastSerializedHierarchy = serializedHierarchy;

      if (validTabs.length === 0) {
        setInterfaceHierarchy(DEFAULT_INTERFACE_HIERARCHY);
        setActiveMainTab(DEFAULT_INTERFACE_HIERARCHY.mainTabs[0]);
        return;
      }
      setInterfaceHierarchy(nextHierarchy);
      setActiveMainTab((prev) => (validTabs.includes(prev) ? prev : validTabs[0]));
    };
    loadHierarchy();

    const pollMs = Number(window.__VISTA_INTERFACE_HIERARCHY_POLL_MS || 1500);
    const shouldPollHierarchy = process.env.NODE_ENV === 'development' && Number.isFinite(pollMs) && pollMs > 0;
    const intervalId = shouldPollHierarchy
      ? window.setInterval(() => loadHierarchy({ cacheBust: true }), pollMs)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);

  const handleUploadComplete = useCallback(async () => {
    await refreshProjectCounts();
  }, [refreshProjectCounts]);

  const refreshRecentlyDeletedOverlays = useCallback(async () => {
    setRecentlyDeletedLoading(true);
    try {
      const resp = await fetch(`/api/projects/${id}/analyze/overlays/recently-deleted`);
      if (!resp.ok) throw new Error(`Failed to load recently deleted overlays (${resp.status})`);
      const payload = await resp.json();
      setRecentlyDeletedOverlays(Array.isArray(payload) ? payload : []);
    } catch (err) {
      setError(err.message || 'Failed to load recently deleted overlays');
    } finally {
      setRecentlyDeletedLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (activeMainTab === 'project_data' && activeProjectDataTab === 'recently_deleted') {
      refreshRecentlyDeletedOverlays();
    }
  }, [activeMainTab, activeProjectDataTab, refreshRecentlyDeletedOverlays]);

  const restoreRecentlyDeletedOverlay = useCallback(async (overlay) => {
    const overlayId = overlay?.image_id;
    if (!overlayId) return;
    try {
      const resp = await fetch(`/api/projects/${id}/analyze/overlays/${encodeURIComponent(String(overlayId))}/restore`, {
        method: 'POST',
      });
      if (!resp.ok) throw new Error(`Failed to restore overlay (${resp.status})`);
      await refreshRecentlyDeletedOverlays();
      await refreshProjectCounts();
    } catch (err) {
      setError(err.message || 'Failed to restore overlay');
    }
  }, [id, refreshProjectCounts, refreshRecentlyDeletedOverlays]);

  const requestIngestValidation = useCallback(async () => {
    try {
      setIngestResult({ loading: true, error: null, payload: null });
      const [batchResp, partResp] = await Promise.all([
        fetch(`/api/projects/${id}/batches`),
        fetch(`/api/projects/${id}/parts`),
      ]);
      if (!batchResp.ok) throw new Error(await buildHttpErrorMessage(batchResp, 'Failed to load batches'));
      if (!partResp.ok) throw new Error(await buildHttpErrorMessage(partResp, 'Failed to load parts'));

      const [batchData, partData] = await Promise.all([batchResp.json(), partResp.json()]);
      const batches = Array.isArray(batchData) ? batchData : [];
      const parts = Array.isArray(partData) ? partData : [];
      const syntheticPayload = {
        batches: batches.slice(0, 1).map((batch) => ({
          name: batch.name,
          description: `Validation run for ${batch.name}`,
          parts: parts
            .filter((part) => part.batch_id === batch.id)
            .slice(0, 3)
            .map((part) => ({
              serial_number: part.serial_number,
              display_name: part.display_name,
              review_state: part.review_state || 'unreviewed',
              metadata: {
                source: 'project-data-ingest-validation',
                existing_part_id: part.id,
              },
            })),
        })),
      };

      const resp = await fetch(`/api/projects/${id}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(syntheticPayload),
      });
      if (!resp.ok) throw new Error(await buildHttpErrorMessage(resp, 'Failed to run ingest validation'));
      const payload = await resp.json();
      setIngestResult({ loading: false, error: null, payload });
      await refreshProjectCounts();
    } catch (err) {
      setIngestResult({ loading: false, error: err.message || 'Failed to run ingest validation', payload: null });
    }
  }, [id, refreshProjectCounts]);

  const currentPhase = resolveCurrentProjectPhase({
    phaseSettings: projectConfiguration?.phase_settings,
    partsLoaded: dataCounts.partsLoaded,
    annotations: dataCounts.annotations,
  });

  const projectDataContent = useMemo(() => (
    <>
      <ProjectDataSummaryTab counts={dataCounts} loading={countsLoading} />

      <div className="project-data-subtabs project-tabs" role="tablist" aria-label="Project data sections">
        {Object.entries(PROJECT_DATA_TABS).map(([tabKey, definition]) => (
          <button
            key={tabKey}
            type="button"
            className={`project-tab ${activeProjectDataTab === tabKey ? 'active' : ''}`}
            role="tab"
            aria-selected={activeProjectDataTab === tabKey}
            onClick={() => setActiveProjectDataTab(tabKey)}
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
                  projectId={id}
                  projectType={project?.project_type}
                  onUploadComplete={handleUploadComplete}
                  setError={setError}
                />
              </div>
              <div className="export-section">
                <ProjectDataExportPanel
                  projectId={id}
                  projectName={project?.name}
                  counts={dataCounts}
                  setError={setError}
                />
              </div>
            </div>
          )}
          <section className="workbench-panel project-data-action-panel" aria-label="Project data validation">
            <header className="workbench-header">
              <div>
                <h2>Data Validation</h2>
                <p>Run a synthetic ingest pass against the current batch and part structure.</p>
              </div>
              <div className="workbench-detail-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="request-ingest-validation"
                  disabled={ingestResult.loading}
                  onClick={requestIngestValidation}
                >
                  {ingestResult.loading ? 'Running Ingest Validation...' : 'Run Ingest Validation'}
                </button>
              </div>
            </header>
            {ingestResult.error && <div className="alert alert-error">{ingestResult.error}</div>}
            {ingestResult.payload && (
              <div className="alert alert-success" data-testid="ingest-validation-result">
                Ingest validation complete: created {ingestResult.payload?.counters?.parts_created || 0} parts, skipped{' '}
                {ingestResult.payload?.counters?.parts_skipped_existing || 0} existing, discrepancies{' '}
                {(ingestResult.payload?.discrepancies || []).length}.
              </div>
            )}
          </section>
        </div>
      )}

      {activeProjectDataTab === 'batches' && (
        <BatchesTab
          projectId={id}
          parts={projectParts}
          onAssignmentsChanged={refreshProjectCounts}
          setError={setError}
          onInspectBatch={(batch) => {
            setInspectionLaunchFilters({
              selected_batch_id: batch.id,
              review_filter: 'manual',
              source: 'batches_tab_inspect',
              source_batch_name: batch.name,
              at: Date.now(),
            });
            setActiveMainTab('inspection');
          }}
        />
      )}

      {activeProjectDataTab === 'images_to_parts' && (
        <ImagesToPartsTab
          projectId={id}
          parts={projectParts}
          images={projectImages}
          onAssignmentsChanged={refreshProjectCounts}
          setError={setError}
        />
      )}


      {activeProjectDataTab === 'remove_images' && (
        <RemoveImagesTab
          projectId={id}
          parts={projectParts}
          images={projectImages}
          onImagesRemoved={refreshProjectCounts}
          setError={setError}
        />
      )}

            {activeProjectDataTab === 'recently_deleted' && (
        <section className="workbench-panel recently-deleted-overlays-panel" role="tabpanel" aria-label="Recently Deleted">
          <header className="workbench-header">
            <div>
              <h2>Recently Deleted Overlays</h2>
              <p>Analyze overlays remain recoverable for 48 hours before their part metadata is purged.</p>
            </div>
            <div className="workbench-detail-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={recentlyDeletedLoading}
                onClick={refreshRecentlyDeletedOverlays}
              >
                {recentlyDeletedLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </header>
          {recentlyDeletedLoading ? (
            <div className="loading-text">Loading recently deleted overlays...</div>
          ) : recentlyDeletedOverlays.length === 0 ? (
            <p className="muted">No Analyze overlays are waiting for deletion.</p>
          ) : (
            <div className="recently-deleted-overlay-list">
              {recentlyDeletedOverlays.map((overlay) => (
                <article key={`${overlay.part_id}-${overlay.image_id}`} className="recently-deleted-overlay-row">
                  <div>
                    <h3>{overlay.label || 'Analyze Overlay'}</h3>
                    <p>
                      {overlay.part_display_name || overlay.part_serial_number}
                      {' '}
                      -
                      {' '}
                      {overlay.filename}
                    </p>
                    <span>
                      Deleted {overlay.deleted_at ? new Date(overlay.deleted_at).toLocaleString() : 'recently'}
                      {' '}
                      -
                      {' '}
                      purges {overlay.pending_hard_delete_at ? new Date(overlay.pending_hard_delete_at).toLocaleString() : 'after retention'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => restoreRecentlyDeletedOverlay(overlay)}
                  >
                    Restore
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  ), [
    activeProjectDataTab,
    countsLoading,
    dataCounts,
    id,
    projectImages,
    projectParts,
    recentlyDeletedLoading,
    recentlyDeletedOverlays,
    handleUploadComplete,
    ingestResult,
    project?.is_archived,
    project?.name,
    project?.project_type,
    refreshProjectCounts,
    refreshRecentlyDeletedOverlays,
    requestIngestValidation,
    restoreRecentlyDeletedOverlay,
  ]);

  const renderMainPanel = () => {
    if (activeMainTab === 'inspection') {
      return (
        <InspectionWorkbenchPanel
          projectId={id}
          projectType={project?.project_type}
          hierarchy={interfaceHierarchy.inspection}
          launchFilters={inspectionLaunchFilters}
        />
      );
    }
    if (activeMainTab === 'project_data') {
      return projectDataContent;
    }
    if (activeMainTab === 'analyze') {
      return (
        <AnalyzeWorkbenchTab
          projectId={id}
          projectType={project?.project_type}
          setError={setError}
        />
      );
    }
    if (activeMainTab === 'project_configuration') {
      return (
        <>
          <ProjectConfigurationPanel
            projectId={id}
            projectType={project?.project_type}
            currentInterfaceLayout={interfaceHierarchy}
            isAdminUser={currentUserGroups.includes('admin') || currentUserGroups.includes('admins')}
            onConfigurationSaved={(nextConfig) => setProjectConfiguration(nextConfig)}
          />
          {!project?.is_archived && (
            <div className="management-sections project-configuration-management">
              <div className="classes-section">
                <ClassManager
                  projectId={id}
                  classes={classes}
                  setClasses={setClasses}
                  loading={loading}
                  setLoading={setLoading}
                  setError={setError}
                />
              </div>
              <div className="metadata-section">
                <MetadataManager
                  projectId={id}
                  metadata={metadata}
                  setMetadata={setMetadata}
                  loading={loading}
                  setLoading={setLoading}
                  setError={setError}
                />
              </div>
            </div>
          )}
        </>
      );
    }
    if (activeMainTab === 'report') {
      return <ProjectReportTab projectId={id} projectName={project?.name} setError={setError} />;
    }
    return null;
  };

  const renderMainTabs = (className = '') => (
    <div className={`project-tabs project-main-tabs ${className}`.trim()} role="tablist" aria-label="Project sections">
      {interfaceHierarchy.mainTabs.map((tabKey) => (
        <button
          key={tabKey}
          type="button"
          className={`project-tab ${activeMainTab === tabKey ? 'active' : ''}`}
          role="tab"
          aria-selected={activeMainTab === tabKey}
          onClick={() => setActiveMainTab(tabKey)}
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
            </div>
            <div className="project-info">
              <div className="project-title-row">
                <h1 className="project-title">{project ? project.name : 'Loading project...'}</h1>
                <span className="project-group">Type: {project?.project_type || 'PT1'}</span>
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
          <div className="alert alert-error">
            <strong>Error:</strong> {error}
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
