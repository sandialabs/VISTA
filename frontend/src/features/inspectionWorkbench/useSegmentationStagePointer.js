import { getMprAxisImageDimensions } from './volumeDescriptors';
import { MPR_DISPLAY_AXES_BY_VIEW } from './mprConstants';
import {
  clientPointToSource,
  getContainedImageTransform,
  safeReleasePointerCapture,
  safeSetPointerCapture,
} from '../../utils/annotationGeometry';
import { SEGMENTATION_POINT_MARKER_TOOLS } from './segmentationConfig';
import { rasterizeSphereStroke } from '../../components/pt3SegmentationVolume';

export function useSegmentationStagePointer({
  segmentationHelperAxis,
  mprDimensions,
  volumeCacheState,
  mprProjectionMirror,
  stepSlicePosition,
  readOnly,
  selectedSegmentationSegment,
  segmentationPointerSessionRef,
  segmentationHelperActions,
  segmentationTool,
  segmentationOperation,
  getActiveSegmentationToolMode,
  runSegmentationMlHelper,
  getSegmentationVoxelPosition,
  makeSegmentationShapeBase,
  segmentationDraftRef,
  buildConnectedVolumeSegmentationSelection,
  buildConnectedSegmentationSelection,
  segmentationSensitivity,
  getSegmentationVolumeSpacing,
  getSegmentationVolumeDimensions,
  commitSegmentationShape,
}) {
  const getSegmentationPointerPosition = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const dimensions = getMprAxisImageDimensions(segmentationHelperAxis, mprDimensions, volumeCacheState.cache);
    const displayAxes = MPR_DISPLAY_AXES_BY_VIEW[segmentationHelperAxis] || MPR_DISPLAY_AXES_BY_VIEW.axial;
    const transform = getContainedImageTransform({
      elementRect: rect,
      sourceWidth: dimensions.width,
      sourceHeight: dimensions.height,
      mirrorX: mprProjectionMirror[displayAxes.x] === true,
      mirrorY: mprProjectionMirror[displayAxes.y] === true,
    });
    const point = clientPointToSource(transform, event, { rejectOutside: true });
    if (!point) return null;
    return {
      x: point.x,
      y: point.y,
      displayX: event.clientX - rect.left,
      displayY: event.clientY - rect.top,
      stageWidth: rect.width,
      stageHeight: rect.height,
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
    };
  };

  const handleSegmentationHelperWheel = (event) => {
    event.preventDefault();
    stepSlicePosition(segmentationHelperAxis, event.deltaY > 0 ? 1 : -1);
  };

  const handleSegmentationStagePointerDown = (event) => {
    if (readOnly) return;
    if (!selectedSegmentationSegment || (event.button !== undefined && event.button !== 0)) return;
    if (segmentationPointerSessionRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const position = getSegmentationPointerPosition(event);
    if (!position) return;
    segmentationHelperActions.setPointerPreview(position);
    event.preventDefault();
    event.stopPropagation();
    const operation = segmentationTool === 'eraser' ? 'subtract' : segmentationOperation;
    const tool = segmentationTool === 'eraser' ? 'brush' : segmentationTool;
    const toolMode = getActiveSegmentationToolMode(segmentationTool);
    if (tool === 'ml-helper') {
      runSegmentationMlHelper(event, position);
      return;
    }
    if (tool === 'brush' || tool === 'scissors') {
      const voxel = toolMode === '3d' ? getSegmentationVoxelPosition(position) : null;
      const shape = makeSegmentationShapeBase(tool, position, {
        mode: tool === 'brush' ? toolMode : '2d',
        operation,
        points: [position],
        ...(voxel ? { voxelCenters: [voxel], seedVoxel: voxel } : {}),
      });
      segmentationDraftRef.current = shape;
      segmentationHelperActions.setDraftShape(shape);
      segmentationPointerSessionRef.current = {
        pointerId: event.pointerId,
        captureTarget: event.currentTarget,
        captured: safeSetPointerCapture(event.currentTarget, event.pointerId),
      };
      return;
    }
    if (tool === 'circle') {
      const shape = makeSegmentationShapeBase(tool, position, { center: position, edge: position, radius: 0, points: [position] });
      segmentationDraftRef.current = shape;
      segmentationHelperActions.setDraftShape(shape);
      segmentationPointerSessionRef.current = {
        pointerId: event.pointerId,
        captureTarget: event.currentTarget,
        captured: safeSetPointerCapture(event.currentTarget, event.pointerId),
      };
      return;
    }
    if (tool === 'rectangle') {
      const shape = makeSegmentationShapeBase(tool, position, { start: position, end: position, points: [position] });
      segmentationDraftRef.current = shape;
      segmentationHelperActions.setDraftShape(shape);
      segmentationPointerSessionRef.current = {
        pointerId: event.pointerId,
        captureTarget: event.currentTarget,
        captured: safeSetPointerCapture(event.currentTarget, event.pointerId),
      };
      return;
    }
    if (tool === 'connected') {
      if (toolMode === '3d') {
        buildConnectedVolumeSegmentationSelection(position);
      } else {
        segmentationHelperActions.setVolumeStatus('');
        segmentationHelperActions.setPendingSelection(buildConnectedSegmentationSelection(event.currentTarget, position));
      }
      return;
    }
    if (['threshold', 'level-trace'].includes(tool)) {
      const radius = Math.max(6, Number(segmentationSensitivity) || 28);
      segmentationHelperActions.setPendingSelection(makeSegmentationShapeBase(tool, position, {
        seed: position,
        radius,
        points: SEGMENTATION_POINT_MARKER_TOOLS.has(tool) ? [position] : [],
      }));
      return;
    }
    if (tool === 'polygon') {
      const existing = segmentationDraftRef.current?.tool === 'polygon' ? segmentationDraftRef.current : null;
      const points = [...(existing?.points || []), position];
      const shape = makeSegmentationShapeBase(tool, position, { ...(existing || {}), points, closed: false });
      segmentationDraftRef.current = shape;
      segmentationHelperActions.setDraftShape(shape);
    }
  };

  const handleSegmentationStagePointerMove = (event) => {
    if (readOnly) return;
    const pointerSession = segmentationPointerSessionRef.current;
    if (pointerSession
      && pointerSession.pointerId !== undefined
      && event.pointerId !== undefined
      && pointerSession.pointerId !== event.pointerId) return;
    if (segmentationDraftRef.current && event.pointerType === 'mouse' && event.buttons === 0) {
      safeReleasePointerCapture(pointerSession?.captureTarget, pointerSession?.pointerId);
      segmentationPointerSessionRef.current = null;
      segmentationHelperActions.setDraftShape(null);
      segmentationDraftRef.current = null;
      return;
    }
    const position = getSegmentationPointerPosition(event);
    if (position) segmentationHelperActions.setPointerPreview(position);
    const draft = segmentationDraftRef.current;
    if (!draft || draft.tool === 'polygon') return;
    if (!position) return;
    event.preventDefault();
    if (draft.tool === 'brush' || draft.tool === 'scissors') {
      const voxel = draft.mode === '3d' ? getSegmentationVoxelPosition(position, draft.axis) : null;
      const previousVoxel = draft.voxelCenters?.[draft.voxelCenters.length - 1];
      const voxelChanged = voxel && (
        !previousVoxel
        || voxel.some((value, index) => value !== previousVoxel[index])
      );
      const next = {
        ...draft,
        points: [...(draft.points || []), position],
        ...(voxelChanged ? { voxelCenters: [...(draft.voxelCenters || []), voxel] } : {}),
      };
      segmentationDraftRef.current = next;
      segmentationHelperActions.setDraftShape(next);
      return;
    }
    if (draft.tool === 'circle') {
      const radius = Math.hypot(position.x - draft.center.x, position.y - draft.center.y);
      const next = { ...draft, edge: position, radius, points: [draft.center, position] };
      segmentationDraftRef.current = next;
      segmentationHelperActions.setDraftShape(next);
      return;
    }
    if (draft.tool === 'rectangle') {
      const next = { ...draft, end: position, points: [draft.start, position] };
      segmentationDraftRef.current = next;
      segmentationHelperActions.setDraftShape(next);
    }
  };

  const handleSegmentationStagePointerLeave = (event) => {
    const pointerSession = segmentationPointerSessionRef.current;
    if (pointerSession
      && pointerSession.pointerId !== undefined
      && event?.pointerId !== undefined
      && pointerSession.pointerId !== event.pointerId) return;
    segmentationHelperActions.setPointerPreview(null);
    if (segmentationDraftRef.current && pointerSession && !pointerSession.captured) {
      safeReleasePointerCapture(pointerSession.captureTarget, pointerSession.pointerId);
      segmentationPointerSessionRef.current = null;
      segmentationHelperActions.setDraftShape(null);
      segmentationDraftRef.current = null;
    }
  };

  const handleSegmentationStagePointerUp = (event) => {
    if (readOnly) return;
    const pointerSession = segmentationPointerSessionRef.current;
    if (pointerSession
      && pointerSession.pointerId !== undefined
      && event.pointerId !== undefined
      && pointerSession.pointerId !== event.pointerId) return;
    const draft = segmentationDraftRef.current;
    if (!draft || draft.tool === 'polygon') return;
    event.preventDefault();
    event.stopPropagation();
    if (draft.tool === 'brush' || draft.tool === 'scissors') {
      if (draft.mode === '3d' && draft.tool === 'brush') {
        const spacing = getSegmentationVolumeSpacing();
        const inPlaneSpacing = draft.axis === 'coronal'
          ? [spacing[0], spacing[2]]
          : (draft.axis === 'sagittal' ? [spacing[1], spacing[2]] : [spacing[0], spacing[1]]);
        const physicalRadius = Math.max(
          Math.min(...inPlaneSpacing),
          (Number(draft.brushSize) / 2) * Math.min(...inPlaneSpacing),
        );
        const sphere = rasterizeSphereStroke({
          centers: draft.voxelCenters,
          radius: physicalRadius,
          dimensions: draft.volumeDimensions || getSegmentationVolumeDimensions(),
          spacing,
          maxRuns: 50000,
          maxVoxels: 250000,
        });
        const volumeShape = {
          ...draft,
          points: [],
          voxelCenters: undefined,
          volumeRuns: sphere.runs,
          voxelCount: sphere.voxelCount,
          spacing,
          truncated: sphere.truncated,
          truncationReason: sphere.reason,
        };
        if (sphere.runs.length > 0) {
          commitSegmentationShape(volumeShape, draft.operation);
          if (sphere.truncated) {
            segmentationHelperActions.setVolumeStatus(
              `Sphere stroke was limited by ${sphere.reason || 'the volume guard'}; a partial stroke was applied.`,
            );
          }
        }
      } else if ((draft.points || []).length > 0) {
        commitSegmentationShape(draft, draft.operation);
      }
    } else {
      segmentationHelperActions.setPendingSelection(draft);
      segmentationHelperActions.setDraftShape(null);
      segmentationDraftRef.current = null;
    }
    safeReleasePointerCapture(pointerSession?.captureTarget || event.currentTarget, pointerSession?.pointerId ?? event.pointerId);
    segmentationPointerSessionRef.current = null;
  };

  const handleSegmentationStagePointerCancel = (event) => {
    const pointerSession = segmentationPointerSessionRef.current;
    if (pointerSession
      && pointerSession.pointerId !== undefined
      && event.pointerId !== undefined
      && pointerSession.pointerId !== event.pointerId) return;
    safeReleasePointerCapture(pointerSession?.captureTarget || event.currentTarget, pointerSession?.pointerId ?? event.pointerId);
    segmentationPointerSessionRef.current = null;
    segmentationHelperActions.setPendingSelection(null);
    segmentationHelperActions.setDraftShape(null);
    segmentationDraftRef.current = null;
  };

  return {
    handleSegmentationHelperWheel,
    handleSegmentationStagePointerDown,
    handleSegmentationStagePointerMove,
    handleSegmentationStagePointerLeave,
    handleSegmentationStagePointerUp,
    handleSegmentationStagePointerCancel,
  };
}
