import Pt3GaussianSplatViewer from '../../components/Pt3GaussianSplatViewer';
import { SegmentationHelperModal } from './SegmentationHelperModal';

/**
 * Segmentation helper modal wired to useInspectionSegmentationWorkbench. The
 * 3D view embeds a volume-mode splat viewer that shares the panel's base props.
 */
export function InspectionSegmentationHelperDialog({
  dialog, pt3SplatViewerBaseProps, sliceImage, readOnly,
}) {
  if (readOnly || !dialog.state.open) return null;
  return (
    <SegmentationHelperModal
      state={dialog.state}
      actions={dialog.actions}
      dialogRef={dialog.dialogRef}
      closeButtonRef={dialog.closeButtonRef}
      onClose={dialog.onClose}
      handlers={dialog.handlers}
      stageHandlers={dialog.stageHandlers}
      sliceImage={sliceImage}
      selectedSegment={dialog.selectedSegment}
      volumeDimensions={dialog.volumeDimensions}
      pendingVolumePreviewSegment={dialog.pendingVolumePreviewSegment}
      getCanonicalSliceIndex={dialog.getCanonicalSliceIndex}
      getActiveToolMode={dialog.getActiveToolMode}
      volumeViewer={dialog.state.view === '3d' ? (
        <Pt3GaussianSplatViewer
          {...pt3SplatViewerBaseProps}
          volumeMetadata={dialog.volumeMetadata}
          mode="volume"
          slicePosition={dialog.canonicalSlicePosition}
          showRayMarchControls={false}
          showSplatControls={false}
          showRealOptimizationControls={false}
          vectorAnnotations={dialog.vectorAnnotations}
          showAnnotations
        />
      ) : null}
      surfacePreviewTruncated={dialog.surfacePreviewTruncated}
    />
  );
}
