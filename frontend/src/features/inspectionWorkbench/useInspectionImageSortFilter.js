import { useCallback, useMemo, useRef, useState } from 'react';
import { updatePartImageDisplayOrder } from '../../api/parts';
import { getImageMetadataFilterOptions, getPreferredMetadataFilterKey } from './imageLookup';
import {
  DEFAULT_INSPECTION_IMAGE_SORT_ID,
  getInspectionImageOrderKey,
  getInspectionImageSortSelectOptions,
  normalizeInspectionImageSortLayers,
  sortInspectionImageDisplayEntries,
} from './imageSorting';
import { DEFAULT_MODALITY_IMAGE_FILTER_KEY, DEFAULT_PRIMARY_IMAGE_FILTER_KEY, DEFAULT_SECONDARY_IMAGE_FILTER_KEY } from './inspectionConstants';
import useInspectionImageFilterVisibility from './useInspectionImageFilterVisibility';
import useInspectionImageSortControls from './useInspectionImageSortControls';
import { getVisibleInspectionImageRefs } from './visibleImageRefs';

/**
 * Image sort options and persistence (including save progress), metadata filter keys and visibility, and the
 * visible image reference list.
 */
export default function useInspectionImageSortFilter({
  activeSelectionId,
  aggregatePartImageRefs,
  annotationsVisible,
  enabledModalities,
  isAllImagesSelection,
  modalityImageFilterKey,
  primaryImageFilterKey,
  projectConfiguration,
  projectId,
  projectImageLookup,
  projectType,
  readOnly,
  renderCategories,
  secondaryImageFilterKey,
  selectedPart,
  selectedPartId,
  selectedPartImageRefs,
  setAllPartsImageSortLayers,
  setAnnotationsVisible,
  setParts,
  tileSizeRangeInputRef,
}) {
  const [imageOrderSaving, setImageOrderSaving] = useState(false);
  const [imageOrderError, setImageOrderError] = useState('');
  const [imageOrderAnnouncement, setImageOrderAnnouncement] = useState('');
  const imageOrderSaveRequestRef = useRef(null);
  const resetImageOrderProgress = useCallback(() => {
    imageOrderSaveRequestRef.current = null;
    setImageOrderSaving(false);
    setImageOrderError('');
    setImageOrderAnnouncement('');
  }, []);
  const selectedPartImageOrderKeys = useMemo(
    () => selectedPartImageRefs.map(getInspectionImageOrderKey).filter(Boolean),
    [selectedPartImageRefs],
  );
  const sortableImageRefs = isAllImagesSelection ? aggregatePartImageRefs : selectedPartImageRefs;
  const imageSortOptions = useMemo(
    () => getInspectionImageSortSelectOptions(sortableImageRefs, projectImageLookup),
    [projectImageLookup, sortableImageRefs],
  );
  const {
    imageOrderFocusRestoreRef,
    imageSortButtonRef,
    imageSortLayers,
    imageSortMenuOpen,
    imageSortMenuRef,
    setImageSortMenuOpen,
    toggleImageSortMenu,
    updateImageSortLayer,
    addImageSortLayer,
    removeImageSortLayer,
  } = useInspectionImageSortControls({
    activeSelectionId,
    defaultSortId: DEFAULT_INSPECTION_IMAGE_SORT_ID,
    imageOrderSaving,
    imageSortOptions,
    isAllImagesSelection,
    normalizeSortLayers: normalizeInspectionImageSortLayers,
    projectId,
    readOnly,
    selectedPart,
    selectedPartId,
    selectedPartImageOrderKeyCount: selectedPartImageOrderKeys.length,
    setImageOrderError,
    resetImageOrderProgress,
    tileSizeRangeInputRef,
  });
  const effectiveImageSortLayers = useMemo(
    () => normalizeInspectionImageSortLayers(imageSortLayers, imageSortOptions),
    [imageSortLayers, imageSortOptions],
  );
  const metadataFilterOptions = useMemo(
    () => getImageMetadataFilterOptions(selectedPartImageRefs, projectImageLookup),
    [projectImageLookup, selectedPartImageRefs],
  );
  const effectivePrimaryImageFilterKey = useMemo(
    () => getPreferredMetadataFilterKey(
      metadataFilterOptions,
      primaryImageFilterKey,
      DEFAULT_PRIMARY_IMAGE_FILTER_KEY,
    ),
    [metadataFilterOptions, primaryImageFilterKey],
  );
  const effectiveModalityImageFilterKey = useMemo(
    () => getPreferredMetadataFilterKey(
      metadataFilterOptions,
      modalityImageFilterKey,
      DEFAULT_MODALITY_IMAGE_FILTER_KEY,
    ),
    [metadataFilterOptions, modalityImageFilterKey],
  );
  const effectiveSecondaryImageFilterKey = useMemo(
    () => getPreferredMetadataFilterKey(
      metadataFilterOptions,
      secondaryImageFilterKey,
      DEFAULT_SECONDARY_IMAGE_FILTER_KEY,
    ),
    [metadataFilterOptions, secondaryImageFilterKey],
  );
  const {
    hiddenPrimaryImageFilterValues,
    hiddenModalityImageFilterValues,
    hiddenSecondaryImageFilterValues,
    selectOnlyLayerVisibility,
    selectOnlyModalityFilterVisibility,
    selectOnlyViewVisibility,
    setAllLayerVisibility,
    setAllModalityFilterVisibility,
    setAllViewVisibility,
    setHiddenPrimaryImageFilterValues,
    setHiddenModalityImageFilterValues,
    setHiddenSecondaryImageFilterValues,
  } = useInspectionImageFilterVisibility({
    defaultSecondaryImageFilterKey: DEFAULT_SECONDARY_IMAGE_FILTER_KEY,
    effectiveSecondaryImageFilterKey,
    setAnnotationsVisible,
  });
  const saveImageSortOrder = useCallback(async (sortLayers) => {
    if (
      readOnly
      || imageOrderSaving
      || imageOrderSaveRequestRef.current
      || selectedPartImageOrderKeys.length < 2
    ) return;
    const normalizedSortLayers = normalizeInspectionImageSortLayers(sortLayers, imageSortOptions, false);
    const sortLabel = normalizedSortLayers
      .map((sortId) => imageSortOptions.find((option) => option.id === sortId)?.label || sortId)
      .join(', then ');

    if (isAllImagesSelection) {
      setAllPartsImageSortLayers(normalizedSortLayers);
      setImageSortMenuOpen(false);
      setImageOrderError('');
      setImageOrderAnnouncement(`Images sorted by ${sortLabel}.`);
      imageSortButtonRef.current?.focus();
      return;
    }

    if (!selectedPart) return;

    const sortedEntries = sortInspectionImageDisplayEntries(
      selectedPartImageRefs,
      normalizedSortLayers,
      projectImageLookup,
    );
    const imageRefs = sortedEntries.map(getInspectionImageOrderKey).filter(Boolean);
    const requestProjectId = String(projectId);
    const requestPartId = String(selectedPart.id);
    const requestToken = {};
    imageOrderSaveRequestRef.current = requestToken;
    imageOrderFocusRestoreRef.current = { projectId: requestProjectId, partId: requestPartId };
    setImageSortMenuOpen(false);
    setImageOrderSaving(true);
    setImageOrderError('');
    setImageOrderAnnouncement(`Saving image sort: ${sortLabel}.`);
    try {
      const updatedPart = await updatePartImageDisplayOrder(
        projectId,
        selectedPart.id,
        imageRefs,
        { readOnly, errorLabel: 'Unable to save image order' },
      );
      const savedImageOrder = updatedPart?.metadata?.image_display_order;
      setParts((previous) => previous.map((part) => (
        String(part.id) === requestPartId && Array.isArray(savedImageOrder)
          ? {
            ...part,
            metadata: {
              ...(part.metadata && typeof part.metadata === 'object' ? part.metadata : {}),
              image_display_order: [...savedImageOrder],
            },
          }
          : part
      )));
      if (imageOrderSaveRequestRef.current !== requestToken) return;
      setImageOrderAnnouncement(`Images sorted by ${sortLabel}.`);
    } catch (saveError) {
      if (imageOrderSaveRequestRef.current !== requestToken) return;
      setImageOrderError(saveError?.message || 'Unable to save image order.');
      setImageOrderAnnouncement('Image display order was not saved.');
    } finally {
      if (imageOrderSaveRequestRef.current === requestToken) {
        imageOrderSaveRequestRef.current = null;
        setImageOrderSaving(false);
      }
    }
  }, [
    imageOrderFocusRestoreRef,
    imageOrderSaving,
    imageSortButtonRef,
    imageSortOptions,
    isAllImagesSelection,
    projectId,
    projectImageLookup,
    readOnly,
    selectedPart,
    selectedPartImageOrderKeys.length,
    selectedPartImageRefs,
    setImageSortMenuOpen,
    setAllPartsImageSortLayers,
    setParts,
  ]);
  const visibleSelectedPartImageRefs = useMemo(() => getVisibleInspectionImageRefs({
    annotationsVisible,
    effectivePrimaryImageFilterKey,
    effectiveModalityImageFilterKey,
    effectiveSecondaryImageFilterKey,
    enabledModalities,
    hiddenPrimaryImageFilterValues,
    hiddenModalityImageFilterValues,
    hiddenSecondaryImageFilterValues,
    projectConfiguration,
    projectImageLookup,
    projectType,
    renderCategories,
    selectedPartImageRefs,
  }), [
    annotationsVisible,
    effectivePrimaryImageFilterKey,
    effectiveModalityImageFilterKey,
    effectiveSecondaryImageFilterKey,
    enabledModalities,
    hiddenPrimaryImageFilterValues,
    hiddenModalityImageFilterValues,
    hiddenSecondaryImageFilterValues,
    projectConfiguration,
    projectImageLookup,
    projectType,
    renderCategories,
    selectedPartImageRefs,
  ]);
  return {
    addImageSortLayer,
    effectiveImageSortLayers,
    effectiveModalityImageFilterKey,
    effectivePrimaryImageFilterKey,
    effectiveSecondaryImageFilterKey,
    hiddenModalityImageFilterValues,
    hiddenPrimaryImageFilterValues,
    hiddenSecondaryImageFilterValues,
    imageOrderAnnouncement,
    imageOrderError,
    imageOrderSaving,
    imageSortButtonRef,
    imageSortMenuOpen,
    imageSortMenuRef,
    imageSortOptions,
    removeImageSortLayer,
    saveImageSortOrder,
    selectOnlyLayerVisibility,
    selectOnlyModalityFilterVisibility,
    selectOnlyViewVisibility,
    selectedPartImageOrderKeys,
    setAllLayerVisibility,
    setAllModalityFilterVisibility,
    setAllViewVisibility,
    setHiddenModalityImageFilterValues,
    setHiddenPrimaryImageFilterValues,
    setHiddenSecondaryImageFilterValues,
    toggleImageSortMenu,
    updateImageSortLayer,
    visibleSelectedPartImageRefs,
  };
}
