import { getImageMetadataFilterOptions, getPreferredMetadataFilterKey, getMetadataFilterValuesForKey, getMetadataFilterKeySelectOptions } from './imageLookup';
import { DEFAULT_PRIMARY_IMAGE_FILTER_KEY, DEFAULT_SECONDARY_IMAGE_FILTER_KEY, DEFAULT_MODALITY_IMAGE_FILTER_KEY } from './inspectionConstants';

export function buildPartSummaryChipModel({
  imageRefs,
  modalities,
  enabledModalities,
  projectImageLookup,
  effectivePrimaryImageFilterKey,
  effectiveSecondaryImageFilterKey,
  effectiveModalityImageFilterKey,
  hiddenPrimaryImageFilterValues,
  hiddenModalityImageFilterValues,
  hiddenSecondaryImageFilterValues,
}) {
  const enabledModalityKeys = enabledModalities.map((entry) => String(entry).toLowerCase());
  const rowMetadataFilterOptions = getImageMetadataFilterOptions(imageRefs, projectImageLookup);
  const rowMetadataKeys = rowMetadataFilterOptions.keys;
  const primaryFilterKey = getPreferredMetadataFilterKey(
    rowMetadataFilterOptions,
    effectivePrimaryImageFilterKey,
    DEFAULT_PRIMARY_IMAGE_FILTER_KEY,
  );
  const secondaryFilterKey = getPreferredMetadataFilterKey(
    rowMetadataFilterOptions,
    effectiveSecondaryImageFilterKey,
    DEFAULT_SECONDARY_IMAGE_FILTER_KEY,
  );
  const primaryFilterValues = getMetadataFilterValuesForKey(rowMetadataFilterOptions, primaryFilterKey);
  const modalityFilterKey = getPreferredMetadataFilterKey(
    rowMetadataFilterOptions,
    effectiveModalityImageFilterKey,
    DEFAULT_MODALITY_IMAGE_FILTER_KEY,
  );
  const modalityFilterValues = modalityFilterKey === DEFAULT_MODALITY_IMAGE_FILTER_KEY
    ? modalities.map((modality) => String(modality).toLowerCase()).filter(Boolean)
    : getMetadataFilterValuesForKey(rowMetadataFilterOptions, modalityFilterKey);
  const secondaryFilterValues = getMetadataFilterValuesForKey(rowMetadataFilterOptions, secondaryFilterKey);
  const primaryFilterKeyOptions = getMetadataFilterKeySelectOptions(rowMetadataKeys, primaryFilterKey);
  const modalityFilterKeyOptions = getMetadataFilterKeySelectOptions(rowMetadataKeys, modalityFilterKey);
  const secondaryFilterKeyOptions = getMetadataFilterKeySelectOptions(rowMetadataKeys, secondaryFilterKey);
  const hiddenPrimaryValueSet = new Set(hiddenPrimaryImageFilterValues.map((name) => String(name).toLowerCase()));
  const hiddenModalityValueSet = new Set(hiddenModalityImageFilterValues.map((name) => String(name).toLowerCase()));
  const hiddenSecondaryValueSet = new Set(hiddenSecondaryImageFilterValues.map((name) => String(name).toLowerCase()));
  const visiblePrimaryValues = primaryFilterValues.filter((value) => !hiddenPrimaryValueSet.has(value));
  const selectedPrimaryOnlyVisible = primaryFilterValues.length > 1 && visiblePrimaryValues.length === 1;
  const allViewsVisible = primaryFilterValues.length > 0
    && primaryFilterValues.every((value) => !hiddenPrimaryValueSet.has(value));
  const allViewsToggleActive = allViewsVisible && !selectedPrimaryOnlyVisible;
  const isDefaultModalityFilter = modalityFilterKey === DEFAULT_MODALITY_IMAGE_FILTER_KEY;
  const selectedModalityOnlyVisible = isDefaultModalityFilter
    ? modalityFilterValues.length > 1
      && enabledModalityKeys.filter((modality) => modalityFilterValues.includes(modality)).length === 1
    : modalityFilterValues.length > 1
      && modalityFilterValues.filter((value) => !hiddenModalityValueSet.has(value)).length === 1;
  const allModalitiesVisible = isDefaultModalityFilter
    ? modalityFilterValues.length > 0
      && modalityFilterValues.every((modality) => enabledModalityKeys.includes(String(modality).toLowerCase()))
    : modalityFilterValues.length > 0
      && modalityFilterValues.every((value) => !hiddenModalityValueSet.has(value));
  const allModalitiesToggleActive = allModalitiesVisible && !selectedModalityOnlyVisible;
  const allLayersVisible = secondaryFilterValues.length > 0
    && secondaryFilterValues.every((value) => !hiddenSecondaryValueSet.has(value));
  const allLayersToggleActive = allLayersVisible && !(secondaryFilterValues.length > 1 && secondaryFilterValues.filter((value) => !hiddenSecondaryValueSet.has(value)).length === 1);
  return {
    enabledModalityKeys,
    primaryFilterKey,
    secondaryFilterKey,
    primaryFilterValues,
    modalityFilterKey,
    modalityFilterValues,
    secondaryFilterValues,
    primaryFilterKeyOptions,
    modalityFilterKeyOptions,
    secondaryFilterKeyOptions,
    hiddenPrimaryValueSet,
    hiddenModalityValueSet,
    hiddenSecondaryValueSet,
    selectedPrimaryOnlyVisible,
    allViewsToggleActive,
    isDefaultModalityFilter,
    allModalitiesVisible,
    allModalitiesToggleActive,
    allLayersVisible,
    allLayersToggleActive,
  };
}
