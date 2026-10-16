import { useEffect } from 'react';
import { INSPECTION_VIEW_ALL_IMAGES_TAB } from './inspectionConstants';
import { getOverlayLayers } from './inspectionUtils';
import { MPR_AXES } from './mprConstants';
import { getAggregatePartImageRefs, getPartImageRefs } from './partImageRefs';
import { ALL_PARTS_ID } from './useInspectionPartSelection';

/**
 * Applies launch filters (batch, review filter, part, image, tabs, overlays) once per distinct launch signature.
 */
export default function useInspectionLaunchFilters({
  appliedLaunchFiltersSignatureRef,
  applyMprNavigationSession,
  batches,
  launchFilters,
  mprNavigationHydratedProjectRef,
  mprSessionProjectKey,
  parts,
  projectImageLookup,
  projectType,
  selectedPartId,
  setActiveInspectionViewTab,
  setActiveMetadataTab,
  setActiveOverlayIds,
  setManualFilterNotice,
  setReviewFilter,
  setSelectedBatchId,
  setSelectedImageRef,
  setSelectedPartId,
}) {
  useEffect(() => {
    if (!launchFilters || typeof launchFilters !== 'object') return;
    if (parts.length === 0 && batches.length === 0) return;

    const launchFiltersSignature = JSON.stringify({
      selected_batch_id: launchFilters.selected_batch_id || '',
      review_filter: launchFilters.review_filter || '',
      selected_part_id: launchFilters.selected_part_id || '',
      selected_image_ref: launchFilters.selected_image_ref || '',
      active_metadata_tab: launchFilters.active_metadata_tab || '',
      active_mpr_pane: launchFilters.active_mpr_pane || '',
      active_overlay_ids: Array.isArray(launchFilters.active_overlay_ids) ? launchFilters.active_overlay_ids : [],
      source: launchFilters.source || '',
      at: launchFilters.at || '',
    });
    if (appliedLaunchFiltersSignatureRef.current === launchFiltersSignature) return;

    const requestedBatchId = String(launchFilters.selected_batch_id || '').trim();
    if (requestedBatchId && batches.some((batch) => String(batch.id) === requestedBatchId)) {
      setSelectedBatchId(requestedBatchId);
    }
    const requestedReviewFilter = String(launchFilters.review_filter || '').trim();
    if (['all', 'pass', 'reject_pending', 'reject_confirmed', 'none', 'manual'].includes(requestedReviewFilter)) {
      setReviewFilter(requestedReviewFilter);
    }
    const requestedPartId = String(launchFilters.selected_part_id || '').trim();
    if (requestedPartId === ALL_PARTS_ID || (requestedPartId && parts.some((part) => String(part.id) === requestedPartId))) {
      if (requestedPartId === ALL_PARTS_ID) setActiveInspectionViewTab(INSPECTION_VIEW_ALL_IMAGES_TAB);
      setSelectedPartId(requestedPartId);
    }
    const targetPartId = requestedPartId || selectedPartId;
    const requestedImageRef = String(launchFilters.selected_image_ref || '').trim();
    if (requestedImageRef) {
      const targetPart = parts.find((part) => String(part.id) === targetPartId);
      const validImageRefs = targetPartId === ALL_PARTS_ID
        ? getAggregatePartImageRefs(parts, projectImageLookup).map((entry) => String(entry.imageRef))
        : getPartImageRefs(targetPart).map((entry) => String(entry.imageRef));
      if (validImageRefs.includes(requestedImageRef)) setSelectedImageRef(requestedImageRef);
    }
    const requestedMetadataTab = String(launchFilters.active_metadata_tab || '').trim();
    if (requestedMetadataTab) setActiveMetadataTab(requestedMetadataTab);
    const requestedMprPane = String(launchFilters.active_mpr_pane || '').trim();
    if (projectType === 'PT3' && ['axial', 'coronal', 'sagittal', 'volume'].includes(requestedMprPane)) {
      if (mprNavigationHydratedProjectRef.current === mprSessionProjectKey) {
        applyMprNavigationSession({
          activePane: requestedMprPane,
          ...(MPR_AXES.includes(requestedMprPane)
            ? { lastActiveAxis: requestedMprPane }
            : {}),
        });
      }
    }
    if (projectType === 'PT3' && Array.isArray(launchFilters.active_overlay_ids)) {
      const targetPart = parts.find((part) => String(part.id) === targetPartId);
      const stableOverlayIds = new Set(getOverlayLayers(targetPart).map((overlay) => String(overlay.id)));
      const nextOverlayIds = launchFilters.active_overlay_ids.map((entry) => String(entry)).filter((entry) => stableOverlayIds.has(entry));
      if (nextOverlayIds.length > 0) setActiveOverlayIds(nextOverlayIds);
    }
    if (launchFilters.review_filter === 'manual') {
      const batchName = String(launchFilters.source_batch_name || '').trim();
      setManualFilterNotice(
        batchName
          ? `Manual filter applied from Batches tab for ${batchName}.`
          : 'Manual filter applied from Batches tab.',
      );
    }
    appliedLaunchFiltersSignatureRef.current = launchFiltersSignature;
  }, [
    applyMprNavigationSession,
    batches,
    launchFilters,
    mprNavigationHydratedProjectRef,
    mprSessionProjectKey,
    parts,
    projectImageLookup,
    projectType,
    selectedPartId,
    setActiveInspectionViewTab,
    setSelectedImageRef,
    appliedLaunchFiltersSignatureRef,
    setActiveMetadataTab,
    setActiveOverlayIds,
    setManualFilterNotice,
    setReviewFilter,
    setSelectedBatchId,
    setSelectedPartId,
  ]);
}
