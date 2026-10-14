import { DEFAULT_MODALITY_IMAGE_FILTER_KEY } from './inspectionConstants';
import { getMetadataFilterValue } from './imageLookup';
import { buildPartSummaryChipModel } from './partSummaryChipModel';

export function PartSummaryChipRows({ row, chipFilters }) {
  const {
    rowId,
    label,
    isSelected,
    collapsed,
    imageRefs = [],
    modalities = [],
    showViewsRow,
    showModalitiesRow,
    showLayersRow,
    onSelect,
  } = row;
  const {
    enabledModalities,
    projectImageLookup,
    effectivePrimaryImageFilterKey,
    effectiveSecondaryImageFilterKey,
    effectiveModalityImageFilterKey,
    hiddenPrimaryImageFilterValues,
    hiddenModalityImageFilterValues,
    hiddenSecondaryImageFilterValues,
    setSelectedImageRef,
    setPrimaryImageFilterKey,
    setHiddenPrimaryImageFilterValues,
    selectOnlyViewVisibility,
    setAllViewVisibility,
    setModalityImageFilterKey,
    setHiddenModalityImageFilterValues,
    setAllModalityVisibility,
    ensureRenderCategoryVisible,
    selectOnlyModalityFilterVisibility,
    selectOnlyModalityVisibility,
    setAllModalityFilterVisibility,
    setSecondaryImageFilterKey,
    setHiddenSecondaryImageFilterValues,
    selectOnlyLayerVisibility,
    setAllLayerVisibility,
  } = chipFilters;
  if (collapsed) return null;

  const {
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
  } = buildPartSummaryChipModel({
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
  });
  const getImageRefForEntry = (entry) => String(
    entry?.imageRef
    || entry?.imageId
    || entry?.image_id
    || entry?.filename
    || entry
    || '',
  );
  const selectImageEntry = (entry) => {
    const nextImageRef = getImageRefForEntry(entry);
    if (nextImageRef) setSelectedImageRef(nextImageRef);
  };
  const getImageRefForMetadataValue = (key, value) => imageRefs.find((entry) => (
    getMetadataFilterValue(entry, key, projectImageLookup) === String(value || '').toLowerCase()
  ));
  const formatMetadataButtonLabel = (value) => String(value || '').toUpperCase();

  return (
    <>
      {showViewsRow && primaryFilterValues.length > 0 && (
        <div className="part-summary-chip-group">
          <select
            id={`${rowId}-primary-metadata-filter-key`}
            className="part-summary-chip-key-select part-summary-chip-label"
            aria-label={`${label} primary image filter key`}
            value={primaryFilterKey}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              event.stopPropagation();
              setPrimaryImageFilterKey(event.target.value);
              setHiddenPrimaryImageFilterValues([]);
            }}
          >
            {primaryFilterKeyOptions.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
          <div className="part-summary-images" aria-label={`${label} view toggles`}>
            {primaryFilterValues.map((value) => {
              const isHidden = hiddenPrimaryValueSet.has(value);
              const imageEntry = getImageRefForMetadataValue(primaryFilterKey, value);
              return (
                <button
                  type="button"
                  key={`${rowId}-view-${value}`}
                  className={`btn btn-secondary btn-sm ${isSelected && selectedPrimaryOnlyVisible && !isHidden ? 'active' : ''} ${isHidden ? 'muted-toggle' : ''}`}
                  aria-pressed={!isHidden}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                    selectOnlyViewVisibility(primaryFilterValues, value);
                    if (imageEntry) selectImageEntry(imageEntry);
                  }}
                >
                  {formatMetadataButtonLabel(value)}
                </button>
              );
            })}
            <button
              type="button"
              className={`btn btn-secondary btn-sm part-summary-all-toggle ${allViewsToggleActive ? 'active' : 'muted-toggle'}`}
              aria-pressed={allViewsToggleActive}
              onClick={(event) => {
                event.stopPropagation();
                onSelect();
                setAllViewVisibility(primaryFilterValues, true);
              }}
            >
              ALL
            </button>
          </div>
        </div>
      )}
      {showModalitiesRow && modalityFilterValues.length > 0 && (
        <div className="part-summary-chip-group">
          <select
            id={`${rowId}-modality-metadata-filter-key`}
            className="part-summary-chip-key-select part-summary-chip-label"
            aria-label={`${label} modality image filter key`}
            value={modalityFilterKey}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              event.stopPropagation();
              setModalityImageFilterKey(event.target.value);
              setHiddenModalityImageFilterValues([]);
              if (event.target.value !== DEFAULT_MODALITY_IMAGE_FILTER_KEY) setAllModalityVisibility(modalities, true);
            }}
          >
            {modalityFilterKeyOptions.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
          <div className="part-summary-images part-summary-modalities" aria-label={`${label} modality toggles`}>
            {modalityFilterValues.map((value) => {
              const isHidden = isDefaultModalityFilter
                ? !enabledModalityKeys.includes(String(value).toLowerCase())
                : hiddenModalityValueSet.has(value);
              const matchingImage = getImageRefForMetadataValue(modalityFilterKey, value);
              return (
                <button
                  type="button"
                  key={`${rowId}-modality-${value}`}
                  className={`btn btn-secondary btn-sm ${isHidden ? 'muted-toggle' : 'active'}`}
                  aria-pressed={!isHidden}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                    if (matchingImage?.overlay && isHidden) ensureRenderCategoryVisible('overlay');
                    selectOnlyModalityFilterVisibility(modalityFilterValues, value);
                    if (isDefaultModalityFilter) {
                      selectOnlyModalityVisibility(modalities, value);
                    } else {
                      setAllModalityVisibility(modalities, true);
                    }
                    if (matchingImage) selectImageEntry(matchingImage);
                  }}
                >
                  {formatMetadataButtonLabel(value)}
                </button>
              );
            })}
            <button
              type="button"
              className={`btn btn-secondary btn-sm part-summary-all-toggle ${allModalitiesToggleActive ? 'active' : 'muted-toggle'}`}
              aria-pressed={allModalitiesToggleActive}
              onClick={(event) => {
                event.stopPropagation();
                onSelect();
                setAllModalityFilterVisibility(modalityFilterValues, !allModalitiesVisible);
                if (isDefaultModalityFilter) {
                  setAllModalityVisibility(modalities, !allModalitiesVisible);
                } else {
                  setAllModalityVisibility(modalities, true);
                }
              }}
            >
              ALL
            </button>
          </div>
        </div>
      )}
      {showLayersRow && secondaryFilterValues.length > 0 && (
        <div className="part-summary-chip-group">
          <select
            id={`${rowId}-secondary-metadata-filter-key`}
            className="part-summary-chip-key-select part-summary-chip-label"
            aria-label={`${label} secondary image filter key`}
            value={secondaryFilterKey}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              event.stopPropagation();
              setSecondaryImageFilterKey(event.target.value);
              setHiddenSecondaryImageFilterValues([]);
            }}
          >
            {secondaryFilterKeyOptions.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
          </select>
          <div className="part-summary-images part-summary-layers" aria-label={`${label} layer toggles`}>
            {secondaryFilterValues.map((value) => {
              const isVisible = !hiddenSecondaryValueSet.has(value);
              const matchingImage = getImageRefForMetadataValue(secondaryFilterKey, value);
              return (
              <button
                type="button"
                key={`${rowId}-layer-${value}`}
                className={`btn btn-secondary btn-sm ${isVisible ? 'active' : 'muted-toggle'}`}
                aria-pressed={isVisible}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect();
                  selectOnlyLayerVisibility(value, Object.fromEntries(secondaryFilterValues.map((entryValue) => [entryValue, true])));
                  if (matchingImage) selectImageEntry(matchingImage);
                }}
              >
                {formatMetadataButtonLabel(value)}
              </button>
              );
            })}
            <button
              type="button"
              className={`btn btn-secondary btn-sm part-summary-all-toggle ${allLayersToggleActive ? 'active' : 'muted-toggle'}`}
              aria-pressed={allLayersToggleActive}
              onClick={(event) => {
                event.stopPropagation();
                onSelect();
                setAllLayerVisibility(!allLayersVisible, Object.fromEntries(secondaryFilterValues.map((value) => [value, true])));
              }}
            >
              ALL
            </button>
          </div>
        </div>
      )}
    </>
  );
}
