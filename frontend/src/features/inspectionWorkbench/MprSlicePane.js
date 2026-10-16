import { MprSliceCanvas } from './MprSliceCanvas';
import { MprSliceEditHandles } from './MprSliceEditHandles';
import { MprWindowedImage } from './MprWindowedImage';
import { renderAnnotationOverlay } from './annotationOverlayRendering';
import { MPR_AXIS_CONFIG, MPR_AXIS_LABELS } from './mprConstants';
import { getFallbackProjectionImage, getMprCrosshairStyle } from './mprGeometry';
import { buildMprSliceOverlays } from './mprSliceOverlays';
import { renderCompositedSegmentationSegment } from './segmentationGeometry';
import { getMprAxisImageDimensions } from './volumeDescriptors';

function MprSliceSurface({ axis, label, fallbackImage, navigation, volume, display }) {
  const {
    slicePosition,
    mprDimensions,
  } = navigation;
  const {
    volumeCacheState,
    hasVolumeImageSource,
    activeVolumeOverlayCaches,
    selectedExternalOverlayResourceId,
  } = volume;
  const {
    displayWindow,
    displayValueDomain,
  } = display;
  if (hasVolumeImageSource) {
    return (
      <MprSliceCanvas
        axis={axis}
        volumeCache={volumeCacheState.cache}
        overlayCaches={activeVolumeOverlayCaches}
        highlightedOverlayResourceId={selectedExternalOverlayResourceId}
        volumeCacheStatus={volumeCacheState.status}
        slicePosition={slicePosition}
        dimensions={mprDimensions}
        displayWindow={displayWindow}
        displayDomain={displayValueDomain}
        overlayOpacityMultiplier={1}
      />
    );
  }
  if (fallbackImage) {
    return (
      <MprWindowedImage
        className="mpr-fallback-projection"
        src={fallbackImage.url}
        alt={`${label} fallback projection from ${fallbackImage.viewName} view`}
        displayWindow={displayWindow}
        displayDomain={displayValueDomain}
      />
    );
  }
  return <span className="mpr-empty-volume">No volume stack images</span>;
}

export function MprSlicePane({ axis, readOnly, navigation, volume, display, annotations, drafts, fullscreen, handlers }) {
  const {
    activeMprPane,
    slicePosition,
    mprProjectionMirror,
    mprDimensions,
  } = navigation;
  const {
    volumeCacheState,
    shellImageLayers,
  } = volume;
  const {
    annotationLayerVisible,
    annotationOpacityMultiplier,
  } = display;
  const {
    selectedAnnotationId,
  } = annotations;
  const {
    annotationToolMode,
  } = drafts;
  const {
    applyMprNavigationSession,
    openMprAnnotationTool,
    setFullscreenMeasureActive,
    resetFullscreenImageZoom,
    handleMprPaneWheel,
    toggleMprProjectionMirror,
    handleMprAnnotationPointerDown,
    handleMprAnnotationPointerMove,
    handleMprAnnotationPointerUp,
    handleMprAnnotationPointerCancel,
    updateSlicePosition,
  } = handlers;
  const upper = Math.max(0, (mprDimensions[axis] || 1) - 1);
  const config = MPR_AXIS_CONFIG[axis];
  const label = config?.label || MPR_AXIS_LABELS[axis] || axis.toUpperCase();
  const isMirrored = mprProjectionMirror[axis] === true;
  const crosshairStyle = getMprCrosshairStyle(axis, slicePosition, mprDimensions, mprProjectionMirror);
  const fallbackImage = getFallbackProjectionImage(axis, shellImageLayers);
  const currentSliceIndex = Number(slicePosition[axis] || 0);
  const mprCanonicalSliceIndex = handlers.getSegmentationCanonicalSliceIndex(
    axis,
    currentSliceIndex,
  );
  const {
    mprPreviewLines,
    mprPreviewBoxes,
    pendingCubeBoxes,
    mprSliceLines,
    mprEditableSliceBoxes,
    mprSliceBoxes,
    mprSliceSegments,
  } = buildMprSliceOverlays({
    axis,
    sliceIndex: currentSliceIndex,
    canonicalSliceIndex: mprCanonicalSliceIndex,
    annotationLayerVisible,
    annotations,
    drafts,
  });
  const mprImageDimensions = getMprAxisImageDimensions(axis, mprDimensions, volumeCacheState.cache);
  const mprAnnotationUnit = handlers.getUnitForImage(handlers.getMprAnnotationImage(axis));
  return (
    <article
      className={`mpr-pane mpr-pane-${axis} ${activeMprPane === axis ? 'active-pane' : ''}`}
      style={{ '--mpr-axis-color': config?.color, ...crosshairStyle }}
      data-testid={`mpr-pane-${axis}`}
      onClick={() => {
        applyMprNavigationSession({
          activePane: axis,
          lastActiveAxis: axis,
        });
        openMprAnnotationTool(axis, '');
        setFullscreenMeasureActive(false);
        resetFullscreenImageZoom();
      }}
      onWheel={(event) => handleMprPaneWheel(axis, event)}
    >
      <header className="mpr-pane-header">
        <strong>{label}</strong>
        <div className="mpr-pane-header-controls">
          <span>{config?.sliceLabel || axis.toUpperCase()} {slicePosition[axis]} / {upper}</span>
          <label className="mpr-mirror-toggle" htmlFor={`mpr-mirror-${axis}`} onClick={(event) => event.stopPropagation()}>
            <input
              id={`mpr-mirror-${axis}`}
              type="checkbox"
              checked={isMirrored}
              onChange={() => toggleMprProjectionMirror(axis)}
            />
            Mirror
          </label>
        </div>
      </header>
      <div
        className="mpr-crosshair-preview"
        aria-label={`${label} slice preview`}
        data-testid={`mpr-preview-${axis}`}
        style={crosshairStyle}
        onMouseDown={(event) => handleMprAnnotationPointerDown(event, axis)}
        onMouseMove={(event) => handleMprAnnotationPointerMove(event, axis)}
        onMouseUp={(event) => handleMprAnnotationPointerUp(event, axis)}
        onMouseLeave={handleMprAnnotationPointerCancel}
        onClick={(event) => {
          if (annotationToolMode) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <MprSliceSurface
          axis={axis}
          label={label}
          fallbackImage={fallbackImage}
          navigation={navigation}
          volume={volume}
          display={display}
        />
        <span className="mpr-crosshair-h" />
        <span className="mpr-crosshair-v" />
        <span className="mpr-crosshair-center" />
        <svg
          className="inspection-fullscreen-measurement-overlay mpr-annotation-overlay mpr-projection-overlay"
          viewBox={`0 0 ${mprImageDimensions.width} ${mprImageDimensions.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label={`${label} annotation overlay`}
        >
          <g transform={`scale(${mprImageDimensions.width / 1000} ${mprImageDimensions.height / 1000})`}>
            {renderAnnotationOverlay({
              measurementLines: [...mprSliceLines, ...mprPreviewLines],
              boxes: [...mprSliceBoxes, ...pendingCubeBoxes, ...mprPreviewBoxes],
              fontSize: 26,
              selectedAnnotationId,
              opacityMultiplier: annotationOpacityMultiplier,
              unit: mprAnnotationUnit,
            })}
            <MprSliceEditHandles
              readOnly={readOnly}
              axis={axis}
              currentSliceIndex={currentSliceIndex}
              mprSliceLines={mprSliceLines}
              mprEditableSliceBoxes={mprEditableSliceBoxes}
              selectedAnnotationId={selectedAnnotationId}
              handlers={handlers}
            />
          </g>
          {mprSliceSegments.map((segment) => (
            <g
              key={`mpr-segment-${segment.id}`}
              opacity={annotationOpacityMultiplier}
            >
              {renderCompositedSegmentationSegment(segment, {
                color: segment.color,
                fillOpacity: segment.opacity,
                axis,
                sliceIndex: mprCanonicalSliceIndex,
                imageWidth: mprImageDimensions.width,
                imageHeight: mprImageDimensions.height,
                volumeDimensions: [
                  mprDimensions.sagittal,
                  mprDimensions.coronal,
                  mprDimensions.axial,
                ],
              })}
            </g>
          ))}
        </svg>
      </div>
      <label className="mpr-slice-control" htmlFor={`mpr-slice-${axis}`}>
        Slice
        <input
          id={`mpr-slice-${axis}`}
          type="range"
          min="0"
          max={upper}
          value={slicePosition[axis]}
          onChange={(event) => updateSlicePosition(axis, event.target.value, mprDimensions)}
        />
      </label>
    </article>
  );
}
