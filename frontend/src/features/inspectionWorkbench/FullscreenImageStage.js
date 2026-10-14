import { stopMiddleMouseDefault } from './inspectionUtils';
import { MprSliceCanvas } from './MprSliceCanvas';
import { FullscreenAnnotationOverlay } from './FullscreenAnnotationOverlay';

// Class name and pointer handlers shared by the fullscreen image and MPR slice canvas.
function buildFullscreenSurface({ model, modal, tools, display, fullscreenHandlers }) {
  const {
    isMprFullscreen,
    fullscreenShowsExternalOverlay,
  } = model;
  const {
    fullscreenImageModal,
    fullscreenImageRef,
    fullscreenPanDragRef,
  } = modal;
  const {
    fullscreenMeasureActive,
    fullscreenBoxActive,
    fullscreenCropActive,
    fullscreenEditingEndpoint,
    fullscreenEditingBoxCorner,
    annotationDraftsRef,
  } = tools;
  const {
    annotationOpacityMultiplier,
  } = display;
  const {
    handleFullscreenMeasurePointerDown,
    handleFullscreenBoxPointerDown,
    handleFullscreenMeasurePointerUp,
    handleFullscreenBoxPointerUp,
    handleFullscreenBoxPointerCancel,
    cancelAnnotationDraft,
  } = fullscreenHandlers;
	    const fullscreenSurfaceClassName = `inspection-fullscreen-image ${fullscreenShowsExternalOverlay ? 'analysis-overlay-image' : ''} ${fullscreenMeasureActive || fullscreenBoxActive || fullscreenCropActive || fullscreenEditingEndpoint || fullscreenEditingBoxCorner ? 'measurement-active' : ''}`;
	    const fullscreenSurfaceProps = {
	      ref: fullscreenImageRef,
	      className: fullscreenSurfaceClassName,
	      style: !isMprFullscreen && fullscreenShowsExternalOverlay
	        ? { opacity: annotationOpacityMultiplier }
	        : undefined,
	      'aria-label': `${fullscreenImageModal.label} fullscreen`,
	      onMouseDown: (event) => {
	        handleFullscreenMeasurePointerDown(event);
	        handleFullscreenBoxPointerDown(event);
	      },
	      onMouseUp: (event) => {
	        handleFullscreenMeasurePointerUp(event);
	        handleFullscreenBoxPointerUp(event);
	      },
	      onMouseLeave: (event) => {
	        handleFullscreenBoxPointerCancel(event);
	        if (!fullscreenPanDragRef.current && fullscreenMeasureActive && annotationDraftsRef.current.fullscreen.measure) {
	          cancelAnnotationDraft('fullscreen', ['measure', 'preview']);
	        }
	      },
	      onClick: (event) => {
	        if (fullscreenEditingEndpoint?.lineId || fullscreenEditingBoxCorner?.boxId) {
	          handleFullscreenMeasurePointerDown(event);
	        } else if (fullscreenMeasureActive) {
	          if (annotationDraftsRef.current.fullscreen.measure) {
	            handleFullscreenMeasurePointerUp(event);
	          } else {
	            handleFullscreenMeasurePointerDown(event);
	          }
	        }
	      },
	    };
  return { fullscreenSurfaceClassName, fullscreenSurfaceProps };
}

export function FullscreenImageStage({ readOnly, model, modal, tools, display, annotations, navigation, volume, fullscreenHandlers }) {
  const {
    isMprFullscreen,
    fullscreenImageId,
    fullscreenBaseImageId,
    renderedFullscreenMeasurementLines,
    renderedFullscreenBoxAnnotations,
    fullscreenShowsExternalOverlay,
    fullscreenMprSlicePosition,
    fullscreenMprProjectionStyle,
  } = model;
  const {
    fullscreenImageModal,
    fullscreenMprSliceKey,
    fullscreenImageZoom,
    fullscreenImagePanning,
  } = modal;
  const {
    displayWindow,
    displayValueDomain,
  } = display;
  const {
    mprDimensions,
  } = navigation;
  const {
    volumeCacheState,
    activeVolumeOverlayCaches,
  } = volume;
  const {
    handleFullscreenImageWheel,
    handleFullscreenPanMouseDown,
    handleFullscreenImagePointerMove,
    handleFullscreenPanMouseUp,
  } = fullscreenHandlers;
  const { fullscreenSurfaceClassName, fullscreenSurfaceProps } = buildFullscreenSurface({ model, modal, tools, display, fullscreenHandlers });
  return (
              <div
	                className={`inspection-fullscreen-image-frame ${fullscreenImageZoom.scale > 1 ? 'zoomed' : ''} ${fullscreenImagePanning ? 'panning' : ''}`}
	                onMouseDown={handleFullscreenPanMouseDown}
	                onMouseMove={(event) => handleFullscreenImagePointerMove(event, renderedFullscreenMeasurementLines, renderedFullscreenBoxAnnotations)}
	                onMouseUp={handleFullscreenPanMouseUp}
	                onAuxClick={stopMiddleMouseDefault}
	                onMouseLeave={() => {
	                  handleFullscreenPanMouseUp();
	                }}
                onWheel={handleFullscreenImageWheel}
              >
                <div
                  className="inspection-fullscreen-image-zoom-layer"
	                  style={{
	                    transform: `translate(${fullscreenImageZoom.panX || 0}px, ${fullscreenImageZoom.panY || 0}px) scale(${fullscreenImageZoom.scale})`,
	                    transformOrigin: `${fullscreenImageZoom.originX}% ${fullscreenImageZoom.originY}%`,
	                  }}
                >
                  {!isMprFullscreen && fullscreenShowsExternalOverlay && (
                    <img
                      src={`/api/images/${encodeURIComponent(fullscreenBaseImageId)}/content`}
                      alt={`${fullscreenImageModal.label} source fullscreen`}
                      className="inspection-fullscreen-image"
                    />
                  )}
                  {isMprFullscreen ? (
                    <MprSliceCanvas
                      {...fullscreenSurfaceProps}
                      className={`${fullscreenSurfaceClassName} inspection-fullscreen-mpr-slice`}
                      axis={fullscreenImageModal.axis}
                      volumeCache={volumeCacheState.cache}
                      overlayCaches={activeVolumeOverlayCaches}
                      volumeCacheStatus={volumeCacheState.status}
                      slicePosition={fullscreenMprSlicePosition}
                      dimensions={mprDimensions}
                      displayWindow={displayWindow}
                      displayDomain={displayValueDomain}
                        overlayOpacityMultiplier={1}
                      style={fullscreenMprProjectionStyle}
                      data-testid="fullscreen-mpr-slice"
                      data-mpr-slice-key={fullscreenMprSliceKey}
                      data-mpr-backing-image-id={fullscreenImageId}
                    />
                  ) : (
                    <img
                      {...fullscreenSurfaceProps}
                      src={`/api/images/${encodeURIComponent(
                        fullscreenShowsExternalOverlay ? fullscreenImageId : (fullscreenBaseImageId || fullscreenImageId),
                      )}/content`}
                      alt={`${fullscreenImageModal.label} fullscreen`}
		                />
                  )}
                <FullscreenAnnotationOverlay
                  readOnly={readOnly}
                  model={model}
                  modal={modal}
                  tools={tools}
                  display={display}
                  annotations={annotations}
                  navigation={navigation}
                  fullscreenHandlers={fullscreenHandlers}
                />
	                </div>

              </div>
  );
}
