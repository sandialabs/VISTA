import { useMemo } from 'react';
import { normalizeConfigurationSection, normalizeLower, normalizeOverlayIndicator } from './configurationSchema';

// Builds the stable set of config-entry mutation callbacks (defect types, image
// modalities, part views/sides, filename entries, overlay indicator) that the
// configuration panel passes into its subtab markup. Depends only on setConfig,
// so the returned callbacks keep a stable identity across renders.
export function useConfigEntryMutations(setConfig) {
  return useMemo(() => {
    const addDefectType = () => {
      setConfig((previous) => ({
        ...previous,
        defect_types: [
          ...previous.defect_types,
          { name: '', color: '#ef4444', definition: '' },
        ],
      }));
    };

    const updateDefectType = (index, patch) => {
      setConfig((previous) => ({
        ...previous,
        defect_types: previous.defect_types.map((defectType, defectIndex) =>
          defectIndex === index ? { ...defectType, ...patch } : defectType,
        ),
      }));
    };

    const removeDefectType = (index) => {
      setConfig((previous) => ({
        ...previous,
        defect_types: previous.defect_types.filter((_, defectIndex) => defectIndex !== index),
      }));
    };

    const addImageModality = () => {
      setConfig((previous) => ({
        ...previous,
        image_modalities: [
          ...(previous.image_modalities || []),
          { id: '', label: '', calibration_required: false, example_image_uploaded: false },
        ],
      }));
    };

    const updateImageModality = (index, patch) => {
      setConfig((previous) => {
        const previousId = previous.image_modalities?.[index]?.id;
        const nextId = patch.id;
        return {
          ...previous,
          image_modalities: (previous.image_modalities || []).map((modality, modalityIndex) =>
            modalityIndex === index ? { ...modality, ...patch } : modality,
          ),
          part_views: nextId !== undefined && normalizeLower(previousId) !== normalizeLower(nextId)
            ? (previous.part_views || []).map((partView) => ({
                ...partView,
                required_modalities: (partView.required_modalities || []).map((requiredModality) =>
                  normalizeLower(requiredModality) === normalizeLower(previousId) ? nextId : requiredModality,
                ),
              }))
            : previous.part_views,
        };
      });
    };

    const removeImageModality = (index) => {
      setConfig((previous) => {
        const removedId = previous.image_modalities?.[index]?.id;
        return {
          ...previous,
          image_modalities: (previous.image_modalities || []).filter((_, modalityIndex) => modalityIndex !== index),
          part_views: (previous.part_views || []).map((partView) => ({
            ...partView,
            required_modalities: (partView.required_modalities || []).filter(
              (requiredModality) => normalizeLower(requiredModality) !== normalizeLower(removedId),
            ),
          })),
        };
      });
    };

    const addPartView = () => {
      setConfig((previous) => ({
        ...previous,
        part_views: [
          ...(previous.part_views || []),
          { id: '', label: '', required_modalities: [], source: 'manual' },
        ],
      }));
    };

    const updatePartView = (index, patch) => {
      setConfig((previous) => ({
        ...previous,
        part_views: (previous.part_views || []).map((partView, partViewIndex) =>
          partViewIndex === index ? { ...partView, ...patch } : partView,
        ),
      }));
    };

    const removePartView = (index) => {
      setConfig((previous) => ({
        ...previous,
        part_views: (previous.part_views || []).filter((_, partViewIndex) => partViewIndex !== index),
      }));
    };

    const updateFileNameEntry = (entryType, index, patch) => {
      setConfig((previous) => ({
        ...previous,
        file_naming_scheme: {
          ...normalizeConfigurationSection('file_naming_scheme', previous),
          [entryType]: normalizeConfigurationSection('file_naming_scheme', previous)[entryType].map((entry, entryIndex) =>
            entryIndex === index ? { ...entry, ...patch } : entry,
          ),
        },
      }));
    };

    const addFileNameEntry = (entryType) => {
      setConfig((previous) => ({
        ...previous,
        file_naming_scheme: {
          ...normalizeConfigurationSection('file_naming_scheme', previous),
          [entryType]: [...normalizeConfigurationSection('file_naming_scheme', previous)[entryType], { id: 'other', label: '', abbreviation: '' }],
        },
      }));
    };

    const removeFileNameEntry = (entryType, index) => {
      setConfig((previous) => ({
        ...previous,
        file_naming_scheme: {
          ...normalizeConfigurationSection('file_naming_scheme', previous),
          [entryType]: normalizeConfigurationSection('file_naming_scheme', previous)[entryType].filter((_, entryIndex) => entryIndex !== index),
        },
      }));
    };

    const updateOverlayIndicator = (patch) => {
      setConfig((previous) => {
        const currentScheme = normalizeConfigurationSection('file_naming_scheme', previous);
        return {
          ...previous,
          file_naming_scheme: {
            ...currentScheme,
            overlay_indicator: normalizeOverlayIndicator({
              ...currentScheme.overlay_indicator,
              ...patch,
            }),
          },
        };
      });
    };

    return {
      addDefectType,
      updateDefectType,
      removeDefectType,
      addImageModality,
      updateImageModality,
      removeImageModality,
      addPartView,
      updatePartView,
      removePartView,
      updateFileNameEntry,
      addFileNameEntry,
      removeFileNameEntry,
      updateOverlayIndicator,
    };
  }, [setConfig]);
}
