import { DEFAULT_SEGMENT_COLOR, getSegmentationShapePoints } from './segmentationConfig';
import {
  renderCompositedSegmentationSegment,
  renderSegmentationShape,
  segmentVisibleOnSlice,
} from './segmentationGeometry';
import { MPR_AXES, MPR_AXIS_CONFIG } from './mprConstants';
import { getMprAxisImageDimensions } from './volumeDescriptors';
import { getFallbackProjectionImage, getMprCrosshairStyle } from './mprGeometry';
import { MprSliceCanvas } from './MprSliceCanvas';
import { MprWindowedImage } from './MprWindowedImage';

const PENDING_PREVIEW_STYLE = { color: '#fde047', fillOpacity: 0.3 };

function SegmentationSliceImage({ axis, sliceImage }) {
  const { hasVolumeImageSource, volumeCacheState, displayWindow, displayDomain } = sliceImage;
  if (hasVolumeImageSource) {
    return (
      <MprSliceCanvas
        axis={axis}
        volumeCache={volumeCacheState.cache}
        overlayCaches={sliceImage.overlayCaches}
        volumeCacheStatus={volumeCacheState.status}
        slicePosition={sliceImage.slicePosition}
        dimensions={sliceImage.mprDimensions}
        displayWindow={displayWindow}
        displayDomain={displayDomain}
        overlayOpacityMultiplier={1}
      />
    );
  }
  const fallback = getFallbackProjectionImage(axis, sliceImage.shellImageLayers);
  if (!fallback) return <span className="mpr-empty-volume">No volume stack images</span>;
  return (
    <MprWindowedImage
      className="mpr-fallback-projection"
      src={fallback.url}
      alt={`${MPR_AXIS_CONFIG[axis]?.label} segmentation helper fallback`}
      displayWindow={displayWindow}
      displayDomain={displayDomain}
    />
  );
}

function renderSegmentMask(segment, slice, style = {}) {
  return renderCompositedSegmentationSegment(segment, {
    color: style.color ?? segment.color,
    fillOpacity: style.fillOpacity ?? segment.opacity ?? 0.2,
    axis: slice.axis,
    sliceIndex: slice.sliceIndex,
    imageWidth: slice.dimensions.width,
    imageHeight: slice.dimensions.height,
    volumeDimensions: slice.volumeDimensions,
  });
}

function SegmentationMprPane({ axis, segments, pendingVolumePreviewSegment, sliceImage, volumeDimensions, getCanonicalSliceIndex, onFocusAxis }) {
  const { slicePosition, mprDimensions } = sliceImage;
  const config = MPR_AXIS_CONFIG[axis];
  const dimensions = getMprAxisImageDimensions(axis, mprDimensions, sliceImage.volumeCacheState.cache);
  const sliceIndex = Number(slicePosition[axis] || 0);
  const canonicalSliceIndex = getCanonicalSliceIndex(axis, sliceIndex);
  const slice = { axis, sliceIndex: canonicalSliceIndex, dimensions, volumeDimensions };
  const visibleSegments = segments.filter((segment) => segmentVisibleOnSlice(segment, axis, canonicalSliceIndex));
  return (
    <button
      type="button"
      className="segmentation-helper-mpr-pane"
      style={{
        '--segment-axis-color': config.color,
        ...getMprCrosshairStyle(axis, slicePosition, mprDimensions, sliceImage.mprProjectionMirror),
      }}
      aria-label={`Edit ${config.sliceLabel} axis in ${config.label} plane`}
      onClick={() => onFocusAxis(axis)}
      data-testid={`segmentation-helper-mpr-${axis}`}
    >
      <header>
        <strong>{config.sliceLabel}</strong>
        <span>{config.label} · {sliceIndex}</span>
      </header>
      <div className="segmentation-helper-mpr-image">
        <SegmentationSliceImage axis={axis} sliceImage={sliceImage} />
        <span className="mpr-crosshair-h" />
        <span className="mpr-crosshair-v" />
        <span className="mpr-crosshair-center" />
        <svg
          className="segmentation-helper-overlay mpr-projection-overlay"
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label={`${config.sliceLabel} segmentation projection`}
        >
          {visibleSegments.map((segment) => (
            <g key={`segmentation-mpr-mask-${axis}-${segment.id}`}>
              {renderSegmentMask(segment, slice)}
            </g>
          ))}
          {pendingVolumePreviewSegment && (
            <g>{renderSegmentMask(pendingVolumePreviewSegment, slice, PENDING_PREVIEW_STYLE)}</g>
          )}
        </svg>
      </div>
    </button>
  );
}

export function SegmentationMprGrid(props) {
  return (
    <section className="segmentation-helper-mpr-grid" data-testid="segmentation-helper-mpr">
      {MPR_AXES.map((axis) => (
        <SegmentationMprPane key={axis} axis={axis} {...props} />
      ))}
      <p className="segmentation-helper-workspace-hint">
        These three panes share one crosshair. Select a pane to open its editable axis view.
      </p>
    </section>
  );
}

export function SegmentationVolumeStage({ viewer, surfacePreviewTruncated }) {
  return (
    <section className="segmentation-helper-3d-stage" data-testid="segmentation-helper-3d-stage">
      {viewer}
      <div className="segmentation-helper-3d-hint">
        <strong>Volume context</strong>
        <span>Orbit to inspect the exact segment surface over sampled anatomy context. Paint or seed from X, Y, or Z.</span>
        {surfacePreviewTruncated && (
          <span className="segmentation-volume-status warning" role="status">
            3D surface preview truncated for performance; the stored mask is intact.
          </span>
        )}
      </div>
    </section>
  );
}

function SegmentationStageOverlay({ state, slice, visibleSegments, selectedSegment, pendingVolumePreviewSegment }) {
  const { pendingSelection, draftShape } = state;
  const { dimensions } = slice;
  const draftPoints = [
    ...getSegmentationShapePoints(draftShape),
    ...getSegmentationShapePoints(pendingSelection),
  ];
  return (
    <svg
      className="segmentation-helper-overlay mpr-projection-overlay"
      viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-label="Segmentation helper overlay"
    >
      {visibleSegments.map((segment) => (
        <g
          key={`segmentation-segment-mask-${segment.id}`}
          className={segment.id === selectedSegment?.id ? 'active-segment' : ''}
        >
          {renderSegmentMask(segment, slice)}
        </g>
      ))}
      {pendingVolumePreviewSegment && (
        <g>{renderSegmentMask(pendingVolumePreviewSegment, slice, PENDING_PREVIEW_STYLE)}</g>
      )}
      {pendingSelection?.mode !== '3d' && renderSegmentationShape(pendingSelection, {
        color: '#fde047',
        fillColor: '#fde047',
        fillOpacity: 0.18,
        preview: true,
        strokeWidth: 3,
      })}
      {draftShape && renderSegmentationShape(draftShape, {
        color: '#f8fafc',
        fillColor: selectedSegment?.color || DEFAULT_SEGMENT_COLOR,
        fillOpacity: 0.15,
        preview: true,
        strokeWidth: 3,
      })}
      {draftPoints.map((point, index) => (
        <circle
          key={`segmentation-point-${index}-${point.x}-${point.y}`}
          className="segmentation-helper-point"
          cx={point.x}
          cy={point.y}
          r={Math.max(1.5, Math.min(dimensions.width, dimensions.height) * 0.006)}
        />
      ))}
    </svg>
  );
}

export function SegmentationSliceStage({
  state,
  axis,
  canonicalSliceIndex,
  activeToolMode,
  selectedSegment,
  pendingVolumePreviewSegment,
  sliceImage,
  volumeDimensions,
  stageHandlers,
}) {
  const { segments, tool, pointerPreview, brushSize } = state;
  const { slicePosition, mprDimensions } = sliceImage;
  const config = MPR_AXIS_CONFIG[axis] || MPR_AXIS_CONFIG.axial;
  const dimensions = getMprAxisImageDimensions(axis, mprDimensions, sliceImage.volumeCacheState.cache);
  const slice = { axis, sliceIndex: canonicalSliceIndex, dimensions, volumeDimensions };
  const visibleSegments = segments.filter((segment) => segmentVisibleOnSlice(segment, axis, canonicalSliceIndex));
  const brushPointerVisible = ['brush', 'eraser'].includes(tool) && pointerPreview;
  const brushPointerDiameter = Math.max(2, Number(brushSize) || 18);
  return (
    <div
      className={`segmentation-slice-stage ${brushPointerVisible ? 'show-brush-pointer' : ''} ${activeToolMode === '3d' ? 'mode-3d' : ''}`}
      style={{
        '--segment-axis-color': config.color,
        '--brush-pointer-x': brushPointerVisible ? `${pointerPreview.displayX}px` : '50%',
        '--brush-pointer-y': brushPointerVisible ? `${pointerPreview.displayY}px` : '50%',
        '--brush-pointer-size': `${brushPointerDiameter}px`,
        ...getMprCrosshairStyle(axis, slicePosition, mprDimensions, sliceImage.mprProjectionMirror),
      }}
      {...stageHandlers}
      data-testid="segmentation-helper-stage"
    >
      <SegmentationSliceImage axis={axis} sliceImage={sliceImage} />
      <SegmentationStageOverlay
        state={state}
        slice={slice}
        visibleSegments={visibleSegments}
        selectedSegment={selectedSegment}
        pendingVolumePreviewSegment={pendingVolumePreviewSegment}
      />
    </div>
  );
}
