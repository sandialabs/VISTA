import { renderAnnotationOverlay } from './annotationOverlayRendering';
import { renderCompositedSegmentationSegment } from './segmentationGeometry';
import { FullscreenBoxHandles, FullscreenMeasurementLines } from './FullscreenAnnotationHandles';
import { AnnotationOverlaySvg } from './AnnotationOverlaySvg';

export function FullscreenAnnotationOverlay({ readOnly, model, modal, tools, display, annotations, navigation, fullscreenHandlers }) {
  const {
    isMprFullscreen,
    renderedFullscreenBoxAnnotations,
    fullscreenPreviewBoxes,
    fullscreenMprProjectionStyle,
    fullscreenOverlayWidth,
    fullscreenOverlayHeight,
    fullscreenCanonicalSliceIndex,
    fullscreenSegmentAnnotations,
    fullscreenAnnotationUnit,
  } = model;
  const {
    fullscreenImageModal,
  } = modal;
  const {
    annotationOpacityMultiplier,
  } = display;
  const {
    selectedAnnotationId,
  } = annotations;
  const {
    mprDimensions,
  } = navigation;
  return (
    <AnnotationOverlaySvg
      className={`inspection-fullscreen-measurement-overlay ${isMprFullscreen ? 'mpr-projection-overlay' : ''}`.trim()}
      imageWidth={fullscreenOverlayWidth}
      imageHeight={fullscreenOverlayHeight}
      style={fullscreenMprProjectionStyle}
      ariaLabel="fullscreen measurement overlay"
      renderContent={(frame) => (
        <>
          <FullscreenMeasurementLines
            readOnly={readOnly}
            model={model}
            tools={tools}
            display={display}
            fullscreenHandlers={fullscreenHandlers}
            frame={frame}
          />
          {renderAnnotationOverlay({ measurementLines: [], boxes: [...renderedFullscreenBoxAnnotations, ...fullscreenPreviewBoxes], fontSize: 20, selectedAnnotationId, opacityMultiplier: annotationOpacityMultiplier, unit: fullscreenAnnotationUnit, frame })}
          <FullscreenBoxHandles
            readOnly={readOnly}
            model={model}
            tools={tools}
            fullscreenHandlers={fullscreenHandlers}
            frame={frame}
          />
        </>
      )}
    >
      {fullscreenSegmentAnnotations.map((segment) => (
        <g
          key={`fullscreen-segment-${segment.id}`}
          opacity={annotationOpacityMultiplier}
        >
          {renderCompositedSegmentationSegment(segment, {
            color: segment.color,
            fillOpacity: segment.opacity,
            axis: fullscreenImageModal.axis,
            sliceIndex: fullscreenCanonicalSliceIndex,
            imageWidth: fullscreenOverlayWidth,
            imageHeight: fullscreenOverlayHeight,
            volumeDimensions: [
              mprDimensions.sagittal,
              mprDimensions.coronal,
              mprDimensions.axial,
            ],
          })}
        </g>
      ))}
    </AnnotationOverlaySvg>
  );
}
