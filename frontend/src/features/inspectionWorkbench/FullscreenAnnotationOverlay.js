import { renderAnnotationOverlay } from './annotationOverlayRendering';
import { renderCompositedSegmentationSegment } from './segmentationGeometry';
import { FullscreenBoxHandles, FullscreenMeasurementLines } from './FullscreenAnnotationHandles';

export function FullscreenAnnotationOverlay({ readOnly, model, modal, tools, display, annotations, navigation, fullscreenHandlers }) {
  const {
    isMprFullscreen,
    renderedFullscreenBoxAnnotations,
    fullscreenPreviewBoxes,
    fullscreenMprProjectionStyle,
    fullscreenOverlayWidth,
    fullscreenOverlayHeight,
    fullscreenOverlayViewBox,
    fullscreenOverlayContentTransform,
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
		          <svg
		            className={`inspection-fullscreen-measurement-overlay ${isMprFullscreen ? 'mpr-projection-overlay' : ''}`.trim()}
		            viewBox={fullscreenOverlayViewBox}
		            preserveAspectRatio="xMidYMid meet"
		            style={fullscreenMprProjectionStyle}
		            aria-label="fullscreen measurement overlay"
		          >
		            <g transform={fullscreenOverlayContentTransform}>
                    <FullscreenMeasurementLines
                      readOnly={readOnly}
                      model={model}
                      tools={tools}
                      display={display}
                      fullscreenHandlers={fullscreenHandlers}
                    />
	                    {renderAnnotationOverlay({ measurementLines: [], boxes: [...renderedFullscreenBoxAnnotations, ...fullscreenPreviewBoxes], fontSize: 20, selectedAnnotationId, opacityMultiplier: annotationOpacityMultiplier, unit: fullscreenAnnotationUnit })}
                    <FullscreenBoxHandles
                      readOnly={readOnly}
                      model={model}
                      tools={tools}
                      fullscreenHandlers={fullscreenHandlers}
                    />
		            </g>
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
	                  </svg>
  );
}
