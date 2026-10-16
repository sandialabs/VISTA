import { MprSlicePane } from './MprSlicePane';
import { MprViewportToolbar } from './MprViewportToolbar';
import { MprVolumePane } from './MprVolumePane';
import { MPR_AXES } from './mprConstants';
import { getMprSliceCachingMessage } from './mprSliceCache';

export function MprViewport({ selectedPart, projectType, filteredParts, readOnly, segmentationRun, measurementRun, pt3SplatViewerBaseProps, splatConfigurationModal, navigation, volume, display, annotations, drafts, fullscreen, handlers }) {
  const {
    activeMprPane,
    lastActiveMprAxis,
    viewportTransform,
    mprRotation,
  } = navigation;
  const {
    volumeCacheState,
    hasVolumeImageSource,
    volumeMetadataProbeState,
  } = volume;
  const groups = {
    navigation,
    volume,
    display,
    annotations,
    drafts,
    fullscreen,
    handlers,
  };
  return (
    <section
      className="mpr-shell"
      data-testid="mpr-panel"
      data-active-pane={activeMprPane}
      data-last-active-axis={lastActiveMprAxis}
      data-zoom={viewportTransform.zoom}
      data-pan-x={viewportTransform.panX}
      data-pan-y={viewportTransform.panY}
      data-rotation-x={mprRotation.x}
      data-rotation-y={mprRotation.y}
      aria-label="Multi-Planar Reconstruction"
    >
      {!selectedPart ? (
        <p className="muted">No part selected. Select a part to inspect the volume.</p>
      ) : (
        <>
          <MprViewportToolbar
            selectedPart={selectedPart}
            projectType={projectType}
            filteredParts={filteredParts}
            readOnly={readOnly}
            volume={volume}
            display={display}
            handlers={handlers}
          />
          {volumeMetadataProbeState.warning && (
            <div className="alert alert-warning" role="alert" data-testid="volume-metadata-probe-warning">
              {volumeMetadataProbeState.warning}
            </div>
          )}
          <div className="mpr-grid mpr-grid-four" data-testid="mpr-grid">
            {volumeMetadataProbeState.pending && (
              <div className="mpr-grid-loading" role="status" aria-live="polite" data-testid="volume-metadata-probe-loading">
                <strong>Inspecting volume metadata…</strong>
                <small>VISTA is confirming volume dimensions and color channels before rendering.</small>
              </div>
            )}
            {volumeCacheState.status === 'loading' && hasVolumeImageSource && (
              <div className="mpr-grid-loading" role="status" aria-live="polite">
                <strong>Preparing MPR slices…</strong>
                <span>{getMprSliceCachingMessage(volumeCacheState.progress)}</span>
                <small>VISTA is loading the volume stack. Slice views will appear when caching completes.</small>
              </div>
            )}
            {MPR_AXES.map((axis) => (
              <MprSlicePane key={axis} axis={axis} readOnly={readOnly} {...groups} />
            ))}
            <MprVolumePane pt3SplatViewerBaseProps={pt3SplatViewerBaseProps} {...groups} />
          </div>
          {(segmentationRun || measurementRun) && (
            <div className="workbench-notice">
              {segmentationRun && <p>Segmentation: {segmentationRun.status || 'complete'}</p>}
              {measurementRun && <p>Measurements: {measurementRun.status || 'complete'}</p>}
            </div>
          )}
          {splatConfigurationModal}
        </>
      )}
    </section>
  );
}
