import Pt3GaussianSplatViewer from '../../components/Pt3GaussianSplatViewer';
import { MprVolumeFallbackModel } from './MprVolumeFallbackModel';
import { getAnnotationListType, getAnnotationListValue } from './annotationListHelpers';
import {
  MPR_AXES,
  MPR_AXIS_CONFIG,
  MPR_RECONSTRUCTION_MODES,
  PT3_RENDERER_RECONSTRUCTION_MODES,
} from './mprConstants';
import { handleMprOrbitKeyDown } from './mprOrbitKeys';

function MprVolumeHeader({ navigation, volume, display, fullscreen, handlers }) {
  const {
    viewportTransform,
  } = navigation;
  const {
    effectiveMprReconstructionLabel,
  } = volume;
  const {
    annotationsVisible,
  } = display;
  const {
    mprFullscreenOpen,
    mprFullscreenAnnotationListVisible,
    mprFullscreenReconstructionSettingsVisible,
    mprFullscreenCloseRef,
  } = fullscreen;
  const {
    closeMprFullscreen,
    setAnnotationsVisible,
    setMprFullscreenAnnotationListVisible,
    setMprFullscreenReconstructionSettingsVisible,
  } = handlers;
  return (
    <header className="mpr-pane-header">
      <strong id={mprFullscreenOpen ? 'mpr-3d-fullscreen-title' : undefined}>{mprFullscreenOpen ? '3D reconstruction' : '3D'}</strong>
      <span id={mprFullscreenOpen ? 'mpr-3d-fullscreen-mode' : undefined}>
        {mprFullscreenOpen ? `${effectiveMprReconstructionLabel} • ` : ''}Zoom {viewportTransform.zoom.toFixed(2)}x
      </span>
      {mprFullscreenOpen && (
        <button
          type="button"
          className="modal-close-btn mpr-3d-fullscreen-close"
          aria-label="Close fullscreen 3D view"
          ref={mprFullscreenCloseRef}
          onClick={(event) => {
            event.stopPropagation();
            closeMprFullscreen();
          }}
        >
          &times;
        </button>
      )}
      {mprFullscreenOpen && (
        <div
          className="mpr-3d-display-controls"
          role="group"
          aria-label="Fullscreen 3D display options"
          onClick={(event) => event.stopPropagation()}
        >
          <label className="mpr-3d-display-toggle">
            <input
              type="checkbox"
              checked={annotationsVisible}
              onChange={(event) => setAnnotationsVisible(event.target.checked)}
            />
            Render annotations
          </label>
          <label className="mpr-3d-display-toggle">
            <input
              type="checkbox"
              checked={mprFullscreenAnnotationListVisible}
              onChange={(event) => setMprFullscreenAnnotationListVisible(event.target.checked)}
            />
            Show annotations list
          </label>
          <label className="mpr-3d-display-toggle">
            <input
              type="checkbox"
              checked={mprFullscreenReconstructionSettingsVisible}
              onChange={(event) => setMprFullscreenReconstructionSettingsVisible(event.target.checked)}
            />
            Show reconstruction settings
          </label>
        </div>
      )}
    </header>
  );
}

function MprVolumeAnnotationList({ annotations, handlers }) {
  const {
    inspectionAnnotationItems,
  } = annotations;
  const {
    setInspectionItemVisibility,
  } = handlers;
  return (
    <aside
      className="mpr-3d-annotation-list"
      aria-label="3D annotations"
      onClick={(event) => event.stopPropagation()}
    >
      <h4>Annotations</h4>
      {inspectionAnnotationItems.length === 0 ? (
        <p className="muted">No annotations.</p>
      ) : (
        <ul>
          {inspectionAnnotationItems.map((item) => {
            const typeLabel = item.typeLabel || (item.annotation
              ? getAnnotationListType(item.annotation)
              : 'External overlay');
            const displayName = item.displayName || (item.annotation
              ? getAnnotationListValue(item.annotation)
              : `External: ${item.label}`);
            return (
              <li key={`mpr-3d-${item.key}`} className={item.visible ? '' : 'annotation-entry-hidden'}>
                <span className="overlay-swatch" style={{ backgroundColor: item.color }} />
                <span title={`${typeLabel}: ${displayName}`}>
                  <span>{typeLabel}</span>
                  {' — '}
                  <span>{displayName}</span>
                </span>
                <button
                  type="button"
                  aria-label={`${item.visible ? 'Hide' : 'Show'} 3D annotation ${displayName}`}
                  aria-pressed={item.visible}
                  onClick={() => setInspectionItemVisibility(item, !item.visible)}
                >
                  {item.visible ? 'Hide' : 'Show'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

function MprVolumeLegend() {
  return (
    <div className="mpr-volume-legend" aria-label="MPR axis legend">
      {MPR_AXES.map((axis) => (
        <span key={axis} className={`chip chip-${axis}`}>
          <span className="overlay-swatch" style={{ backgroundColor: MPR_AXIS_CONFIG[axis].color }} />
          {MPR_AXIS_CONFIG[axis].label}
        </span>
      ))}
    </div>
  );
}

export function MprVolumePane({ pt3SplatViewerBaseProps, navigation, volume, display, annotations, drafts, fullscreen, handlers }) {
  const {
    activeMprPane,
    slicePosition,
    mprAxisMirrorScale,
  } = navigation;
  const {
    effectiveMprReconstructionMode,
  } = volume;
  const {
    annotationLayerVisible,
  } = display;
  const {
    pt3RenderableAnnotations,
  } = annotations;
  const {
    mprFullscreenOpen,
    mprFullscreenAnnotationListVisible,
    mprFullscreenReconstructionSettingsVisible,
    mprFullscreenSceneRef,
    mprOverlayCanvasRef,
    segmentationHelperOpen,
    segmentationHelperView,
  } = fullscreen;
  const {
    applyMprNavigationSession,
    closeMprFullscreen,
    openMprFullscreen,
    handleMprVolumeWheel,
    handleMprVolumePointerDown,
    handleMprVolumePointerMove,
    handleMprVolumePointerUp,
    handleMprVolumePointerCancel,
    preventMprNativeDrag,
    adjustZoom,
    resetViewport,
  } = handlers;
  const handleSceneKeyDown = (event) => handleMprOrbitKeyDown(event, {
    fullscreenOpen: mprFullscreenOpen,
    openFullscreen: openMprFullscreen,
    applyNavigationSession: applyMprNavigationSession,
    adjustZoom,
    resetViewport,
  });
  return (
    <>
      {mprFullscreenOpen && <div className="mpr-3d-fullscreen-backdrop" aria-hidden="true" onClick={closeMprFullscreen} />}
      <article
        className={`mpr-pane mpr-pane-volume ${activeMprPane === 'volume' ? 'active-pane' : ''} ${mprFullscreenOpen ? 'mpr-pane-volume-fullscreen' : ''}`}
        data-testid="mpr-pane-3d"
        role={mprFullscreenOpen ? 'dialog' : undefined}
        aria-modal={mprFullscreenOpen ? 'true' : undefined}
        aria-labelledby={mprFullscreenOpen ? 'mpr-3d-fullscreen-title' : undefined}
        aria-describedby={mprFullscreenOpen ? 'mpr-3d-fullscreen-mode' : undefined}
        onClick={() => {
          applyMprNavigationSession({ activePane: 'volume' });
        }}
        onWheel={handleMprVolumeWheel}
      >
        <MprVolumeHeader
          navigation={navigation}
          volume={volume}
          display={display}
          fullscreen={fullscreen}
          handlers={handlers}
        />
        <div
          className="mpr-volume-scene"
          data-mirror-x={mprAxisMirrorScale.x}
          data-mirror-y={mprAxisMirrorScale.y}
          data-mirror-z={mprAxisMirrorScale.z}
          role={mprFullscreenOpen ? 'application' : 'button'}
          tabIndex={0}
          ref={mprFullscreenSceneRef}
          aria-label={mprFullscreenOpen ? 'Fullscreen 3D part view. Use arrow keys to orbit, plus and minus to zoom, and zero to reset.' : 'Open 3D part view fullscreen'}
          onClick={(event) => {
            if (!mprFullscreenOpen && !event.target.closest('button, input, select, label, fieldset')) {
              openMprFullscreen(event);
            }
          }}
          onPointerDown={handleMprVolumePointerDown}
          onPointerMove={handleMprVolumePointerMove}
          onPointerUp={handleMprVolumePointerUp}
          onPointerCancel={handleMprVolumePointerCancel}
          onDragStart={preventMprNativeDrag}
          onKeyDown={handleSceneKeyDown}
        >
          {!PT3_RENDERER_RECONSTRUCTION_MODES.includes(effectiveMprReconstructionMode) && (
            <canvas className="mpr-volume-overlay" ref={mprOverlayCanvasRef} aria-hidden="true" />
          )}
          {PT3_RENDERER_RECONSTRUCTION_MODES.includes(effectiveMprReconstructionMode)
            && !(segmentationHelperOpen && segmentationHelperView === '3d') && (
            <Pt3GaussianSplatViewer
              {...pt3SplatViewerBaseProps}
              mode={effectiveMprReconstructionMode === MPR_RECONSTRUCTION_MODES.volume3d
                ? 'volume'
                : effectiveMprReconstructionMode === MPR_RECONSTRUCTION_MODES.splat
                  ? 'splat'
                  : 'real-splat'}
              slicePosition={slicePosition}
              showRayMarchControls={mprFullscreenOpen && mprFullscreenReconstructionSettingsVisible}
              showSplatControls={mprFullscreenOpen && mprFullscreenReconstructionSettingsVisible}
              showRealOptimizationControls={!mprFullscreenOpen || mprFullscreenReconstructionSettingsVisible}
              vectorAnnotations={pt3RenderableAnnotations}
              showAnnotations={annotationLayerVisible}
            />
            )}
          {!PT3_RENDERER_RECONSTRUCTION_MODES.includes(effectiveMprReconstructionMode) && (
            <MprVolumeFallbackModel
              navigation={navigation}
              volume={volume}
              display={display}
              handlers={handlers}
            />
          )}
        </div>
        {mprFullscreenOpen && mprFullscreenAnnotationListVisible && (
          <MprVolumeAnnotationList annotations={annotations} handlers={handlers} />
        )}
        <MprVolumeLegend />
      </article>
    </>
  );
}
