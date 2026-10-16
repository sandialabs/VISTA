import { useEffect } from 'react';
import { normalizeSavedMeasurements } from './annotationListHelpers';
import {
  DEFAULT_MODALITY_IMAGE_FILTER_KEY,
  DEFAULT_PRIMARY_IMAGE_FILTER_KEY,
  DEFAULT_SECONDARY_IMAGE_FILTER_KEY,
} from './inspectionConstants';
import { normalizeTileViewportTransform } from './inspectionUtils';
import { getDiscoveredModalities, getModalities } from './partImageRefs';

/**
 * Hydrates inspector modalities, filters, measurements, viewport, and the annotation draft from the saved workspace state.
 */
export default function useInspectorWorkspaceHydration({
  aggregateLoadedModalities,
  isAllImagesSelection,
  selectedPart,
  setAnnotationDraft,
  setEnabledModalities,
  setHiddenModalityImageFilterValues,
  setHiddenPrimaryImageFilterValues,
  setHiddenSecondaryImageFilterValues,
  setImageEnabled,
  setInspectorViewport,
  setMeasurementEntries,
  setModalityImageFilterKey,
  setNormalizationTriageField,
  setPrimaryImageFilterKey,
  setSecondaryImageFilterKey,
  setShortcutHelpVisible,
  workspaceHydration,
}) {
  useEffect(() => {
    const savedInspector = workspaceHydration?.inspector || {};
    setShortcutHelpVisible(savedInspector.shortcut_help_visible === true);
    setNormalizationTriageField(
      typeof savedInspector.normalization_triage_field === 'string'
        ? savedInspector.normalization_triage_field
        : '',
    );
    const discoveredModalities = isAllImagesSelection
      ? aggregateLoadedModalities
      : getDiscoveredModalities(selectedPart);
    const discoveredModalityKeys = new Set(discoveredModalities.map((value) => String(value).toLowerCase()));
    const savedModalities = Array.isArray(savedInspector.modalities)
      ? savedInspector.modalities.map((value) => String(value)).filter((value) => discoveredModalityKeys.has(value.toLowerCase()))
      : [];
    setEnabledModalities(savedModalities.length > 0 ? savedModalities : discoveredModalities);
    setPrimaryImageFilterKey(
      savedInspector.primary_image_filter_key
        ? String(savedInspector.primary_image_filter_key)
        : DEFAULT_PRIMARY_IMAGE_FILTER_KEY,
    );
    setModalityImageFilterKey(
      savedInspector.modality_image_filter_key
        ? String(savedInspector.modality_image_filter_key)
        : DEFAULT_MODALITY_IMAGE_FILTER_KEY,
    );
    setSecondaryImageFilterKey(
      savedInspector.secondary_image_filter_key
        ? String(savedInspector.secondary_image_filter_key)
        : DEFAULT_SECONDARY_IMAGE_FILTER_KEY,
    );
    setHiddenPrimaryImageFilterValues(
      Array.isArray(savedInspector.hidden_primary_image_filter_values)
      ? savedInspector.hidden_primary_image_filter_values.map((value) => String(value).toLowerCase())
      : [],
    );
    setHiddenModalityImageFilterValues(
      Array.isArray(savedInspector.hidden_modality_image_filter_values)
        ? savedInspector.hidden_modality_image_filter_values.map((value) => String(value).toLowerCase())
        : [],
    );
    setHiddenSecondaryImageFilterValues(
      Array.isArray(savedInspector.hidden_secondary_image_filter_values)
        ? savedInspector.hidden_secondary_image_filter_values.map((value) => String(value).toLowerCase())
        : [],
    );
    setImageEnabled(typeof savedInspector.image_enabled === 'boolean' ? savedInspector.image_enabled : true);
    setMeasurementEntries(normalizeSavedMeasurements(savedInspector.measurements));
    const savedInspectorViewport = savedInspector.viewport_transform || {};
    setInspectorViewport(normalizeTileViewportTransform(savedInspectorViewport));
    setAnnotationDraft({
      defect_class: '',
      modality: (isAllImagesSelection ? aggregateLoadedModalities[0] : getModalities(selectedPart)[0]) || 'visual',
      comment: '',
      disposition: 'open',
      measurement_name: '',
      measurement_value: '',
    });
  }, [
    aggregateLoadedModalities,
    isAllImagesSelection,
    selectedPart,
    setAnnotationDraft,
    setEnabledModalities,
    setHiddenModalityImageFilterValues,
    setHiddenPrimaryImageFilterValues,
    setHiddenSecondaryImageFilterValues,
    setImageEnabled,
    workspaceHydration,
    setInspectorViewport,
    setMeasurementEntries,
    setModalityImageFilterKey,
    setNormalizationTriageField,
    setPrimaryImageFilterKey,
    setSecondaryImageFilterKey,
    setShortcutHelpVisible,
  ]);
}
