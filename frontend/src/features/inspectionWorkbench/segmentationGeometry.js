import { buildPt3SegmentMask, buildPt3SegmentVolumeSliceMask, pt3SegmentMaskToSvgPath } from '../../components/pt3VectorAnnotations';
import { annotationToVectorSegment } from '../../components/inspectionAnnotationAdapter';
import { MPR_AXES } from './mprConstants';
import { DEFAULT_SEGMENT_COLOR, SEGMENT_COLORS } from './segmentationConfig';

export function createDefaultSegment(index = 0, context = {}) {
  const axis = MPR_AXES.includes(context.axis) ? context.axis : 'axial';
  const sliceIndex = Math.max(0, Math.floor(Number(context.sliceIndex) || 0));
  return {
    id: `segment-${Date.now()}-${index}`,
    annotationId: '',
    name: index === 0 ? 'Segment A' : `Segment ${String.fromCharCode(65 + (index % 26))}`,
    color: SEGMENT_COLORS[index % SEGMENT_COLORS.length] || DEFAULT_SEGMENT_COLOR,
    axis,
    minSlice: sliceIndex,
    maxSlice: sliceIndex,
    imageWidth: Math.max(1, Number(context.imageWidth) || 1),
    imageHeight: Math.max(1, Number(context.imageHeight) || 1),
    volumeDimensions: Array.isArray(context.volumeDimensions)
      ? context.volumeDimensions.slice(0, 3).map((value) => Math.max(1, Math.floor(Number(value) || 1)))
      : null,
    visible: true,
    areas: [],
  };
}

export function annotationToSegmentationHelperSegment(annotation) {
  const vectorSegment = annotationToVectorSegment(annotation);
  if (!vectorSegment) return null;
  return {
    id: vectorSegment.id,
    annotationId: vectorSegment.annotationId,
    name: vectorSegment.label,
    color: vectorSegment.color,
    opacity: vectorSegment.opacity,
    visible: vectorSegment.visible,
    axis: vectorSegment.axis,
    minSlice: vectorSegment.minSlice,
    maxSlice: vectorSegment.maxSlice,
    imageWidth: vectorSegment.imageWidth,
    imageHeight: vectorSegment.imageHeight,
    version: vectorSegment.version,
    volumeDimensions: vectorSegment.volumeDimensions,
    areas: vectorSegment.areas,
    annotation,
  };
}

export function segmentHasVolumeAreas(segment) {
  return (Array.isArray(segment?.areas) ? segment.areas : []).some((area) => (
    (Array.isArray(area?.volumeRuns) && area.volumeRuns.length > 0)
    || (Array.isArray(area?.volume_runs) && area.volume_runs.length > 0)
  ));
}

function segmentHasPlanarAreaOnSlice(segment, axis, sliceIndex) {
  const safeAxis = MPR_AXES.includes(axis) ? axis : 'axial';
  const selectedSlice = Math.round(Number(sliceIndex) || 0);
  const segmentAxis = MPR_AXES.includes(segment?.axis) ? segment.axis : 'axial';
  return (Array.isArray(segment?.areas) ? segment.areas : []).some((area) => {
    if (String(area?.mode || area?.areaMode || area?.dimensionality || '2d').toLowerCase() === '3d') {
      return false;
    }
    const areaAxis = MPR_AXES.includes(area?.axis) ? area.axis : segmentAxis;
    if (areaAxis !== safeAxis) return false;
    const areaSlice = Number(area?.sliceIndex ?? area?.slice_index);
    if (Number.isFinite(areaSlice)) return Math.round(areaSlice) === selectedSlice;
    return (
      selectedSlice >= Math.min(Number(segment?.minSlice) || 0, Number(segment?.maxSlice) || 0)
      && selectedSlice <= Math.max(Number(segment?.minSlice) || 0, Number(segment?.maxSlice) || 0)
    );
  });
}

export function segmentVisibleOnSlice(segment, axis, sliceIndex) {
  return segment?.visible !== false && (
    segmentHasVolumeAreas(segment)
    || segmentHasPlanarAreaOnSlice(segment, axis, sliceIndex)
  );
}

export function renderSegmentationShape(shape, options = {}) {
  if (!shape) return null;
  const strokeColor = options.color || shape.color || DEFAULT_SEGMENT_COLOR;
  const fillColor = options.fillColor || strokeColor;
  const fillOpacity = Number.isFinite(Number(options.fillOpacity)) ? Number(options.fillOpacity) : 0.22;
  const strokeWidth = options.strokeWidth || 2.5;
  const points = Array.isArray(shape.points) ? shape.points : [];
  const className = [
    'segmentation-helper-shape',
    shape.operation === 'subtract' ? 'subtract' : 'add',
    options.preview ? 'preview' : '',
  ].filter(Boolean).join(' ');

  if (shape.tool === 'brush' || shape.tool === 'eraser' || shape.tool === 'scissors') {
    if (points.length === 0) return null;
    const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
    return (
      <path
        d={path}
        className={className}
        fill="none"
        stroke={strokeColor}
        strokeWidth={Math.max(2, Number(shape.brushSize) || 12)}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={shape.tool === 'eraser' || shape.operation === 'subtract' ? 0.72 : 0.88}
      />
    );
  }

  if (shape.tool === 'polygon' && points.length > 0) {
    const pointString = points.map((point) => `${point.x},${point.y}`).join(' ');
    return (
      <polyline
        points={pointString}
        className={className}
        fill={shape.closed && points.length > 2 ? fillColor : 'none'}
        fillOpacity={shape.closed && points.length > 2 ? fillOpacity : 0}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
    );
  }

  if (shape.tool === 'circle' && shape.center) {
    const radius = Number(shape.radius) || (
      shape.edge ? Math.hypot(shape.edge.x - shape.center.x, shape.edge.y - shape.center.y) : 0
    );
    if (radius <= 0) return null;
    return (
      <circle
        cx={shape.center.x}
        cy={shape.center.y}
        r={radius}
        className={className}
        fill={fillColor}
        fillOpacity={fillOpacity}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
    );
  }

  if (shape.tool === 'rectangle' && shape.start && shape.end) {
    const x = Math.min(shape.start.x, shape.end.x);
    const y = Math.min(shape.start.y, shape.end.y);
    const width = Math.abs(shape.end.x - shape.start.x);
    const height = Math.abs(shape.end.y - shape.start.y);
    if (width <= 0 || height <= 0) return null;
    return (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        className={className}
        fill={fillColor}
        fillOpacity={fillOpacity}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
    );
  }

  if (shape.tool === 'ml-helper' && Array.isArray(shape.bbox) && shape.bbox.length >= 4) {
    const [x1, y1, x2, y2] = shape.bbox.map(Number);
    const width = x2 - x1;
    const height = y2 - y1;
    if (![x1, y1, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return (
      <rect
        x={x1}
        y={y1}
        width={width}
        height={height}
        className={className}
        fill={fillColor}
        fillOpacity={fillOpacity}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
    );
  }

  if (shape.tool === 'connected') {
    if (!shape.maskPath) return null;
    return (
      <path
        d={shape.maskPath}
        className={className}
        fill={fillColor}
        fillOpacity={fillOpacity}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
      />
    );
  }

  if (['threshold', 'level-trace'].includes(shape.tool) && shape.seed) {
    const radius = Number(shape.radius) || Number(shape.sensitivity) || 20;
    return (
      <ellipse
        cx={shape.seed.x}
        cy={shape.seed.y}
        rx={radius * 1.25}
        ry={radius}
        className={className}
        fill={fillColor}
        fillOpacity={fillOpacity}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={shape.tool === 'level-trace' ? '7 5' : undefined}
      />
    );
  }

  return null;
}

export function renderCompositedSegmentationSegment(segment, options = {}) {
  if (!segment || segment.visible === false) return null;
  const color = options.color || segment.color || DEFAULT_SEGMENT_COLOR;
  const fillOpacity = Number.isFinite(Number(options.fillOpacity))
    ? Number(options.fillOpacity)
    : (Number.isFinite(Number(segment.opacity)) ? Number(segment.opacity) : 0.24);
  const selectedSlice = Number(options.sliceIndex);
  const targetWidth = Math.max(1, Number(options.imageWidth) || Number(segment.imageWidth) || 1);
  const targetHeight = Math.max(1, Number(options.imageHeight) || Number(segment.imageHeight) || 1);
  const hasVolume = segmentHasVolumeAreas(segment);
  const planarVisible = !options.axis || segmentHasPlanarAreaOnSlice(
    segment,
    options.axis,
    selectedSlice,
  );
  const mask = planarVisible && !hasVolume
    ? buildPt3SegmentMask(segment, {
      axis: options.axis,
      sliceIndex: selectedSlice,
      imageWidth: targetWidth,
      imageHeight: targetHeight,
    })
    : null;
  const path = mask ? pt3SegmentMaskToSvgPath(mask) : '';
  const volumeMask = hasVolume && options.axis && options.volumeDimensions
    ? buildPt3SegmentVolumeSliceMask(segment, {
      axis: options.axis,
      sliceIndex: options.sliceIndex,
      dimensions: options.volumeDimensions,
    })
    : null;
  const volumePath = volumeMask ? pt3SegmentMaskToSvgPath(volumeMask) : '';
  if (!path && !volumePath) return null;
  return (
    <>
      {path && (
        <g transform={`scale(${targetWidth / mask.imageWidth} ${targetHeight / mask.imageHeight})`}>
          <path
            d={path}
            className="segmentation-helper-shape add composited-segment-mask"
            fill={color}
            fillOpacity={fillOpacity}
            stroke="none"
            data-mask-rectangles={mask.rectangles.length}
            data-mask-truncated={mask.stats.truncated ? 'true' : 'false'}
            data-mask-approximated={mask.stats.approximated ? 'true' : 'false'}
          />
        </g>
      )}
      {volumePath && (
        <g transform={`scale(${targetWidth / volumeMask.imageWidth} ${targetHeight / volumeMask.imageHeight})`}>
          <path
            d={volumePath}
            className="segmentation-helper-shape add composited-segment-mask volumetric-segment-mask"
            fill={color}
            fillOpacity={fillOpacity}
            stroke="none"
            data-volume-mask-rectangles={volumeMask.rectangles.length}
            data-volume-voxel-count={volumeMask.stats.voxelCount}
          />
        </g>
      )}
    </>
  );
}
