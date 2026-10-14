import { useEffect } from 'react';
import { buildPt3VectorAnnotationFaces, forEachPt3VectorFaceVoxelPolygon } from '../../components/pt3VectorAnnotations';
import { MPR_AXES, MPR_AXIS_CONFIG, PT3_RENDERER_RECONSTRUCTION_MODES } from './mprConstants';
import { getPlaneFocusRange, projectMprPointToOverlay } from './mprGeometry';

/**
 * Sizes and paints the 2D fallback MPR overlay canvas: slice plane outlines, the active plane focus, and vector annotations.
 */
export default function useMprFallbackOverlayCanvas({
  activeMprPane,
  annotationLayerVisible,
  annotationOpacityMultiplier,
  fallbackMprModelZoom,
  lastActiveMprAxis,
  mprAxisMirrorScale,
  mprDimensions,
  mprFallbackOverlaySize,
  mprFullscreenOpen,
  mprOverlayCanvasRef,
  mprReconstructionMode,
  mprRotation,
  pt3GuideAppearance,
  pt3RenderableAnnotations,
  setMprFallbackOverlaySize,
  slicePosition,
}) {
  useEffect(() => {
    const canvas = mprOverlayCanvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return undefined;
    const updateSize = () => {
      const bounds = parent.getBoundingClientRect?.();
      const width = Math.max(0, Math.round(parent.clientWidth || bounds?.width || 0));
      const height = Math.max(0, Math.round(parent.clientHeight || bounds?.height || 0));
      setMprFallbackOverlaySize((previous) => (
        previous.width === width && previous.height === height
          ? previous
          : { width, height }
      ));
    };
    updateSize();
    const ResizeObserverConstructor = window.ResizeObserver;
    const observer = typeof ResizeObserverConstructor === 'function'
      ? new ResizeObserverConstructor(updateSize)
      : null;
    observer?.observe(parent);
    window.addEventListener('resize', updateSize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [mprFullscreenOpen, mprReconstructionMode, mprOverlayCanvasRef, setMprFallbackOverlaySize]);

  useEffect(() => {
    const canvas = mprOverlayCanvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    canvas.width = mprFallbackOverlaySize.width || parent.clientWidth;
    canvas.height = mprFallbackOverlaySize.height || parent.clientHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (activeMprPane !== 'volume' || PT3_RENDERER_RECONSTRUCTION_MODES.includes(mprReconstructionMode)) return;
    const dims = {
      sagittal: Math.max(1, mprDimensions.sagittal || 1),
      coronal: Math.max(1, mprDimensions.coronal || 1),
      axial: Math.max(1, mprDimensions.axial || 1),
    };
    const sx = slicePosition.sagittal;
    const sy = slicePosition.coronal;
    const sz = slicePosition.axial;
    const bounds = {
      x0: -0.5,
      x1: dims.sagittal - 0.5,
      y0: -0.5,
      y1: dims.coronal - 0.5,
      z0: -0.5,
      z1: dims.axial - 0.5,
    };
    const full = {
      axial: [[bounds.x0, bounds.y0, sz], [bounds.x1, bounds.y0, sz], [bounds.x1, bounds.y1, sz], [bounds.x0, bounds.y1, sz]],
      sagittal: [[sx, bounds.y0, bounds.z0], [sx, bounds.y1, bounds.z0], [sx, bounds.y1, bounds.z1], [sx, bounds.y0, bounds.z1]],
      coronal: [[bounds.x0, sy, bounds.z0], [bounds.x1, sy, bounds.z0], [bounds.x1, sy, bounds.z1], [bounds.x0, sy, bounds.z1]],
    };
    const [axX0, axX1] = getPlaneFocusRange(sx, dims.sagittal);
    const [axY0, axY1] = getPlaneFocusRange(sy, dims.coronal);
    const [sgY0, sgY1] = getPlaneFocusRange(sy, dims.coronal);
    const [sgZ0, sgZ1] = getPlaneFocusRange(sz, dims.axial);
    const [coX0, coX1] = getPlaneFocusRange(sx, dims.sagittal);
    const [coZ0, coZ1] = getPlaneFocusRange(sz, dims.axial);
    const focus = {
      axial: [[axX0, axY0, sz], [axX1, axY0, sz], [axX1, axY1, sz], [axX0, axY1, sz]],
      sagittal: [[sx, sgY0, sgZ0], [sx, sgY1, sgZ0], [sx, sgY1, sgZ1], [sx, sgY0, sgZ1]],
      coronal: [[coX0, sy, coZ0], [coX1, sy, coZ0], [coX1, sy, coZ1], [coX0, sy, coZ1]],
    };
    const drawOrder = MPR_AXES;
    drawOrder.forEach((axis) => {
      const color = MPR_AXIS_CONFIG[axis].color;
      const line = full[axis].map(([x, y, z]) => projectMprPointToOverlay(x, y, z, dims, mprRotation, fallbackMprModelZoom, canvas.width, canvas.height, mprAxisMirrorScale));
      ctx.beginPath();
      ctx.moveTo(line[0].x, line[0].y);
      line.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.closePath();
      ctx.globalAlpha = pt3GuideAppearance.planeOutlineOpacity;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = pt3GuideAppearance.planeOutlineLineWidthPx / 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
      const active = lastActiveMprAxis === axis ? axis : null;
      if (active) {
        const quad = focus[axis].map(([x, y, z]) => projectMprPointToOverlay(x, y, z, dims, mprRotation, fallbackMprModelZoom, canvas.width, canvas.height, mprAxisMirrorScale));
        ctx.beginPath();
        ctx.moveTo(quad[0].x, quad[0].y);
        quad.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
        ctx.closePath();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = pt3GuideAppearance.planeOutlineOpacity;
        ctx.lineWidth = pt3GuideAppearance.planeOutlineLineWidthPx;
        ctx.strokeStyle = color;
        ctx.stroke();
      }
    });
    if (annotationLayerVisible && pt3RenderableAnnotations.length > 0) {
      const vectorFaces = buildPt3VectorAnnotationFaces(pt3RenderableAnnotations, {
        dimensions: [dims.sagittal, dims.coronal, dims.axial],
      }).faces.map((face) => {
        let depthTotal = 0;
        let pointCount = 0;
        forEachPt3VectorFaceVoxelPolygon(face, (polygon) => {
          polygon.forEach(([x, y, z]) => {
            const point = projectMprPointToOverlay(x, y, z, dims, mprRotation, fallbackMprModelZoom, canvas.width, canvas.height, mprAxisMirrorScale);
            if (!Number.isFinite(point.z)) return;
            depthTotal += point.z;
            pointCount += 1;
          });
        });
        return {
          face,
          depth: depthTotal / Math.max(1, pointCount),
          pointCount,
        };
      }).filter((entry) => entry.pointCount > 0).sort((left, right) => left.depth - right.depth);
      vectorFaces.forEach(({ face }) => {
        ctx.beginPath();
        let polygonCount = 0;
        forEachPt3VectorFaceVoxelPolygon(face, (polygon) => {
          const points = polygon.map(([x, y, z]) => (
            projectMprPointToOverlay(x, y, z, dims, mprRotation, fallbackMprModelZoom, canvas.width, canvas.height, mprAxisMirrorScale)
          ));
          if (points.length < 3 || !points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return;
          ctx.moveTo(points[0].x, points[0].y);
          points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
          ctx.closePath();
          polygonCount += 1;
        });
        if (polygonCount === 0) return;
        ctx.globalAlpha = (face.surface === 'side' ? Math.min(0.3, face.opacity) : Math.min(0.48, face.opacity + 0.12))
          * annotationOpacityMultiplier;
        ctx.fillStyle = face.color;
        ctx.fill();
        ctx.globalAlpha = 0.88 * annotationOpacityMultiplier;
        ctx.lineWidth = face.surface === 'side' ? 1 : 1.5;
        ctx.strokeStyle = face.color;
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
  }, [
    activeMprPane,
    annotationLayerVisible,
    annotationOpacityMultiplier,
    fallbackMprModelZoom,
    lastActiveMprAxis,
    mprAxisMirrorScale,
    mprDimensions,
    mprFallbackOverlaySize,
    mprFullscreenOpen,
    mprReconstructionMode,
    mprRotation,
    pt3GuideAppearance.planeOutlineLineWidthPx,
    pt3GuideAppearance.planeOutlineOpacity,
    pt3RenderableAnnotations,
    slicePosition,
    mprOverlayCanvasRef,
  ]);
}
