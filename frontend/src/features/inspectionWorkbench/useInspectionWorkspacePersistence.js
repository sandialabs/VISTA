import { useEffect } from 'react';
import { updateProjectWorkspaceState } from '../../api/projects';

/**
 * Debounced workspace state persistence and inspection share state publication.
 */
export default function useInspectionWorkspacePersistence({
  activeMetadataTab,
  activeMprPane,
  activeOverlayIds,
  activeSelectionId,
  cursorProbe,
  displayWindow,
  effectiveModalityImageFilterKey,
  effectivePrimaryImageFilterKey,
  effectiveSecondaryImageFilterKey,
  enabledModalities,
  hiddenModalityImageFilterValues,
  hiddenPrimaryImageFilterValues,
  hiddenSecondaryImageFilterValues,
  imageEnabled,
  inspectorViewport,
  loading,
  measurementEntries,
  modalityImageFilterKey,
  mprProjectionMirror,
  mprReconstructionMode,
  normalizationTriageField,
  onInspectionShareStateChange,
  panelLayout,
  partFilter,
  primaryImageFilterKey,
  projectId,
  projectType,
  rayMarchSettings,
  readOnly,
  reviewFilter,
  secondaryImageFilterKey,
  selectedBatchId,
  selectedImageRef,
  selectedPart,
  selectedPartId,
  shortcutHelpVisible,
  slicePosition,
  sortMode,
  viewportTransform,
  workspaceStateLoaded,
}) {
  useEffect(() => {
    if (loading || !workspaceStateLoaded) return;
    const saveHandle = setTimeout(async () => {
      try {
        await updateProjectWorkspaceState(projectId, {
          selected_batch_id: selectedBatchId || '',
          review_filter: reviewFilter,
          part_filter: partFilter,
          sort_mode: sortMode,
          selected_part_id: activeSelectionId,
          mpr: projectType === 'PT3'
            ? {
              slice_position: slicePosition,
              viewport_transform: viewportTransform,
              reconstruction_mode: mprReconstructionMode,
              ray_march_settings: rayMarchSettings,
              projection_mirror: mprProjectionMirror,
              display_window: displayWindow,
              active_overlay_ids: activeOverlayIds,
              cursor_probe: cursorProbe,
            }
            : undefined,
          inspector: {
            modalities: enabledModalities,
            primary_image_filter_key: effectivePrimaryImageFilterKey || primaryImageFilterKey || '',
            modality_image_filter_key: effectiveModalityImageFilterKey || modalityImageFilterKey || '',
            secondary_image_filter_key: effectiveSecondaryImageFilterKey || secondaryImageFilterKey || '',
            hidden_primary_image_filter_values: hiddenPrimaryImageFilterValues,
            hidden_modality_image_filter_values: hiddenModalityImageFilterValues,
            hidden_secondary_image_filter_values: hiddenSecondaryImageFilterValues,
            image_enabled: imageEnabled,
            shortcut_help_visible: shortcutHelpVisible,
            normalization_triage_field: normalizationTriageField || '',
            measurements: measurementEntries,
            viewport_transform: inspectorViewport,
          },
          panel_layout: panelLayout,
        }, { readOnly });
      } catch (_err) {
        // Workspace persistence is non-blocking for main workbench interactions.
      }
    }, 350);
    return () => clearTimeout(saveHandle);
  }, [
    activeOverlayIds,
    activeSelectionId,
    displayWindow,
    cursorProbe,
    reviewFilter,
    partFilter,
    enabledModalities,
    effectivePrimaryImageFilterKey,
    effectiveModalityImageFilterKey,
    effectiveSecondaryImageFilterKey,
    hiddenPrimaryImageFilterValues,
    hiddenModalityImageFilterValues,
    hiddenSecondaryImageFilterValues,
    imageEnabled,
    shortcutHelpVisible,
    loading,
    measurementEntries,
    normalizationTriageField,
    inspectorViewport,
    panelLayout,
    projectId,
    projectType,
    mprReconstructionMode,
    mprProjectionMirror,
    rayMarchSettings,
    readOnly,
    selectedBatchId,
    selectedPart,
    primaryImageFilterKey,
    modalityImageFilterKey,
    secondaryImageFilterKey,
    slicePosition,
    sortMode,
    viewportTransform,
    workspaceStateLoaded,
  ]);



  useEffect(() => {
    if (typeof onInspectionShareStateChange !== 'function' || loading || !workspaceStateLoaded) return;
    onInspectionShareStateChange({
      selectedBatchId,
      selectedPartId: activeSelectionId || selectedPartId,
      selectedImageRef,
      reviewFilter,
      activeMetadataTab,
      activeMprPane: projectType === 'PT3' ? activeMprPane : '',
      activeOverlayIds: projectType === 'PT3' ? activeOverlayIds : [],
    }, { replace: true });
  }, [
    activeMetadataTab,
    activeMprPane,
    activeSelectionId,
    activeOverlayIds,
    loading,
    onInspectionShareStateChange,
    projectType,
    reviewFilter,
    selectedBatchId,
    selectedImageRef,
    selectedPartId,
    workspaceStateLoaded,
  ]);
}
