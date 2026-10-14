import React, { useCallback, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import './App.css';

import ImageDisplay from './components/ImageDisplay';
import ImageDeletionControls from './components/ImageDeletionControls';
import { copyCurrentShareUrl } from './utils/shareLink';
import ImageNavigationSettings from './features/imageView/ImageNavigationSettings';
import ImageViewHeader from './features/imageView/ImageViewHeader';
import ImageViewSidebar from './features/imageView/ImageViewSidebar';
import useImageAnalysisSelection from './features/imageView/useImageAnalysisSelection';
import useImageMeasurements from './features/imageView/useImageMeasurements';
import useImageNavigation from './features/imageView/useImageNavigation';
import useImageProjectData from './features/imageView/useImageProjectData';
import useImageRecordLoader from './features/imageView/useImageRecordLoader';
import useImageViewPreferences from './features/imageView/useImageViewPreferences';
import useOptionalCurrentUser from './features/imageView/useOptionalCurrentUser';
import useResizableSidebar from './features/imageView/useResizableSidebar';

function ImageView() {
  const { imageId } = useParams();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project');
  const navigate = useNavigate();
  const routeKey = `${projectId || ''}:${imageId || ''}`;
  const routeInstanceIdentityRef = useRef({
    epoch: 0,
    instanceKey: '',
    routeKey: null,
  });
  if (routeInstanceIdentityRef.current.routeKey !== routeKey) {
    const epoch = routeInstanceIdentityRef.current.epoch + 1;
    routeInstanceIdentityRef.current = {
      epoch,
      instanceKey: `${routeKey}#${epoch}`,
      routeKey,
    };
  }
  const routeInstanceKey = routeInstanceIdentityRef.current.instanceKey;
  const activeRouteInstanceKeyRef = useRef(routeInstanceKey);
  activeRouteInstanceKeyRef.current = routeInstanceKey;

  // loaderActionsRef breaks the one remaining circular dependency:
  // useImageProjectData and useImageMeasurements need the loader's setError
  // and updateCurrentImage, but the loader is only callable after
  // useImageMeasurements has produced the measurement glue it depends on.
  // The stable callbacks below read the ref only inside callbacks that run
  // after mount, by which point the assignment near the bottom of this
  // component has already run, mirroring the existing
  // activeRouteInstanceKeyRef.current assignment pattern used elsewhere.
  const loaderActionsRef = useRef({
    setError: () => {},
    updateCurrentImage: () => {},
  });
  const reportError = useCallback((message) => {
    loaderActionsRef.current.setError(message);
  }, []);
  const applyImageUpdate = useCallback((nextImageOrUpdater) => {
    loaderActionsRef.current.updateCurrentImage(nextImageOrUpdater);
  }, []);

  const {
    classes,
    projectArchived,
  } = useImageProjectData({ projectId, setError: reportError });
  const currentUser = useOptionalCurrentUser();
  const {
    handleMouseDown,
    isResizing,
    sidebarWidth,
  } = useResizableSidebar();
  const [shareLinkMessage, setShareLinkMessage] = React.useState(null);

  const handleCopySessionLink = useCallback(async () => {
    try {
      await copyCurrentShareUrl();
      setShareLinkMessage({ type: 'success', text: 'Link copied to clipboard.' });
    } catch (err) {
      setShareLinkMessage({
        type: 'error',
        text: err?.message || 'Unable to copy link. Please copy the browser URL manually.',
      });
    }
  }, []);

  const {
    autoSelectLatest,
    overlayOptions,
    setAutoSelectLatest,
    setOverlayOptions,
    setSkipDeletedImages,
    skipDeletedImages,
  } = useImageViewPreferences();

  const {
    handleMLAnalysisSelect,
    selectedAnalysis,
    selectedAnnotations,
  } = useImageAnalysisSelection({
    routeInstanceKey,
    setOverlayOptions,
  });

  const {
    glue: measurementsGlue,
    handleDeleteMeasurement,
    handleRenameMeasurement,
    handleSaveMeasurement,
    handleToggleVisibility,
    measurementActive,
    measurements,
    selectedMeasurementId,
    setRouteMeasurementActive,
    setRouteSelectedMeasurementId,
    visibleMeasurementIds,
  } = useImageMeasurements({
    activeRouteInstanceKeyRef,
    imageId,
    projectArchived,
    projectId,
    routeInstanceKey,
    setError: reportError,
    updateCurrentImage: applyImageUpdate,
  });

  const {
    calibration,
    error,
    image,
    loading,
    setError,
    setRouteCalibration,
    setRouteError,
    setRouteLoading,
    updateCurrentImage,
  } = useImageRecordLoader({
    activeRouteInstanceKeyRef,
    imageId,
    measurementsGlue,
    projectId,
    routeInstanceKey,
  });
  loaderActionsRef.current = { setError, updateCurrentImage };

  const handleBack = useCallback(() => {
    if (image && image.group_id) {
      navigate(`/project/${projectId}/group/${image.group_id}`);
    } else {
      navigate(`/project/${projectId}`);
    }
  }, [image, navigate, projectId]);

  const {
    currentImageIndex,
    isTransitioning,
    loadProjectImages,
    navigateToNextImage,
    navigateToPreviousImage,
    projectImages,
  } = useImageNavigation({
    activeRouteInstanceKeyRef,
    image,
    imageId,
    navigate,
    projectId,
    routeInstanceKey,
    searchParams,
    setError,
    skipDeletedImages,
  });

  return (
    <div className="App" style={{ maxWidth: '100%', padding: '0' }}>
      <ImageViewHeader
        currentUser={currentUser}
        filename={image ? image.filename : 'Loading...'}
        onBack={handleBack}
        onCopySessionLink={handleCopySessionLink}
      />

      <div className="container" style={{ maxWidth: '100%', padding: 'var(--space-4)' }}>
        {shareLinkMessage && (
          <div className={`alert alert-${shareLinkMessage.type}`} role="status">
            {shareLinkMessage.text}
          </div>
        )}

        {projectArchived === true && (
          <div className="archived-project-notice">
            <strong>This project is archived.</strong> It is read-only. Classifications, comments, reviews, and other edits are disabled.
          </div>
        )}
        {error && (
          <div className="alert alert-error">
            {error}
            <button
              className="close-alert"
              onClick={() => setError(null)}
            >
              &times;
            </button>
          </div>
        )}

        <div className="image-view-container">
          <div className="image-view-main">
            <ImageViewSidebar
              autoSelectLatest={autoSelectLatest}
              calibration={calibration}
              classes={classes}
              handleDeleteMeasurement={handleDeleteMeasurement}
              handleMLAnalysisSelect={handleMLAnalysisSelect}
              handleRenameMeasurement={handleRenameMeasurement}
              handleToggleVisibility={handleToggleVisibility}
              image={image}
              imageId={imageId}
              loading={loading}
              measurements={measurements}
              overlayOptions={overlayOptions}
              projectArchived={projectArchived}
              projectId={projectId}
              routeInstanceKey={routeInstanceKey}
              selectedAnalysis={selectedAnalysis}
              selectedMeasurementId={selectedMeasurementId}
              setAutoSelectLatest={setAutoSelectLatest}
              setOverlayOptions={setOverlayOptions}
              setRouteCalibration={setRouteCalibration}
              setRouteError={setRouteError}
              setRouteLoading={setRouteLoading}
              setRouteSelectedMeasurementId={setRouteSelectedMeasurementId}
              sidebarWidth={sidebarWidth}
              updateCurrentImage={updateCurrentImage}
              visibleMeasurementIds={visibleMeasurementIds}
            />

            {/* Resizable divider */}
            <div
              className="resize-divider"
              onMouseDown={handleMouseDown}
              style={{ cursor: isResizing ? 'ew-resize' : 'ew-resize' }}
            >
              <div className="resize-handle"></div>
            </div>

            {/* Right side with image display */}
            <div className="image-view-content">
              <ImageDisplay
                key={`display:${routeInstanceKey}`}
                imageId={imageId}
                image={image}
                isTransitioning={isTransitioning}
                projectId={projectId}
                setImage={updateCurrentImage}
                refreshProjectImages={loadProjectImages}
                navigateToPreviousImage={navigateToPreviousImage}
                navigateToNextImage={navigateToNextImage}
                currentImageIndex={currentImageIndex}
                projectImages={projectImages}
                selectedAnalysis={selectedAnalysis}
                annotations={selectedAnnotations}
                overlayOptions={overlayOptions}
                calibration={calibration}
                measurements={measurements}
                measurementActive={measurementActive}
                setMeasurementActive={setRouteMeasurementActive}
                onSaveMeasurement={projectArchived === false ? handleSaveMeasurement : undefined}
                selectedMeasurementId={selectedMeasurementId}
                visibleMeasurementIds={visibleMeasurementIds}
              />
            </div>
          </div>

          {/* Keep deletion controls at the bottom for all to see (hidden for archived projects) */}
          {projectArchived === false && (
            <ImageDeletionControls
              key={`deletion:${routeInstanceKey}`}
              projectId={projectId}
              image={image}
              setImage={updateCurrentImage}
              refreshProjectImages={loadProjectImages}
            />
          )}

          <ImageNavigationSettings
            setSkipDeletedImages={setSkipDeletedImages}
            skipDeletedImages={skipDeletedImages}
          />
        </div>
      </div>
    </div>
  );
}

export default ImageView;
