import React from 'react';

import CalibrationManager from '../../components/CalibrationManager';
import CompactImageClassifications from '../../components/CompactImageClassifications';
import ImageComments from '../../components/ImageComments';
import ImageGroupPanel from '../../components/ImageGroupPanel';
import ImageMetadata from '../../components/ImageMetadata';
import MLAnalysisPanel from '../../components/MLAnalysisPanel';
import MeasurementList from '../../components/MeasurementList';
import OverlayControls from '../../components/OverlayControls';
import ReviewPanel from '../../components/ReviewPanel';

export default function ImageViewSidebar({
  autoSelectLatest,
  calibration,
  classes,
  handleDeleteMeasurement,
  handleMLAnalysisSelect,
  handleRenameMeasurement,
  handleToggleVisibility,
  image,
  imageId,
  loading,
  measurements,
  overlayOptions,
  projectArchived,
  projectId,
  routeInstanceKey,
  selectedAnalysis,
  selectedMeasurementId,
  setAutoSelectLatest,
  setOverlayOptions,
  setRouteCalibration,
  setRouteLoading,
  setRouteError,
  setRouteSelectedMeasurementId,
  sidebarWidth,
  updateCurrentImage,
  visibleMeasurementIds,
}) {
  return (
    <div
      className="image-view-sidebar"
      style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}
    >
      {image && (
        <ReviewPanel
          key={`review:${routeInstanceKey}`}
          imageId={imageId}
          readOnly={projectArchived !== false}
        />
      )}

      {image && projectId && (
        <ImageGroupPanel
          key={`group:${routeInstanceKey}`}
          imageId={imageId}
          projectId={projectId}
          groupId={image.group_id || null}
          onGroupChanged={(newGroupId) => {
            updateCurrentImage((previous) => (
              previous ? { ...previous, group_id: newGroupId } : previous
            ));
          }}
          readOnly={projectArchived !== false}
        />
      )}

      <CompactImageClassifications
        key={`classifications:${routeInstanceKey}`}
        imageId={imageId}
        classes={classes}
        loading={loading}
        setLoading={setRouteLoading}
        setError={setRouteError}
        readOnly={projectArchived !== false}
      />

      <ImageComments
        key={`comments:${routeInstanceKey}`}
        imageId={imageId}
        loading={loading}
        setLoading={setRouteLoading}
        setError={setRouteError}
        readOnly={projectArchived !== false}
      />

      <ImageMetadata
        key={`metadata:${routeInstanceKey}`}
        imageId={imageId}
        image={image}
        setImage={updateCurrentImage}
        loading={loading}
        setLoading={setRouteLoading}
        setError={setRouteError}
        readOnly={projectArchived !== false}
      />

      {image && (
        <CalibrationManager
          key={`calibration:${routeInstanceKey}`}
          projectId={projectId}
          imageId={imageId}
          image={image}
          onCalibrationChange={setRouteCalibration}
          readOnly={projectArchived !== false}
        />
      )}

      {image && measurements.length > 0 && (
        <MeasurementList
          key={`measurements:${routeInstanceKey}`}
          measurements={measurements}
          calibration={calibration}
          onDeleteMeasurement={projectArchived === false ? handleDeleteMeasurement : undefined}
          onRenameMeasurement={projectArchived === false ? handleRenameMeasurement : undefined}
          onToggleVisibility={handleToggleVisibility}
          visibleMeasurementIds={visibleMeasurementIds}
          selectedMeasurementId={selectedMeasurementId}
          onSelectMeasurement={setRouteSelectedMeasurementId}
          readOnly={projectArchived !== false}
        />
      )}

      {image && (
        <MLAnalysisPanel
          key={`analysis:${routeInstanceKey}`}
          imageId={imageId}
          onSelect={handleMLAnalysisSelect}
          autoSelectLatest={autoSelectLatest}
          onAutoSelectChange={setAutoSelectLatest}
        />
      )}

      {selectedAnalysis && (
        <OverlayControls
          options={overlayOptions}
          onChange={setOverlayOptions}
        />
      )}
    </div>
  );
}
