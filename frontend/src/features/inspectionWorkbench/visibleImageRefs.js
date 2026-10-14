import { getMetadataFilterValue } from './imageLookup';

function filterImageRefsByVisibility({
  annotationsVisible,
  effectiveModalityImageFilterKey,
  effectivePrimaryImageFilterKey,
  effectiveSecondaryImageFilterKey,
  enabledModalities,
  hiddenModalityImageFilterValues,
  hiddenPrimaryImageFilterValues,
  hiddenSecondaryImageFilterValues,
  projectConfiguration,
  projectImageLookup,
  projectType,
  renderCategories,
  selectedPartImageRefs,
}) {
  const enabled = new Set(enabledModalities.map((name) => String(name).toLowerCase()));
  const hiddenPrimary = new Set(hiddenPrimaryImageFilterValues.map((value) => String(value).toLowerCase()));
  const hiddenModality = new Set(hiddenModalityImageFilterValues.map((value) => String(value).toLowerCase()));
  const hiddenSecondary = new Set(hiddenSecondaryImageFilterValues.map((value) => String(value).toLowerCase()));
  const configuredModalityIds = new Set(
    (Array.isArray(projectConfiguration?.image_modalities) ? projectConfiguration.image_modalities : [])
      .map((modality) => String(modality?.id || '').trim().toLowerCase())
      .filter(Boolean),
  );
  return selectedPartImageRefs.filter((entry) => {
    const category = entry.cropChild ? 'crop' : (entry.overlay ? 'overlay' : 'source');
    if (!(projectType === 'PT3' && category === 'overlay') && !renderCategories.includes(category)) return false;
    if (entry.hidden === true) return false;
    if (entry.overlay && !annotationsVisible) return false;
    if (
      effectivePrimaryImageFilterKey
      && hiddenPrimary.has(getMetadataFilterValue(entry, effectivePrimaryImageFilterKey, projectImageLookup))
    ) return false;
    if (
      effectiveModalityImageFilterKey
      && hiddenModality.has(getMetadataFilterValue(entry, effectiveModalityImageFilterKey, projectImageLookup))
    ) return false;
    if (
      effectiveSecondaryImageFilterKey
      && hiddenSecondary.has(getMetadataFilterValue(entry, effectiveSecondaryImageFilterKey, projectImageLookup))
    ) return false;
    const modality = String(entry.modality || '').toLowerCase();
    const modalityVisible = entry.cropChild
      || !modality
      || modality === 'analyze-overlay'
      || modality === 'overlay'
      || (entry.overlay && configuredModalityIds.size > 0 && !configuredModalityIds.has(modality))
      || enabled.has(modality);
    if (!modalityVisible) return false;
    if (entry.overlay && (entry.overlayBaseImageId || entry.overlayBaseFilename)) return true;
    return true;
  });
}

function suppressOverlaidSourceImageRefs(categoryFiltered) {
  const sourceEntries = categoryFiltered.filter((entry) => !entry.overlay);
  const suppressedSourceEntryIds = new Set();
  categoryFiltered.forEach((entry) => {
    if (!entry.overlay) return;
    const baseImageId = String(entry.overlayBaseImageId || '').trim();
    if (baseImageId) {
      sourceEntries
        .filter((sourceEntry) => String(sourceEntry.imageId || '').trim() === baseImageId)
        .forEach((sourceEntry) => suppressedSourceEntryIds.add(sourceEntry.id));
      return;
    }
    const baseFilename = String(entry.overlayBaseFilename || '').trim();
    if (!baseFilename) return;
    const filenameMatches = sourceEntries.filter(
      (sourceEntry) => String(sourceEntry.filename || '').trim() === baseFilename,
    );
    if (filenameMatches.length === 1) suppressedSourceEntryIds.add(filenameMatches[0].id);
  });
  if (suppressedSourceEntryIds.size === 0) return categoryFiltered;
  return categoryFiltered.filter((entry) => {
    if (entry.overlay) return true;
    return !suppressedSourceEntryIds.has(entry.id);
  });
}

/**
 * Returns the image references visible under the active category, metadata, and modality filters.
 * Source images covered by a visible overlay are hidden when overlays render.
 */
export function getVisibleInspectionImageRefs(options) {
  const categoryFiltered = filterImageRefsByVisibility(options);
  if (options.projectType !== 'PT3' && !options.renderCategories.includes('overlay')) return categoryFiltered;
  return suppressOverlaidSourceImageRefs(categoryFiltered);
}
