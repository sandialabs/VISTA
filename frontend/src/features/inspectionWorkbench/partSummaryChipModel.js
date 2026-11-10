import {
  getDefaultMetadataFilterKeys,
  getImageMetadataFilterOptions,
  getMetadataFilterDisplayValue,
  getPreferredMetadataFilterKey,
  getMetadataFilterValuesForKey,
  getMetadataFilterKeySelectOptions,
  SYSTEM_CATEGORY_FILTER_KEYS,
} from './imageLookup';
import { DEFAULT_SECONDARY_IMAGE_FILTER_KEY, MODALITY_METADATA_KEY } from './inspectionConstants';

export function buildPartSummaryChipModel({
  imageRefs = [],
  modalities = [],
  enabledModalities = [],
  projectImageLookup,
  effectivePrimaryImageFilterKey,
  effectiveSecondaryImageFilterKey,
  effectiveModalityImageFilterKey,
  hiddenPrimaryImageFilterValues = [],
  hiddenModalityImageFilterValues = [],
  hiddenSecondaryImageFilterValues = [],
  configuredImageFilterKeys = [],
}) {
  const safeModalities = Array.isArray(modalities) ? modalities : [];
  const enabledModalityKeys = (Array.isArray(enabledModalities) ? enabledModalities : [])
    .map((entry) => String(entry).toLowerCase());
  const rowMetadataFilterOptions = getImageMetadataFilterOptions(imageRefs, projectImageLookup);
  const rowMetadataKeys = rowMetadataFilterOptions.keys;
  const rowDefaultKeys = getDefaultMetadataFilterKeys(rowMetadataFilterOptions, configuredImageFilterKeys);
  const primaryFilterKey = getPreferredMetadataFilterKey(
    rowMetadataFilterOptions,
    effectivePrimaryImageFilterKey,
    rowDefaultKeys.primary,
    { allowAnyKey: false },
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
    rowDefaultKeys.modality,
    { allowAnyKey: false },
  );
  // The modality-visibility toggles apply only when the row groups by the
  // user's own "modality" key; values come from the images themselves.
  const isDefaultModalityFilter = modalityFilterKey === MODALITY_METADATA_KEY;
  const modalityFilterValues = isDefaultModalityFilter
    ? safeModalities.map((modality) => String(modality).toLowerCase()).filter(Boolean)
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
  const modalityDisplayValues = new Map(
    safeModalities.map((modality) => [String(modality).toLowerCase(), String(modality)]),
  );
  // User metadata values are displayed exactly as supplied. VISTA's own system
  // fields (e.g. layer: source/overlay/crop) keep their upper-case styling.
  const getDisplayValue = (key, value) => {
    if (SYSTEM_CATEGORY_FILTER_KEYS.has(key)) return String(value || '').toUpperCase();
    if (key === modalityFilterKey && isDefaultModalityFilter && modalityDisplayValues.has(value)) {
      return modalityDisplayValues.get(value);
    }
    return getMetadataFilterDisplayValue(rowMetadataFilterOptions, key, value);
  };
  return {
    getDisplayValue,
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
