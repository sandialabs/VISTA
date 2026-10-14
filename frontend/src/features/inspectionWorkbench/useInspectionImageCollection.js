import { useMemo } from 'react';
import { applyInspectionImageDisplayOrder, sortInspectionImageDisplayEntries } from './imageSorting';
import {
  getAggregateLayerAvailability,
  getAggregateModalities,
  getAggregatePartImageRefs,
  getAggregateViews,
  getAllLoadedImageRefModalities,
  getModalities,
  getPartImageRefs,
  isInspectionImageRefLoaded,
} from './partImageRefs';

/**
 * Aggregates part image references for the All Images view and orders the selected part's image references.
 */
export default function useInspectionImageCollection({
  allPartsImageSortLayers,
  filteredParts,
  isAllImagesSelection,
  projectConfiguration,
  projectImageLookup,
  selectedPart,
}) {
  const aggregatePartImageRefs = useMemo(
    () => getAggregatePartImageRefs(filteredParts, projectImageLookup),
    [filteredParts, projectImageLookup],
  );
  const aggregateViews = useMemo(
    () => getAggregateViews(aggregatePartImageRefs),
    [aggregatePartImageRefs],
  );
  const aggregateModalities = useMemo(
    () => getAggregateModalities(aggregatePartImageRefs, projectConfiguration),
    [aggregatePartImageRefs, projectConfiguration],
  );
  const aggregateLoadedModalities = useMemo(
    () => getAllLoadedImageRefModalities(aggregatePartImageRefs, projectConfiguration),
    [aggregatePartImageRefs, projectConfiguration],
  );
  const aggregateLayerAvailability = useMemo(
    () => getAggregateLayerAvailability(aggregatePartImageRefs, filteredParts),
    [aggregatePartImageRefs, filteredParts],
  );
  const modalityOptions = useMemo(
    () => (isAllImagesSelection ? aggregateModalities : getModalities(selectedPart)),
    [aggregateModalities, isAllImagesSelection, selectedPart],
  );
  const selectedPartImageRefs = useMemo(() => {
    if (isAllImagesSelection) {
      return allPartsImageSortLayers.length > 0
        ? sortInspectionImageDisplayEntries(aggregatePartImageRefs, allPartsImageSortLayers, projectImageLookup)
        : aggregatePartImageRefs;
    }
    if (!selectedPart?.metadata || typeof selectedPart.metadata !== 'object') return [];
    const mappedEntries = getPartImageRefs(selectedPart)
      .filter((entry) => isInspectionImageRefLoaded(entry, projectImageLookup));
    const persistedOrder = Array.isArray(selectedPart.metadata.image_display_order)
      ? selectedPart.metadata.image_display_order
      : [];
    return applyInspectionImageDisplayOrder(mappedEntries, persistedOrder);
  }, [aggregatePartImageRefs, allPartsImageSortLayers, isAllImagesSelection, projectImageLookup, selectedPart]);
  return {
    aggregateLayerAvailability,
    aggregateLoadedModalities,
    aggregateModalities,
    aggregatePartImageRefs,
    aggregateViews,
    modalityOptions,
    selectedPartImageRefs,
  };
}
